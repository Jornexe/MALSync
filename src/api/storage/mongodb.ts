import { storageInterface } from './storageInterface';
import { createMongoClient, MongoClient } from '../../utils/mongoClient';

let mongoClient: MongoClient | null = null;

/**
 * Initialize MongoDB client based on settings
 */
async function initMongoClient(): Promise<MongoClient | null> {
  try {
    const enabled = await getSettingDirect('mongodbEnabled');
    if (!enabled) return null;

    const url = await getSettingDirect('mongodbUrl');
    const database = await getSettingDirect('mongodbDatabase');
    const username = await getSettingDirect('mongodbUsername');
    const password = await getSettingDirect('mongodbPassword');

    if (!url || !database) {
      con.warn('MongoDB URL or database not configured');
      return null;
    }

    mongoClient = createMongoClient({
      baseUrl: url,
      database,
      username,
      password,
    });

    // Test connection
    const connected = await mongoClient.ping();
    if (!connected) {
      con.error('Failed to connect to MongoDB');
      mongoClient = null;
      return null;
    }

    con.log('MongoDB client initialized successfully');
    return mongoClient;
  } catch (error) {
    con.error('Error initializing MongoDB client:', error);
    mongoClient = null;
    return null;
  }
}

/**
 * Get MongoDB client, initializing if needed
 */
async function getMongoClient(): Promise<MongoClient | null> {
  if (!mongoClient) {
    await initMongoClient();
  }
  return mongoClient;
}

/**
 * Get setting value directly from localStorage (fallback)
 * This is used during MongoDB initialization to avoid circular dependency
 */
function getSettingDirect(key: string): Promise<any> {
  return new Promise((resolve) => {
    try {
      const value = localStorage.getItem(`settings/${key}`);
      resolve(value ? JSON.parse(value) : undefined);
    } catch (e) {
      resolve(undefined);
    }
  });
}

/**
 * MongoDB storage implementation
 * This mirrors the webextension storage but uses MongoDB as backend
 */
export const mongodb: storageInterface = {
  async set(key: string, value: any): Promise<void> {
    const client = await getMongoClient();
    if (!client) {
      throw new Error('MongoDB client not initialized');
    }

    try {
      const collection = client.collection('storage');
      await collection.replaceOne(
        { key },
        { key, value, updatedAt: Date.now() },
        true, // upsert
      );
    } catch (error) {
      con.error('MongoDB set error:', error);
      throw error;
    }
  },

  async get(key: string): Promise<any> {
    const client = await getMongoClient();
    if (!client) {
      return undefined;
    }

    try {
      const collection = client.collection('storage');
      const doc = await collection.findOne({ key });
      return doc ? doc.value : undefined;
    } catch (error) {
      con.error('MongoDB get error:', error);
      return undefined;
    }
  },

  async remove(key: string): Promise<void> {
    const client = await getMongoClient();
    if (!client) {
      throw new Error('MongoDB client not initialized');
    }

    try {
      const collection = client.collection('storage');
      await collection.deleteOne({ key });
    } catch (error) {
      con.error('MongoDB remove error:', error);
      throw error;
    }
  },

  async list(from = 'local'): Promise<{ [key: string]: any }> {
    const client = await getMongoClient();
    if (!client) {
      return {};
    }

    try {
      const collection = client.collection('storage');
      const docs = await collection.find({});
      
      const result: { [key: string]: any } = {};
      docs.forEach((doc) => {
        result[doc.key] = doc.value;
      });
      
      return result;
    } catch (error) {
      con.error('MongoDB list error:', error);
      return {};
    }
  },

  async addStyle(css: string): Promise<void> {
    // Same as other implementations
    try {
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.body || document.documentElement || document).appendChild(style);
    } catch (e) {
      console.log(`Could not add css:${e}`);
    }
  },

  version(): string {
    // For userscript, get from package or hardcoded
    return '0.12.3'; // TODO: Make this dynamic
  },

  lang(selector: string, args?: string[]): string {
    // Placeholder - actual implementation would need i18n
    return selector;
  },

  langDirection(): 'ltr' | 'rtl' {
    return 'ltr';
  },

  assetUrl(filename: string): string {
    // For userscript, use CDN or local path
    return `assets/${filename}`;
  },

  injectCssResource(res: string, head: any, code?: string | null): void {
    // Userscript CSS injection
    const style = document.createElement('style');
    style.textContent = code || '';
    head.appendChild(style);
  },

  injectjsResource(res: string, head: any): void {
    // Userscript JS injection
    const script = document.createElement('script');
    script.src = `vendor/${res}`;
    script.onload = function () {
      // @ts-ignore
      this.remove();
    };
    head.appendChild(script);
  },

  addProxyScriptToTag(tag: HTMLScriptElement, name: string): HTMLScriptElement {
    // Not used in MongoDB storage
    return tag;
  },

  updateDom(head: any): void {
    // Not needed for MongoDB storage
  },

  storageOnChanged(cb: (changes: any, namespace: any) => void): any {
    // TODO: Implement polling or WebSocket for change notifications
    // For now, return empty unsubscribe function
    return () => {};
  },
};

/**
 * Reset MongoDB client (useful for reconnecting after settings change)
 */
export function resetMongoClient(): void {
  mongoClient = null;
}

/**
 * Test MongoDB connection
 */
export async function testMongoConnection(): Promise<boolean> {
  try {
    const client = await getMongoClient();
    if (!client) return false;
    return await client.ping();
  } catch (error) {
    con.error('MongoDB connection test failed:', error);
    return false;
  }
}
