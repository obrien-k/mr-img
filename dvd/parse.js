// Parsers for the probe tools' text output. Each returns measured facts only.

// HandBrakeCLI --scan: "scan: chap 3, 514467 ms" (one title per scan run).
function parseChapterDurations(log) {
  return [...log.matchAll(/scan: chap \d+, (\d+) ms/g)].map((m) => Number(m[1]));
}

// HandBrakeCLI -t 0 --scan: "scan: scanning title 2" followed by "scan: duration is 01:25:19 (5119166 ms)".
function parseTitleDurations(log) {
  const titles = [];
  let current = null;
  for (const line of log.split('\n')) {
    const title = line.match(/scan: scanning title (\d+)/);
    if (title) current = Number(title[1]);
    const duration = line.match(/scan: duration is [\d:]+ \((\d+) ms\)/);
    if (duration && current !== null) titles.push({ title: current, ms: Number(duration[1]) });
  }
  return titles;
}

// dvdbackup -I: the "Title Sets:" section.
function parseTitleSets(log) {
  const sets = [];
  let set = null;
  let title = null;
  for (const line of log.split('\n')) {
    let m;
    if ((m = line.match(/^\s*Title set (\d+)\s*$/))) {
      set = { titleset: Number(m[1]), aspect: null, audioTracks: 0, subpictures: 0, titles: [] };
      sets.push(set);
      title = null;
    } else if (!set) {
      continue;
    } else if ((m = line.match(/aspect ratio of title set \d+ is (\S+)/))) {
      set.aspect = m[1];
    } else if ((m = line.match(/Title set \d+ has (\d+) audio tracks?/))) {
      set.audioTracks = Number(m[1]);
    } else if ((m = line.match(/Title set \d+ has (\d+) subpicture channels?/))) {
      set.subpictures = Number(m[1]);
    } else if ((m = line.match(/^\s*Title (\d+):\s*$/))) {
      title = { title: Number(m[1]), chapters: 0, audioChannels: 0 };
      set.titles.push(title);
    } else if (title && (m = line.match(/Title \d+ has (\d+) chapters?/))) {
      title.chapters = Number(m[1]);
    } else if (title && (m = line.match(/Title \d+ has (\d+) audio channels?/))) {
      title.audioChannels = Number(m[1]);
    }
  }
  return sets;
}

module.exports = { parseChapterDurations, parseTitleDurations, parseTitleSets };
