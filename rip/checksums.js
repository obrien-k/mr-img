// Per-track rip checksums from 16-bit stereo PCM (44.1 kHz, little-endian):
//   crc32     — EAC/XLD "Copy CRC" / "CRC32 hash": IEEE CRC-32 over every byte.
//   arV1/arV2 — AccurateRip v1 and v2. Each stereo frame is one uint32 (left
//               in the low half); multiplier starts at 1. The first track skips
//               frames below 5 sectors (2940), the last track stops 5 sectors
//               before its end; both bounds inclusive. Matches cyanrip's
//               checksums.h and leo-bogert/accuraterip-checksum.
const SKIP = 5 * 588;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

// Streaming: feed PCM chunks of any size, then digest().
function trackHasher({ totalFrames, first = false, last = false }) {
  const from = first ? SKIP : 0;
  const to = last ? totalFrames - SKIP : totalFrames;
  let crc = 0xffffffff;
  let v1 = 0;
  let v2 = 0;
  let mult = 1;
  let carry = Buffer.alloc(0);

  return {
    update(chunk) {
      for (let i = 0; i < chunk.length; i++) crc = CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const whole = buf.length - (buf.length % 4);
      for (let o = 0; o < whole; o += 4, mult++) {
        if (mult < from || mult > to) continue;
        const s = buf.readUInt32LE(o);
        // v1: low 32 bits of s*mult. v2: hi + lo of the full 64-bit product.
        const p = BigInt(s) * BigInt(mult);
        const lo = Number(p & 0xffffffffn);
        v1 = (v1 + lo) >>> 0;
        v2 = (v2 + lo + Number(p >> 32n)) >>> 0;
      }
      carry = Buffer.from(buf.subarray(whole));
    },
    digest() {
      const hex = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
      return { crc32: hex(crc ^ 0xffffffff), arV1: hex(v1), arV2: hex(v2), frames: mult - 1 };
    },
  };
}

module.exports = { trackHasher, SKIP };
