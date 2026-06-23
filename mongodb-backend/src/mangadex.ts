/**
 * Minimal MangaDex API client.
 *
 * Speaks the bits of https://api.mangadex.org we need to mirror a user's manga
 * library into MongoDB: OAuth2 (personal client / password grant), reading
 * statuses, personal ratings, manga metadata, and — optionally — read-chapter
 * markers so we can derive a chapter progress number.
 *
 * Node 18+ globals (`fetch`, `URLSearchParams`) are used; no extra deps.
 */

const AUTH_URL =
  'https://auth.mangadex.org/realms/mangadex/protocol/openid-connect/token';
const API_BASE = 'https://api.mangadex.org';

/** All content ratings, so a user's NSFW entries still resolve. */
const ALL_CONTENT_RATINGS = ['safe', 'suggestive', 'erotica', 'pornographic'];

export type MangadexStatus =
  | 'reading'
  | 'on_hold'
  | 'plan_to_read'
  | 'dropped'
  | 're_reading'
  | 'completed';

export type MangaAttributes = {
  title: Record<string, string>;
  altTitles: Record<string, string>[];
  links: Record<string, string> | null;
  originalLanguage: string;
  tags: { attributes: { name: Record<string, string>; group: string } }[];
  publicationDemographic: string | null;
};

export type MangaData = {
  id: string;
  type: 'manga';
  attributes: MangaAttributes;
  relationships: {
    id: string;
    type: string;
    attributes?: { fileName?: string };
  }[];
};

export type MangadexCredentials = {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
};

function assertCredentials(creds: Partial<MangadexCredentials>): MangadexCredentials {
  const missing = (['clientId', 'clientSecret', 'username', 'password'] as const).filter(
    k => !creds[k],
  );
  if (missing.length) {
    throw new Error(
      `Missing MangaDex credentials: ${missing.join(', ')}. Set them in mongodb-backend/.env ` +
        `(MANGADEX_CLIENT_ID / MANGADEX_CLIENT_SECRET / MANGADEX_USERNAME / MANGADEX_PASSWORD).`,
    );
  }
  return creds as MangadexCredentials;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class MangadexClient {
  private readonly creds: MangadexCredentials;

  private accessToken: string | null = null;

  private refreshToken: string | null = null;

  /** ms epoch at which the current access token should be considered stale. */
  private tokenExpiresAt = 0;

  /** Spacing between API calls — MangaDex allows ~5 req/s globally. */
  private readonly minRequestSpacingMs: number;

  private lastRequestAt = 0;

  constructor(creds: Partial<MangadexCredentials>, opts: { requestsPerSecond?: number } = {}) {
    this.creds = assertCredentials(creds);
    // MangaDex guarantees ~5 req/s per IP globally; stay comfortably under it so
    // a long run (e.g. one /aggregate per manga for 1000+ entries) never trips
    // the limiter. A single shared throttle covers every endpoint.
    const requested = opts.requestsPerSecond && opts.requestsPerSecond > 0 ? opts.requestsPerSecond : 3;
    const rps = Math.min(requested, 5);
    this.minRequestSpacingMs = Math.ceil(1000 / rps);
  }

  // --- auth -----------------------------------------------------------------

  private async tokenRequest(body: Record<string, string>): Promise<void> {
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.access_token) {
      const detail = json?.error_description || json?.error || `HTTP ${res.status}`;
      throw new Error(`MangaDex auth failed: ${detail}`);
    }
    this.accessToken = json.access_token;
    this.refreshToken = json.refresh_token || this.refreshToken;
    // Refresh a little early to avoid mid-flight expiry (tokens last ~15 min).
    const ttl = (Number(json.expires_in) || 900) * 1000;
    this.tokenExpiresAt = Date.now() + ttl - 30_000;
  }

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;

    if (this.refreshToken) {
      try {
        await this.tokenRequest({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
        });
        return this.accessToken!;
      } catch {
        // Fall through to a fresh password grant.
        this.refreshToken = null;
      }
    }

    await this.tokenRequest({
      grant_type: 'password',
      username: this.creds.username,
      password: this.creds.password,
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
    });
    return this.accessToken!;
  }

  // --- request plumbing -----------------------------------------------------

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minRequestSpacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  /**
   * GET a MangaDex API path. `params` may repeat keys (arrays become `key[]`).
   * Retries on 429 (honouring Retry-After) and transient 5xx.
   */
  private async get(path: string, params: Record<string, string | string[]> = {}): Promise<any> {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(`${key}[]`, v);
      } else {
        url.searchParams.append(key, value);
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      await this.throttle();
      const token = await this.ensureToken();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 1;
        await sleep(retryAfter * 1000);
        continue;
      }
      if (res.status === 401) {
        // Token rejected — force a refresh and retry once more.
        this.tokenExpiresAt = 0;
        continue;
      }
      if (res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      const json: any = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = json?.errors?.[0]?.detail || `HTTP ${res.status}`;
        throw new Error(`MangaDex GET ${path} failed: ${detail}`);
      }
      return json;
    }
    throw new Error(`MangaDex GET ${path} failed after retries`);
  }

  // --- endpoints ------------------------------------------------------------

  /** Map of mangaId -> reading status for the whole library. */
  async getReadingStatuses(): Promise<Record<string, MangadexStatus>> {
    const json = await this.get('/manga/status');
    return (json?.statuses || {}) as Record<string, MangadexStatus>;
  }

  /** Map of mangaId -> personal rating (1-10). Queried in batches of 100. */
  async getRatings(mangaIds: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const batch of chunk(mangaIds, 100)) {
      const json = await this.get('/rating', { manga: batch });
      const ratings = json?.ratings || {};
      for (const [id, value] of Object.entries<any>(ratings)) {
        if (value && typeof value.rating === 'number') out[id] = value.rating;
      }
    }
    return out;
  }

  /** Full manga documents (with cover_art) for the given ids, batched by 100. */
  async getManga(mangaIds: string[]): Promise<MangaData[]> {
    const out: MangaData[] = [];
    for (const batch of chunk(mangaIds, 100)) {
      const json = await this.get('/manga', {
        ids: batch,
        limit: '100',
        includes: ['cover_art'],
        contentRating: ALL_CONTENT_RATINGS,
      });
      for (const item of json?.data || []) out.push(item as MangaData);
    }
    return out;
  }

  /** Map of mangaId -> read chapter ids, batched by 100 (grouped response). */
  async getReadChapters(mangaIds: string[]): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const batch of chunk(mangaIds, 100)) {
      const json = await this.get('/manga/read', { ids: batch, grouped: 'true' });
      const data = json?.data || {};
      for (const [id, chapters] of Object.entries<any>(data)) {
        if (Array.isArray(chapters)) out[id] = chapters;
      }
    }
    return out;
  }

  /**
   * Chapter-id -> { chapter, volume } lookup for a single manga, derived from
   * the aggregate (volume/chapter) tree. Used to turn read-chapter ids into a
   * numeric progress value.
   */
  async getChapterNumbers(
    mangaId: string,
  ): Promise<Record<string, { chapter: string; volume: string }>> {
    const json = await this.get(`/manga/${mangaId}/aggregate`);
    const lookup: Record<string, { chapter: string; volume: string }> = {};
    const volumes = json?.volumes || {};
    for (const vol of Object.values<any>(volumes)) {
      const volume = vol?.volume ?? '';
      for (const ch of Object.values<any>(vol?.chapters || {})) {
        const entry = { chapter: ch?.chapter ?? '', volume };
        if (ch?.id) lookup[ch.id] = entry;
        for (const other of ch?.others || []) lookup[other] = entry;
      }
    }
    return lookup;
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
