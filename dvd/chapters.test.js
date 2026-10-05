const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chapterList, formatTimestamp } = require('./chapters.js');
const recipe = require('./recipes/donnie-darko.json');

const vob = (discId, file) =>
  recipe.discs.find((d) => d.id === discId).titlesets[0].pgcs[0].vobs.find((v) => v.file === file);

test('movie chapters match the list disc A was authored with (trailing 0.6s stub dropped)', () => {
  assert.equal(
    chapterList(vob('A', 'main.mpg').chapterDurationsMs),
    '0,8:24.533,15:20.367,23:54.834,34:12.134,44:51.367,56:36.134,1:06:08.334,1:15:02.400,1:25:44.833,1:31:50.166,1:42:34.033',
  );
});

test('title 2 chapters match disc D2', () => {
  assert.equal(
    chapterList(vob('D2', 't2.mpg').chapterDurationsMs),
    '0,7:25.567,18:10.967,31:17.200,58:22.400,1:11:48.967,1:18:30.667',
  );
});

test('a title that is one real chapter plus a stub collapses to "0"', () => {
  assert.equal(chapterList([148000, 600]), '0');
});

test('a lone short chapter is kept, not dropped as a stub', () => {
  assert.equal(chapterList([600]), '0');
});

test('timestamps: m:ss.mmm under an hour, h:mm:ss.mmm over', () => {
  assert.equal(formatTimestamp(20833), '0:20.833');
  assert.equal(formatTimestamp(1579000), '26:19.000');
  assert.equal(formatTimestamp(3968334), '1:06:08.334');
});
