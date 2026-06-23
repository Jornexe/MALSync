# malsync-mongodb-backend

A thin Hono + MongoDB HTTP API that the MALSync extension can talk to as an
alternative to SpaceTimeDB. Mirrors the upsert / delete / link / unlink
operations of the SpaceTimeDB reducers.

## Setup

```bash
cp .env.example .env       # edit MONGO_URI / DB_NAME / PORT as needed
npm install
npm run dev                # http://localhost:8787
```

Health check:

```bash
curl http://localhost:8787/health
```

## Authentication

The server uses a single header — `X-API-Key`. Keys are stored hashed in the
`apiKeys` collection. Mint one with:

```bash
npm run create-key -- --owner=jorn --label=local
```

The script prints the raw key once. Paste it into the extension's MongoDB
settings panel along with the server URL.

For localhost-only experiments you can set `ALLOW_ANON=1` in `.env` to skip the
auth check entirely (every request is attributed to the `anonymous` owner).

## API

| Method | Path                  | Notes                                                   |
|--------|-----------------------|---------------------------------------------------------|
| GET    | `/health`             | No auth.                                                |
| GET    | `/me`                 | Returns `{ ownerId, label, href }`.                     |
| GET    | `/entries`            | Query `?userKey=...&mediaType=anime|manga`.             |
| POST   | `/entries`            | Body matches the SpaceTimeDB `upsert_entry` payload.    |
| DELETE | `/entries/:entryId`   | Query `?userKey=...&mediaType=...`.                     |
| POST   | `/entries/link`       | Body matches the SpaceTimeDB `link_entry` payload.      |
| POST   | `/entries/unlink`     | Body matches the SpaceTimeDB `unlink_entry` payload.    |

Unknown fields on the upsert body are stored verbatim, so adding a new field on
the extension side requires no backend change.

## Importing a MangaDex library

`npm run import-mangadex` pulls your MangaDex reading list, personal ratings and
manga metadata from <https://api.mangadex.org> and upserts them as `manga` sync
entries — the same documents the extension reads back through the MongoDB
provider.

### Credentials

Create a **personal client** at <https://mangadex.org/settings> → *API Clients*,
then fill these into `.env` (the OAuth2 password grant also needs your account
login):

```
MANGADEX_CLIENT_ID=personal-client-xxxxxxxx
MANGADEX_CLIENT_SECRET=...
MANGADEX_USERNAME=...
MANGADEX_PASSWORD=...
MANGADEX_OWNER=anonymous   # default --owner
MANGADEX_USERKEY=          # default --user (your extension profile)
```

### Run

```bash
npm run import-mangadex -- --user=<profile> [options]
```

`--user` is the extension *profile* (the MongoDB `userKey`); entries land under
that profile so they show up when the extension's MongoDB profile matches.

| Flag                  | Default     | Notes                                                              |
|-----------------------|-------------|-------------------------------------------------------------------|
| `--user=<profile>`    | `MANGADEX_USERKEY` | Profile / userKey to import into (required).               |
| `--owner=<ownerId>`   | `MANGADEX_OWNER` / `anonymous` | Owner the entries belong to.                   |
| `--merge=off\|exact\|fuzzy` | `off` | Server-side title de-dup mode. `off` keeps every title distinct.  |
| `--progress`          | off         | Derive a chapter/volume number from read markers (slower — one extra request per read manga). |
| `--tags`              | off         | Store MangaDex demographic + genres in the entry's `tags` field.  |
| `--limit=N`           | all         | Import only the first N manga (handy for a test run).             |
| `--rps=N`             | `3`         | Requests/second to MangaDex (capped at 5 — their global limit).  |
| `--dry-run`           | off         | Print what would be written without touching MongoDB.            |

### Rate limits

MangaDex guarantees ~5 requests/second per IP globally; the read endpoints used
here have no stricter per-endpoint cap. The client enforces a single shared
throttle (default **3 req/s**) and backs off on `429` (honouring `Retry-After`),
so even a 1000+ entry library stays within bounds. The base import is only ~20
requests; `--progress` adds one `/aggregate` call per read manga, so for 1000
entries expect roughly 1000 requests (~5–6 min at 3 req/s) — the run prints an
ETA before it starts.

```bash
# Preview the first 10 without writing anything
npm run import-mangadex -- --user=jorn --limit=10 --dry-run

# Full import with chapter progress and genre tags
npm run import-mangadex -- --user=jorn --progress --tags
```

### Mapping

- **entryId** prefers a list-provider link from MangaDex (`mal` → MAL id, else
  `al` → `a:<id>`, else `kt` → `k:<id>`) so the entry matches what the extension
  generates on the page; manga with no such link fall back to `md:<uuid>`.
- **status** maps MangaDex states to MALSync's: reading/re_reading → reading,
  completed, on_hold, dropped, plan_to_read.
- **score** comes from your MangaDex personal rating (1–10).
- **title / altTitles / image** mirror the Mangadex page adapter (romaji-first
  title, every alternate spelling, the `uploads.mangadex.org` cover).
- Re-running is idempotent — entries upsert on `{owner, userKey, manga, entryId}`.

## Storage

Single collection `syncEntries`. Unique index on
`{ ownerId, userKey, mediaType, entryId }`; secondary index on `aliases` to
speed up alias lookups. API keys live in `apiKeys` (hashed).
