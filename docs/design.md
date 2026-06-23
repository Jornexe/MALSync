# MAL-Sync Design Doc

## Overview
MAL-Sync is a browser extension and userscript that syncs anime/manga progress across multiple list providers (MyAnimeList, AniList, Kitsu, Simkl) and many streaming/reading sites. It injects content scripts into supported pages, detects the current title and episode/chapter, and updates the user’s list with minimal friction. A local IndexedDB cache speeds lookups. This fork adds an optional self-hosted sync mode powered by SpaceTimeDB.

## Goals
- Track watch/read progress automatically on supported sites.
- Sync progress with multiple list providers.
- Offer a usable UI on supported sites (overlay widgets, progress controls).
- Provide offline-friendly cache for list lookup and matching.
- Optional self-hosted sync mode via SpaceTimeDB.

## Non-Goals
- Provide a full replacement for list provider UIs.
- Guarantee perfect matching for all titles and variants without manual correction.
- Support server-side rendering or a standalone web app.

## System Context
- Runs in a browser as an extension or userscript.
- Integrates with external list APIs (MAL, AniList, Kitsu, Simkl).
- Integrates with hundreds of third-party streaming/reading sites.
- Optional: connects to a SpaceTimeDB instance for self-hosted list sync.

## High-Level Architecture
- **Content scripts** detect pages, inject UI, and gather playback/reading signals.
- **Background scripts** handle privileged operations (requests, storage, notifications).
- **Provider adapters** map external list APIs to a shared interface.
- **Site/page adapters** map streaming/reading pages to a shared content model.
- **UI surfaces** include overlay widgets, popup, and minimal windows.
- **Local cache** uses IndexedDB via Dexie for fast list lookups.
- **SpaceTimeDB module** (optional) stores and dedupes entries for self-hosted sync.

## Key Components

### Entry Points
- Content entry initializes per site, dispatching to the correct page adapter or provider integration.
- Background entry handles messaging, API requests, storage, and notifications.

### Content Script Runtime
- Determines which site it is on.
- Instantiates the correct site/page adapter.
- Creates the sync UI and listens for playback/reading updates.
- Triggers sync updates and sends messages to background.

### Background Runtime
- Provides a single message handler for content and background callers.
- Performs network requests with retry/backoff for rate limits.
- Manages IndexedDB caching and list refreshes.
- Displays user notifications.

### Provider Layer
- Per-provider classes encapsulate API auth, data formats, and update calls.
- Shared list and metadata factories normalize provider data.

### Page/Site Adapters
- Each supported site maps its DOM to a normalized media model.
- Adapters provide episode/chapter detection, title detection, and player hooks.

### Local Cache (IndexedDB)
- Dexie-based database stores entries for quick lookup and matching.
- Periodically refreshes from the selected list provider.

### SpaceTimeDB Module (Optional)
- Stores user entries in a shared database for cross-device sync.
- Provides reducers to upsert and delete entries.
- Applies title-deduping logic on the server to reduce duplicates.

## Data Model

### Local Cache Entry
- `uid`, `type`, `title`, `malId`, `cacheKey`, `image`, `score`, `status`, `watchedEp`, `totalEp`, `url`

### SpaceTimeDB `sync_entry`
- `id`, `entryId`, `ownerId`, `userKey`, `mediaType`, `sourceUrl`, `title`, `altTitles`, `image`, `tags`, `streamingUrl`, `progress`, `volumeProgress`, `score`, `status`, `updatedAt`, `aliases`

## Data Flow

### Typical Sync Flow (Extension/Userscript)
1. Content script detects the current page and media context.
2. Page adapter extracts title, episode/chapter, and player state.
3. Content script sends a message to background for API calls or cache access.
4. Background updates the list provider and cache.
5. UI updates to reflect new sync state.

### Local Cache Refresh
1. Background schedules periodic list refreshes.
2. Selected provider fetches the full list.
3. Cache is replaced in a single bulk update.

### SpaceTimeDB Sync Flow (Optional)
1. Client calls `upsert_entry` with normalized entry data.
2. Server reducer merges entries by ID, alias, or title overlap.
3. Client subscribes to table updates to render sync state.

## Matching and Deduplication
- Title matching uses normalized keys and a strong containment heuristic.
- Alias lists are maintained to preserve previous IDs and reduce duplicates.
- Title merge strictness is configurable (off/exact/fuzzy).

## Security and Privacy
- Content scripts operate only on supported pages.
- OAuth flows are confined to specific callback routes.
- Requests to MALSync services include version/type headers for telemetry and rate-limiting.
- SpaceTimeDB uses authenticated sender identity for ownership.

## Build and Release
- WebExtension build uses webpack with separate content/background pipelines.
- Userscript build reuses the content build pipeline.
- Tests include TypeScript unit tests and headless browser tests.

## Operational Notes
- SpaceTimeDB module lives in [spacetimedb/src](spacetimedb/src).
- Local database logic is in [src/background/database.ts](src/background/database.ts).
- Content entry point is [src/index.ts](src/index.ts).

## Open Questions
- Clarify the primary audience for the doc if it should target external integrators.
- Confirm whether SpaceTimeDB maincloud support should be documented or excluded.
