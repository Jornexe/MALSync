import { MongoClient, createMongoClient } from '../utils/mongoClient';
import { Entry } from './database';
import { emitter } from '../utils/emitter';
import { getList } from '../_provider/listFactory';

const UPDATE_INTERVAL = 7 * 24 * 60 * 60 * 1000;
const logger = con.m('DatabaseMongo');

let mongoClient: MongoClient | null = null;

/**
 * Initialize MongoDB client for database operations
 */
async function initClient(): Promise<MongoClient | null> {
  if (mongoClient) return mongoClient;

  try {
    const enabled = await api.settings.getAsync('mongodbEnabled');
    if (!enabled) return null;

    const url = await api.settings.getAsync('mongodbUrl');
    const database = await api.settings.getAsync('mongodbDatabase');
    const username = await api.settings.getAsync('mongodbUsername');
    const password = await api.settings.getAsync('mongodbPassword');

    if (!url || !database) {
      logger.warn('MongoDB not configured');
      return null;
    }

    mongoClient = createMongoClient({
      baseUrl: url,
      database,
      username,
      password,
    });

    const connected = await mongoClient.ping();
    if (!connected) {
      logger.error('Failed to connect to MongoDB');
      mongoClient = null;
      return null;
    }

    logger.log('MongoDB connected');
    return mongoClient;
  } catch (error) {
    logger.error('Error connecting to MongoDB:', error);
    mongoClient = null;
    return null;
  }
}

async function updateEntry(data: any) {
  const client = await initClient();
  if (!client) return;

  logger.log('update', data);
  if (data.id && data.state.onList) {
    await addEntry({
      uid: data.id,
      type: data.type,
      title: data.meta.title,
      malId: data.meta.malId,
      cacheKey: data.cacheKey,
      image: data.meta.image,
      score: data.state.score,
      status: data.state.status,
      watchedEp: data.state.episode,
      totalEp: data.meta.totalEp,
      url: data.meta.url,
    });
  }
}

export async function initDatabase() {
  const client = await initClient();
  if (!client) {
    logger.log('MongoDB sync disabled');
    return;
  }

  logger.log('Starting MongoDB sync');

  // Set up event listeners
  emitter.on('update.*', async data => updateEntry(data), { objectify: true });
  emitter.on('state.*', async data => updateEntry(data), { objectify: true });

  emitter.on(
    'delete.*',
    async data => {
      logger.log('delete', data);
      await removeEntry(data.type, data.id);
    },
    { objectify: true },
  );

  await indexUpdate();
  logger.log('MongoDB sync ready');
}

export async function indexUpdate() {
  const client = await initClient();
  if (!client) return;

  const types = ['anime', 'manga'];
  const globalMode = await api.settings.getAsync('syncMode');

  for (let i = 0; i < types.length; i++) {
    const type = types[i] as 'anime' | 'manga';
    const state = (await getKey(`update_${type}`)) as number;
    const mode = await getKey(`update_mode_${type}`);

    if (!state || state < Date.now() - UPDATE_INTERVAL || mode !== globalMode) {
      await importList(type);
    }
  }
}

export async function getKey(key: string): Promise<string | number | undefined> {
  const client = await initClient();
  if (!client) return undefined;

  try {
    const collection = client.collection('storage');
    const doc = await collection.findOne({ key });
    return doc ? doc.value : undefined;
  } catch (error) {
    logger.error('Error getting key:', error);
    return undefined;
  }
}

export async function setKey(key: string, value: string | number) {
  const client = await initClient();
  if (!client) return;

  try {
    const collection = client.collection('storage');
    await collection.replaceOne({ key }, { key, value }, true);
  } catch (error) {
    logger.error('Error setting key:', error);
  }
}

const blocked = {
  anime: false,
  manga: false,
};

async function importList(type: 'anime' | 'manga'): Promise<void> {
  if (blocked[type]) {
    logger.log('Import already running');
    return;
  }
  blocked[type] = true;
  logger.log(`Import ${type} list to MongoDB`);

  try {
    await api.settings.init();
    const listProvider = await getList(7, type);
    const list = await listProvider.getCompleteList();
    
    await importEntries(
      type,
      list.map(el => ({
        uid: el.uid,
        type: el.type,
        title: el.title,
        malId: el.malId,
        cacheKey: el.cacheKey,
        image: el.image,
        score: el.score,
        status: el.status,
        watchedEp: el.watchedEp,
        totalEp: el.totalEp,
        url: el.url,
      })),
    );
    
    blocked[type] = false;
    await setKey(`update_${type}`, Date.now());
    await setKey(`update_mode_${type}`, api.settings.get('syncMode'));
  } catch (e) {
    blocked[type] = false;
    throw e;
  }
}

export async function addEntry(entry: Entry) {
  const client = await initClient();
  if (!client) return;

  try {
    const collectionName = entry.type === 'anime' ? 'anime' : 'manga';
    const collection = client.collection(collectionName);
    await collection.replaceOne({ uid: entry.uid }, entry, true);
  } catch (error) {
    logger.error('Error adding entry:', error);
  }
}

export async function getEntry(
  type: 'anime' | 'manga',
  uid: number | string,
): Promise<undefined | Entry> {
  const client = await initClient();
  if (!client) return undefined;

  try {
    const collectionName = type === 'anime' ? 'anime' : 'manga';
    const collection = client.collection(collectionName);
    const doc = await collection.findOne({ uid });
    return doc as Entry | undefined;
  } catch (error) {
    logger.error('Error getting entry:', error);
    return undefined;
  }
}

export async function getEntryByMalId(
  type: 'anime' | 'manga',
  malId: number,
): Promise<undefined | Entry> {
  const client = await initClient();
  if (!client) return undefined;

  try {
    const collectionName = type === 'anime' ? 'anime' : 'manga';
    const collection = client.collection(collectionName);
    const doc = await collection.findOne({ malId });
    return doc as Entry | undefined;
  } catch (error) {
    logger.error('Error getting entry by MAL ID:', error);
    return undefined;
  }
}

export async function removeEntry(type: 'anime' | 'manga', uid: number | string) {
  const client = await initClient();
  if (!client) return;

  try {
    const collectionName = type === 'anime' ? 'anime' : 'manga';
    const collection = client.collection(collectionName);
    await collection.deleteOne({ uid });
  } catch (error) {
    logger.error('Error removing entry:', error);
  }
}

async function importEntries(type: 'anime' | 'manga', entries: Entry[]) {
  const client = await initClient();
  if (!client) return;

  try {
    const collectionName = type === 'anime' ? 'anime' : 'manga';
    const collection = client.collection(collectionName);
    
    // Clear existing entries
    await collection.clear();
    
    // Bulk insert new entries
    if (entries.length > 0) {
      await collection.bulkPut(entries);
    }
  } catch (error) {
    logger.error('Error importing entries:', error);
  }
}

export async function databaseRequest(call: string, param: any) {
  switch (call) {
    case 'entry':
      indexUpdate();
      return getEntry(param.type, param.id);
    case 'entryByMalId':
      indexUpdate();
      return getEntryByMalId(param.type, param.id);
    default:
      throw `Unknown call "${call}"`;
  }
}

/**
 * Reset MongoDB client (for reconnection)
 */
export function resetMongoClient() {
  mongoClient = null;
}
