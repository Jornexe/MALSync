import { Collection, Db, MongoClient } from 'mongodb';

export type SyncEntryDoc = {
  ownerId: string;
  userKey: string;
  mediaType: 'anime' | 'manga';
  entryId: string;
  sourceUrl: string;
  title: string;
  altTitles: string[];
  aliases: string[];
  image: string | null;
  tags: string;
  streamingUrl: string | null;
  progress: number;
  volumeProgress: number;
  score: number;
  status: number;
  updatedAt: Date;
  [extra: string]: unknown;
};

export type ApiKeyDoc = {
  keyHash: string;
  ownerId: string;
  label: string;
  createdAt: Date;
};

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
  const dbName = process.env.DB_NAME || 'malsync';
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);

  await Promise.all([
    syncEntries(db).createIndex(
      { ownerId: 1, userKey: 1, mediaType: 1, entryId: 1 },
      { unique: true },
    ),
    syncEntries(db).createIndex({ ownerId: 1, userKey: 1, mediaType: 1, aliases: 1 }),
    apiKeys(db).createIndex({ keyHash: 1 }, { unique: true }),
  ]);

  return db;
}

export function syncEntries(d: Db): Collection<SyncEntryDoc> {
  return d.collection<SyncEntryDoc>('syncEntries');
}

export function apiKeys(d: Db): Collection<ApiKeyDoc> {
  return d.collection<ApiKeyDoc>('apiKeys');
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
