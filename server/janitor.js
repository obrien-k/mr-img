const { ObjectID } = require('mongodb');
const { connectToDatabase } = require('./_connector');

export default async (req, res) => {
  const db = await connectToDatabase();

  const entry = await db.db('yimg').collection('delete_test').findOne({ _id: new ObjectID(req.query.id) });

    if (entry !== null) {
        return res.redirect(301, entry.link);
    }

    return res.redirect(301, '/');
}