/**
 * Import a MangaDex library into the MongoDB sync store.
 *
 * Pulls the authenticated user's reading statuses, personal ratings and manga
 * metadata from https://api.mangadex.org and upserts them as `manga` sync
 * entries — the same documents the extension reads back through the MongoDB
 * provider.
 *
 * Usage:
 *   npm run import-mangadex -- --user=<profile> [--owner=<ownerId>]
 *                              [--merge=off|exact|fuzzy] [--progress]
 *                              [--tags] [--limit=N] [--dry-run]
 *
 * Credentials come from mongodb-backend/.env:
 *   MANGADEX_CLIENT_ID, MANGADEX_CLIENT_SECRET,
 *   MANGADEX_USERNAME, MANGADEX_PASSWORD
 */
import 'dotenv/config';
import { closeDb, getDb } from '../db.js';
import { upsertEntry, UpsertPayload } from '../entries.js';
import { TitleMergeMode } from '../merge.js';
import { MangadexClient, MangaData, MangadexStatus } from '../mangadex.js';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find(a => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// MangaDex reading status -> MAL-style status number used across MALSync.
// (MongoDB sync has no rewatching state, so re_reading collapses to reading.)
const STATUS_MAP: Record<MangadexStatus, number> = {
  reading: 1, // Watching
  completed: 2, // Completed
  on_hold: 3, // Onhold
  dropped: 4, // Dropped
  plan_to_read: 6, // PlanToWatch
  re_reading: 1, // Watching
};

const MANGADEX_BASE = 'https://mangadex.org';

/** Pick a display title the way the Mangadex page adapter does. */
function pickTitle(manga: MangaData): string {
  const { title, originalLanguage } = manga.attributes;
  return (
    title?.[`${originalLanguage}-ro`] ??
    title?.en ??
    title?.[originalLanguage] ??
    (title ? Object.values(title)[0] : '') ??
    ''
  );
}

/** Every alternate spelling MangaDex knows, minus the chosen main title. */
function collectAltTitles(manga: MangaData, mainTitle: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === mainTitle || seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };
  for (const value of Object.values(manga.attributes.title || {})) push(value);
  for (const alt of manga.attributes.altTitles || []) {
    for (const value of Object.values(alt)) push(value);
  }
  return out;
}

function coverUrl(manga: MangaData): string | null {
  const cover = manga.relationships?.find(rel => rel.type === 'cover_art');
  const fileName = cover?.attributes?.fileName;
  if (!fileName) return null;
  return `https://uploads.mangadex.org/covers/${manga.id}/${fileName}`;
}

/**
 * Resolve the entryId / sourceUrl, preferring a list-provider link so the entry
 * matches what the extension generates when you visit the page. Falls back to a
 * MangaDex-native id when no MAL/AniList/Kitsu link exists.
 */
function resolveIdentity(manga: MangaData): { entryId: string; sourceUrl: string } {
  const links = manga.attributes.links || {};
  if (links.mal && /^\d+$/.test(links.mal)) {
    return { entryId: links.mal, sourceUrl: `https://myanimelist.net/manga/${links.mal}` };
  }
  if (links.al && /^\d+$/.test(links.al)) {
    return { entryId: `a:${links.al}`, sourceUrl: `https://anilist.co/manga/${links.al}` };
  }
  if (links.kt) {
    return { entryId: `k:${links.kt}`, sourceUrl: `https://kitsu.app/manga/${links.kt}` };
  }
  return { entryId: `md:${manga.id}`, sourceUrl: `${MANGADEX_BASE}/title/${manga.id}` };
}

function buildTags(manga: MangaData): string {
  const names: string[] = [];
  const demo = manga.attributes.publicationDemographic;
  if (demo) names.push(demo);
  for (const tag of manga.attributes.tags || []) {
    const name = tag.attributes?.name?.en;
    if (name) names.push(name);
  }
  return names.join(', ');
}

/** Highest read chapter / volume number for one manga from its read markers. */
function deriveProgress(
  readChapterIds: string[],
  lookup: Record<string, { chapter: string; volume: string }>,
): { progress: number; volumeProgress: number } {
  let progress = 0;
  let volumeProgress = 0;
  for (const id of readChapterIds) {
    const meta = lookup[id];
    if (!meta) continue;
    const chapter = parseFloat(meta.chapter);
    if (!Number.isNaN(chapter)) progress = Math.max(progress, chapter);
    const volume = parseFloat(meta.volume);
    if (!Number.isNaN(volume)) volumeProgress = Math.max(volumeProgress, volume);
  }
  return { progress, volumeProgress };
}

async function main() {
  const userKey = arg('user') || process.env.MANGADEX_USERKEY;
  if (!userKey) {
    console.error(
      'Usage: npm run import-mangadex -- --user=<profile> [--owner=<ownerId>] ' +
        '[--merge=off|exact|fuzzy] [--progress] [--tags] [--limit=N] [--dry-run]',
    );
    process.exit(1);
  }

  const ownerId = arg('owner') || process.env.MANGADEX_OWNER || 'anonymous';
  const mergeArg = arg('merge');
  const titleMergeMode: TitleMergeMode =
    mergeArg === 'exact' || mergeArg === 'fuzzy' ? mergeArg : 'off';
  const withProgress = flag('progress');
  const withTags = flag('tags');
  const dryRun = flag('dry-run');
  const limit = Number(arg('limit')) || 0;

  const requestsPerSecond = Number(arg('rps')) || 3;

  const client = new MangadexClient(
    {
      clientId: process.env.MANGADEX_CLIENT_ID,
      clientSecret: process.env.MANGADEX_CLIENT_SECRET,
      username: process.env.MANGADEX_USERNAME,
      password: process.env.MANGADEX_PASSWORD,
    },
    { requestsPerSecond },
  );

  console.log('[import-mangadex] fetching reading statuses…');
  const statuses = await client.getReadingStatuses();
  let mangaIds = Object.keys(statuses);
  console.log(`[import-mangadex] ${mangaIds.length} manga in library`);
  if (limit > 0) mangaIds = mangaIds.slice(0, limit);
  if (!mangaIds.length) {
    console.log('[import-mangadex] nothing to import.');
    await closeDb();
    return;
  }

  console.log('[import-mangadex] fetching ratings…');
  let ratings: Record<string, number> = {};
  try {
    ratings = await client.getRatings(mangaIds);
  } catch (err) {
    console.warn(`[import-mangadex] ratings unavailable, importing without scores: ${(err as Error).message}`);
  }

  console.log('[import-mangadex] fetching manga metadata…');
  const mangaList = await client.getManga(mangaIds);

  let readChapters: Record<string, string[]> = {};
  if (withProgress) {
    console.log('[import-mangadex] fetching read-chapter markers…');
    readChapters = await client.getReadChapters(mangaIds);
    const withReads = Object.values(readChapters).filter(c => c.length).length;
    const etaSeconds = Math.ceil(withReads / requestsPerSecond);
    console.log(
      `[import-mangadex] deriving progress for ${withReads} manga ` +
        `(~${etaSeconds}s at ${requestsPerSecond} req/s)…`,
    );
  }

  const db = dryRun ? null : await getDb();
  let imported = 0;
  let failed = 0;

  for (const manga of mangaList) {
    const status = statuses[manga.id];
    if (!status) continue;

    const title = pickTitle(manga);
    const { entryId, sourceUrl } = resolveIdentity(manga);

    let progress = 0;
    let volumeProgress = 0;
    if (withProgress && readChapters[manga.id]?.length) {
      try {
        const lookup = await client.getChapterNumbers(manga.id);
        ({ progress, volumeProgress } = deriveProgress(readChapters[manga.id], lookup));
      } catch (err) {
        console.warn(`[import-mangadex] progress lookup failed for ${title}: ${(err as Error).message}`);
      }
    }

    const payload: UpsertPayload = {
      entryId,
      mediaType: 'manga',
      userKey,
      titleMergeMode,
      sourceUrl,
      title: title || entryId,
      altTitles: collectAltTitles(manga, title),
      image: coverUrl(manga),
      tags: withTags ? buildTags(manga) : '',
      streamingUrl: `${MANGADEX_BASE}/title/${manga.id}`,
      progress,
      volumeProgress,
      score: ratings[manga.id] || 0,
      status: STATUS_MAP[status] ?? 6,
    };

    if (dryRun) {
      console.log(
        `[dry-run] ${payload.title} -> entryId=${entryId} status=${payload.status} ` +
          `score=${payload.score} progress=${progress}`,
      );
      imported++;
      continue;
    }

    try {
      await upsertEntry(db!, ownerId, payload);
      imported++;
      if (imported % 25 === 0) console.log(`[import-mangadex] imported ${imported}…`);
    } catch (err) {
      failed++;
      console.warn(`[import-mangadex] failed "${payload.title}": ${(err as Error).message}`);
    }
  }

  console.log(
    `[import-mangadex] done — ${imported} imported, ${failed} failed` +
      (dryRun ? ' (dry run, nothing written)' : ` for owner="${ownerId}" user="${userKey}"`),
  );

  await closeDb();
}

main().catch(async err => {
  console.error('[import-mangadex]', err);
  await closeDb().catch(() => {});
  process.exit(1);
});
