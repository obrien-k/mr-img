const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseChapterDurations, parseTitleDurations, parseTitleSets } = require('./parse.js');
const { chapterList } = require('./chapters.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('HandBrake scan -> chapter durations -> the list disc A used', () => {
  const ms = parseChapterDurations(fixture('handbrake-title1-scan.txt'));
  assert.equal(ms.length, 13);
  assert.equal(ms[12], 600);
  assert.equal(
    chapterList(ms),
    '0,8:24.533,15:20.367,23:54.834,34:12.134,44:51.367,56:36.134,1:06:08.334,1:15:02.400,1:25:44.833,1:31:50.166,1:42:34.033',
  );
});

test('deleted scenes (title 4): 20 real chapters, ends at 31:25.034', () => {
  const list = chapterList(parseChapterDurations(fixture('handbrake-title4-chapters.txt'))).split(',');
  assert.equal(list.length, 20);
  assert.equal(list[19], '31:25.034');
});

test('HandBrake -t 0 scan -> per-title durations', () => {
  assert.deepEqual(parseTitleDurations(fixture('handbrake-all-titles-no-dvdnav.txt')), [
    { title: 1, ms: 6788600 },
    { title: 2, ms: 5119166 },
    { title: 3, ms: 148600 },
    { title: 4, ms: 1912800 },
    { title: 26, ms: 523367 },
  ]);
});

test('dvdbackup -I -> title sets, ignoring the "main feature" summary', () => {
  const sets = parseTitleSets(fixture('dvdbackup-info.txt'));
  assert.deepEqual(sets.map((s) => s.titleset), [1, 2, 4]);
  assert.deepEqual(sets[0], {
    titleset: 1, aspect: '16:9', audioTracks: 3, subpictures: 1,
    titles: [{ title: 1, chapters: 13, audioChannels: 6 }],
  });
  assert.deepEqual(sets[1].titles.map((t) => t.title), [2, 3]);
  assert.equal(sets[2].aspect, '4:3');
  assert.equal(sets[2].titles[0].audioChannels, 1);
});
