// audio-cd: author a Red Book Audio CD from a FLAC (+ CUE) rip.
// Source directory is read-only. Everything generated lives in the workdir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('util');
const { decodeCue, parseCue, rewriteCue, splitTracks } = require('./cue.js');
const { findCue, resolveSource, planSource, wavName } = require('./source.js');
const { readWavInfo, readFlacInfo, wavPcmMd5, cdDaProblems } = require('./audio.js');
const { FPS, sectorsForSamples, formatMinSec } = require('./msf.js');
const { tocAudioFiles, tocType, stripCdText, parseShowToc, parseScanbus } = require('./toc.js');
const { run, setCommandLog, killCurrent } = require('./run.js');

const USAGE = `usage: audio-cd <album-dir | file.cue> [options]

Validates the rip, builds a cdrdao TOC in a temporary workdir, and simulates
the burn. Nothing is written to a disc unless --burn is given.

  --burn             write the disc after validation and a successful simulation
  --check            validate and build the TOC only; don't touch the drive
  --device DEV       cdrdao device (default: the only drive cdrdao scanbus finds)
  --speed N          write/simulate speed
  --capacity MIN     blank capacity in minutes (default 80)
  --cue NAME         which .cue to use when the directory has several
  --appended-gaps    accept "gaps appended to previous track" CUEs (drops those INDEX 00 markers; audio unchanged)
  --workdir PATH     use PATH (new or empty) instead of a temp dir
  --keep-workdir     keep the workdir afterwards and print its path
  --verbose          show ffmpeg commands and per-file detail
  -h, --help`;

class Fail extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const LEAD_IN_PREGAP = 2 * FPS; // track 1's mandatory 2 s pregap, on every disc

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        burn: { type: 'boolean' }, check: { type: 'boolean' }, device: { type: 'string' }, speed: { type: 'string' },
        capacity: { type: 'string' }, cue: { type: 'string' }, 'appended-gaps': { type: 'boolean' },
        workdir: { type: 'string' }, 'keep-workdir': { type: 'boolean' }, verbose: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (e) {
    throw new Fail(`${e.message}\n\n${USAGE}`, 2);
  }
  const { values: v, positionals } = parsed;
  if (v.help) return { help: true };
  if (positionals.length !== 1) throw new Fail(USAGE, 2);
  if (v.burn && v.check) throw new Fail('--burn and --check contradict each other', 2);
  const capacity = v.capacity === undefined ? 80 : Number(v.capacity);
  if (!(capacity > 0)) throw new Fail(`--capacity must be a positive number of minutes, got ${v.capacity}`, 2);
  if (v.speed !== undefined && !/^\d+$/.test(v.speed)) throw new Fail(`--speed must be a whole number, got ${v.speed}`, 2);
  return { input: positionals[0], ...v, capacity, appendedGaps: v['appended-gaps'], keepWorkdir: v['keep-workdir'] };
}

function which(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* keep looking */ }
  }
  return null;
}

function requireTools(names) {
  const missing = names.filter((n) => !which(n));
  if (missing.length) {
    throw new Fail(`missing required tool(s): ${missing.join(', ')}\n  install: brew install ffmpeg cdrdao   (cue2toc: see docs/runbooks/audio-cd.md)`);
  }
}

// Workdir: fresh temp dir, or an explicit one that is new/empty and outside the source.
function makeWorkdir(opt, sourceDir) {
  let dir;
  if (opt) {
    dir = path.resolve(opt);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Fail(`--workdir ${dir} is not empty`);
    fs.mkdirSync(dir, { recursive: true });
  } else {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cd-'));
  }
  const real = fs.realpathSync(dir);
  const src = fs.realpathSync(sourceDir);
  if (real === src || real.startsWith(src + path.sep)) {
    fs.rmdirSync(dir);
    throw new Fail(`workdir ${real} is inside the source directory; refusing to write there`);
  }
  return real;
}

function capacityReport(trackCount, usedSectors, capacityMin) {
  const cap = Math.round(capacityMin * 60 * FPS);
  const left = cap - usedSectors;
  return {
    fits: left >= 0,
    text: [
      `Disc: ${trackCount} tracks`,
      `Total: ${formatMinSec(usedSectors)}`,
      `Capacity: ${formatMinSec(cap)}`,
      left >= 0 ? `Remaining: ${formatMinSec(left)}` : `Over by: ${formatMinSec(-left)}`,
      `Status: ${left >= 0 ? 'FITS' : 'DOES NOT FIT'}`,
    ].join('\n'),
  };
}

async function main(argv, { onWorkdir } = {}) {
  const opts = parse(argv);
  if (opts.help) { console.log(USAGE); return 0; }
  const log = (...a) => console.log(...a);
  const detail = (...a) => opts.verbose && console.log(...a);

  // 1-2. CUE + sources (read-only)
  const cuePath = findCue(opts.input, opts.cue);
  const sourceDir = path.dirname(cuePath);
  const cue = parseCue(decodeCue(fs.readFileSync(cuePath)));
  rewriteCue(cue, cue.files.map(() => 'x.wav'), { appendedGaps: opts.appendedGaps }); // layout check, fails early
  log(`CUE: ${cuePath}`);
  log(`Tracks: ${cue.tracks.length} in ${cue.files.length} FILE(s)`);
  if (opts.appendedGaps && splitTracks(cue).some((s) => s.gap)) {
    log('Note: --appended-gaps: gap audio stays at the end of the previous track; INDEX 00 markers dropped');
  }

  const sources = new Map(); // resolved source path -> plan
  const fileSources = cue.files.map((f) => {
    const src = resolveSource(sourceDir, f.name);
    const key = src.flac || src.wav;
    if (!sources.has(key)) sources.set(key, planSource(src));
    return sources.get(key);
  });
  const taken = new Set();
  for (const p of sources.values()) {
    p.wavName = wavName(p.flac || p.wav, taken);
    if (p.note) detail(`  ${p.note}`);
    p.warnings.forEach((w) => log(`Warning: ${w}`));
  }

  // Early capacity estimate from headers, before decoding anything.
  if (fileSources.every((p) => p.samples)) {
    const est = fileSources.reduce((n, p) => n + sectorsForSamples(p.samples), 0)
      + cue.tracks.reduce((n, t) => n + t.pregap + t.postgap, 0) + LEAD_IN_PREGAP;
    const r = capacityReport(cue.tracks.length, est, opts.capacity);
    if (!r.fits) throw new Fail(`${r.text}\n\nThe source does not fit a ${opts.capacity}-minute disc.`);
  }

  // 3. Tools
  const decodes = [...sources.values()].filter((p) => p.action === 'decode');
  requireTools([...(decodes.length ? ['ffmpeg'] : []), 'cue2toc', 'cdrdao']);

  // 4. Workdir (cleaned on exit unless --keep-workdir)
  const work = makeWorkdir(opts.workdir, sourceDir);
  const inWork = (name) => {
    const p = path.join(work, name);
    if (path.dirname(p) !== work) throw new Fail(`refusing to write outside the workdir: ${p}`);
    return p;
  };
  if (onWorkdir) onWorkdir(work, opts.keepWorkdir);
  setCommandLog(inWork('commands.sh'));
  log(`Workdir: ${work}`);

  // 5. WAVs: reuse (symlink, after verifying) or decode the FLAC
  for (const p of sources.values()) {
    const out = inWork(p.wavName);
    if (p.action === 'reuse' && p.flac) {
      const { md5 } = readFlacInfo(p.flac);
      if (md5 && wavPcmMd5(p.wav) !== md5) {
        log(`Warning: ${path.basename(p.wav)} does not match ${path.basename(p.flac)} (MD5); decoding the FLAC`);
        p.action = 'decode';
        p.from = p.flac;
      }
    }
    if (p.action === 'reuse') {
      fs.symlinkSync(p.from, out);
      log(`  reuse  ${path.basename(p.from)}`);
    } else {
      log(`  decode ${path.basename(p.from)} -> ${p.wavName}`);
      const r = await run('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', '-i', p.from,
        '-map', '0:a:0', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-bitexact', out],
      { echo: opts.verbose });
      if (r.code !== 0) throw new Fail(`ffmpeg failed on ${p.from}:\n${r.out.trim()}`);
    }
    const info = readWavInfo(out);
    const problems = cdDaProblems(info);
    if (problems.length) throw new Fail(`${p.wavName} is not usable as CD-DA: ${problems.join(', ')}`);
    if (p.expectSamples && info.samples !== p.expectSamples) {
      throw new Fail(`${p.wavName}: ${info.samples} samples, expected ${p.expectSamples}`);
    }
    if (p.action === 'decode' && p.expectSamples) {
      const { md5 } = readFlacInfo(p.flac);
      if (md5 && wavPcmMd5(out, info) !== md5) throw new Fail(`${p.wavName}: decoded audio does not match the FLAC's MD5`);
      detail(`    bit-exact (MD5 ${md5})`);
    }
    if (info.samples % 588) log(`Warning: ${p.wavName} is not a whole number of CD sectors; cdrdao will pad it with silence`);
  }

  // 6. Temporary CUE (FILE lines -> local WAV names; no CD-TEXT fields)
  const discCue = inWork('disc.cue');
  fs.writeFileSync(discCue, rewriteCue(cue, fileSources.map((p) => p.wavName), { appendedGaps: opts.appendedGaps }));

  // 7. CUE -> TOC. -n where this cue2toc has it; the CUE already carries no CD-TEXT.
  const discToc = inWork('disc.toc');
  const help = await run('cue2toc', ['-h'], { echo: false });
  const args = [...(/(^|\s)-n\b/m.test(help.out) ? ['-n'] : []), '-o', discToc, discCue];
  const c2t = await run('cue2toc', args, { cwd: work });
  if (c2t.code !== 0) {
    fs.rmSync(discToc, { force: true }); // cue2toc leaves a partial TOC behind on failure
    throw new Fail(`cue2toc failed (exit ${c2t.code}):\n${c2t.out.trim()}`);
  }
  let toc = fs.readFileSync(discToc, 'utf8');
  if (/\bCD_TEXT\b/.test(toc)) {
    toc = stripCdText(toc);
    fs.writeFileSync(discToc, toc);
    log('Note: removed CD_TEXT blocks from the TOC');
  }

  // 8. Validate the TOC
  if (tocType(toc) !== 'CD_DA') throw new Fail(`TOC type is ${tocType(toc)}, expected CD_DA`);
  const names = new Set([...sources.values()].map((p) => p.wavName));
  for (const f of tocAudioFiles(toc)) {
    if (!names.has(f) || !fs.existsSync(path.join(work, f))) throw new Fail(`TOC references ${f}, which is not a prepared WAV`);
  }
  const show = await run('cdrdao', ['show-toc', discToc], { cwd: work });
  if (show.code !== 0) throw new Fail(`cdrdao rejected the TOC:\n${show.out.trim()}`);
  const st = parseShowToc(show.out);
  if (st.type !== 'CD_DA') throw new Fail(`cdrdao reports TOC type ${st.type}, expected CD_DA`);
  if (st.tracks.length !== cue.tracks.length) throw new Fail(`TOC has ${st.tracks.length} tracks, CUE has ${cue.tracks.length}`);
  st.tracks.forEach((t, i) => {
    if (t.number !== i + 1) throw new Fail(`TOC track numbering is not sequential at track ${t.number}`);
    if (t.mode !== 'AUDIO') throw new Fail(`TOC track ${t.number} is ${t.mode}, not AUDIO`);
  });
  if (st.endSectors === null) throw new Fail('could not read the disc length from cdrdao show-toc');

  // 9. Capacity, from cdrdao's own reading of the WAVs
  const report = capacityReport(cue.tracks.length, st.endSectors + LEAD_IN_PREGAP, opts.capacity);
  log(`\n${report.text}\n`);
  if (!report.fits) throw new Fail(`does not fit a ${opts.capacity}-minute disc`);

  if (opts.check) { log('Checked. --check: the drive was not used.'); return 0; }

  // 10. Drive
  let device = opts.device;
  if (!device) {
    const scan = await run('cdrdao', ['scanbus']);
    const drives = parseScanbus(scan.out);
    if (drives.length === 0) throw new Fail(`no optical drive found (cdrdao scanbus):\n${scan.out.trim()}`);
    if (drives.length > 1) {
      throw new Fail(`several drives found; pick one with --device:\n${drives.map((d) => `  ${d.device}  ${d.vendor} ${d.model}`).join('\n')}`);
    }
    device = drives[0].device;
    log(`Drive: ${device} (${drives[0].vendor} ${drives[0].model})`);
  }
  const speed = opts.speed ? ['--speed', opts.speed] : [];

  // 11. Simulate (always, before any burn)
  const sim = await run('cdrdao', ['simulate', '--device', device, ...speed, discToc], { cwd: work, stream: true });
  if (sim.code !== 0) throw new Fail(`simulation failed (cdrdao exit ${sim.code}); not burning`);
  log('Simulation OK.');
  if (!opts.burn) { log('No disc written. Re-run with --burn to write it.'); return 0; }

  // 12. Burn
  const w = await run('cdrdao', ['write', '--device', device, ...speed, '--eject', discToc], { cwd: work, stream: true });
  if (w.code !== 0) throw new Fail(`burn failed (cdrdao exit ${w.code})`);
  log('Disc written.');
  return 0;
}

// Process wrapper: exit codes, cleanup, signals.
function cli(argv) {
  let work = null;
  let keep = false;
  const cleanup = () => {
    if (!work) return;
    if (keep) console.log(`Workdir kept: ${work}`);
    else fs.rmSync(work, { recursive: true, force: true });
    work = null;
  };
  process.on('exit', cleanup);
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.on(sig, () => {
      killCurrent(sig);
      console.error(`\naudio-cd: ${sig}, stopping`);
      process.exit(code);
    });
  }
  main(argv, { onWorkdir: (dir, k) => { work = dir; keep = k; } })
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      console.error(`audio-cd: ${e.message}`);
      process.exitCode = e instanceof Fail ? e.code : 1;
    });
}

module.exports = { main, cli, parse, capacityReport, USAGE };
