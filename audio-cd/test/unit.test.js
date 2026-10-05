const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseCue, rewriteCue, decodeCue, CueError } = require('../cue.js');
const { wavName, resolveSource, SourceError } = require('../source.js');
const { readFlacInfo } = require('../audio.js');
const { parseShowToc, parseScanbus, stripCdText, tocType } = require('../toc.js');
const { capacityReport } = require('../cli.js');
const { tmpdir, XLD } = require('./helpers.js');

const cue = (s) => parseCue(s);
const track = (n, file = `${n}.flac`) => `FILE "${file}" WAVE\n  TRACK ${String(n).padStart(2, '0')} AUDIO\n    INDEX 01 00:00:00\n`;

test('.flac -> .wav replaces the extension, never appends (#10, #11)', () => {
  const taken = new Set();
  assert.equal(wavName('/x/01 Track.flac', taken), '01 Track.wav');
  assert.equal(wavName("/x/02 Don't (Stop) [Live]  ü.flac", taken), "02 Don't (Stop) [Live]  ü.wav");
  assert.equal(wavName('/x/a.b.flac', taken), 'a.b.wav');
  assert.doesNotMatch([...taken].join(' '), /\.flac\.wav/);
});

test('wavName de-duplicates and neutralizes characters a TOC string cannot hold', () => {
  const taken = new Set();
  assert.equal(wavName('/a/x.flac', taken), 'x.wav');
  assert.equal(wavName('/b/X.flac', taken), 'X (2).wav');
  assert.equal(wavName('/a/back\\slash.flac', taken), 'back_slash.wav');
});

test('rewrite changes FILE lines only, keeps layout, drops CD-TEXT (#2-#4)', () => {
  const src = `CATALOG 0000000000000\nPERFORMER "Ü"\nFILE "01 It's (a) [b]  c.flac" WAVE\n  TRACK 01 AUDIO\n    TITLE "x"\n    FLAGS DCP\n    ISRC USABC0000001\n    INDEX 01 00:00:00\nFILE "02.flac" WAVE\n  TRACK 02 AUDIO\n    PREGAP 00:02:00\n    INDEX 00 00:00:00\n    INDEX 01 00:01:30\n    INDEX 02 01:00:00\n    POSTGAP 00:01:00\n`;
  assert.equal(rewriteCue(cue(src), ["01 It's (a) [b]  c.wav", '02.wav']),
    `CATALOG 0000000000000\nFILE "01 It's (a) [b]  c.wav" WAVE\n  TRACK 01 AUDIO\n    FLAGS DCP\n    ISRC USABC0000001\n    INDEX 01 00:00:00\nFILE "02.wav" WAVE\n  TRACK 02 AUDIO\n    PREGAP 00:02:00\n    INDEX 00 00:00:00\n    INDEX 01 00:01:30\n    INDEX 02 01:00:00\n    POSTGAP 00:01:00\n`);
});

test('unquoted FILE names, CRLF and a UTF-8 BOM parse', () => {
  const text = decodeCue(Buffer.from(`﻿FILE a.flac WAVE\r\n  TRACK 01 AUDIO\r\n    INDEX 01 00:00:00\r\n`));
  assert.equal(cue(text).files[0].name, 'a.flac');
});

test('cp1252 CUEs (EAC) decode', () => {
  const buf = Buffer.concat([Buffer.from('FILE "Caf'), Buffer.from([0xe9]), Buffer.from('.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n')]);
  assert.equal(cue(decodeCue(buf)).files[0].name, 'Café.flac');
});

test('track numbering must be sequential from 01 (#13)', () => {
  assert.throws(() => cue(track(1) + track(3)), /not sequential: expected TRACK 02, found TRACK 03/);
  assert.throws(() => cue(track(2)), /expected TRACK 01/);
});

test('malformed CUEs fail with the line (#8)', () => {
  assert.throws(() => cue('FILE "a.flac WAVE\n'), CueError);
  assert.throws(() => cue('  TRACK 01 AUDIO\n'), /TRACK before any FILE/);
  assert.throws(() => cue('FILE "a.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:99\n'), /line 3: bad mm:ss:ff/);
  assert.throws(() => cue('FILE "a.flac" WAVE\n  TRACK 01 AUDIO\n'), /no INDEX 01/);
  assert.throws(() => cue('FILE "a.bin" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n'), /only AUDIO/);
  assert.throws(() => cue(''), /no FILE/);
});

test('"gaps appended to previous track" needs --appended-gaps; with it, audio layout is kept', () => {
  const src = `FILE "1.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    INDEX 00 03:00:00\nFILE "2.flac" WAVE\n    INDEX 01 00:00:00\n`;
  assert.throws(() => rewriteCue(cue(src), ['1.wav', '2.wav']), /--appended-gaps/);
  assert.equal(rewriteCue(cue(src), ['1.wav', '2.wav'], { appendedGaps: true }),
    `FILE "1.wav" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\nFILE "2.wav" WAVE\n  TRACK 02 AUDIO\n    INDEX 01 00:00:00\n`);
});

test('a TRACK line placed before its FILE line is moved without needing a flag', () => {
  const src = `FILE "1.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\nFILE "2.flac" WAVE\n    INDEX 01 00:00:00\n`;
  assert.equal(rewriteCue(cue(src), ['1.wav', '2.wav']),
    `FILE "1.wav" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\nFILE "2.wav" WAVE\n  TRACK 02 AUDIO\n    INDEX 01 00:00:00\n`);
});

test('source resolution prefers FLAC, refuses lossy-only, reports missing (#8)', () => {
  const d = tmpdir();
  for (const f of ['01 a.flac', '01 a.mp3', '02 b.mp3', '03 c.wav']) fs.writeFileSync(path.join(d, f), '');
  assert.equal(path.basename(resolveSource(d, '01 a.mp3').flac), '01 a.flac');
  assert.throws(() => resolveSource(d, '02 b.mp3'), /unsupported audio source/);
  assert.equal(path.basename(resolveSource(d, '03 c.flac').wav), '03 c.wav');
  assert.throws(() => resolveSource(d, '04 d.flac'), /does not exist/);
});

test('FLAC STREAMINFO from the XLD fixture', () => {
  assert.deepEqual(readFlacInfo(XLD), { sampleRate: 44100, channels: 2, bitsPerSample: 16, samples: 441000, md5: '3524cc3bd5eeb26cdaa3b64d5d293bcf' });
});

test('show-toc and scanbus parsing (#12, #13)', () => {
  const st = parseShowToc(`TOC TYPE: CD_DA\nTRACK  1  Mode AUDIO:\n          START  00:00:00(     0)\n          END    00:03:00(   225)\n\nTRACK  2  Mode AUDIO:\n          END    54:02:13(243163)\n`);
  assert.deepEqual(st, { type: 'CD_DA', tracks: [{ number: 1, mode: 'AUDIO' }, { number: 2, mode: 'AUDIO' }], endSectors: 243163 });
  assert.deepEqual(parseScanbus('Cdrdao version 1.2.5\nIOCompactDiscServices/1 : HL-DT-ST, DVDRW GX50N, RP09\nERROR: x : a, b, c\n'),
    [{ device: 'IOCompactDiscServices/1', vendor: 'HL-DT-ST', model: 'DVDRW GX50N', revision: 'RP09' }]);
});

test('CD_TEXT blocks are stripped, nested braces included', () => {
  const toc = 'CD_DA\nCD_TEXT {\n LANGUAGE_MAP { 0 : EN }\n LANGUAGE 0 { TITLE "x" }\n}\nTRACK AUDIO\n CD_TEXT { LANGUAGE 0 { TITLE "(null)" } }\n AUDIOFILE "a.wav" 0\n';
  const out = stripCdText(toc);
  assert.doesNotMatch(out, /CD_TEXT|TITLE/);
  assert.match(out, /AUDIOFILE "a\.wav" 0/);
  assert.equal(tocType('// c\nCD_DA\n'), 'CD_DA');
});

test('capacity report matches the expected wording; 81 minutes does not fit (#7)', () => {
  const fits = capacityReport(13, (54 * 60 + 2) * 75, 80);
  assert.equal(fits.text, 'Disc: 13 tracks\nTotal: 54:02\nCapacity: 80:00\nRemaining: 25:58\nStatus: FITS');
  const over = capacityReport(20, 81 * 60 * 75, 80);
  assert.equal(over.fits, false);
  assert.match(over.text, /Over by: 1:00\nStatus: DOES NOT FIT/);
});
