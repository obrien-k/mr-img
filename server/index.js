const express = require('express');
const cors = require('cors')
const app = express();
app.use(cors())
app.options('*', cors())
app.use(express.json({ extended: false }));
const download = require('./download.js')

const url = 'https://i.stack.imgur.com/aA5kp.jpg'
app.get('/', (req, res) => res.send('API Running'));

// Define Routes
app.post('/post', cors(), (req, res) => {
  res.send('Got a POST request')
  
})

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
  try {
    await download(url)
    console.log('Download done')
  } catch (e) {
    console.log('Download failed')
    console.log(e.message)
  }
}
run();
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server started on ${PORT}`));
