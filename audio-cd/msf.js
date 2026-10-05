// Red Book units: 75 sectors (frames) per second, 588 stereo samples per sector.
const FPS = 75;
const SAMPLES_PER_SECTOR = 588;
const CD_RATE = 44100;

function parseMsf(s) {
  const m = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const [mm, ss, ff] = m.slice(1).map(Number);
  if (ss > 59 || ff > 74) return null;
  return (mm * 60 + ss) * FPS + ff;
}

const sectorsForSamples = (samples) => Math.ceil(samples / SAMPLES_PER_SECTOR);

// mm:ss, rounded down: "Remaining" must never round up into space that isn't there.
function formatMinSec(sectors) {
  const neg = sectors < 0;
  const secs = Math.floor(Math.abs(sectors) / FPS);
  const s = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

module.exports = { FPS, SAMPLES_PER_SECTOR, CD_RATE, parseMsf, sectorsForSamples, formatMinSec };
