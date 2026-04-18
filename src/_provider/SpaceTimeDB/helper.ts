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
  altTitles: string[];
  image: string | null;
  tags: string;
  streamingUrl: string | null;
  progress: number;
  volumeProgress: number;
  score: number;
  status: number;
  aliases: string[];
  updatedAt?: unknown;
};

type SyncEntryAggregate = {
  mediaType: string;
  entryId: string;
  aliases: Set<string>;
  title: string;
  altTitles: Set<string>;
  tags: string;
  streamingUrl: string;
  image: string;
  progress: number;
  volumeProgress: number;
  score: number;
  status: number;
  sourceUrl: string;
};

export type SyncEntryPayload = {
  entryId: string;
  mediaType: 'anime' | 'manga';
  titleMergeMode?: 'off' | 'exact' | 'fuzzy';
  sourceUrl: string;
  title: string;
  altTitles?: string[];
  image: string;
  tags: string;
  streamingUrl: string;
  progress: number;
  volumeProgress: number;
  score: number;
  status: number;
};

export type SyncEntryLinkPayload = {
  entryId: string;
  mediaType: 'anime' | 'manga';
  targetEntryId?: string;
  aliases?: string[];
  altTitles?: string[];
};

export type SyncEntryUnlinkPayload = {
  entryId: string;
  mediaType: 'anime' | 'manga';
  targetEntryId?: string;
  alias?: string;
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
    altTitles: t.array(t.string()).default([]),
    aliases: t.array(t.string()).default([]),
  },
);

const remoteModule = {
  ...schema({ syncEntry: syncEntryTable }).schemaType,
  ...reducers(
    reducerSchema('upsert_entry', {
      entryId: t.string(),
      mediaType: t.string(),
      userKey: t.string(),
      titleMergeMode: t.string().optional(),
      sourceUrl: t.string(),
      title: t.string(),
      altTitles: t.array(t.string()).optional(),
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
    reducerSchema('link_entry', {
      entryId: t.string(),
      mediaType: t.string(),
      userKey: t.string(),
      targetEntryId: t.string().optional(),
      aliases: t.array(t.string()).optional(),
      altTitles: t.array(t.string()).optional(),
    }),
    reducerSchema('unlink_entry', {
      entryId: t.string(),
      mediaType: t.string(),
      userKey: t.string(),
      targetEntryId: t.string().optional(),
      alias: t.string().optional(),
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

function normalizeValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeAltTitles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  value.forEach(el => {
    if (typeof el !== 'string') return;
    const trimmed = el.trim();
    if (!trimmed) return;
    dedupe.add(trimmed);
  });
  return [...dedupe];
}

function normalizeAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const dedupe = new Set<string>();
  value.forEach(el => {
    if (typeof el !== 'string') return;
    const trimmed = el.trim();
    if (!trimmed) return;
    dedupe.add(trimmed);
  });
  return [...dedupe];
}

function normalizeTitleKey(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .trim()
    .replace(/[\W_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasStrongTitleContainment(a: string, b: string): boolean {
  if (!a || !b) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;

  if (shorter.length < 10) return false;

  return longer.includes(shorter);
}

function isExactTitleMatch(targetKey: string, rowKey: string): boolean {
  return Boolean(targetKey) && Boolean(rowKey) && targetKey === rowKey;
}

function isFuzzyTitleMatch(targetKey: string, rowKey: string): boolean {
  return (
    isExactTitleMatch(targetKey, rowKey) ||
    hasStrongTitleContainment(targetKey, rowKey)
  );
}

function getTitleMergeMode(): 'off' | 'exact' | 'fuzzy' {
  if (api.settings.get('spacetimeTitleMergeAutomation') !== 'on') return 'off';
  return api.settings.get('spacetimeTitleMergeStrictness') === 'exact' ? 'exact' : 'fuzzy';
}

function isLocalRow(row: SpaceTimeSyncRow | SyncEntryAggregate): boolean {
  return row.entryId.startsWith('l:') || row.sourceUrl.startsWith('local://');
}

function toAggregate(row: SpaceTimeSyncRow): SyncEntryAggregate {
  return {
    mediaType: row.mediaType,
    entryId: row.entryId,
    aliases: new Set(normalizeAliases([row.entryId, ...(row.aliases || [])])),
    title: row.title,
    altTitles: new Set(normalizeAltTitles(row.altTitles)),
    tags: row.tags || '',
    streamingUrl: row.streamingUrl || '',
    image: row.image || '',
    progress: Number(row.progress) || 0,
    volumeProgress: Number(row.volumeProgress) || 0,
    score: Number(row.score) || 0,
    status: Number(row.status) || 0,
    sourceUrl: row.sourceUrl || '',
  };
}

function mergeAggregate(target: SyncEntryAggregate, incoming: SpaceTimeSyncRow) {
  normalizeAliases([incoming.entryId, ...(incoming.aliases || [])]).forEach(alias =>
    target.aliases.add(alias),
  );
  normalizeAltTitles(incoming.altTitles).forEach(title => target.altTitles.add(title));

  const incomingLooksRemote = !isLocalRow(incoming);
  const targetLooksLocal = isLocalRow(target);
  if (incomingLooksRemote && targetLooksLocal) {
    target.entryId = incoming.entryId;
    target.sourceUrl = incoming.sourceUrl || target.sourceUrl;
  }

  if (!target.title && incoming.title) target.title = incoming.title;
  if (!target.tags && incoming.tags) target.tags = incoming.tags;
  if (!target.streamingUrl && incoming.streamingUrl) target.streamingUrl = incoming.streamingUrl;
  if (!target.image && incoming.image) target.image = incoming.image;

  target.progress = Math.max(target.progress, Number(incoming.progress) || 0);
  target.volumeProgress = Math.max(target.volumeProgress, Number(incoming.volumeProgress) || 0);
  target.score = Math.max(target.score, Number(incoming.score) || 0);
}

function overlapsByIds(target: SyncEntryAggregate, row: SpaceTimeSyncRow): boolean {
  const ids = normalizeAliases([row.entryId, ...(row.aliases || [])]);
  return ids.some(id => target.aliases.has(id));
}

function overlapsByTitle(
  target: SyncEntryAggregate,
  row: SpaceTimeSyncRow,
  titleMergeMode: 'off' | 'exact' | 'fuzzy',
): boolean {
  if (titleMergeMode === 'off') return false;

  const targetKeys = new Set<string>([
    normalizeTitleKey(target.title),
    ...[...target.altTitles].map(el => normalizeTitleKey(el)),
  ].filter(Boolean));
  const rowKeys = [
    normalizeTitleKey(row.title),
    ...normalizeAltTitles(row.altTitles).map(el => normalizeTitleKey(el)),
  ].filter(Boolean);

  return rowKeys.some(rowKey => {
    return [...targetKeys].some(targetKey => {
      if (titleMergeMode === 'exact') return isExactTitleMatch(targetKey, rowKey);
      return isFuzzyTitleMatch(targetKey, rowKey);
    });
  });
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
  const titleMergeMode = getTitleMergeMode();

  const libraryKey = await requireLibraryKey();
  const rows = [...conn.db.syncEntry.iter()] as SpaceTimeSyncRow[];
  const ownerRows = rows.filter(row => rowLibraryKey(row) === libraryKey);

  con.log(logScope, 'getSyncList', {
    totalRows: rows.length,
    ownerRows: ownerRows.length,
    libraryKeyEnabled: Boolean(libraryKey),
  });

  const deduped: SyncEntryAggregate[] = [];
  ownerRows.forEach(row => {
    const match = deduped.find(
      candidate =>
        candidate.mediaType === row.mediaType &&
        (overlapsByIds(candidate, row) || overlapsByTitle(candidate, row, titleMergeMode)),
    );

    if (!match) {
      deduped.push(toAggregate(row));
      return;
    }

    mergeAggregate(match, row);
  });

  return deduped
    .reduce((acc, row) => {
      acc[`stdb://${row.mediaType}/${encodeURIComponent(row.entryId)}`] = {
        name: row.title,
        altTitles: normalizeAltTitles([...row.altTitles]),
        tags: row.tags,
        sUrl: row.streamingUrl,
        image: row.image,
        progress: row.progress,
        volumeprogress: row.volumeProgress,
        score: row.score,
        status: row.status,
        sourceUrl: row.sourceUrl,
      };
      return acc;
    }, {} as Record<string, any>);
}

export async function getEntry(
  entryId: string,
  mediaType: 'anime' | 'manga',
  titleHint?: string,
) {
  con.log(logScope, 'getEntry:start', { entryId, mediaType, hasTitleHint: Boolean(titleHint) });

  const conn = await getConnection();
  await ensureSubscribed(conn);

  const libraryKey = await requireLibraryKey();

  const rows = [...conn.db.syncEntry.iter()] as SpaceTimeSyncRow[];
  const ownerRows = rows.filter(row => rowLibraryKey(row) === libraryKey && row.mediaType === mediaType);
  const titleMergeMode = getTitleMergeMode();

  let row = ownerRows.find(el => el.entryId === entryId);
  if (!row) {
    row = ownerRows.find(candidate => normalizeAliases(candidate.aliases).includes(entryId));
  }

  if (!row && titleMergeMode !== 'off') {
    const entryIdTitleHint = normalizeTitleKey(entryId.replace(/^l:[^:]+::/i, ''));
    if (entryIdTitleHint) {
      row = ownerRows.find(candidate => {
        const titleKeys = [
          normalizeTitleKey(candidate.title),
          ...normalizeAltTitles(candidate.altTitles).map(el => normalizeTitleKey(el)),
        ].filter(Boolean);
        if (titleMergeMode === 'exact') return titleKeys.includes(entryIdTitleHint);
        return titleKeys.some(titleKey => isFuzzyTitleMatch(titleKey, entryIdTitleHint));
      });
    }
  }

  if (!row && titleHint && titleMergeMode !== 'off') {
    const normalizedTitleHint = normalizeTitleKey(titleHint);
    if (normalizedTitleHint) {
      row = ownerRows.find(candidate => {
        const titleKeys = [
          normalizeTitleKey(candidate.title),
          ...normalizeAltTitles(candidate.altTitles).map(el => normalizeTitleKey(el)),
        ].filter(Boolean);
        if (titleMergeMode === 'exact') return titleKeys.includes(normalizedTitleHint);
        return titleKeys.some(titleKey => isFuzzyTitleMatch(titleKey, normalizedTitleHint));
      });
    }
  }

  if (!row) {
    con.log(logScope, 'getEntry:not found', {
      entryId,
      mediaType,
      ownerRows: ownerRows.length,
    });
    return null;
  }

  con.log(logScope, 'getEntry:hit', {
    entryId,
    mediaType,
    ownerRows: ownerRows.length,
  });

  return {
    name: row.title,
    aliases: normalizeAliases(row.aliases),
    altTitles: normalizeAltTitles(row.altTitles),
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
  const titleMergeMode = payload.titleMergeMode || getTitleMergeMode();

  await conn.reducers.upsertEntry({
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    userKey,
    titleMergeMode,
    sourceUrl: payload.sourceUrl,
    title: payload.title,
    altTitles: normalizeAltTitles(payload.altTitles),
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

export async function linkEntry(payload: SyncEntryLinkPayload) {
  con.log(logScope, 'linkEntry:start', {
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    targetEntryId: payload.targetEntryId || null,
    aliases: payload.aliases || [],
  });

  const conn = await getConnection();
  const userKey = requireLibraryKey();

  await conn.reducers.linkEntry({
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    userKey,
    targetEntryId: normalizeValue(payload.targetEntryId),
    aliases: normalizeAliases(payload.aliases),
    altTitles: normalizeAltTitles(payload.altTitles),
  });

  con.log(logScope, 'linkEntry:done', {
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    targetEntryId: payload.targetEntryId || null,
  });
}

export async function unlinkEntry(payload: SyncEntryUnlinkPayload) {
  con.log(logScope, 'unlinkEntry:start', {
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    targetEntryId: payload.targetEntryId || null,
    alias: payload.alias || null,
  });

  const conn = await getConnection();
  const userKey = requireLibraryKey();

  await conn.reducers.unlinkEntry({
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    userKey,
    targetEntryId: normalizeValue(payload.targetEntryId),
    alias: normalizeValue(payload.alias),
  });

  con.log(logScope, 'unlinkEntry:done', {
    entryId: payload.entryId,
    mediaType: payload.mediaType,
    targetEntryId: payload.targetEntryId || null,
    alias: payload.alias || null,
  });
}
