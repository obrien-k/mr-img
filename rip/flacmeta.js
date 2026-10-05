// FLAC Vorbis comments (metadata block type 4), read without decoding.
const fs = require('fs');

function readVorbisComments(file) {
  const buf = fs.readFileSync(file, { encoding: null, flag: 'r' }).subarray(0, 4 << 20);
  let pos = 0;
  if (buf.toString('latin1', 0, 3) === 'ID3') pos = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f));
  if (buf.toString('latin1', pos, pos + 4) !== 'fLaC') throw new Error('not a FLAC file');
  pos += 4;
  const tags = {};
  for (let last = false; !last && pos + 4 <= buf.length;) {
    last = (buf[pos] & 0x80) !== 0;
    const type = buf[pos] & 0x7f;
    const len = buf.readUIntBE(pos + 1, 3);
    if (type === 4) {
      let p = pos + 4;
      p += 4 + buf.readUInt32LE(p); // vendor string
      const count = buf.readUInt32LE(p);
      p += 4;
      for (let i = 0; i < count; i++) {
        const l = buf.readUInt32LE(p);
        const kv = buf.toString('utf8', p + 4, p + 4 + l);
        p += 4 + l;
        const eq = kv.indexOf('=');
        if (eq > 0) tags[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
      }
    }
    pos += 4 + len;
  }
  return tags;
}

module.exports = { readVorbisComments };
