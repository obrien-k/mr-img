const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const { dvdauthorXml } = require('./author.js');
const {
  encodePass1Argv, encodePass2Argv, remuxArgv, extractTitleArgv, isoArgv, buildScript,
} = require('./script.js');
const recipe = require('./recipes/donnie-darko.json');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const disc = (id) => recipe.discs.find((d) => d.id === id);
const steps = (run) => recipe.steps.filter((s) => s.run === run);

// Every expected value below is the argv / file that actually ran to produce
// the two burned discs (enc.sh, remux.sh, dvd1.xml, dvd2.xml), as bash expanded it.
const IN = 'concat:src/VTS_01_1.VOB|src/VTS_01_2.VOB|src/VTS_01_3.VOB|src/VTS_01_4.VOB|src/VTS_01_5.VOB|src/VTS_01_6.VOB';
const VID = ['-vf', 'fps=24000/1001,telecine=pattern=23', '-c:v', 'mpeg2video', '-b:v', '4600k', '-maxrate', '8000k',
  '-bufsize', '1835k', '-g', '18', '-bf', '2', '-flags', '+ilme+ildct', '-alternate_scan', '1', '-mbd', 'rd',
  '-trellis', '1', '-cmp', '2', '-subcmp', '2', '-aspect', '16:9', '-pix_fmt', 'yuv420p'];
const PROBE = ['-fflags', '+genpts', '-analyzeduration', '200M', '-probesize', '200M'];

test('disc A XML is byte-identical to the dvd1.xml that was authored', () => {
  assert.equal(dvdauthorXml(disc('A')), fixture('dvd1.xml'));
});

test('disc D2 XML is byte-identical to the dvd2.xml that was authored', () => {
  assert.equal(dvdauthorXml(disc('D2')), fixture('dvd2.xml'));
});

test('encode pass 1 matches enc.sh pass1', () => {
  assert.deepEqual(encodePass1Argv(steps('encode-2pass')[0]),
    ['ffmpeg', '-y', ...PROBE, '-i', IN, '-map', '0:v:0', ...VID, '-pass', '1', '-f', 'null', '-']);
});

test('encode pass 2 matches enc.sh pass2 (all three audio tracks + subs)', () => {
  assert.deepEqual(encodePass2Argv(steps('encode-2pass')[0]), [
    'ffmpeg', '-y', ...PROBE, '-i', IN, '-map', '0:v:0',
    '-map', '0:i:0x80', '-map', '0:i:0x81', '-map', '0:i:0x82', '-map', '0:i:0x20?',
    ...VID, '-pass', '2', '-c:a', 'copy', '-c:s', 'copy', '-f', 'dvd', 'main.mpg',
  ]);
});

test('title extraction and remux match remux.sh', () => {
  assert.deepEqual(extractTitleArgv(steps('extract-title')[0]), ['dvdbackup', '-i', '$SRC', '-o', 't', '-t', '2', '-n', 'T2']);
  assert.deepEqual(remuxArgv(steps('remux')[0]), [
    'ffmpeg', '-y', '-hide_banner', '-loglevel', 'warning', ...PROBE,
    '-i', 'concat:t/T2/VIDEO_TS/VTS_02_1.VOB|t/T2/VIDEO_TS/VTS_02_2.VOB',
    '-map', '0:v:0', '-map', '0:a', '-c', 'copy', '-f', 'dvd', 't2.mpg',
  ]);
});

test('ISO commands match what built the burned images', () => {
  assert.deepEqual(isoArgv(disc('D2')),
    ['hdiutil', 'makehybrid', '-udf', '-udf-volume-name', 'DONNIE_DARKO_D2', '-o', 'dd2.iso', 'dvd2/']);
  // Disc A's folder was renamed dvd1 -> dvd1-movieonly by hand before this ran; same contents.
  assert.deepEqual(isoArgv(disc('A')),
    ['hdiutil', 'makehybrid', '-udf', '-udf-volume-name', 'DONNIE_DARKO_A', '-o', 'dd1-movieonly.iso', 'dvd1/']);
});

test('generated script is valid bash and verifies every output', () => {
  const script = buildScript(recipe);
  assert.match(script, /^set -euo pipefail$/m);
  assert.match(script, /^check_field_order main\.mpg tt$/m);
  assert.match(script, /^check_duration main\.mpg 6788600 10000$/m);
  assert.match(script, /^check_fits dd2\.iso 4700372992$/m);
  assert.match(script, /^\[ -f dvd1\/VIDEO_TS\/VIDEO_TS\.IFO \]/m);
  assert.ok(!/^hdiutil burn/m.test(script), 'the script never burns on its own');
  execFileSync('bash', ['-n'], { input: script }); // throws on a syntax error
});
