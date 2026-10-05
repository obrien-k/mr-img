// Header readers for the two supported sources. Read-only; no decoding.
const fs = require('fs');
const crypto = require('crypto');
const { CD_RATE } = require('./msf.js');

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

// RIFF/WAVE: walk the chunks (LIST/INFO etc. may sit before `data`).
function readWavInfo(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = readAt(fd, 0, 12);
    if (head.length < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') {
      throw new Error('not a RIFF/WAVE file');
    }
    let pos = 12;
    let fmt = null;
    let dataBytes = null;
    let dataOffset = null;
    while (pos + 8 <= size && (fmt === null || dataBytes === null)) {
      const h = readAt(fd, pos, 8);
      const id = h.toString('latin1', 0, 4);
      const len = h.readUInt32LE(4);
      if (id === 'fmt ') {
        const b = readAt(fd, pos + 8, Math.min(len, 40));
        let format = b.readUInt16LE(0);
        if (format === 0xfffe && b.length >= 26) format = b.readUInt16LE(24); // EXTENSIBLE: subformat GUID
        fmt = { pcm: format === 1, channels: b.readUInt16LE(2), sampleRate: b.readUInt32LE(4), bitsPerSample: b.readUInt16LE(14) };
      } else if (id === 'data') {
        dataBytes = Math.min(len, size - pos - 8);
        dataOffset = pos + 8;
      }
      pos += 8 + len + (len % 2);
    }
    if (!fmt) throw new Error('no fmt chunk');
    if (dataBytes === null) throw new Error('no data chunk');
    const frameBytes = fmt.channels * (fmt.bitsPerSample / 8);
    return { ...fmt, dataOffset, dataBytes, samples: frameBytes ? Math.floor(dataBytes / frameBytes) : 0 };
  } finally {
    fs.closeSync(fd);
  }
}

// FLAC STREAMINFO (always the first metadata block), after an optional ID3v2 tag.
function readFlacInfo(file) {
  const fd = fs.openSync(file, 'r');
  try {
    let pos = 0;
    const id3 = readAt(fd, 0, 10);
    if (id3.toString('latin1', 0, 3) === 'ID3') {
      pos = 10 + ((id3[6] & 0x7f) << 21 | (id3[7] & 0x7f) << 14 | (id3[8] & 0x7f) << 7 | (id3[9] & 0x7f));
    }
    const b = readAt(fd, pos, 4 + 4 + 34);
    if (b.length < 42 || b.toString('latin1', 0, 4) !== 'fLaC') throw new Error('not a FLAC file');
    if ((b[4] & 0x7f) !== 0) throw new Error('first FLAC metadata block is not STREAMINFO');
    const v = b.readBigUInt64BE(8 + 10);
    return {
      sampleRate: Number(v >> 44n),
      channels: Number((v >> 41n) & 7n) + 1,
      bitsPerSample: Number((v >> 36n) & 31n) + 1,
      samples: Number(v & 0xfffffffffn), // 0 = unknown
      md5: /^0+$/.test(b.toString('hex', 8 + 18, 8 + 34)) ? null : b.toString('hex', 8 + 18, 8 + 34),
    };
  } finally {
    fs.closeSync(fd);
  }
}

// MD5 of a WAV's PCM data. For 16-bit audio this is exactly what FLAC's
// STREAMINFO MD5 covers, so equal hashes prove a bit-exact decode.
function wavPcmMd5(file, info = readWavInfo(file)) {
  const hash = crypto.createHash('md5');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let left = info.dataBytes;
    let pos = info.dataOffset;
    while (left > 0) {
      const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), pos);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
      left -= n;
      pos += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

// What disqualifies a WAV as a CD-DA source (empty = usable as-is).
function cdDaProblems(info) {
  const p = [];
  if (info.pcm === false) p.push('not PCM');
  if (info.sampleRate !== CD_RATE) p.push(`${info.sampleRate} Hz, need 44100`);
  if (info.channels !== 2) p.push(`${info.channels} channel(s), need 2`);
  if (info.bitsPerSample !== 16) p.push(`${info.bitsPerSample}-bit, need 16`);
  if (info.samples === 0) p.push('no audio');
  return p;
}

module.exports = { readWavInfo, readFlacInfo, wavPcmMd5, cdDaProblems };
