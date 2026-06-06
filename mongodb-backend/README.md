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

## Storage

Single collection `syncEntries`. Unique index on
`{ ownerId, userKey, mediaType, entryId }`; secondary index on `aliases` to
speed up alias lookups. API keys live in `apiKeys` (hashed).
