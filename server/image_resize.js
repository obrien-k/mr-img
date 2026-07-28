const fetch = require('node-fetch');
const download = require('./download.js');
const imageMetadata = require('./metadata.js');
const { mapWithConcurrency } = require('./concurrency.js');

const DOWNLOAD_CONCURRENCY = 4;

async function fetchHighestResolutionPhoto(roverName = 'Curiosity', earthDate = '2021-07-12') {
  const apiKey = process.env.NASA_API_KEY || 'DEMO_KEY';
  const apiUrl = `https://api.nasa.gov/mars-photos/api/v1/rovers/${roverName}/photos?earth_date=${earthDate}&api_key=${apiKey}`;

  const apiRes = await fetch(apiUrl);
  if (!apiRes.ok) {
    throw new Error(`NASA API request failed: ${apiRes.status} ${apiRes.statusText}`);
  }

  const { photos } = await apiRes.json();
  if (!photos || photos.length === 0) {
    throw new Error(`No photos found for ${roverName} on ${earthDate}`);
  }

  const candidates = await mapWithConcurrency(photos, DOWNLOAD_CONCURRENCY, async (photo) => {
    if (!photo.img_src) {
      console.error(`Photo ${photo.id} has no img_src, skipping`);
      return { photo, resolution: 0 };
    }
    try {
      const dest = await download(photo.img_src);
      const { width, height } = await imageMetadata(dest);
      return { photo, dest, width, height, resolution: width * height };
    } catch (err) {
      console.error(`Error processing ${photo.img_src}: ${err.message}`);
      return { photo, resolution: 0 };
    }
  });

  const best = candidates.reduce((acc, cur) => (cur.resolution > acc.resolution ? cur : acc));
  if (best.resolution === 0) {
    throw new Error(`No usable photos found for ${roverName} on ${earthDate}`);
  }

  return best;
}

module.exports = { fetchHighestResolutionPhoto };
