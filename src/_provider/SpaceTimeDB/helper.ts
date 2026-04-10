/* eslint-disable */
import {
  DbConnectionBuilder,
  DbConnectionImpl,
  reducerSchema,
  reducers,
  schema,
  t,
  table,
} from 'spacetimedb';

type SpaceTimeSyncRow = {
  id: string;
  entryId: string;
  ownerId: unknown;
  userKey: string;
  mediaType: string;
  sourceUrl: string;
  title: string;
  image: string | null;
  tags: string;
  streamingUrl: string | null;
  progress: number;
  volumeProgress: number;
  score: number;
  status: number;
};

export type SyncEntryPayload = {
  entryId: string;
  mediaType: 'anime' | 'manga';
  sourceUrl: string;
  title: string;
  image: string;
  tags: string;
  streamingUrl: string;
  progress: number;
  volumeProgress: number;
  score: number;
  status: number;
};

const uriDefault = 'ws://127.0.0.1:3000';
const databaseDefault = 'mal';
const logScope = '[SpaceTimeDB][Client]';

const syncEntryTable = table(
  {
    name: 'sync_entry',
    public: true,
    indexes: [
      {
        accessor: 'sync_entry_owner_id',
        name: 'sync_entry_owner_id',
        algorithm: 'btree',
        columns: ['ownerId'],
      },
      {
        accessor: 'sync_entry_user_key',
        name: 'sync_entry_user_key',
        algorithm: 'btree',
        columns: ['userKey'],
      },
      {
        accessor: 'sync_entry_entry_id',
        name: 'sync_entry_entry_id',
        algorithm: 'btree',
        columns: ['entryId'],
      },
    ],
  },
  {
    id: t.string().primaryKey(),
    entryId: t.string(),
    ownerId: t.identity(),
    userKey: t.string(),
    mediaType: t.string(),
    sourceUrl: t.string(),
    title: t.string(),
    image: t.string().optional(),
    tags: t.string(),
    streamingUrl: t.string().optional(),
    progress: t.u32(),
    volumeProgress: t.u32(),
    score: t.u8(),
    status: t.u8(),
    updatedAt: t.timestamp(),
  },
);

const remoteModule = {
  ...schema({ syncEntry: syncEntryTable }).schemaType,
  ...reducers(
    reducerSchema('upsert_entry', {
      entryId: t.string(),
      mediaType: t.string(),
      userKey: t.string(),
      sourceUrl: t.string(),
      title: t.string(),
      image: t.string().optional(),
      tags: t.string(),
      streamingUrl: t.string().optional(),
      progress: t.u32(),
      volumeProgress: t.u32(),
      score: t.u8(),
      status: t.u8(),
    }),
    reducerSchema('delete_entry', {
      entryId: t.string(),
      mediaType: t.string(),
      userKey: t.string(),
    }),
  ).reducersType,
  procedures: [] as const,
  versionInfo: { cliVersion: '2.1.0' as const },
};

let connectionPromise: Promise<DbConnectionImpl<any>> | null = null;
let subscribed = false;
let currentIdentityHex = '';

function getUri() {
  return api.settings.get('spacetimeUri') || uriDefault;
}

function getDatabaseName() {
  return api.settings.get('spacetimeDatabase') || databaseDefault;
}

function getToken() {
  const token = api.settings.get('spacetimeToken');
  if (token) return token;
  return undefined;
}

function normalizeUserKey(value: string | null | undefined) {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function getLibraryKey() {
  const profile = normalizeUserKey(api.settings.get('spacetimeProfile'));
  if (profile) return profile;

  const legacyProfile = normalizeUserKey(api.settings.get('spacetimeUserKey'));
  if (legacyProfile) {
    api.settings.set('spacetimeProfile', legacyProfile);
    return legacyProfile;
  }

  return '';
}

function isSpaceTimeDbModeSelected() {
  return (
    api.settings.get('syncMode') === 'SPACETIMEDB' ||
    api.settings.get('syncModeSimkl') === 'SPACETIMEDB'
  );
}

function requireLibraryKey() {
  const libraryKey = getLibraryKey();
  if (!libraryKey) {
    if (isSpaceTimeDbModeSelected()) {
      const message = 'Please set a profile first in Tracking settings before using SpaceTimeDB.';
      utils.flashm(message, { error: true, type: 'spacetimedb-library-key' });
      throw new Error(message);
    }

    throw new Error('Profile is missing.');
  }

  return libraryKey;
}

export function clearSession() {
  con.log(logScope, 'clearSession');
  subscribed = false;
  currentIdentityHex = '';
  connectionPromise = null;
  return api.settings.set('spacetimeToken', '');
}

export function getCacheKey(slug: string, listType: 'anime' | 'manga') {
  return `stdb:${listType}:${slug}`;
}

export function getRegex(listType: 'anime' | 'manga') {
  return new RegExp(`^stdb://${listType}/`, 'i');
}

function normalizeIdentityHex(value: unknown) {
  if (!value) return '';

  if (typeof value === 'string') {
    return value.replace(/^0x/i, '').toLowerCase();
  }

  if (typeof value === 'object') {
    const candidate = value as {
      toHexString?: () => string;
      __identity__?: bigint;
    };

    if (typeof candidate.toHexString === 'function') {
      return candidate.toHexString().replace(/^0x/i, '').toLowerCase();
    }

    if (typeof candidate.__identity__ === 'bigint') {
      return candidate.__identity__.toString(16);
    }
  }

  return '';
}

function rowLibraryKey(row: SpaceTimeSyncRow) {
  return normalizeUserKey(row.userKey);
}

function getCurrentIdentityHex(conn: DbConnectionImpl<any>) {
  return currentIdentityHex || normalizeIdentityHex(conn.identity);
}

async function ensureSubscribed(conn: DbConnectionImpl<any>) {
  if (subscribed) {
    con.log(logScope, 'subscription already active');
    return;
  }

  con.log(logScope, 'subscribing to sync_entry table');
  await new Promise<void>((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        subscribed = true;
        con.log(logScope, 'subscription applied');
        resolve();
      })
      .onError(ctx => {
        const errorText = ctx.event?.message || 'Subscription failed';
        con.error(logScope, 'subscription error', errorText);
        reject(new Error(errorText));
      })
      .subscribe(['SELECT * FROM sync_entry']);
  });
}

export async function getConnection() {
  const libraryKey = requireLibraryKey();

  if (connectionPromise) {
    con.log(logScope, 'reusing existing connection promise');
    return connectionPromise;
  }

  con.log(logScope, 'creating connection', {
    uri: getUri(),
    database: getDatabaseName(),
    libraryKey,
    tokenPresent: Boolean(getToken()),
  });

  connectionPromise = new Promise((resolve, reject) => {
    let settled = false;

    const builder = new DbConnectionBuilder(remoteModule, config => new DbConnectionImpl(config))
      .withUri(getUri())
      .withDatabaseName(getDatabaseName())
      .withToken(getToken())
      .onConnect((conn, identity, token) => {
        currentIdentityHex = normalizeIdentityHex(identity) || normalizeIdentityHex(conn.identity);
        con.log(logScope, 'connected', {
          identity: currentIdentityHex || 'anonymous',
          tokenReceived: Boolean(token || conn.token),
        });
        const nextToken = token || conn.token;
        if (nextToken && nextToken !== api.settings.get('spacetimeToken')) {
          api.settings.set('spacetimeToken', nextToken);
        }
        settled = true;
        resolve(conn);
      })
      .onConnectError((_ctx, error) => {
        con.error(logScope, 'connect error', error);
        if (!settled) {
          connectionPromise = null;
          reject(error);
        }
      })
      .onDisconnect((_ctx, error) => {
        subscribed = false;
        connectionPromise = null;
        if (error) {
          con.error('[SpaceTimeDB] Connection disconnected', error);
        }
      });

    builder.build();
  });

  return connectionPromise;
}

export async function getUserObject() {
  const conn = await getConnection();
  const identityHex = getCurrentIdentityHex(conn) || 'anonymous';
  const libraryKey = await requireLibraryKey();

  con.log(logScope, 'getUserObject', {
    identity: identityHex,
    database: getDatabaseName(),
  });

  return {
    username: libraryKey || `${identityHex.substring(0, 12)}...`,
    picture: '',
    href: `https://spacetimedb.com/database/${getDatabaseName()}`,
  };
}

export async function getSyncList() {
  const conn = await getConnection();
  await ensureSubscribed(conn);

  const libraryKey = await requireLibraryKey();
  const rows = [...conn.db.syncEntry.iter()] as SpaceTimeSyncRow[];
  const ownerRows = rows.filter(row => rowLibraryKey(row) === libraryKey);

  con.log(logScope, 'getSyncList', {
    totalRows: rows.length,
    ownerRows: ownerRows.length,
    libraryKeyEnabled: Boolean(libraryKey),
  });

  return ownerRows
    .reduce((acc, row) => {
      acc[`stdb://${row.mediaType}/${encodeURIComponent(row.entryId)}`] = {
        name: row.title,
        tags: row.tags,
        sUrl: row.streamingUrl || '',
        image: row.image || '',
        progress: row.progress,
        volumeprogress: row.volumeProgress,
        score: row.score,
        status: row.status,
        sourceUrl: row.sourceUrl,
      };
      return acc;
    }, {} as Record<string, any>);
}

export async function getEntry(entryId: string) {
  con.log(logScope, 'getEntry:start', { entryId });

  const conn = await getConnection();
  await ensureSubscribed(conn);

  const libraryKey = await requireLibraryKey();

  const rows = [...conn.db.syncEntry.iter()] as SpaceTimeSyncRow[];
  const row = rows.find(el => el.entryId === entryId && rowLibraryKey(el) === libraryKey);
  if (!row) {
    con.log(logScope, 'getEntry:not found', {
      entryId,
      ownerRows: rows.length,
    });
    return null;
  }

  con.log(logScope, 'getEntry:hit', {
    entryId,
    ownerRows: rows.length,
  });

  return {
    name: row.title,
    tags: row.tags,
    sUrl: row.streamingUrl || '',
    image: row.image || '',
    progress: row.progress,
    volumeprogress: row.volumeProgress,
    score: row.score,
    status: row.status,
    sourceUrl: row.sourceUrl,
  };
}

export async function upsertEntry(payload: SyncEntryPayload) {
  con.log(logScope, 'upsertEntry:start', {
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    progress: payload.progress,
    volumeProgress: payload.volumeProgress,
    score: payload.score,
    status: payload.status,
  });

  const conn = await getConnection();
  const userKey = requireLibraryKey();

  await conn.reducers.upsertEntry({
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    userKey,
    sourceUrl: payload.sourceUrl,
    title: payload.title,
    image: payload.image || null,
    tags: payload.tags,
    streamingUrl: payload.streamingUrl || null,
    progress: payload.progress,
    volumeProgress: payload.volumeProgress,
    score: payload.score,
    status: payload.status,
  });

  con.log(logScope, 'upsertEntry:done', { entryId: payload.entryId });
}

export async function deleteEntry(entryId: string, mediaType: 'anime' | 'manga') {
  con.log(logScope, 'deleteEntry:start', { entryId, mediaType });

  const conn = await getConnection();
  const userKey = requireLibraryKey();
  await conn.reducers.deleteEntry({
    entryId,
    mediaType,
    userKey,
  });

  con.log(logScope, 'deleteEntry:done', { entryId, mediaType });
}
