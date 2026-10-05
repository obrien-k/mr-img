// Readers for cue2toc's TOC file and cdrdao's show-toc / scanbus output.

// The AUDIOFILE/FILE names a TOC references.
function tocAudioFiles(toc) {
  return [...toc.matchAll(/^\s*(?:AUDIOFILE|FILE)\s+"((?:[^"\\]|\\.)*)"/gm)].map((m) => m[1]);
}

function tocType(toc) {
  const first = toc.split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).find(Boolean);
  return first || null;
}

// Remove CD_TEXT { ... } blocks (brace-matched). Used only if a cue2toc
// build emits them despite the CD-TEXT-free CUE we hand it.
function stripCdText(toc) {
  let out = '';
  let i = 0;
  for (;;) {
    const at = toc.indexOf('CD_TEXT', i);
    if (at === -1) return out + toc.slice(i);
    const open = toc.indexOf('{', at);
    if (open === -1) return out + toc.slice(i);
    let depth = 0;
    let j = open;
    for (; j < toc.length; j++) {
      if (toc[j] === '{') depth++;
      else if (toc[j] === '}' && --depth === 0) break;
    }
    out += toc.slice(i, at);
    i = j + 1;
  }
}

// cdrdao show-toc:
//   TOC TYPE: CD_DA
//   TRACK  1  Mode AUDIO:
//             END    54:02:13(243163)
function parseShowToc(out) {
  const type = (/^TOC TYPE:\s*(\S+)/m.exec(out) || [])[1] || null;
  const tracks = [...out.matchAll(/^TRACK\s+(\d+)\s+Mode\s+(\S+?):/gm)].map((m) => ({ number: Number(m[1]), mode: m[2] }));
  const ends = [...out.matchAll(/^\s*END\s+\d+:\d+:\d+\(\s*(\d+)\)/gm)].map((m) => Number(m[1]));
  return { type, tracks, endSectors: ends.length ? ends[ends.length - 1] : null };
}

// cdrdao scanbus (prints to stderr, exits 0 even with no drives):
//   IOCompactDiscServices/1 : HL-DT-ST, DVDRW GX50N, RP09
//   /dev/sr0 : HL-DT-ST, DVDRAM GP65NB60, RF01
function parseScanbus(out) {
  return out.split('\n')
    .filter((l) => !/^\s*(Cdrdao|ERROR|WARNING)/.test(l))
    .map((l) => /^\s*(\S+)\s*:\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*(.*?)\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ device: m[1], vendor: m[2], model: m[3], revision: m[4] }));
}

module.exports = { tocAudioFiles, tocType, stripCdText, parseShowToc, parseScanbus };
