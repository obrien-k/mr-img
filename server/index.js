const express = require('express');
const cors = require('cors')
const app = express();
require('dotenv').config()

app.use(cors())
app.options('*', cors())
app.use(express.json({ extended: false }));
const download = require('./download.js')

const url = 'https://mars.jpl.nasa.gov/msl-raw-images/proj/msl/redops/ods/surface/sol/01792/opgs/edr/fcam/FLB_556577420EDR_F0651174FHAZ00302M_.jpg'
app.get('/', (req, res) => res.send('API Running'));

// Define Routes
app.post('/post', cors(), (req, res) => {
  res.send('Got a POST request')
  
})

// Constants
const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3000;

app.listen(PORT, HOST, () => {
  console.log(`Running on http://${HOST}:${PORT}`);
});
async function run() {
  try {
    await download(url)
    console.log('Download done')
  } catch (e) {
    console.log('Download failed')
    console.log(e.message)
  }
}
run();
