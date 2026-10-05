// Disc identity from the CD's table of contents (track start offsets in
// sectors incl. the 150-sector lead-in, plus the lead-out). The TOC travels
// with XLD rips in the iTunes_CDDB_1 tag: "<cddbid>+<leadout>+<n>+<off1>+…".

function parseCddbTag(value) {
  const parts = String(value).trim().split('+');
  if (parts.length < 4 || !/^[0-9a-f]{8}$/i.test(parts[0])) return null;
  const [id, leadout, n, ...offsets] = parts;
  const nums = [Number(leadout), Number(n), ...offsets.map(Number)];
  if (nums.some((x) => !Number.isInteger(x) || x < 0) || offsets.length !== Number(n)) return null;
  return { cddbId: id.toLowerCase(), leadout: Number(leadout), offsets: offsets.map(Number) };
}

const digitSum = (n) => String(n).split('').reduce((a, d) => a + Number(d), 0);

// freedb/CDDB disc id, recomputed from the TOC.
function cddbId({ offsets, leadout }) {
  const n = offsets.reduce((a, o) => a + digitSum(Math.floor(o / 75)), 0);
  const t = Math.floor(leadout / 75) - Math.floor(offsets[0] / 75);
  return (((n % 0xff) << 24 | t << 8 | offsets.length) >>> 0).toString(16).padStart(8, '0');
}

// AccurateRip disc id ("005-00055fd8-001a3998-3206ae05") and its database path.
function accurateRipId({ offsets, leadout }) {
  const lba = offsets.map((o) => o - 150);
  const out = leadout - 150;
  const id1 = (lba.reduce((a, b) => a + b, 0) + out) >>> 0;
  const id2 = (lba.reduce((a, b, i) => a + Math.max(b, 1) * (i + 1), 0) + out * (lba.length + 1)) >>> 0;
  const h = (x) => x.toString(16).padStart(8, '0');
  const id = `${String(lba.length).padStart(3, '0')}-${h(id1)}-${h(id2)}-${cddbId({ offsets, leadout })}`;
  return { id, url: `http://www.accuraterip.com/accuraterip/${h(id1)[7]}/${h(id1)[6]}/${h(id1)[5]}/dBAR-${id}.bin` };
}

// Expected length of each track, in sectors, per the TOC.
const trackSectors = ({ offsets, leadout }) => offsets.map((o, i) => (offsets[i + 1] ?? leadout) - o);

module.exports = { parseCddbTag, cddbId, accurateRipId, trackSectors };
