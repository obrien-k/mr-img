// Test fixtures: real FLACs (cut from an XLD rip with ffmpeg), real cue2toc and
// cdrdao show-toc, and a stub cdrdao for anything that would touch a drive.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const BIN = path.join(__dirname, '..', '..', 'bin', 'audio-cd.js');
const XLD = path.join(__dirname, 'fixtures', 'xld-track-10s.flac');

function which(cmd) {
  try { return execFileSync('sh', ['-c', `command -v ${cmd}`]).toString().trim() || null; } catch { return null; }
}
const HAVE = { ffmpeg: which('ffmpeg'), cue2toc: which('cue2toc'), cdrdao: which('cdrdao') };
const missingTools = () => Object.entries(HAVE).filter(([, p]) => !p).map(([n]) => n);

const made = [];
process.on('exit', () => made.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function tmpdir(prefix = 'audio-cd-test-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

// A FLAC that is `seconds` long: a cut of the XLD fixture (≤10 s) or a tone.
function makeFlac(file, seconds = 4) {
  const args = seconds <= 10
    ? ['-i', XLD, '-t', String(seconds)]
    : ['-f', 'lavfi', '-i', `sine=f=440:sample_rate=44100`, '-t', String(seconds), '-ac', '2'];
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-c:a', 'flac', '-sample_fmt', 's16', file]);
}

// Header-only FLAC claiming `samples` of CD audio: enough for the pre-decode capacity check.
function makeHeaderOnlyFlac(file, samples) {
  const info = Buffer.alloc(34);
  info.writeUInt16BE(4096, 0);
  info.writeUInt16BE(4096, 2);
  const v = (44100n << 44n) | (1n << 41n) | (15n << 36n) | BigInt(samples);
  info.writeBigUInt64BE(v, 10);
  fs.writeFileSync(file, Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0, 0, 34]), info]));
}

// album(dir, [{ name, seconds }], { wav, cue }) -> path to the album dir
function album(names, { seconds = 3, wav = false, cue } = {}) {
  const dir = path.join(tmpdir(), "Album's (2001) [FLAC]");
  fs.mkdirSync(dir);
  names.forEach((n) => {
    makeFlac(path.join(dir, `${n}.flac`), seconds);
    if (wav) execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, `${n}.flac`), '-c:a', 'pcm_s16le', path.join(dir, `${n}.wav`)]);
  });
  const text = cue || names.map((n, i) =>
    `FILE "${n}.flac" WAVE\n  TRACK ${String(i + 1).padStart(2, '0')} AUDIO\n    TITLE "T${i + 1}"\n    INDEX 01 00:00:00\n`).join('');
  fs.writeFileSync(path.join(dir, 'Album.cue'), `PERFORMER "Somebody"\nTITLE "Album"\n${text}`);
  fs.writeFileSync(path.join(dir, 'Album.log'), 'XLD extraction logfile\n');
  return dir;
}

// name -> sha1 of every file (and symlink target) under dir, plus mtimes.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.lstatSync(p);
        out[path.relative(dir, p)] = `${crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex')} ${st.mtimeMs} ${st.mode}`;
      }
    }
  };
  walk(dir);
  return out;
}

// A dir with a stub `cdrdao`: show-toc goes to the real one; scanbus, simulate
// and write are faked from env (STUB_DRIVES, STUB_SIM_EXIT, STUB_LOG).
function stubBin() {
  const dir = tmpdir('audio-cd-stub-');
  fs.writeFileSync(path.join(dir, 'cdrdao'), `#!/bin/sh
echo "cdrdao $*" >> "\${STUB_LOG:-/dev/null}"
case "$1" in
  show-toc) exec "${HAVE.cdrdao}" "$@" ;;
  scanbus) printf 'Cdrdao version 1.2.5\\n%b' "\${STUB_DRIVES:-}" >&2; exit 0 ;;
  simulate) exit "\${STUB_SIM_EXIT:-0}" ;;
  write) exit "\${STUB_WRITE_EXIT:-0}" ;;
esac
exit 99
`, { mode: 0o755 });
  return dir;
}

// Run the CLI as a user would. Resolves { code, out }.
function runCli(args, { env = {}, path: PATH = process.env.PATH, onSpawn } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env, PATH } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    if (onSpawn) onSpawn(child, () => out);
    child.on('close', (code, signal) => resolve({ code, signal, out }));
  });
}

module.exports = { HAVE, missingTools, tmpdir, makeFlac, makeHeaderOnlyFlac, album, snapshot, stubBin, runCli, XLD };
