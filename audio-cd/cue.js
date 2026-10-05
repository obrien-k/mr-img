// CUE sheet parsing and rewriting. The rewrite keeps every layout line
// (TRACK/INDEX/PREGAP/POSTGAP/FLAGS/ISRC/CATALOG/REM) verbatim and changes only
// FILE lines, plus dropping CD-TEXT fields so no CD_TEXT reaches the TOC.
const { parseMsf } = require('./msf.js');

class CueError extends Error {}

// Fields cue2toc turns into CD_TEXT blocks.
const CD_TEXT_FIELDS = new Set(['TITLE', 'PERFORMER', 'SONGWRITER', 'COMPOSER', 'ARRANGER', 'MESSAGE', 'CDTEXTFILE', 'UPC_EAN', 'DISC_ID', 'GENRE']);

// EAC writes cp1252, XLD writes UTF-8 (sometimes with a BOM).
function decodeCue(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function parseCue(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const files = [];
  const tracks = [];
  let track = null;
  const fail = (i, msg) => { throw new CueError(`line ${i + 1}: ${msg}: ${lines[i].trim()}`); };

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const keyword = line.split(/\s+/, 1)[0].toUpperCase();
    switch (keyword) {
      case 'FILE': {
        const m = /^FILE\s+(?:"([^"]*)"|(\S+))\s+(\S+)$/i.exec(line);
        if (!m) fail(i, 'malformed FILE');
        files.push({ name: m[1] ?? m[2], type: m[3].toUpperCase(), line: i });
        break;
      }
      case 'TRACK': {
        const m = /^TRACK\s+(\d{1,2})\s+(\S+)$/i.exec(line);
        if (!m) fail(i, 'malformed TRACK');
        if (!files.length) fail(i, 'TRACK before any FILE');
        track = { number: Number(m[1]), mode: m[2].toUpperCase(), file: files.length - 1, line: i, indexes: [], pregap: 0, postgap: 0 };
        tracks.push(track);
        break;
      }
      case 'INDEX': {
        const m = /^INDEX\s+(\d{1,2})\s+(\S+)$/i.exec(line);
        if (!m) fail(i, 'malformed INDEX');
        if (!track) fail(i, 'INDEX before any TRACK');
        const at = parseMsf(m[2]);
        if (at === null) fail(i, 'bad mm:ss:ff time');
        track.indexes.push({ number: Number(m[1]), at, file: files.length - 1, line: i });
        break;
      }
      case 'PREGAP':
      case 'POSTGAP': {
        const m = /^(?:PREGAP|POSTGAP)\s+(\S+)$/i.exec(line);
        const at = m && parseMsf(m[1]);
        if (at === null || at === undefined) fail(i, `malformed ${keyword}`);
        if (!track) fail(i, `${keyword} before any TRACK`);
        track[keyword.toLowerCase()] = at;
        break;
      }
      default:
        break; // REM, CATALOG, FLAGS, ISRC, CD-TEXT fields: carried through or dropped by rewriteCue
    }
  });

  validate(files, tracks);
  return { lines, files, tracks };
}

function validate(files, tracks) {
  if (!files.length) throw new CueError('no FILE statements');
  if (!tracks.length) throw new CueError('no TRACK statements');
  tracks.forEach((t, n) => {
    if (t.number !== n + 1) {
      throw new CueError(`track numbering is not sequential: expected TRACK ${String(n + 1).padStart(2, '0')}, found TRACK ${String(t.number).padStart(2, '0')}`);
    }
    if (t.mode !== 'AUDIO') throw new CueError(`TRACK ${t.number} is ${t.mode}; only AUDIO tracks can go on an Audio CD`);
    const one = t.indexes.find((x) => x.number === 1);
    if (!one) throw new CueError(`TRACK ${t.number} has no INDEX 01`);
    t.indexes.forEach((x, k) => {
      if (k > 0 && x.number !== t.indexes[k - 1].number + 1) throw new CueError(`TRACK ${t.number}: INDEX numbers must increase by 1`);
      if (k > 0 && x.file === t.indexes[k - 1].file && x.at <= t.indexes[k - 1].at) throw new CueError(`TRACK ${t.number}: INDEX ${x.number} does not come after INDEX ${t.indexes[k - 1].number}`);
    });
    if (t.indexes[0].number > 1) throw new CueError(`TRACK ${t.number}: first INDEX must be 00 or 01`);
  });
}

// Tracks whose TRACK line sits under an earlier FILE than their INDEX 01.
// `gap: true` means audio before INDEX 01 lives in that earlier file — the
// EAC/XLD "gaps appended to previous track" layout cue2toc cannot convert.
function splitTracks(cue) {
  return cue.tracks
    .filter((t) => t.indexes.find((x) => x.number === 1).file !== t.file)
    .map((t) => ({ number: t.number, gap: t.indexes.some((x) => x.number === 0 && x.file !== t.indexes.find((y) => y.number === 1).file) }));
}

function quoteCueString(s) {
  if (/["\r\n]/.test(s)) throw new CueError(`cannot write ${JSON.stringify(s)} into a CUE FILE line`);
  return `"${s}"`;
}

// newNames[i] = WAV name for cue.files[i].
// appendedGaps: for split tracks, move the TRACK line (and its FLAGS/ISRC) after
// the FILE line holding INDEX 01, dropping the INDEX 00 that sat in the earlier
// file. The gap audio stays at the end of the previous track: same audio, the
// pregap marker is lost. Only done when explicitly requested.
function rewriteCue(cue, newNames, { appendedGaps = false } = {}) {
  const split = splitTracks(cue);
  const withGap = split.filter((s) => s.gap).map((s) => s.number);
  if (withGap.length && !appendedGaps) {
    throw new CueError(
      `track(s) ${withGap.join(', ')} keep their pregap (INDEX 00) at the end of the previous file ` +
      '("gaps appended to previous track"). cue2toc cannot convert that layout. Re-run with --appended-gaps ' +
      'to keep the gap audio at the end of the previous track and drop the INDEX 00 marker (audio is unchanged).',
    );
  }

  const drop = new Set();
  const moveAfter = new Map(); // FILE line index -> lines to insert after it
  for (const s of split) {
    const t = cue.tracks[s.number - 1];
    const one = t.indexes.find((x) => x.number === 1);
    const targetFileLine = cue.files[one.file].line;
    const moved = [];
    for (let i = t.line; i < targetFileLine; i++) {
      const kw = cue.lines[i].trim().split(/\s+/, 1)[0].toUpperCase();
      if (kw === 'INDEX') { drop.add(i); continue; }
      if (cue.lines[i].trim()) moved.push(cue.lines[i]);
      drop.add(i);
    }
    moveAfter.set(targetFileLine, [...(moveAfter.get(targetFileLine) || []), ...moved]);
  }

  const out = [];
  cue.lines.forEach((raw, i) => {
    if (drop.has(i)) return;
    const kw = raw.trim().split(/\s+/, 1)[0].toUpperCase();
    if (CD_TEXT_FIELDS.has(kw)) return;
    const f = cue.files.findIndex((x) => x.line === i);
    if (f !== -1) {
      out.push(`${raw.match(/^\s*/)[0]}FILE ${quoteCueString(newNames[f])} WAVE`);
      out.push(...(moveAfter.get(i) || []));
      return;
    }
    out.push(raw.replace(/\s+$/, ''));
  });
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n') + '\n';
}

module.exports = { CueError, decodeCue, parseCue, splitTracks, rewriteCue, CD_TEXT_FIELDS };
