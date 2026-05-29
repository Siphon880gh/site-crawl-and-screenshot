# AGENTS_CODE_REFERENCE

> **Note for AI tools:** This documentation uses **approximate location cues** (e.g. “near the top of the file”, “below function `X`”) instead of exact line numbers. Line numbers drift with edits; approximate references are intentional and sufficient for navigation.

AI-oriented codebase map for safe modification, feature tracing, and implementation planning.

**Companion files (load only when needed):**

| File | Scope |
|------|--------|
| [AGENTS_CODE_REFERENCE-api.md](./AGENTS_CODE_REFERENCE-api.md) | Express server, in-memory jobs, REST + SSE endpoints |
| [AGENTS_CODE_REFERENCE-ui.md](./AGENTS_CODE_REFERENCE-ui.md) | Static frontend (`public/`) |
| [AGENTS_CODE_REFERENCE-core.md](./AGENTS_CODE_REFERENCE-core.md) | Puppeteer modules in `src/` |

> Refer to **AGENTS_CODE_REFERENCE.md** for high-level context; details are in feature context files.

---

## What the app does

**Site Crawl and Screenshot** — a local web app that:

1. **Maps internal links** from a seed URL up to a configurable depth (scan level 0–6, default 2).
2. **Captures full-page PNG screenshots** of every unique (non-duplicate) page.
3. **Streams live progress** to the browser via Server-Sent Events (SSE).
4. **Persists galleries** under `screenshots/<jobId>/` with optional `meta.json`.
5. **Surfaces operational helpers**: Puppeteer/Chrome health check, outbound IP detection (for Cloudflare WAF whitelisting), optional HTTP proxy.

Duplicate links (same canonical URL seen again deeper in the tree) are shown grayed out and are **not** re-crawled or re-screenshotted.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| HTTP | Express 4 |
| Browser automation | Puppeteer 24 + Chrome/Chromium |
| Frontend | Vanilla HTML/CSS/JS (no build step) |
| Persistence | Filesystem only (`screenshots/`); jobs are in-memory |

**npm scripts:** `npm start` → `node server.js`; `npm run health` → `node src/health.js`

---

## Architecture

```
Browser UI (public/)
    │  REST: /api/crawl, /api/screenshot, /api/stop, /api/galleries, …
    │  SSE:  /api/events/:jobId
    ▼
server.js
    │  in-memory Map of jobs (id, state, nodes, browser, events, listeners)
    ├── src/crawler.js      → BFS link discovery via Puppeteer
    ├── src/screenshotter.js → scroll + full-page PNG capture
    ├── src/browser.js      → launch Chrome, proxy auth, newPage()
    ├── src/galleries.js    → list/read screenshot folders on disk
    ├── src/health.js       → Puppeteer + Chrome launch probe
    └── src/outbound-ip.js  → resolve scanner egress IPv4
    ▼
screenshots/<12-hex-job-id>/   (served at /screenshots/…)
```

**Job lifecycle states:** `created` → `crawling` → `crawled` → `shooting` → `done` | `error` | `stopped`

One Puppeteer browser instance is reused per job across crawl and screenshot phases when possible; closed after screenshots finish or on crawl fatal error.

---

## File tree (relevant files)

```
ss/
├── server.js                 (~239 lines) Entry point, routes, job store, SSE
├── package.json
├── README.md                 User-facing docs (not AI-specific)
├── AGENTS_CODE_REFERENCE*.md This documentation set
├── public/
│   ├── index.html            (~121) Main scan UI
│   ├── credits.html          (~63)  Author/credits page
│   ├── app.js                (~502) Client logic, SSE, gallery UI
│   ├── style.css             (~446) Dark theme styles
│   └── me.jpeg               Avatar on credits page
├── src/
│   ├── browser.js            (~72)  launchBrowser, newPage, parseProxy
│   ├── crawler.js            (~171) BFS crawl, normalizeUrl, extractLinks
│   ├── screenshotter.js      (~113) autoScroll, screenshotPages
│   ├── galleries.js          (~95)  listGalleries, getGallery, writeGalleryMeta
│   ├── health.js             (~103) checkHealth (+ CLI when run directly)
│   └── outbound-ip.js        (~217) getOutboundIp (multi-mechanism fallback)
└── screenshots/              Runtime output (gitignored except .gitkeep)
```

---

## High-level code flow

### 1. Startup

Near the end of `server.js`, Express listens on `PORT` (default 3000), serves `public/` and `/screenshots/`, then runs `checkHealth()` and logs Puppeteer/Chrome status.

### 2. Map links (crawl)

```
User clicks "Map links"
  → POST /api/crawl { url, level, proxy }
  → createJob() assigns 12-char hex id
  → async: launchBrowser → crawl() BFS
  → SSE events: crawl:visit, crawl:error, crawl:result, …
  → job.nodes populated; state → crawled | stopped | error
```

Crawl semantics: start URL is depth 0; pages with `depth < maxLevel` have `<a href>` extracted; internal same-site links only; first sighting = real node, later = `isDuplicate: true`.

### 3. Screenshot pages

```
User clicks "Screenshot pages"
  → POST /api/screenshot { jobId, delay }
  → filters job.nodes: !isDuplicate && status !== 'error'
  → writeGalleryMeta → screenshotPages()
  → SSE: shot:start, shot:done, shot:wait, gallery:updated, shot:result
  → PNGs in screenshots/<jobId>/ as 001_host_path.png
```

Each page: `networkidle2` load → autoScroll (lazy content) → full-page screenshot → configurable delay before next.

### 4. Gallery browsing

Independent of active jobs: `GET /api/galleries` lists past runs; `GET /api/galleries/:id` returns image metadata. UI can refresh during an active shoot via `gallery:updated` SSE events.

### 5. Stop

`POST /api/stop { jobId }` sets `job.stop = true`; crawl and screenshot loops poll `shouldStop()` and exit gracefully with partial results saved.

---

## Configuration (environment)

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `3000`) |
| `PUPPETEER_EXECUTABLE_PATH` | Override Chrome binary |
| `OUTBOUND_IP` / `SERVER_IP` | Force displayed scanner IP |
| Proxy | Passed per-request in UI/API body, not env |

---

## Recent changes (git)

| Commit | Summary |
|--------|---------|
| `c1dcaa0` Initial | Full app: crawl, screenshot, gallery, health, outbound IP |
| `1df6a9b` Added credits | `public/credits.html`, footer/nav links, credits styles |
| `b95396e` Rebrand | Renamed to **Site Crawl and Screenshot** (package, UI copy, server log) |

---

## Safe modification guidelines

1. **Do not persist jobs** — restarting the server loses in-memory job state; only screenshot files survive.
2. **Preserve SSE event shapes** — `public/app.js` `handleEvent()` switches on `evt.type`; adding types is safe; renaming breaks the UI.
3. **Job IDs = gallery folder names** — 12 hex chars from `crypto.randomBytes(6)`; `galleries.js` validates with `/^[a-f0-9]{12}$/`.
4. **Duplicate nodes** — never pass `isDuplicate` pages to `screenshotPages`; crawler marks them, server filters them.
5. **Browser lifecycle** — crawl errors close the browser; screenshot phase re-launches if needed; always closed in screenshot `finally`.
6. **No auth** — app assumes trusted local/single-user use; do not expose publicly without adding protection.

---

## Key snippets (entry points)

Job creation and state (near top of `server.js`, below static middleware):

```javascript
function createJob(opts) {
  const id = crypto.randomBytes(6).toString('hex');
  const job = {
    id, ...opts,
    state: 'created',
    listeners: new Set(),
    events: [],
    nodes: null, browser: null, stop: false,
  };
  jobs.set(id, job);
  return job;
}
```

Crawl POST handler (middle of `server.js`, in the routes section):

```javascript
app.post('/api/crawl', async (req, res) => {
  const { url, level, proxy } = req.body || {};
  const maxLevel = Number.isFinite(+level) ? Math.max(0, Math.min(6, +level)) : 2;
  const job = createJob({ url: String(url).trim(), maxLevel, proxy: proxy || '' });
  res.json({ jobId: job.id, maxLevel });
  // async crawl…
});
```

Node shape from crawler (middle of `src/crawler.js`):

```javascript
const node = {
  id, url, depth, parentId,
  isDuplicate: !!isDuplicate,
  children: [],
  status: 'pending', // pending | crawled | error | skipped
};
```
