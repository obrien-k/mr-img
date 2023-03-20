const sharp = require('sharp');

async function imageMetadata(dest) {
  const metadata = await sharp(dest).metadata().then(function(metadata){
    console.log(metadata.width);
    console.log(metadata.height);
    imgRes = (metadata.height * metadata.width);
    console.log(imgRes);
    console.log('**********');
    console.log(metadata)

  });

}

module.exports = imageMetadata;

// fetch all images per sol



// compare img res to find largest image

// return largest image

// resize largest image