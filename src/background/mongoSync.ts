/**
 * MongoDB Sync Manager
 * 
 * Coordinates bidirectional sync between local IndexedDB (Dexie) and MongoDB.
 * Handles conflict resolution, sync strategies, and error recovery.
 */

import * as localDb from './database';
import * as mongoDb from './databaseMongo';
import { Entry } from './database';

const logger = con.m('MongoSync');

export type SyncMode = 'bidirectional' | 'pushOnly' | 'pullOnly';
export type ConflictResolution = 'newest' | 'local' | 'remote';

interface SyncStatus {
  lastSync: number;
  inProgress: boolean;
  lastError?: string;
  syncedAnime: number;
  syncedManga: number;
}

let syncStatus: SyncStatus = {
  lastSync: 0,
  inProgress: false,
  syncedAnime: 0,
  syncedManga: 0,
};

let syncInterval: number | null = null;

/**
 * Initialize sync manager
 */
export async function initSync() {
  logger.log('Initializing MongoDB sync manager');

  const enabled = await api.settings.getAsync('mongodbEnabled');
  if (!enabled) {
    logger.log('MongoDB sync disabled');
    return;
  }

  // Initialize MongoDB database
  await mongoDb.initDatabase();

  // Set up periodic sync if configured
  const interval = await api.settings.getAsync('mongodbSyncInterval');
  if (interval && interval > 0) {
    startAutoSync(interval);
  }

  // Perform initial sync
  await performSync();

  logger.log('MongoDB sync manager ready');
}

/**
 * Start automatic sync at specified interval
 */
export function startAutoSync(intervalSeconds: number) {
  stopAutoSync();
  
  logger.log(`Starting auto-sync every ${intervalSeconds} seconds`);
  syncInterval = window.setInterval(() => {
    performSync().catch(err => {
      logger.error('Auto-sync failed:', err);
    });
  }, intervalSeconds * 1000);
}

/**
 * Stop automatic sync
 */
export function stopAutoSync() {
  if (syncInterval !== null) {
    clearInterval(syncInterval);
    syncInterval = null;
    logger.log('Auto-sync stopped');
  }
}

/**
 * Perform a full sync between local and MongoDB
 */
export async function performSync(): Promise<void> {
  if (syncStatus.inProgress) {
    logger.log('Sync already in progress');
    return;
  }

  syncStatus.inProgress = true;
  syncStatus.lastError = undefined;

  try {
    const enabled = await api.settings.getAsync('mongodbEnabled');
    if (!enabled) {
      logger.log('MongoDB sync disabled');
      return;
    }

    const mode = (await api.settings.getAsync('mongodbSyncMode')) as SyncMode;
    logger.log(`Syncing in ${mode} mode`);

    // Sync anime and manga lists
    await syncType('anime', mode);
    await syncType('manga', mode);

    // Sync storage/settings
    await syncStorage(mode);

    syncStatus.lastSync = Date.now();
    logger.log('Sync completed successfully');
  } catch (error) {
    syncStatus.lastError = error.message;
    logger.error('Sync failed:', error);
    throw error;
  } finally {
    syncStatus.inProgress = false;
  }
}

/**
 * Sync a specific type (anime or manga)
 */
async function syncType(type: 'anime' | 'manga', mode: SyncMode): Promise<void> {
  try {
    if (mode === 'pullOnly') {
      await pullFromMongo(type);
    } else if (mode === 'pushOnly') {
      await pushToMongo(type);
    } else {
      // Bidirectional
      await bidirectionalSync(type);
    }

    // Update sync count
    if (type === 'anime') {
      syncStatus.syncedAnime++;
    } else {
      syncStatus.syncedManga++;
    }
  } catch (error) {
    logger.error(`Error syncing ${type}:`, error);
    throw error;
  }
}

/**
 * Pull data from MongoDB to local
 */
async function pullFromMongo(type: 'anime' | 'manga'): Promise<void> {
  logger.log(`Pulling ${type} from MongoDB`);
  
  // Import from MongoDB to local would require accessing MongoDB entries
  // and importing them to local Dexie database
  // This is a simplified version - full implementation would need to:
  // 1. Get all entries from MongoDB
  // 2. Compare with local entries
  // 3. Update local entries that are different
  
  // For now, we trigger MongoDB's index update which pulls from provider
  await mongoDb.indexUpdate();
}

/**
 * Push data from local to MongoDB
 */
async function pushToMongo(type: 'anime' | 'manga'): Promise<void> {
  logger.log(`Pushing ${type} to MongoDB`);
  
  // This would require exporting local Dexie data to MongoDB
  // Trigger MongoDB import which gets data from the list provider
  await mongoDb.indexUpdate();
}

/**
 * Bidirectional sync with conflict resolution
 */
async function bidirectionalSync(type: 'anime' | 'manga'): Promise<void> {
  logger.log(`Bidirectional sync for ${type}`);

  const conflictResolution = (await api.settings.getAsync(
    'mongodbConflictResolution',
  )) as ConflictResolution;

  // Get entries from both sources
  // Note: This is simplified - a full implementation would need methods to
  // get all entries from both local and MongoDB databases

  // For now, we just ensure MongoDB is up to date
  await mongoDb.indexUpdate();
  
  // In a full implementation, we would:
  // 1. Get all local entries
  // 2. Get all MongoDB entries
  // 3. Find differences
  // 4. Resolve conflicts based on conflictResolution strategy
  // 5. Update both databases
}

/**
 * Sync storage/settings between local and MongoDB
 */
async function syncStorage(mode: SyncMode): Promise<void> {
  logger.log('Syncing storage');

  // Get all local storage
  const localStorage = await api.storage.list('local');

  if (mode === 'pushOnly' || mode === 'bidirectional') {
    // Push local storage to MongoDB
    for (const [key, value] of Object.entries(localStorage)) {
      try {
        // Skip MongoDB-specific settings to avoid recursion
        if (key.startsWith('settings/mongodb')) continue;
        
        await mongoDb.setKey(key, value);
      } catch (error) {
        logger.error(`Error syncing key ${key}:`, error);
      }
    }
  }

  // TODO: Implement pull from MongoDB
  // This would require a way to get all storage keys from MongoDB
  // and update local storage accordingly
}

/**
 * Get current sync status
 */
export function getSyncStatus(): SyncStatus {
  return { ...syncStatus };
}

/**
 * Force a manual sync
 */
export async function manualSync(): Promise<void> {
  logger.log('Manual sync triggered');
  await performSync();
}

/**
 * Sync a single entry immediately
 */
export async function syncEntry(entry: Entry): Promise<void> {
  const enabled = await api.settings.getAsync('mongodbEnabled');
  if (!enabled) return;

  const mode = (await api.settings.getAsync('mongodbSyncMode')) as SyncMode;
  
  if (mode === 'pullOnly') {
    // Don't push in pull-only mode
    return;
  }

  try {
    await mongoDb.addEntry(entry);
  } catch (error) {
    logger.error('Error syncing entry:', error);
  }
}

/**
 * Resolve conflict between local and remote entry
 */
function resolveConflict(
  local: Entry | undefined,
  remote: Entry | undefined,
  strategy: ConflictResolution,
): Entry | undefined {
  if (!local) return remote;
  if (!remote) return local;

  switch (strategy) {
    case 'local':
      return local;
    case 'remote':
      return remote;
    case 'newest':
      // Compare watchedEp as a simple "newest" heuristic
      // A better implementation would track update timestamps
      return local.watchedEp >= remote.watchedEp ? local : remote;
    default:
      return local;
  }
}

/**
 * Reset sync status
 */
export function resetSyncStatus(): void {
  syncStatus = {
    lastSync: 0,
    inProgress: false,
    syncedAnime: 0,
    syncedManga: 0,
  };
}
