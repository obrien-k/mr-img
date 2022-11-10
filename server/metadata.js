const sharp = require('sharp');

async function imageMetadata(dest) {
  const metadata = await sharp(dest).metadata().then(function(metadata){
    console.log(metadata.width);
    console.log(metadata.height);
    imgRes = (metadata.height * metadata.width);
    console.log(imgRes);
  });
}

module.exports = imageMetadata;
