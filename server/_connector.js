const { MongoClient } = require('mongodb')

let cachedDb;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }
  const client = new MongoClient(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

  cachedDb = await client.connect();
  return cachedDb;
}

module.exports = { connectToDatabase };