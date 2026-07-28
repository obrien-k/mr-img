const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.options('*', cors());
app.use(express.json({ extended: false }));

app.get('/', (req, res) => res.send('API Running'));

// Define Routes
app.post('/post', cors(), (req, res) => {
  res.send('Got a POST request')
})

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Running on http://${HOST}:${PORT}`);
});
