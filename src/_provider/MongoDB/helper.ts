/* eslint-disable */
import { ServerOfflineError } from '../Errors';

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
  totalEp?: number;
  totalVol?: number;
  description?: string;
  year?: number;
  genres?: string[];
  communityScore?: number;
  format?: string;
  airStatus?: string;
  season?: string;
  duration?: number;
  studios?: string[];
  characters?: MongoCharacter[];
  updatedAt?: string | number | null;
  [extra: string]: unknown;
};

export type MongoCharacter = { name: string; img: string; url: string; subtext: string };

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
  updatedAt: number;
  totalEp: number;
  totalVol: number;
  description: string;
  year: number;
  genres: Set<string>;
  communityScore: number;
  // Normalized title + altTitle keys, precomputed once so dedup comparisons are
  // cheap string ops instead of re-running regex normalization per comparison.
  titleKeys: Set<string>;
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
  totalEp?: number;
  totalVol?: number;
  description?: string;
  year?: number;
  genres?: string[];
  communityScore?: number;
  format?: string;
  airStatus?: string;
  season?: string;
  duration?: number;
  studios?: string[];
  characters?: MongoCharacter[];
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

function normalizeCharacters(value: unknown): MongoCharacter[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(el => ({
      name: typeof el?.name === 'string' ? el.name.trim() : '',
      img: typeof el?.img === 'string' ? el.img : '',
      url: typeof el?.url === 'string' ? el.url : '',
      subtext: typeof el?.subtext === 'string' ? el.subtext : '',
    }))
    .filter(character => character.name);
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

function computeTitleKeys(title: string, altTitles: unknown): Set<string> {
  const keys = new Set<string>();
  const titleKey = normalizeTitleKey(title);
  if (titleKey) keys.add(titleKey);
  normalizeAltTitles(altTitles).forEach(alt => {
    const key = normalizeTitleKey(alt);
    if (key) keys.add(key);
  });
  return keys;
}

// Fuzzy (containment) overlap between an aggregate's precomputed title keys and
// a row's precomputed keys. Both sides are already normalized, so this is just
// string comparisons — no per-call regex work.
function titleKeysContainFuzzy(targetKeys: Set<string>, rowKeys: string[]): boolean {
  for (const rowKey of rowKeys) {
    if (targetKeys.has(rowKey)) return true;
    for (const targetKey of targetKeys) {
      if (hasStrongTitleContainment(targetKey, rowKey)) return true;
    }
  }
  return false;
}

function getTitleMergeMode(): 'off' | 'exact' | 'fuzzy' {
  if (api.settings.get('mongoTitleMergeAutomation') !== 'on') return 'off';
  return api.settings.get('mongoTitleMergeStrictness') === 'exact' ? 'exact' : 'fuzzy';
}

function isLocalRow(row: MongoSyncRow | SyncEntryAggregate): boolean {
  return row.entryId.startsWith('l:') || row.sourceUrl.startsWith('local://');
}

function parseUpdatedAt(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  return 0;
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
    updatedAt: parseUpdatedAt(row.updatedAt),
    totalEp: Number(row.totalEp) || 0,
    totalVol: Number(row.totalVol) || 0,
    description: row.description || '',
    year: Number(row.year) || 0,
    genres: new Set(normalizeAltTitles(row.genres)),
    communityScore: Number(row.communityScore) || 0,
    titleKeys: computeTitleKeys(row.title, row.altTitles),
  };
}

function mergeAggregate(target: SyncEntryAggregate, incoming: MongoSyncRow) {
  normalizeAliases([incoming.entryId, ...(incoming.aliases || [])]).forEach(alias =>
    target.aliases.add(alias),
  );
  normalizeAltTitles(incoming.altTitles).forEach(title => target.altTitles.add(title));
  computeTitleKeys(incoming.title, incoming.altTitles).forEach(key => target.titleKeys.add(key));

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
  if (!target.description && incoming.description) target.description = incoming.description;
  normalizeAltTitles(incoming.genres).forEach(genre => target.genres.add(genre));

  target.progress = Math.max(target.progress, Number(incoming.progress) || 0);
  target.volumeProgress = Math.max(target.volumeProgress, Number(incoming.volumeProgress) || 0);
  target.score = Math.max(target.score, Number(incoming.score) || 0);
  target.totalEp = Math.max(target.totalEp, Number(incoming.totalEp) || 0);
  target.totalVol = Math.max(target.totalVol, Number(incoming.totalVol) || 0);
  target.year = target.year || Number(incoming.year) || 0;
  target.communityScore = Math.max(target.communityScore, Number(incoming.communityScore) || 0);
  target.updatedAt = Math.max(target.updatedAt, parseUpdatedAt(incoming.updatedAt));
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

function originPatternFromServerUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch (_err) {
    return null;
  }
}

export async function requestMongoServerPermission(serverUrl?: string): Promise<boolean> {
  if (api.type !== 'webextension' || typeof chrome?.permissions?.request !== 'function') {
    return true;
  }

  const origin = originPatternFromServerUrl(serverUrl || getServerUrl());
  if (!origin) return false;

  const alreadyGranted = await chrome.permissions.contains({ origins: [origin] });
  if (alreadyGranted) return true;

  return chrome.permissions.request({ origins: [origin] });
}

async function mongoFetch<T = any>(
  path: string,
  init: RequestInit = {},
  retry = 0,
): Promise<T> {
  const url = `${getServerUrl()}${path}`;
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['X-API-Key'] = apiKey;

  // Content-script fetch() is blocked on HTTPS pages (mixed content / private
  // network access) when talking to localhost or a Tailscale/LAN backend.
  // Route through the background xhr helper like every other provider.
  const method = String(init.method || 'GET').toUpperCase() as
    | 'GET'
    | 'POST'
    | 'PUT'
    | 'PATCH'
    | 'DELETE';
  const request: { url: string; headers: Record<string, string>; data?: any } = {
    url,
    headers,
  };
  if (init.body !== undefined && init.body !== null) {
    request.data = init.body;
  }

  const retryGet = async () => {
    await new Promise(resolve => setTimeout(resolve, 400 * (retry + 1)));
    return mongoFetch<T>(path, init, retry + 1);
  };

  let xhr;
  try {
    xhr = await api.request.xhr(method, request);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    con.error(logScope, 'request failed', { url, message, retry });
    if (method === 'GET' && retry < 2) return retryGet();
    throw new ServerOfflineError(
      `MongoDB sync: cannot reach ${getServerUrl()} (${message || 'Failed to fetch'})`,
    );
  }

  let body: any = null;
  try {
    body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
  } catch (_err) {
    body = null;
  }

  if (!xhr.status || xhr.status < 200 || xhr.status >= 300) {
    const message = (body && body.error) || xhr.responseText || `HTTP ${xhr.status}`;
    con.error(logScope, 'request failed', { url, status: xhr.status, message, retry });
    if (!xhr.status) {
      if (method === 'GET' && retry < 2) return retryGet();
      throw new ServerOfflineError(`MongoDB sync: cannot reach ${getServerUrl()}`);
    }
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

export async function getSyncList(mediaType?: 'anime' | 'manga', status?: number) {
  const libraryKey = requireLibraryKey();
  const titleMergeMode = getTitleMergeMode();

  // Fetch only the rows the current list view needs. The list shows one
  // mediaType (and usually one status) at a time, so filtering server-side
  // instead of downloading the whole library is the dominant load-time win.
  let path = `/entries?userKey=${encodeURIComponent(libraryKey)}`;
  if (mediaType) path += `&mediaType=${encodeURIComponent(mediaType)}`;
  if (typeof status === 'number') path += `&status=${encodeURIComponent(String(status))}`;

  const { rows = [] } = await fetchEntriesCached(path);

  con.log(logScope, 'getSyncList', { totalRows: rows.length, mediaType, status });

  // Dedup via lookup maps instead of a linear scan per row. A naive
  // `deduped.find(...)` over every row is O(n²); worse, the fuzzy variant
  // re-normalized every title on every comparison, which at 1k+ rows costs
  // several seconds. Id and exact-title overlap reduce to O(1) map lookups, and
  // the fuzzy containment scan compares precomputed (already-normalized) keys.
  const deduped: SyncEntryAggregate[] = [];
  const aliasIndex = new Map<string, SyncEntryAggregate>();
  const titleIndex = titleMergeMode !== 'off' ? new Map<string, SyncEntryAggregate>() : null;

  const indexKey = (mediaType: string, value: string) => `${mediaType} ${value}`;

  const registerAliases = (agg: SyncEntryAggregate) => {
    agg.aliases.forEach(alias => aliasIndex.set(indexKey(agg.mediaType, alias), agg));
  };
  const registerTitles = (agg: SyncEntryAggregate) => {
    if (!titleIndex) return;
    agg.titleKeys.forEach(key => titleIndex.set(indexKey(agg.mediaType, key), agg));
  };

  rows.forEach(row => {
    let match: SyncEntryAggregate | undefined;

    const rowIds = normalizeAliases([row.entryId, ...(row.aliases || [])]);
    for (const id of rowIds) {
      const found = aliasIndex.get(indexKey(row.mediaType, id));
      if (found) {
        match = found;
        break;
      }
    }

    // Precompute the row's normalized title keys once, reused for both the exact
    // index lookup and the fuzzy containment scan.
    const rowTitleKeys = titleIndex ? [...computeTitleKeys(row.title, row.altTitles)] : [];

    if (!match && titleIndex) {
      for (const key of rowTitleKeys) {
        const found = titleIndex.get(indexKey(row.mediaType, key));
        if (found) {
          match = found;
          break;
        }
      }
    }

    // Containment can't be indexed, so this still scans — but only for rows that
    // didn't match by id or exact title, and each comparison is a cheap string
    // op over precomputed keys rather than a fresh normalization pass.
    if (!match && titleMergeMode === 'fuzzy' && rowTitleKeys.length) {
      for (const candidate of deduped) {
        if (candidate.mediaType !== row.mediaType) continue;
        if (titleKeysContainFuzzy(candidate.titleKeys, rowTitleKeys)) {
          match = candidate;
          break;
        }
      }
    }

    if (!match) {
      const agg = toAggregate(row);
      deduped.push(agg);
      registerAliases(agg);
      registerTitles(agg);
      return;
    }

    mergeAggregate(match, row);
    // mergeAggregate can absorb new aliases/altTitles (and promote a local row's
    // entryId to a remote one), so re-register the merged keys.
    registerAliases(match);
    registerTitles(match);
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
      updatedAt: row.updatedAt,
      totalEp: row.totalEp,
      totalVol: row.totalVol,
      description: row.description,
      year: row.year,
      genres: [...row.genres],
      communityScore: row.communityScore,
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
    totalEp: Number(row.totalEp) || 0,
    totalVol: Number(row.totalVol) || 0,
    description: row.description || '',
    year: Number(row.year) || 0,
    genres: normalizeAltTitles(row.genres),
    communityScore: Number(row.communityScore) || 0,
    format: row.format || '',
    airStatus: row.airStatus || '',
    season: row.season || '',
    duration: Number(row.duration) || 0,
    studios: normalizeAltTitles(row.studios),
    characters: normalizeCharacters(row.characters),
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
      totalEp: payload.totalEp,
      totalVol: payload.totalVol,
      description: payload.description,
      year: payload.year,
      genres: normalizeAltTitles(payload.genres),
      communityScore: payload.communityScore,
      format: payload.format,
      airStatus: payload.airStatus,
      season: payload.season,
      duration: payload.duration,
      studios: normalizeAltTitles(payload.studios),
      characters: normalizeCharacters(payload.characters),
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
