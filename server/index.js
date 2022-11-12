const download = require('./download.js')
const url = 'http://mars.jpl.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/01615/opgs/edr/fcam/FLB_540868499EDR_F0610924FHAZ00206M_.JPG'
console.log('Downloading ' + url)
'use strict';

const express = require('express');

// Constants
const PORT = 8080;
const HOST = '0.0.0.0';

// App
const app = express();
app.get('/', (req, res) => {
  res.send('Hello World');
});

app.listen(PORT, HOST, () => {
  console.log(`Running on http://${HOST}:${PORT}`);
});
async function run() {
  console.log('Downloading file')
  try {
    await download(url)
    console.log('Download done')
  } catch (e) {
    console.log('Download failed')
    console.log(e.message)
  }
}

run()