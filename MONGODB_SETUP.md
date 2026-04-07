# MongoDB Self-Hosted Setup for MAL-Sync

MAL-Sync now supports syncing your anime/manga lists, progress, and settings to a self-hosted MongoDB instance. This allows you to sync your data across multiple devices and browsers.

## Prerequisites

1. **MongoDB** installed and running (local or remote)
2. **MongoDB REST API Proxy** (required for browser communication)
3. **MAL-Sync Userscript** installed

## MongoDB REST API Proxy

Since browsers cannot directly connect to MongoDB, you need a lightweight REST API proxy. Here's a simple example using Node.js and Express:

### Quick Setup

1. Create a new directory for the proxy:
```bash
mkdir malsync-mongo-proxy
cd malsync-mongo-proxy
npm init -y
npm install express mongodb cors body-parser
```

2. Create `server.js`:

```javascript
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 27017;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

let db;

// Connect to MongoDB
MongoClient.connect(MONGO_URL, { useUnifiedTopology: true })
  .then(client => {
    console.log('Connected to MongoDB');
    // Database will be specified in the URL path
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Basic auth middleware (optional but recommended)
function basicAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
  const [username, password] = credentials.split(':');
  
  // Check credentials (configure these in environment variables)
  if (username === process.env.API_USERNAME && password === process.env.API_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// Uncomment to enable authentication
// app.use('/api', basicAuth);

// Ping endpoint
app.get('/api/:database/_ping', async (req, res) => {
  res.json({ ok: 1 });
});

// Find documents
app.get('/api/:database/:collection', async (req, res) => {
  try {
    const { database, collection } = req.params;
    const query = req.query.query ? JSON.parse(req.query.query) : {};
    
    const client = await MongoClient.connect(MONGO_URL, { useUnifiedTopology: true });
    const db = client.db(database);
    const documents = await db.collection(collection).find(query).toArray();
    
    await client.close();
    res.json({ documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Find document by ID
app.get('/api/:database/:collection/:id', async (req, res) => {
  try {
    const { database, collection, id } = req.params;
    
    const client = await MongoClient.connect(MONGO_URL, { useUnifiedTopology: true });
    const db = client.db(database);
    const document = await db.collection(collection).findOne({ _id: new ObjectId(id) });
    
    await client.close();
    res.json({ document });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Insert documents
app.post('/api/:database/:collection', async (req, res) => {
  try {
    const { database, collection } = req.params;
    const { documents, upsert } = req.body;
    
    const client = await MongoClient.connect(MONGO_URL, { useUnifiedTopology: true });
    const db = client.db(database);
    
    if (documents && Array.isArray(documents)) {
      // Bulk insert with upsert
      if (upsert) {
        const bulkOps = documents.map(doc => ({
          replaceOne: {
            filter: { uid: doc.uid },
            replacement: doc,
            upsert: true
          }
        }));
        const result = await db.collection(collection).bulkWrite(bulkOps);
        await client.close();
        res.json({ insertedIds: result.upsertedIds });
      } else {
        const result = await db.collection(collection).insertMany(documents);
        await client.close();
        res.json({ insertedIds: Object.values(result.insertedIds) });
      }
    } else {
      // Single insert
      const result = await db.collection(collection).insertOne(req.body);
      await client.close();
      res.json({ insertedId: result.insertedId.toString() });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update documents
app.put('/api/:database/:collection', async (req, res) => {
  try {
    const { database, collection } = req.params;
    const query = req.query.query ? JSON.parse(req.query.query) : {};
    const { document, upsert } = req.body;
    
    const client = await MongoClient.connect(MONGO_URL, { useUnifiedTopology: true });
    const db = client.db(database);
    
    if (document) {
      // Replace document
      const result = await db.collection(collection).replaceOne(query, document, { upsert: !!upsert });
      await client.close();
      res.json({ 
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId?.toString()
      });
    } else {
      // Update with operators
      const result = await db.collection(collection).updateMany(query, req.body);
      await client.close();
      res.json({ modifiedCount: result.modifiedCount });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete documents
app.delete('/api/:database/:collection', async (req, res) => {
  try {
    const { database, collection } = req.params;
    const query = req.query.query ? JSON.parse(req.query.query) : {};
    
    const client = await MongoClient.connect(MONGO_URL, { useUnifiedTopology: true });
    const db = client.db(database);
    const result = await db.collection(collection).deleteMany(query);
    
    await client.close();
    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`MALSync MongoDB Proxy listening on port ${PORT}`);
  console.log(`MongoDB URL: ${MONGO_URL}`);
});
```

3. Create `.env` file (optional, for authentication):
```
MONGO_URL=mongodb://localhost:27017
PORT=3000
API_USERNAME=your_username
API_PASSWORD=your_password
```

4. Run the proxy:
```bash
node server.js
```

For production, use PM2 or similar:
```bash
npm install -g pm2
pm2 start server.js --name malsync-proxy
pm2 save
```

## Configure MAL-Sync

1. Open MAL-Sync settings in your userscript
2. Navigate to **MongoDB Sync** section
3. Configure the following:

   - **Enable MongoDB Sync**: Toggle ON
   - **MongoDB URL**: `http://localhost:3000` (or your proxy URL)
   - **Database Name**: `malsync` (or your preferred database name)
   - **Username**: (optional, if you enabled authentication)
   - **Password**: (optional, if you enabled authentication)

4. Click **Test Connection** to verify the setup
5. Configure sync options:
   - **Sync Direction**: Choose bidirectional, push-only, or pull-only
   - **Auto Sync Interval**: How often to sync (in seconds, minimum 60)
   - **Conflict Resolution**: How to handle conflicts between local and remote data

6. Click **Manual Sync Now** to perform the first sync

## Data Schema

The following collections will be created in your MongoDB database:

- `anime` - Your anime list and progress
- `manga` - Your manga list and progress
- `storage` - Settings and key-value storage

## Security Considerations

1. **Use HTTPS**: Always use HTTPS for the proxy in production
2. **Enable Authentication**: Use the basic auth middleware in the proxy
3. **Firewall**: Restrict access to the proxy to trusted IPs
4. **Encryption**: Enable the "Encrypt Data Before Upload" option in settings for sensitive data

## Troubleshooting

### Connection Failed
- Ensure MongoDB is running
- Verify the proxy server is running
- Check firewall rules
- Verify the MongoDB URL is correct
- Check browser console for errors

### Sync Not Working
- Ensure "Enable MongoDB Sync" is toggled ON
- Check that auto-sync interval is set (minimum 60 seconds)
- Verify MongoDB credentials if authentication is enabled
- Check proxy server logs for errors

### Conflicts
- The conflict resolution strategy can be changed in settings
- Options: Newest wins, Local wins, or Remote wins
- For critical data, use "Local Wins" to prevent data loss

## Docker Setup (Alternative)

You can also run both MongoDB and the proxy in Docker:

```yaml
version: '3.8'
services:
  mongodb:
    image: mongo:latest
    ports:
      - "27017:27017"
    volumes:
      - ./data:/data/db
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: password

  proxy:
    build: .
    ports:
      - "3000:3000"
    environment:
      MONGO_URL: mongodb://admin:password@mongodb:27017
      API_USERNAME: malsync
      API_PASSWORD: your_secure_password
    depends_on:
      - mongodb
```

## Support

For issues and questions:
- GitHub Issues: https://github.com/MALSync/MALSync/issues
- Discord: https://discord.com/invite/cTH4yaw
