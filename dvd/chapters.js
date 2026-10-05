// A trailing chapter shorter than this is an authoring stub (the 0.6s end cell
// most DVD titles carry), not something a viewer would ever skip to.
const STUB_MS = 1000;

function chapterStarts(durationsMs, { stubMs = STUB_MS } = {}) {
  const durations = [...durationsMs];
  if (durations.length > 1 && durations[durations.length - 1] < stubMs) durations.pop();

  const starts = [];
  let t = 0;
  for (const d of durations) {
    starts.push(t);
    t += d;
  }
  return starts;
}

// dvdauthor accepts [[h:]m:]s[.ms]; match what the hand-run discs used.
function formatTimestamp(ms) {
  if (ms === 0) return '0';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const frac = String(ms % 1000).padStart(3, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}.${frac}` : `${m}:${s}.${frac}`;
}

function chapterList(durationsMs, opts) {
  return chapterStarts(durationsMs, opts).map(formatTimestamp).join(',');
}

module.exports = { chapterStarts, formatTimestamp, chapterList, STUB_MS };
