// End to end: the real CLI, real ffmpeg/cue2toc/cdrdao show-toc, a stub for
// anything that would touch a drive. Every test also proves the source
// directory was not touched (#9). No test can burn: write goes to the stub.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { HAVE, missingTools, tmpdir, album, snapshot, stubBin, runCli, makeHeaderOnlyFlac } = require('./helpers.js');

const skip = missingTools().length ? `needs ${missingTools().join(', ')}` : false;
const STUB = stubBin();
const PATH = `${STUB}${path.delimiter}${process.env.PATH}`;

// Run against `dir`, keeping the workdir so the generated files can be checked.
async function check(input, args = ['--check'], env = {}) {
  const dir = fs.statSync(input).isDirectory() ? input : path.dirname(input);
  const before = snapshot(dir);
  const work = path.join(tmpdir(), 'work');
  const log = path.join(tmpdir(), 'cdrdao.log');
  const r = await runCli([input, '--workdir', work, '--keep-workdir', ...args], { path: PATH, env: { STUB_LOG: log, ...env } });
  assert.deepEqual(snapshot(dir), before, 'source directory changed');
  const read = (f) => (fs.existsSync(path.join(work, f)) ? fs.readFileSync(path.join(work, f), 'utf8') : null);
  return { ...r, work, read, cdrdao: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

test('normal 1-FLAC-per-track rip: decodes, builds a CD_DA TOC, fits (#1, #6, #12)', { skip }, async () => {
  const r = await check(album(['01 One', '02 Two', '03 Three']));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Disc: 3 tracks\nTotal: 0:11\nCapacity: 80:00\nRemaining: 79:49\nStatus: FITS/);
  assert.match(r.read('disc.toc'), /^CD_DA$/m);
  assert.doesNotMatch(r.read('disc.toc'), /CD_TEXT/);
  assert.equal((r.read('commands.sh').match(/^ffmpeg /gm) || []).length, 3);
  assert.deepEqual(fs.readdirSync(r.work).filter((f) => f.endsWith('.wav')).sort(), ['01 One.wav', '02 Two.wav', '03 Three.wav']);
});

test("spaces, apostrophes, parentheses, brackets, double spaces, Unicode (#2, #3, #4, #10, #11)", { skip }, async () => {
  const names = ["01 Don't Stop", '02 Song (Live) [2001 Remaster]', '03 Two  Spaces', '04 Ünïcødé 曲'];
  const r = await check(album(names));
  assert.equal(r.code, 0, r.out);
  const toc = r.read('disc.toc');
  names.forEach((n) => assert.ok(toc.includes(`"${n}.wav"`), `${n}.wav missing from TOC:\n${toc}`));
  assert.doesNotMatch(r.read('disc.cue') + toc, /\.flac/);
  assert.doesNotMatch(r.read('disc.cue') + toc, /\.flac\.wav/);
});

test('existing matching WAVs are reused via symlink, not re-decoded (#5)', { skip }, async () => {
  const dir = album(['01 One', '02 Two'], { wav: true });
  const r = await check(dir);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.read('commands.sh'), /^ffmpeg /m);
  const link = path.join(r.work, '01 One.wav');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  assert.equal(fs.readlinkSync(link), path.join(dir, '01 One.wav'));
});

test('an existing WAV that does not match its FLAC is ignored and the FLAC decoded (#5)', { skip }, async () => {
  const dir = album(['01 One'], { wav: true });
  fs.writeFileSync(path.join(dir, '01 One.wav'), fs.readFileSync(path.join(dir, '01 One.wav')).subarray(0, 1000));
  const r = await check(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /ignoring existing 01 One\.wav/);
  assert.match(r.read('commands.sh'), /^ffmpeg /m);
  assert.ok(!fs.lstatSync(path.join(r.work, '01 One.wav')).isSymbolicLink());
});

test('a CUE-referenced WAV with the wrong format is rejected', { skip }, async () => {
  const dir = album(['01 One']);
  fs.rmSync(path.join(dir, '01 One.flac'));
  require('child_process').execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=sample_rate=48000', '-t', '2', '-ac', '2', path.join(dir, '01 One.wav')]);
  const r = await check(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /01 One\.wav cannot be used as CD-DA: 48000 Hz, need 44100/);
});

test('over 80 minutes fails before decoding anything (#7)', async () => {
  const dir = path.join(tmpdir(), 'Long');
  fs.mkdirSync(dir);
  makeHeaderOnlyFlac(path.join(dir, '01.flac'), 50 * 60 * 44100);
  makeHeaderOnlyFlac(path.join(dir, '02.flac'), 31 * 60 * 44100);
  fs.writeFileSync(path.join(dir, 'a.cue'), 'FILE "01.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\nFILE "02.flac" WAVE\n  TRACK 02 AUDIO\n    INDEX 01 00:00:00\n');
  const r = await check(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /Total: 81:02\nCapacity: 80:00\nOver by: 1:02\nStatus: DOES NOT FIT/);
  assert.ok(!fs.existsSync(r.work), 'no workdir should have been created');
});

test('--capacity is enforced on the real TOC length too', { skip }, async () => {
  const r = await check(album(['01 One', '02 Two']), ['--check', '--capacity', '0.05']);
  assert.equal(r.code, 1);
  assert.match(r.out, /Status: DOES NOT FIT/);
});

test('missing CUE reference fails clearly (#8)', async () => {
  const dir = album(['01 One'], { cue: 'FILE "01 One.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\nFILE "02 Gone.flac" WAVE\n  TRACK 02 AUDIO\n    INDEX 01 00:00:00\n' });
  const r = await check(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /CUE references "02 Gone\.flac", which does not exist/);
});

test('zero and multiple CUE files', async () => {
  const dir = album(['01 One']);
  fs.copyFileSync(path.join(dir, 'Album.cue'), path.join(dir, 'Other.cue'));
  const many = await check(dir);
  assert.equal(many.code, 1);
  assert.match(many.out, /2 \.cue files .* pick one with --cue/);
  const empty = tmpdir();
  assert.match((await check(empty)).out, /no \.cue file/);
});

test('--cue picks one; a .cue path works directly', { skip }, async () => {
  const dir = album(['01 One']);
  fs.copyFileSync(path.join(dir, 'Album.cue'), path.join(dir, 'Other.cue'));
  assert.equal((await check(dir, ['--check', '--cue', 'Other.cue'])).code, 0);
  assert.equal((await check(path.join(dir, 'Album.cue'))).code, 0);
});

test('missing tools are named before anything is written', async () => {
  const bin = tmpdir();
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const r = await runCli([album(['01 One']), '--check'], { path: bin });
  assert.equal(r.code, 1);
  assert.match(r.out, /missing required tool\(s\): ffmpeg, cue2toc, cdrdao/);
});

test('--workdir inside the source directory is refused', { skip }, async () => {
  const dir = album(['01 One']);
  const r = await runCli([dir, '--check', '--workdir', path.join(dir, 'tmp')], { path: PATH });
  assert.equal(r.code, 1);
  assert.match(r.out, /inside the source directory/);
  assert.ok(!fs.existsSync(path.join(dir, 'tmp')));
});

test('default run simulates and stops; no write without --burn', { skip }, async () => {
  const r = await check(album(['01 One']), [], { STUB_DRIVES: 'IOCompactDiscServices : Vendor, Writer, 1.0\\n' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.cdrdao, /^cdrdao simulate --device IOCompactDiscServices .*disc\.toc$/m);
  assert.doesNotMatch(r.cdrdao, /^cdrdao write/m);
  assert.match(r.out, /Re-run with --burn/);
});

test('simulation failure exits nonzero and never writes, even with --burn', { skip }, async () => {
  const r = await check(album(['01 One']), ['--burn', '--device', 'X'], { STUB_SIM_EXIT: '1' });
  assert.equal(r.code, 1);
  assert.match(r.out, /simulation failed .*not burning/);
  assert.doesNotMatch(r.cdrdao, /^cdrdao write/m);
});

test('--burn writes only after a passing simulation; a failed write is an error', { skip }, async () => {
  const ok = await check(album(['01 One']), ['--burn', '--device', 'X', '--speed', '4']);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.cdrdao, /^cdrdao simulate --device X --speed 4 .*\ncdrdao write --device X --speed 4 --eject .*disc\.toc$/m);
  const bad = await check(album(['01 One']), ['--burn', '--device', 'X'], { STUB_WRITE_EXIT: '2' });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /burn failed/);
});

test('no drive / several drives', { skip }, async () => {
  const none = await check(album(['01 One']), []);
  assert.equal(none.code, 1);
  assert.match(none.out, /no optical drive found/);
  const two = await check(album(['01 One']), [], { STUB_DRIVES: 'A : V, M1, 1\\nB : V, M2, 1\\n' });
  assert.equal(two.code, 1);
  assert.match(two.out, /several drives found; pick one with --device:\n  A  V M1\n  B  V M2/);
});

test('the workdir is removed on exit unless --keep-workdir', { skip }, async () => {
  const work = path.join(tmpdir(), 'work');
  const r = await runCli([album(['01 One']), '--check', '--workdir', work], { path: PATH });
  assert.equal(r.code, 0, r.out);
  assert.ok(!fs.existsSync(work));
});

test('SIGINT stops the running command and removes the workdir', { skip }, async () => {
  const bin = tmpdir();
  fs.writeFileSync(path.join(bin, 'ffmpeg'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  const dir = album(['01 One']);
  const before = snapshot(dir);
  const work = path.join(tmpdir(), 'work');
  const r = await runCli([dir, '--check', '--workdir', work], {
    path: `${bin}${path.delimiter}${PATH}`,
    onSpawn: (child, out) => {
      const t = setInterval(() => { if (/decode/.test(out())) { clearInterval(t); child.kill('SIGINT'); } }, 50);
    },
  });
  assert.equal(r.code, 130, r.out);
  assert.ok(!fs.existsSync(work), 'workdir left behind');
  assert.deepEqual(snapshot(dir), before);
});
