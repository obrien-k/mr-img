// Finding the CUE and the audio each FILE line refers to. Read-only.
const fs = require('fs');
const path = require('path');
const { readFlacInfo, readWavInfo, cdDaProblems } = require('./audio.js');
const { CD_RATE } = require('./msf.js');

class SourceError extends Error {}

const visible = (name) => !name.startsWith('._') && !name.startsWith('.');

function findCue(input, cueName) {
  let stat;
  try { stat = fs.statSync(input); } catch { throw new SourceError(`no such file or directory: ${input}`); }
  if (stat.isFile()) {
    if (path.extname(input).toLowerCase() !== '.cue') throw new SourceError(`not a .cue file: ${input}`);
    return path.resolve(input);
  }
  if (cueName) {
    const p = path.resolve(input, cueName);
    if (!fs.existsSync(p)) throw new SourceError(`--cue ${cueName}: not found in ${input}`);
    return p;
  }
  const cues = fs.readdirSync(input).filter((n) => visible(n) && path.extname(n).toLowerCase() === '.cue').sort();
  if (cues.length === 0) throw new SourceError(`no .cue file in ${input}`);
  if (cues.length > 1) throw new SourceError(`${cues.length} .cue files in ${input}; pick one with --cue:\n  ${cues.join('\n  ')}`);
  return path.join(path.resolve(input), cues[0]);
}

// Exact name first; then Unicode-normalized (macOS stores NFD), then case-insensitive.
function findEntry(dir, name) {
  const exact = path.join(dir, name);
  if (fs.existsSync(exact)) return exact;
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return null; }
  const nfc = name.normalize('NFC');
  const hit = entries.find((e) => e.normalize('NFC') === nfc)
    || entries.find((e) => e.normalize('NFC').toLowerCase() === nfc.toLowerCase());
  return hit ? path.join(dir, hit) : null;
}

// A FILE reference -> { flac?, wav?, note? }. FLAC is the source of truth
// whenever one exists; a lossy reference is only honored via a lossless sibling.
function resolveSource(cueDir, ref) {
  const full = path.resolve(cueDir, ref.replace(/\\/g, '/'));
  const dir = path.dirname(full);
  const base = path.basename(full);
  const ext = path.extname(base).toLowerCase();
  const stem = base.slice(0, base.length - path.extname(base).length);
  const flac = ext === '.flac' ? findEntry(dir, base) || findEntry(dir, `${stem}.flac`) : findEntry(dir, `${stem}.flac`);
  const wav = ext === '.wav' ? findEntry(dir, base) || findEntry(dir, `${stem}.wav`) : findEntry(dir, `${stem}.wav`);

  if (!flac && !wav) {
    if (ext !== '.flac' && ext !== '.wav' && findEntry(dir, base)) {
      throw new SourceError(`unsupported audio source "${ref}": only FLAC or WAV can be authored (no ${stem}.flac or ${stem}.wav next to it)`);
    }
    throw new SourceError(`CUE references "${ref}", which does not exist (also looked for ${stem}.flac and ${stem}.wav)`);
  }
  const used = flac || wav;
  const note = path.basename(used).normalize('NFC') !== base.normalize('NFC') ? `"${ref}" -> ${path.basename(used)}` : null;
  return { ref, flac, wav, note };
}

const cdNative = (i) => i.sampleRate === CD_RATE && i.channels === 2 && i.bitsPerSample === 16;

// Decide per source: reuse a WAV (only if it checks out) or decode the FLAC.
function planSource(src) {
  const warnings = [];
  if (src.flac) {
    let info;
    try { info = readFlacInfo(src.flac); } catch (e) { throw new SourceError(`${src.flac}: ${e.message}`); }
    const native = cdNative(info);
    if (!native) {
      warnings.push(`${path.basename(src.flac)} is ${info.sampleRate} Hz / ${info.bitsPerSample}-bit / ${info.channels} ch; ffmpeg will convert it to CD format (not bit-exact)`);
    }
    if (src.wav) {
      let reason = null;
      try {
        const w = readWavInfo(src.wav);
        const problems = cdDaProblems(w);
        if (problems.length) reason = problems.join(', ');
        else if (!native) reason = 'FLAC is not CD-native, decoding instead';
        else if (!info.samples) reason = 'FLAC length unknown, cannot compare';
        else if (w.samples !== info.samples) reason = `${w.samples} samples vs FLAC's ${info.samples}`;
        if (!reason) return { ...src, action: 'reuse', from: src.wav, samples: w.samples, expectSamples: w.samples, warnings };
      } catch (e) {
        reason = e.message;
      }
      warnings.push(`ignoring existing ${path.basename(src.wav)} (${reason}); decoding the FLAC`);
    }
    const samples = info.samples ? Math.round((info.samples * CD_RATE) / info.sampleRate) : null;
    return { ...src, action: 'decode', from: src.flac, samples, expectSamples: native && info.samples ? info.samples : null, warnings };
  }
  let w;
  try { w = readWavInfo(src.wav); } catch (e) { throw new SourceError(`${src.wav}: ${e.message}`); }
  const problems = cdDaProblems(w);
  if (problems.length) throw new SourceError(`${path.basename(src.wav)} cannot be used as CD-DA: ${problems.join(', ')}`);
  return { ...src, action: 'reuse', from: src.wav, samples: w.samples, expectSamples: w.samples, warnings };
}

// "01 Track.flac" -> "01 Track.wav": replace the extension, never append.
// Backslashes and quotes would break the TOC's quoted strings.
function wavName(sourcePath, taken) {
  const stem = path.parse(sourcePath).name.replace(/[\\"\u0000-\u001f]/g, '_');
  let name = `${stem}.wav`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${stem} (${n}).wav`;
  taken.add(name.toLowerCase());
  return name;
}

module.exports = { SourceError, findCue, findEntry, resolveSource, planSource, wavName };
