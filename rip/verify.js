// rip-verify: bind a rip's files to its disc (TOC) and its log, and record the
// evidence as a manifest. Read-only on the source: audio is decoded through a
// pipe, nothing is written next to the rip.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { decodeCue, parseCue } = require('../audio-cd/cue.js');
const { findEntry } = require('../audio-cd/source.js');
const { readFlacInfo } = require('../audio-cd/audio.js');
const { readVorbisComments } = require('./flacmeta.js');
const { parseCddbTag, cddbId, accurateRipId, trackSectors } = require('./disc.js');
const { trackHasher } = require('./checksums.js');

const visible = (n) => !n.startsWith('.');
const byExt = (dir, ext) => fs.readdirSync(dir).filter((n) => visible(n) && path.extname(n).toLowerCase() === ext).sort();

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

// Decode to raw PCM through ffmpeg's stdout and hash as it streams.
function hashTrack(file, { totalFrames, first, last }) {
  return new Promise((resolve, reject) => {
    const h = trackHasher({ totalFrames, first, last });
    const md5 = crypto.createHash('md5');
    const ff = spawn('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's16le', '-ac', '2', '-ar', '44100', '-']);
    let err = '';
    ff.stdout.on('data', (c) => { h.update(c); md5.update(c); });
    ff.stderr.on('data', (c) => { err += c; });
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve({ ...h.digest(), pcmMd5: md5.digest('hex') }) : reject(new Error(`ffmpeg: ${err.trim()}`))));
  });
}

// Track files in disc order: from the CUE (one FILE per track) or the FLACs' TRACKNUMBER tags.
function trackFiles(dir) {
  const cues = byExt(dir, '.cue');
  if (cues.length === 1) {
    const cue = parseCue(decodeCue(fs.readFileSync(path.join(dir, cues[0]))));
    if (cue.files.length !== cue.tracks.length) {
      throw new Error(`${cues[0]}: ${cue.tracks.length} tracks in ${cue.files.length} file(s); rip-verify v1 needs one file per track`);
    }
    return {
      cue: cues[0],
      files: cue.tracks.map((t) => {
        const ref = cue.files[t.file].name;
        const stem = path.parse(ref).name;
        const f = findEntry(dir, ref) || findEntry(dir, `${stem}.flac`);
        if (!f) throw new Error(`CUE references "${ref}", which does not exist`);
        return { number: t.number, file: f };
      }),
    };
  }
  const flacs = byExt(dir, '.flac').map((n) => path.join(dir, n));
  const numbered = flacs.map((f, i) => ({ number: Number(readVorbisComments(f).TRACKNUMBER) || i + 1, file: f }));
  return { cue: null, files: numbered.sort((a, b) => a.number - b.number) };
}

// CRCs a ripper log reports, in whatever order. Recognized: XLD "CRC32 hash : X",
// EAC "Copy CRC X"; AccurateRip v2: XLD "AccurateRip v2 signature : X", EAC "[X]  (AR v2)".
function logChecksums(text) {
  const all = (re) => [...text.matchAll(re)].map((m) => (m[1] ?? m[2]).toUpperCase());
  return {
    ripper: (text.split(/\r?\n/).find((l) => l.trim()) || '').trim().slice(0, 120),
    crc32: all(/(?:CRC32 hash\s*:|Copy CRC)\s*([0-9A-Fa-f]{8})\b/g),
    arV2: all(/(?:AccurateRip v2 signature\s*:\s*([0-9A-Fa-f]{8}))|(?:\[([0-9A-Fa-f]{8})\]\s*\(AR v2\))/g),
  };
}

async function verifyRip(dir, { now = new Date() } = {}) {
  const checks = [];
  const check = (name, status, detail) => checks.push({ name, status, detail });
  const { cue, files } = trackFiles(dir);
  if (!files.length) throw new Error(`no FLAC tracks in ${dir}`);

  // Disc TOC from the first track's tags.
  const tags = readVorbisComments(files[0].file);
  const toc = tags.ITUNES_CDDB_1 ? parseCddbTag(tags.ITUNES_CDDB_1) : null;
  let disc = null;
  if (toc) {
    const recomputed = cddbId(toc);
    disc = { cddbId: toc.cddbId, offsets: toc.offsets, leadout: toc.leadout, trackCount: toc.offsets.length, accurateRip: accurateRipId(toc) };
    check('toc.cddb-id', recomputed === toc.cddbId ? 'pass' : 'fail', `tag ${toc.cddbId}, recomputed ${recomputed}`);
    check('toc.track-count', files.length === toc.offsets.length ? 'pass' : 'fail', `${files.length} files, TOC has ${toc.offsets.length} tracks`);
  } else {
    check('toc.present', 'skip', 'no iTunes_CDDB_1 tag; disc TOC unknown');
  }
  const expectSectors = toc ? trackSectors(toc) : [];
  const total = toc ? toc.offsets.length : Number(tags.TRACKTOTAL) || files.length;

  const tracks = [];
  for (const { number, file } of files) {
    const info = readFlacInfo(file);
    const sums = await hashTrack(file, { totalFrames: info.samples, first: number === 1, last: number === total });
    const sectors = info.samples / 588;
    const t = {
      number,
      file: path.basename(file),
      bytes: fs.statSync(file).size,
      sha256: sha256File(file),
      samples: info.samples,
      sectors,
      tocSectors: expectSectors[number - 1] ?? null,
      flacMd5: info.md5,
      md5Verified: info.md5 ? sums.pcmMd5 === info.md5 : null,
      crc32: sums.crc32,
      arV1: sums.arV1,
      arV2: sums.arV2,
    };
    tracks.push(t);
    check(`track${number}.flac-md5`, t.md5Verified === null ? 'skip' : t.md5Verified ? 'pass' : 'fail', t.md5Verified === null ? 'FLAC has no MD5' : 'decoded audio vs STREAMINFO MD5');
    if (t.tocSectors !== null) {
      check(`track${number}.toc-length`, t.sectors === t.tocSectors ? 'pass' : 'fail', `${t.sectors} sectors in file, ${t.tocSectors} in TOC`);
    }
  }

  // Log: hashed and recorded always; its checksums compared when recognized.
  const logs = byExt(dir, '.log');
  let log = null;
  if (logs.length) {
    const text = decodeCue(fs.readFileSync(path.join(dir, logs[0])));
    const found = logChecksums(text);
    log = { file: logs[0], sha256: sha256File(path.join(dir, logs[0])), ripper: found.ripper, crc32Found: found.crc32.length, arV2Found: found.arV2.length };
    for (const [key, list] of [['crc32', found.crc32], ['arV2', found.arV2]]) {
      if (!list.length) { check(`log.${key}`, 'skip', `no ${key} values recognized in ${logs[0]}`); continue; }
      const missing = tracks.filter((t) => !list.includes(t[key])).map((t) => t.number);
      check(`log.${key}`, missing.length ? 'fail' : 'pass', missing.length ? `track(s) ${missing.join(', ')} not in the log` : `all ${tracks.length} tracks match the log`);
    }
  } else {
    check('log.present', 'skip', 'no .log file');
  }

  // pass needs positive evidence tying files to the log, not just a log file.
  const failed = checks.some((c) => c.status === 'fail');
  const logMatched = checks.some((c) => c.name === 'log.crc32' && c.status === 'pass');
  return {
    schema: 'mr-img/rip-manifest@1',
    generatedAt: now.toISOString(),
    source: { dir: path.resolve(dir), cue: cue ? { file: cue, sha256: sha256File(path.join(dir, cue)) } : null, log },
    disc,
    tracks,
    checks,
    verdict: failed ? 'fail' : logMatched ? 'pass' : 'incomplete',
  };
}

module.exports = { verifyRip, logChecksums, trackFiles };
