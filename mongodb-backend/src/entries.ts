import { Db } from 'mongodb';
import { SyncEntryDoc, syncEntries } from './db.js';
import {
  TitleMergeMode,
  hasTitleOverlap,
  mergeStringArrays,
  normalizeStringArray,
  normalizeUserKey,
  normalizeValue,
  preferString,
} from './merge.js';

export type UpsertPayload = {
  entryId: string;
  mediaType: 'anime' | 'manga';
  userKey: string;
  titleMergeMode?: TitleMergeMode;
  sourceUrl: string;
  title: string;
  altTitles?: string[];
  image?: string | null;
  tags: string;
  streamingUrl?: string | null;
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
  characters?: { name: string; img: string; url: string; subtext: string }[];
  [extra: string]: unknown;
};

export type LinkPayload = {
  entryId: string;
  mediaType: 'anime' | 'manga';
  userKey: string;
  targetEntryId?: string;
  aliases?: string[];
  altTitles?: string[];
};

export type UnlinkPayload = {
  entryId: string;
  mediaType: 'anime' | 'manga';
  userKey: string;
  targetEntryId?: string;
  alias?: string;
};

function requireUserKey(value: string | undefined | null): string {
  const normalized = normalizeUserKey(value);
  if (!normalized) throw new Error('userKey is required');
  return normalized;
}

function findOwnerRowById(rows: SyncEntryDoc[], entryId: string): SyncEntryDoc | undefined {
  return (
    rows.find(row => row.entryId === entryId) ||
    rows.find(row => normalizeStringArray(row.aliases).includes(entryId))
  );
}

// Strips fields that we never want a client to overwrite at the storage layer.
const RESERVED_KEYS = new Set([
  '_id',
  'ownerId',
  'userKey',
  'mediaType',
  'entryId',
  'updatedAt',
  'aliases',
  'titleMergeMode',
]);

function extraFields(payload: Record<string, unknown>): Record<string, unknown> {
  const known = new Set([
    'sourceUrl',
    'title',
    'altTitles',
    'image',
    'tags',
    'streamingUrl',
    'progress',
    'volumeProgress',
    'score',
    'status',
    'totalEp',
    'totalVol',
    'description',
    'year',
    'genres',
    'communityScore',
    'format',
    'airStatus',
    'season',
    'duration',
    'studios',
    'characters',
  ]);
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (known.has(key)) continue;
    extras[key] = value;
  }
  return extras;
}

export async function upsertEntry(
  db: Db,
  ownerId: string,
  payload: UpsertPayload,
): Promise<SyncEntryDoc> {
  if (!payload.entryId) throw new Error('entryId is required');
  if (payload.mediaType !== 'anime' && payload.mediaType !== 'manga') {
    throw new Error('mediaType must be anime or manga');
  }

  const userKey = requireUserKey(payload.userKey);
  const titleMergeMode: TitleMergeMode =
    payload.titleMergeMode === 'off' ||
    payload.titleMergeMode === 'exact' ||
    payload.titleMergeMode === 'fuzzy'
      ? payload.titleMergeMode
      : 'fuzzy';

  const col = syncEntries(db);
  const ownerRows = await col
    .find({ ownerId, userKey, mediaType: payload.mediaType })
    .toArray();

  let existing = findOwnerRowById(ownerRows, payload.entryId);
  let resolvedByTitle = false;

  const nextAltTitles = normalizeStringArray(payload.altTitles);
  if (!existing) {
    existing = ownerRows.find(row =>
      hasTitleOverlap(
        row.title,
        normalizeStringArray(row.altTitles),
        payload.title,
        nextAltTitles,
        titleMergeMode,
      ),
    );
    if (existing) resolvedByTitle = true;
  }

  const aliases = mergeStringArrays(
    normalizeStringArray([
      ...(existing?.aliases || []),
      existing?.entryId || payload.entryId,
      payload.entryId,
    ]),
    [],
  );

  const baseEntryId = existing?.entryId || payload.entryId;
  const nextDoc: SyncEntryDoc = {
    ownerId,
    userKey,
    mediaType: payload.mediaType,
    entryId: baseEntryId,
    sourceUrl: resolvedByTitle
      ? preferString(existing?.sourceUrl || '', normalizeValue(payload.sourceUrl))
      : payload.sourceUrl,
    title: resolvedByTitle ? preferString(existing?.title || '', payload.title) : payload.title,
    altTitles: mergeStringArrays(existing?.altTitles || [], nextAltTitles),
    image: resolvedByTitle
      ? normalizeValue(existing?.image || undefined) ?? normalizeValue(payload.image || undefined) ?? null
      : (normalizeValue(payload.image || undefined) ?? null),
    tags: resolvedByTitle
      ? preferString(existing?.tags || '', normalizeValue(payload.tags))
      : payload.tags,
    streamingUrl: resolvedByTitle
      ? normalizeValue(existing?.streamingUrl || undefined) ??
        normalizeValue(payload.streamingUrl || undefined) ??
        null
      : (normalizeValue(payload.streamingUrl || undefined) ?? null),
    progress: resolvedByTitle
      ? Math.max(existing?.progress || 0, payload.progress)
      : payload.progress,
    volumeProgress: resolvedByTitle
      ? Math.max(existing?.volumeProgress || 0, payload.volumeProgress)
      : payload.volumeProgress,
    score: resolvedByTitle ? (payload.score ? payload.score : existing?.score || 0) : payload.score,
    status: resolvedByTitle ? existing?.status || payload.status : payload.status,
    aliases,
    updatedAt: new Date(),
    ...extraFields(payload as Record<string, unknown>),
  };

  // Rich metadata: the client already applied its fill/replace strictness, so
  // take the incoming value when present and otherwise keep what's stored.
  // Empty/absent values never clear an existing field.
  const setRich = (key: keyof SyncEntryDoc, existingVal: unknown, incomingVal: unknown) => {
    const value = resolvedByTitle ? (existingVal ?? incomingVal) : (incomingVal ?? existingVal);
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === 'string' && !value.trim()) return;
    (nextDoc as Record<string, unknown>)[key as string] = value;
  };
  setRich('totalEp', existing?.totalEp, payload.totalEp);
  setRich('totalVol', existing?.totalVol, payload.totalVol);
  setRich('description', existing?.description, normalizeValue(payload.description));
  setRich('year', existing?.year, payload.year);
  setRich('genres', existing?.genres, normalizeStringArray(payload.genres));
  setRich('communityScore', existing?.communityScore, payload.communityScore);
  setRich('format', existing?.format, normalizeValue(payload.format));
  setRich('airStatus', existing?.airStatus, normalizeValue(payload.airStatus));
  setRich('season', existing?.season, normalizeValue(payload.season));
  setRich('duration', existing?.duration, payload.duration);
  setRich('studios', existing?.studios, normalizeStringArray(payload.studios));
  setRich(
    'characters',
    existing?.characters,
    Array.isArray(payload.characters) ? payload.characters : undefined,
  );

  await col.updateOne(
    { ownerId, userKey, mediaType: payload.mediaType, entryId: baseEntryId },
    { $set: nextDoc },
    { upsert: true },
  );

  return nextDoc;
}

export async function deleteEntry(
  db: Db,
  ownerId: string,
  args: { entryId: string; mediaType: 'anime' | 'manga'; userKey: string },
): Promise<{ deleted: number }> {
  if (args.mediaType !== 'anime' && args.mediaType !== 'manga') {
    throw new Error('mediaType must be anime or manga');
  }
  const userKey = requireUserKey(args.userKey);
  const col = syncEntries(db);

  const ownerRows = await col.find({ ownerId, userKey, mediaType: args.mediaType }).toArray();
  const target = findOwnerRowById(ownerRows, args.entryId);
  if (!target) return { deleted: 0 };

  await col.deleteOne({ ownerId, userKey, mediaType: args.mediaType, entryId: target.entryId });
  return { deleted: 1 };
}

export async function listEntries(
  db: Db,
  ownerId: string,
  filters: { userKey: string; mediaType?: 'anime' | 'manga'; status?: number },
): Promise<SyncEntryDoc[]> {
  const userKey = requireUserKey(filters.userKey);
  const query: Record<string, unknown> = { ownerId, userKey };
  if (filters.mediaType) query.mediaType = filters.mediaType;
  if (typeof filters.status === 'number' && Number.isFinite(filters.status)) {
    query.status = filters.status;
  }
  return syncEntries(db).find(query).toArray();
}

export async function linkEntries(db: Db, ownerId: string, payload: LinkPayload): Promise<void> {
  if (payload.mediaType !== 'anime' && payload.mediaType !== 'manga') {
    throw new Error('mediaType must be anime or manga');
  }
  const userKey = requireUserKey(payload.userKey);
  const col = syncEntries(db);

  const ownerRows = await col.find({ ownerId, userKey, mediaType: payload.mediaType }).toArray();
  const source = findOwnerRowById(ownerRows, payload.entryId);
  if (!source) throw new Error('source entry not found');

  const normalizedTargetEntryId = normalizeValue(payload.targetEntryId);
  let target = source;
  if (normalizedTargetEntryId) {
    const found = findOwnerRowById(ownerRows, normalizedTargetEntryId);
    if (found) target = found;
  }

  const linkAliases = normalizeStringArray([
    ...(payload.aliases || []),
    payload.entryId,
    ...(normalizedTargetEntryId ? [normalizedTargetEntryId] : []),
    source.entryId,
    target.entryId,
    ...(source.aliases || []),
    ...(target.aliases || []),
  ]);
  const linkAltTitles = mergeStringArrays(
    mergeStringArrays(target.altTitles || [], source.altTitles || []),
    normalizeStringArray(payload.altTitles),
  );

  await col.updateOne(
    { ownerId, userKey, mediaType: payload.mediaType, entryId: source.entryId },
    { $set: { aliases: linkAliases, altTitles: linkAltTitles, updatedAt: new Date() } },
  );

  if (target.entryId !== source.entryId) {
    await col.updateOne(
      { ownerId, userKey, mediaType: payload.mediaType, entryId: target.entryId },
      { $set: { aliases: linkAliases, altTitles: linkAltTitles, updatedAt: new Date() } },
    );
  }
}

export async function unlinkEntries(db: Db, ownerId: string, payload: UnlinkPayload): Promise<void> {
  if (payload.mediaType !== 'anime' && payload.mediaType !== 'manga') {
    throw new Error('mediaType must be anime or manga');
  }
  const userKey = requireUserKey(payload.userKey);
  const col = syncEntries(db);

  const ownerRows = await col.find({ ownerId, userKey, mediaType: payload.mediaType }).toArray();
  const source = findOwnerRowById(ownerRows, payload.entryId);
  if (!source) throw new Error('source entry not found');

  const normalizedTargetEntryId = normalizeValue(payload.targetEntryId);
  const normalizedAlias = normalizeValue(payload.alias);

  if (normalizedTargetEntryId) {
    const target = findOwnerRowById(ownerRows, normalizedTargetEntryId);
    if (!target) throw new Error('target entry not found');

    const sourceAliases = normalizeStringArray(source.aliases).filter(
      el => el !== target.entryId && el !== normalizedTargetEntryId,
    );
    const targetAliases = normalizeStringArray(target.aliases).filter(
      el => el !== source.entryId && el !== payload.entryId,
    );

    await col.updateOne(
      { ownerId, userKey, mediaType: payload.mediaType, entryId: source.entryId },
      { $set: { aliases: sourceAliases, updatedAt: new Date() } },
    );

    if (target.entryId !== source.entryId) {
      await col.updateOne(
        { ownerId, userKey, mediaType: payload.mediaType, entryId: target.entryId },
        { $set: { aliases: targetAliases, updatedAt: new Date() } },
      );
    }
    return;
  }

  if (normalizedAlias) {
    const sourceAliases = normalizeStringArray(source.aliases).filter(el => el !== normalizedAlias);
    await col.updateOne(
      { ownerId, userKey, mediaType: payload.mediaType, entryId: source.entryId },
      { $set: { aliases: sourceAliases, updatedAt: new Date() } },
    );
  }
}
