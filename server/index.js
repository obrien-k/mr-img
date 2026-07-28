const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { fetchHighestResolutionPhoto } = require('./image_resize.js');

const app = express();
app.use(cors());
app.options('*', cors());
app.use(express.json({ extended: false }));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/images', express.static(path.join(__dirname, 'tmp')));

app.get('/api/health', (req, res) => res.send('API Running'));

app.get('/api/rover-photo', async (req, res) => {
  const rover = req.query.rover || 'Curiosity';
  const earthDate = req.query.earth_date || '2021-07-12';

  try {
    const best = await fetchHighestResolutionPhoto(rover, earthDate);
    res.json({
      img_src: `/images/${path.basename(best.dest)}`,
      width: best.width,
      height: best.height,
      camera: best.photo.camera && best.photo.camera.full_name,
      rover: best.photo.rover && best.photo.rover.name,
      earth_date: best.photo.earth_date,
    });
  } catch (err) {
    res.status(502).json({ error: 'rover_photo_fetch_failed', error_description: err.message });
  }
});

app.post('/post', cors(), (req, res) => {
  res.send('Got a POST request');
});

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Running on http://${HOST}:${PORT}`);
});
