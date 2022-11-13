const { connectToDatabase } = require("./_connector");

export default async (req, res) => {
  const db = await connectToDatabase();

  if (req.body !== '' && req.body.img_src !== undefined && req.body.img_src !== '') {
    const entry = await db.db('yimg').collection('yimg').insertOne({ img_src: req.body.img_src });

    res.statusCode = 201;
    return res.json({ img_src: `yimg/tmp/${entry.insertedId}` });
  }

  res.statusCode = 409;
  res.json({ error: 'no_image_found', error_description: 'No image found'})
}