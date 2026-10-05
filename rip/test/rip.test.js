const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { trackHasher } = require('../checksums.js');
const { parseCddbTag, cddbId, accurateRipId, trackSectors } = require('../disc.js');
const { readVorbisComments } = require('../flacmeta.js');
const { verifyRip, logChecksums } = require('../verify.js');

const XLD = path.join(__dirname, '..', '..', 'audio-cd', 'test', 'fixtures', 'xld-track-10s.flac');
const BIN = path.join(__dirname, '..', '..', 'bin', 'rip-verify.js');
const hasFfmpeg = spawnSync('sh', ['-c', 'command -v ffmpeg']).status === 0;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rip-verify-test-'));

// 10000 frames of LCG noise: non-silent, so the 5-sector first/last skips matter.
function lcgPcm() {
  const pcm = Buffer.alloc(10000 * 4);
  let x = 12345;
  for (let i = 0; i < 20000; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    pcm.writeInt16LE(((x >>> 16) & 0xffff) - 32768, i * 2);
  }
  return pcm;
}
const sums = (pcm, opts, chunk = pcm.length) => {
  const h = trackHasher({ totalFrames: pcm.length / 4, ...opts });
  for (let o = 0; o < pcm.length; o += chunk) h.update(pcm.subarray(o, o + chunk));
  return h.digest();
};

// Expected values from leo-bogert/accuraterip-checksum (the C tool whipper uses)
// and Python's zlib.crc32 over the same PCM.
test('AccurateRip v1/v2 and CRC32 match the reference tool: first, middle, last track', () => {
  const pcm = lcgPcm();
  assert.deepEqual(sums(pcm, { first: true }), { crc32: 'A7E9A8B2', arV1: '09BC400D', arV2: '0B1723D2', frames: 10000 });
  assert.deepEqual(sums(pcm, {}), { crc32: 'A7E9A8B2', arV1: '6A5074E0', arV2: '6BCBB5EA', frames: 10000 });
  assert.deepEqual(sums(pcm, { last: true }), { crc32: 'A7E9A8B2', arV1: '776BD3CB', arV2: '782BC382', frames: 10000 });
});

test('chunk boundaries that split a stereo frame do not change the result', () => {
  const pcm = lcgPcm();
  assert.deepEqual(sums(pcm, { first: true }, 4093), sums(pcm, { first: true }));
});

test('disc identity from the real XLD rip TOC (iTunes_CDDB_1)', () => {
  const toc = parseCddbTag(readVorbisComments(XLD).ITUNES_CDDB_1);
  assert.deepEqual(toc, { cddbId: '3206ae05', leadout: 128472, offsets: [150, 15004, 36800, 53011, 119679] });
  assert.equal(cddbId(toc), '3206ae05');
  assert.equal(accurateRipId(toc).id, '005-00055fd8-001a3998-3206ae05');
  assert.deepEqual(trackSectors(toc), [14854, 21796, 16211, 66668, 8793]);
  assert.equal(parseCddbTag('nonsense'), null);
  assert.equal(parseCddbTag('3206AE05+1+2+150'), null); // claims 2 tracks, lists 1
});

// Formats as I understand them from XLD and EAC logs; real logs will replace these.
test('log checksum extraction: XLD and EAC line shapes (provisional)', () => {
  const xld = 'X Lossless Decoder version 20250302 (157.4)\n\nTrack 01\n    CRC32 hash               : D628605B\n    CRC32 hash (skip zero)   : 11111111\n    AccurateRip v1 signature : 725BCFBA\n    AccurateRip v2 signature : 23112EDD\n';
  assert.deepEqual(logChecksums(xld), { ripper: 'X Lossless Decoder version 20250302 (157.4)', crc32: ['D628605B'], arV2: ['23112EDD'] });
  const eac = 'Exact Audio Copy V1.6 from 23. October 2020\n     Copy CRC 6E8A4B3C\n     Accurately ripped (confidence 12)  [9A3F1C2B]  (AR v2)\n';
  assert.deepEqual(logChecksums(eac), { ripper: 'Exact Audio Copy V1.6 from 23. October 2020', crc32: ['6E8A4B3C'], arV2: ['9A3F1C2B'] });
});

// One-track "disc" built from the fixture: a TOC whose single track is exactly the file.
function oneTrackRip({ log } = {}) {
  const dir = path.join(tmp(), "Rip's (x) [y]");
  fs.mkdirSync(dir);
  const sectors = 441000 / 588; // 750
  const off = 150;
  const leadout = off + sectors;
  const id = cddbId({ offsets: [off], leadout });
  execFileSync('ffmpeg', ['-v', 'error', '-i', XLD, '-c:a', 'copy', '-map_metadata', '-1',
    '-metadata', `iTunes_CDDB_1=${id}+${leadout}+1+${off}`, '-metadata', 'TRACKNUMBER=1', path.join(dir, '01 Track.flac')]);
  fs.writeFileSync(path.join(dir, 'Rip.cue'), 'FILE "01 Track.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n');
  if (log) fs.writeFileSync(path.join(dir, 'Rip.log'), log);
  return dir;
}

test('a complete rip whose log matches verifies as pass', { skip: !hasFfmpeg }, async () => {
  const probe = await verifyRip(oneTrackRip());
  const t = probe.tracks[0];
  assert.equal(probe.verdict, 'incomplete'); // no log: nothing contradicts it, but no log evidence either
  const dir = oneTrackRip({ log: `X Lossless Decoder version 20250302\nTrack 01\n    CRC32 hash               : ${t.crc32}\n    AccurateRip v2 signature : ${t.arV2}\n` });
  const m = await verifyRip(dir);
  assert.equal(m.verdict, 'pass', JSON.stringify(m.checks));
  assert.equal(m.tracks[0].md5Verified, true);
  assert.equal(m.tracks[0].sectors, 750);
  assert.match(m.source.log.sha256, /^[0-9a-f]{64}$/);
});

test('a log that does not match the files fails', { skip: !hasFfmpeg }, async () => {
  const m = await verifyRip(oneTrackRip({ log: 'XLD\n    CRC32 hash               : DEADBEEF\n' }));
  assert.equal(m.verdict, 'fail');
  assert.deepEqual(m.checks.find((c) => c.name === 'log.crc32'), { name: 'log.crc32', status: 'fail', detail: 'track(s) 1 not in the log' });
});

test('a file shorter than its TOC entry fails (the real tag, a 10 s cut of track 1)', { skip: !hasFfmpeg }, async () => {
  const dir = tmp();
  fs.copyFileSync(XLD, path.join(dir, '01.flac'));
  const m = await verifyRip(dir);
  assert.equal(m.verdict, 'fail');
  assert.equal(m.checks.find((c) => c.name === 'track1.toc-length').detail, '750 sectors in file, 14854 in TOC');
  assert.equal(m.checks.find((c) => c.name === 'toc.track-count').status, 'fail');
});

test('the CLI never writes into the rip and refuses --out inside it', { skip: !hasFfmpeg }, () => {
  const dir = oneTrackRip({ log: 'XLD\n' });
  const before = fs.readdirSync(dir).map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`);
  const bad = spawnSync(process.execPath, [BIN, dir, '--out', path.join(dir, 'm.json')]);
  assert.equal(bad.status, 2);
  const out = path.join(tmp(), 'm.json');
  const ok = spawnSync(process.execPath, [BIN, dir, '--out', out]);
  assert.equal(ok.status, 3, ok.stderr.toString()); // incomplete: the log has no checksums to compare
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).schema, 'mr-img/rip-manifest@1');
  assert.deepEqual(fs.readdirSync(dir).map((f) => `${f}:${fs.statSync(path.join(dir, f)).mtimeMs}`), before);
});
