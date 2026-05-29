# AGENTS_CODE_REFERENCE — API & Server

> **Note for AI tools:** Approximate location cues are used instead of exact line numbers. This is intentional.

Scope: `server.js` (~239 lines) — Express app, in-memory jobs, REST + SSE.

Parent overview: [AGENTS_CODE_REFERENCE.md](./AGENTS_CODE_REFERENCE.md)

---

## Server bootstrap

Near the top of `server.js`:

- Imports from `./src/*`
- `PORT = process.env.PORT || 3000`
- `SHOTS_DIR = path.join(__dirname, 'screenshots')`
- `express.json()`, static `public/`, static `/screenshots` → `SHOTS_DIR`

---

## In-memory job store

Below the middleware setup, a module-level `Map` named `jobs` holds all active/completed session jobs (lost on restart).

### Job object shape

| Field | Type | Purpose |
|-------|------|---------|
| `id` | string | Gallery folder id (`hostname_YYYY.MM.DD_HHMM_utc`, optional `_2` suffix) |
| `url` | string | Seed URL |
| `maxLevel` | number | 0–6 |
| `proxy` | string | Optional proxy URL |
| `state` | string | See lifecycle below |
| `listeners` | Set | Active SSE `res` objects |
| `events` | array | Buffered SSE payloads for replay |
| `nodes` | array\|null | Flat crawl result after crawl completes |
| `rootId` | string | Root node id |
| `browser` | Browser\|null | Shared Puppeteer instance |
| `stop` | boolean | Cooperative cancel flag |
| `shots` | array | Screenshot results (after shoot) |
| `createdAt` | number | Timestamp |

### Helper functions (same section)

- **`createJob(opts)`** — allocates id, registers in `jobs`
- **`pushEvent(job, evt)`** — appends to `job.events`, writes to all SSE listeners
- **`closeJobBrowser(job)`** — safe `browser.close()`, nulls reference

---

## REST endpoints

### `GET /api/health`

Calls `checkHealth()` from `src/health.js`. Returns structured `{ ok, puppeteer, chrome, launch, checkedAt }`. 500 on thrown error.

### `GET /api/ip`

Query `?force=1` bypasses 1-hour cache. Calls `getOutboundIp({ force })`. Returns `{ ok, ip, source, provider }` or failure with `tried` mechanisms.

### `GET /api/galleries`

Returns `{ galleries: [...] }` from `listGalleries(SHOTS_DIR)`. Each entry: `{ id, count, hasMeta, createdAt, url }`.

### `GET /api/galleries/:id`

Returns full gallery via `getGallery(SHOTS_DIR, id)` or 404 if invalid/empty.

### `POST /api/crawl`

**Body:** `{ url, level?, proxy? }`

- Validates non-empty `url`
- Clamps `level` to 0–6 (default 2)
- Responds immediately `{ jobId, maxLevel }`
- Background: `state = 'crawling'` → `launchBrowser` → `crawl(...)` with `shouldStop: () => job.stop` and `onProgress: pushEvent`
- On success: `job.nodes`, `job.rootId`, `state = 'crawled'|'stopped'`, emits `crawl:result`
- On failure: `state = 'error'`, `crawl:fatal`, closes browser

### `POST /api/screenshot`

**Body:** `{ jobId, delay? }`

- 404 if unknown job; 409 if crawl not finished (`!job.nodes`)
- Filters pages: `!n.isDuplicate && n.status !== 'error'`
- Responds `{ ok: true, count }` immediately
- Background: `state = 'shooting'`, ensures browser, `writeGalleryMeta`, `screenshotPages(...)`
- Progress events include `baseDir: '/screenshots/<jobId>'`
- `shot:done` also triggers `gallery:updated`
- Finally closes browser; `state = 'done'|'stopped'|'error'`

Default `delayMs`: 2000 (from body `delay`).

### `POST /api/stop`

**Body:** `{ jobId }` — sets `job.stop = true`. Does not kill browser synchronously; loops observe the flag.

---

## SSE: `GET /api/events/:jobId`

Near the end of the routes section:

1. Sets SSE headers (`text/event-stream`, no-cache, keep-alive)
2. Replays all buffered `job.events`
3. Adds `res` to `job.listeners`
4. 15s ping comments (`: ping\n\n`)
5. On client disconnect: removes listener, clears ping interval

**Wire format:** `data: ${JSON.stringify(evt)}\n\n`

---

## SSE event catalog

Events the UI handles (see also `AGENTS_CODE_REFERENCE-ui.md`):

| type | Phase | Key fields |
|------|-------|--------------|
| `crawl:visit` | crawl | `url`, `processed`, `queued`, `id`, `depth` |
| `crawl:error` | crawl | `url`, `error`, `id` |
| `crawl:expanded` | crawl | `id`, `childIds`, `total` |
| `crawl:done` | crawl | `total`, `unique`, `duplicates` |
| `crawl:result` | crawl | `rootId`, `nodes`, `state` |
| `crawl:fatal` | crawl | `error` |
| `crawl:stopped` | crawl | — |
| `shot:start` | shoot | `index`, `total`, `id`, `url` |
| `shot:done` | shoot | `index`, `total`, `id`, `url`, `file`, `ok` |
| `shot:error` | shoot | `index`, `total`, `id`, `url`, `error` |
| `shot:wait` | shoot | `ms`, `next`, `total` |
| `shot:complete` | shoot | `total` |
| `shot:result` | shoot | `results`, `baseDir`, `state` |
| `shot:fatal` | shoot | `error` |
| `shot:stopped` | shoot | `index`, `total` |
| `gallery:updated` | shoot | `jobId` |

---

## Startup health log

At the bottom of `server.js`, after `app.listen`, runs `checkHealth()` and prints OK or fix hint (`npx puppeteer browsers install chrome`).

---

## Extension points

- **New API routes:** add above the startup block; reuse `SHOTS_DIR` and `jobs` patterns.
- **Persist jobs:** would require serializing `nodes` and dropping `browser`/`listeners`; not implemented.
- **Auth/rate limits:** none today; add middleware near top after `express.json()`.
