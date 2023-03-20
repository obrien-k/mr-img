const download = require('./download.js');
const fetch = require('node-fetch');
const sharp = require('sharp');
require('dotenv').config()

const API_KEY = process.env.NASA_API_KEY;

function downloadHighestResolutionImage(roverName = 'Curiosity', earthDate = '2021-7-12') {
  const API_URL = `https://api.nasa.gov/mars-photos/api/v1/rovers/${roverName}/photos?earth_date=${earthDate}&api_key=${API_KEY}`;

  fetch(API_URL)
    .then((res) => res.json())
    .then((data) => {
      const photolist = data.photos;
      if (photolist.length === 0) {
        console.error('No images found for the given rover and date.');
        return;
      }
      const imageUrls = photolist.map((photo) => photo.img_src);
      const sharpPromises = imageUrls.map((url) => {
        if (!url) {
          console.error(`Error: URL is undefined for photo with ID ${photo.id}`);
          return Promise.resolve({ url, resolution: 0 });
        }
        return download(url)
          .then((filePath) => {
            return sharp(filePath, { failOnError: false }).metadata()
              .then((metadata) => {
                if (!metadata) {
                  console.error(`Error: Metadata is null for photo with URL ${url}`);
                  return { url, resolution: 0 };
                }
                return { url, resolution: metadata.width * metadata.height };
              })
              .catch((err) => {
                console.error(`Error getting metadata for image: ${err.message}`);
                return { url, resolution: 0 };
              });
          })
          .catch((err) => {
            console.error(`Error downloading image: ${err.message}`);
            return { url, resolution: 0 };
          });
      });
      Promise.all(sharpPromises)
        .then((sharpResults) => {
          if (sharpResults.length === 0) {
            console.error('No images found for the given rover and date.');
            return;
          } 
          const highestRes = sharpResults.reduce((acc, cur) => (cur.resolution > acc.resolution ? cur : acc));
          console.log(`Downloading image with highest resolution (${highestRes.resolution} pixels): ${highestRes.url}`);
          return console.log(highestRes.url);
        })
        .then(() => console.log(`Image downloaded successfully.`))
        .catch((err) => console.error(`Error downloading image: ${err.message}`));
    })
    .catch((err) => console.error(`Error retrieving photolist: ${err.message}`));
}

downloadHighestResolutionImage();