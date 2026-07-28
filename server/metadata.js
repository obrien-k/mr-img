const sizeOf = require('image-size');

async function imageMetadata(dest) {
  const { width, height } = sizeOf(dest);
  return { width, height };
}

module.exports = imageMetadata;
