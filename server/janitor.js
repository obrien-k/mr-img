const { ObjectId } = require('mongodb');
const { connectToDatabase } = require('./_connector');

module.exports = async (req, res) => {
  const db = await connectToDatabase();

  const entry = await db.db('yimg').collection('delete_test').findOne({ _id: new ObjectId(req.query.id) });

  if (entry !== null) {
    return res.redirect(301, entry.link);
  }

  return res.redirect(301, '/');
}