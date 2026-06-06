/* eslint-disable */
type MongoSyncRow = {
  entryId: string;
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
  [extra: string]: unknown;
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

const urlDefault = 'http://localhost:8787';
const logScope = '[MongoDB][Client]';

function getServerUrl() {
  const raw = (api.settings.get('mongoServerUrl') as string) || urlDefault;
  return raw.replace(/\/+$/, '');
}

function getApiKey() {
  return (api.settings.get('mongoApiKey') as string) || '';
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
  return isExactTitleMatch(targetKey, rowKey) || hasStrongTitleContainment(targetKey, rowKey);
}

function getTitleMergeMode(): 'off' | 'exact' | 'fuzzy' {
  if (api.settings.get('mongoTitleMergeAutomation') !== 'on') return 'off';
  return api.settings.get('mongoTitleMergeStrictness') === 'exact' ? 'exact' : 'fuzzy';
}

function isLocalRow(row: MongoSyncRow | SyncEntryAggregate): boolean {
  return row.entryId.startsWith('l:') || row.sourceUrl.startsWith('local://');
}

function toAggregate(row: MongoSyncRow): SyncEntryAggregate {
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

function mergeAggregate(target: SyncEntryAggregate, incoming: MongoSyncRow) {
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

function overlapsByIds(target: SyncEntryAggregate, row: MongoSyncRow): boolean {
  const ids = normalizeAliases([row.entryId, ...(row.aliases || [])]);
  return ids.some(id => target.aliases.has(id));
}

function overlapsByTitle(
  target: SyncEntryAggregate,
  row: MongoSyncRow,
  titleMergeMode: 'off' | 'exact' | 'fuzzy',
): boolean {
  if (titleMergeMode === 'off') return false;

  const targetKeys = new Set<string>(
    [
      normalizeTitleKey(target.title),
      ...[...target.altTitles].map(el => normalizeTitleKey(el)),
    ].filter(Boolean),
  );
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
  return normalizeUserKey(api.settings.get('mongoProfile'));
}

function isMongoModeSelected() {
  return (
    api.settings.get('syncMode') === 'MONGODB' ||
    api.settings.get('syncModeSimkl') === 'MONGODB'
  );
}

function requireLibraryKey() {
  const libraryKey = getLibraryKey();
  if (!libraryKey) {
    if (isMongoModeSelected()) {
      const message = 'Please set a profile first in Tracking settings before using MongoDB sync.';
      utils.flashm(message, { error: true, type: 'mongodb-library-key' });
      throw new Error(message);
    }
    throw new Error('Profile is missing.');
  }
  return libraryKey;
}

async function mongoFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${getServerUrl()}${path}`;
  const apiKey = getApiKey();
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (apiKey) headers.set('X-API-Key', apiKey);

  const res = await fetch(url, { ...init, headers });
  let body: any = null;
  try {
    body = await res.json();
  } catch (_err) {
    body = null;
  }

  if (!res.ok) {
    const message = (body && body.error) || `HTTP ${res.status}`;
    con.error(logScope, 'request failed', { url, status: res.status, message });
    throw new Error(`MongoDB sync: ${message}`);
  }

  return body as T;
}

/**
 * Short-lived read cache for `/entries` GETs.
 *
 * A single sync-page load reads the list 2-3 times (local lookup, canonical
 * single, first-visit rules cache), and each read pulls the whole library over
 * the network. Caching for a few seconds collapses that burst into one request,
 * which is the main driver of UI load time (especially over higher-latency
 * links like Tailscale). Any write invalidates the cache, so reads stay
 * consistent after a sync/link/delete.
 */
type EntriesCacheEntry = { ts: number; promise: Promise<any> };
const entriesCache = new Map<string, EntriesCacheEntry>();
const ENTRIES_CACHE_TTL = 10000;

function fetchEntriesCached(path: string): Promise<any> {
  const now = Date.now();
  const cached = entriesCache.get(path);
  if (cached && now - cached.ts < ENTRIES_CACHE_TTL) {
    return cached.promise;
  }

  const entry: EntriesCacheEntry = { ts: now, promise: null as any };
  entry.promise = mongoFetch(path).catch(err => {
    // Never cache a failed request.
    if (entriesCache.get(path) === entry) entriesCache.delete(path);
    throw err;
  });
  entriesCache.set(path, entry);
  return entry.promise;
}

function invalidateEntriesCache() {
  entriesCache.clear();
}

export function clearSession() {
  con.log(logScope, 'clearSession');
  return api.settings.set('mongoApiKey', '');
}

export function getCacheKey(slug: string, listType: 'anime' | 'manga') {
  return `mongo:${listType}:${slug}`;
}

export function getRegex(listType: 'anime' | 'manga') {
  return new RegExp(`^mongo://${listType}/`, 'i');
}

export async function getUserObject() {
  const libraryKey = requireLibraryKey();
  try {
    const me = await mongoFetch<{ ownerId: string; label: string; href: string }>('/me');
    return {
      username: libraryKey || me.label || me.ownerId,
      picture: '',
      href: me.href || `${getServerUrl()}/me`,
    };
  } catch (err) {
    con.error(logScope, 'getUserObject failed', err);
    throw err;
  }
}

export async function getSyncList() {
  const libraryKey = requireLibraryKey();
  const titleMergeMode = getTitleMergeMode();

  const { rows = [] } = await fetchEntriesCached(
    `/entries?userKey=${encodeURIComponent(libraryKey)}`,
  );

  con.log(logScope, 'getSyncList', { totalRows: rows.length });

  const deduped: SyncEntryAggregate[] = [];
  rows.forEach(row => {
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

  return deduped.reduce((acc, row) => {
    acc[`mongo://${row.mediaType}/${encodeURIComponent(row.entryId)}`] = {
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

  const libraryKey = requireLibraryKey();
  const titleMergeMode = getTitleMergeMode();

  const { rows = [] } = await fetchEntriesCached(
    `/entries?userKey=${encodeURIComponent(libraryKey)}&mediaType=${encodeURIComponent(mediaType)}`,
  );

  let row = rows.find(el => el.entryId === entryId);
  if (!row) {
    row = rows.find(candidate => normalizeAliases(candidate.aliases).includes(entryId));
  }

  if (!row && titleMergeMode !== 'off') {
    const entryIdTitleHint = normalizeTitleKey(entryId.replace(/^l:[^:]+::/i, ''));
    if (entryIdTitleHint) {
      row = rows.find(candidate => {
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
      row = rows.find(candidate => {
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
    con.log(logScope, 'getEntry:not found', { entryId, mediaType, rows: rows.length });
    return null;
  }

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
  const userKey = requireLibraryKey();
  const titleMergeMode = payload.titleMergeMode || getTitleMergeMode();

  await mongoFetch('/entries', {
    method: 'POST',
    body: JSON.stringify({
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
    }),
  });

  invalidateEntriesCache();
  con.log(logScope, 'upsertEntry:done', { entryId: payload.entryId });
}

export async function deleteEntry(entryId: string, mediaType: 'anime' | 'manga') {
  const userKey = requireLibraryKey();
  await mongoFetch(
    `/entries/${encodeURIComponent(entryId)}?mediaType=${encodeURIComponent(
      mediaType,
    )}&userKey=${encodeURIComponent(userKey)}`,
    { method: 'DELETE' },
  );
  invalidateEntriesCache();
  con.log(logScope, 'deleteEntry:done', { entryId, mediaType });
}

export async function linkEntry(payload: SyncEntryLinkPayload) {
  const userKey = requireLibraryKey();
  await mongoFetch('/entries/link', {
    method: 'POST',
    body: JSON.stringify({
      entryId: payload.entryId,
      mediaType: payload.mediaType,
      userKey,
      targetEntryId: normalizeValue(payload.targetEntryId),
      aliases: normalizeAliases(payload.aliases),
      altTitles: normalizeAltTitles(payload.altTitles),
    }),
  });
  invalidateEntriesCache();
  con.log(logScope, 'linkEntry:done', { entryId: payload.entryId });
}

export async function unlinkEntry(payload: SyncEntryUnlinkPayload) {
  const userKey = requireLibraryKey();
  await mongoFetch('/entries/unlink', {
    method: 'POST',
    body: JSON.stringify({
      entryId: payload.entryId,
      mediaType: payload.mediaType,
      userKey,
      targetEntryId: normalizeValue(payload.targetEntryId),
      alias: normalizeValue(payload.alias),
    }),
  });
  invalidateEntriesCache();
  con.log(logScope, 'unlinkEntry:done', { entryId: payload.entryId });
}
