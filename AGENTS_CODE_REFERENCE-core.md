# AGENTS_CODE_REFERENCE — Core Modules (`src/`)

> **Note for AI tools:** Approximate location cues are used instead of exact line numbers. This is intentional.

Scope: Puppeteer-backed libraries consumed by `server.js`. No direct HTTP.

Parent overview: [AGENTS_CODE_REFERENCE.md](./AGENTS_CODE_REFERENCE.md)

---

## Module map

| File | Lines | Exports | Used by |
|------|-------|---------|---------|
| `browser.js` | ~72 | `launchBrowser`, `newPage`, `parseProxy` | crawler, screenshotter, server |
| `crawler.js` | ~171 | `crawl`, `normalizeUrl`, `sameSite` | server |
| `screenshotter.js` | ~113 | `screenshotPages`, `sanitizeFilename` | server |
| `galleries.js` | ~95 | `listGalleries`, `getGallery`, `writeGalleryMeta` | server |
| `health.js` | ~103 | `checkHealth` | server, CLI (`npm run health`) |
| `outbound-ip.js` | ~217 | `getOutboundIp` | server |

---

## `browser.js`

### `launchBrowser({ proxy })`

Near the top:

- Args: `--no-sandbox`, `--disable-setuid-sandbox`
- Proxy: `parseProxy()` splits server vs credentials; `--proxy-server=` for host; credentials stored on `browser.__proxyAuth` for `page.authenticate()`
- Executable: `PUPPETEER_EXECUTABLE_PATH` or `puppeteer.executablePath()` if file exists
- Returns headless Puppeteer `Browser`

### `parseProxy(raw)`

Middle of file. Accepts `http://user:pass@host:port` or bare `host:port` (defaults to `http://`).

### `newPage(browser)`

Near the end:

- Applies `browser.__proxyAuth` if set
- Viewport `1366×900`
- Used by crawler and screenshotter for every page visit

---

## `crawler.js`

### URL normalization (`normalizeUrl`)

Near the top:

- Resolves relative URLs against `base`
- http/https only; strips hash; lowercases host; strips leading `www.` for comparison
- Removes trailing slash except root
- Returns canonical string or `null`

### `sameSite(url, rootHost)`

Compares normalized hosts (www-insensitive).

### `crawl({ startUrl, maxLevel, browser, onProgress, shouldStop })`

Main export, bulk of file:

**Algorithm:** BFS over real (non-duplicate) nodes.

1. Create root at depth 0, add to `seen` set and queue
2. While queue non-empty:
   - Check `shouldStop()` → emit `crawl:stopped`, break
   - Dequeue node, emit `crawl:visit`
   - If `node.depth >= maxLevel`: mark `crawled`, skip link extraction
   - Else `extractLinks(browser, node.url)`:
     - On error: `status = 'error'`, emit `crawl:error`
     - On success: for each internal link:
       - If already in `seen`: `makeNode(..., isDuplicate: true)` — not queued
       - Else: real child, queued
   - Emit `crawl:expanded`
3. Emit `crawl:done` stats
4. Return `{ rootId, nodes: flat array }`

**Node fields:** `id`, `url`, `depth`, `parentId`, `isDuplicate`, `children[]`, `status`, optional `error`

### `extractLinks(browser, url)`

Near the end:

- `newPage` → `goto` (`domcontentloaded`, 30s timeout)
- 400ms pause for SPAs
- `page.evaluate` collects `a[href]` → absolute `href` strings
- Always closes page in `finally`

---

## `screenshotter.js`

### `sanitizeFilename(url)`

Near the top — host + path + query, non-alphanumeric → `_`, max 120 chars.

### `autoScroll(page)`

Middle — increments scroll by 400px every 100ms until bottom, scrolls back to top, 300ms pause. Triggers lazy-loaded content before capture.

### `screenshotPages({ pages, browser, outDir, delayMs, onProgress, shouldStop })`

Main loop:

1. `mkdirSync(outDir, { recursive: true })`
2. For each page (index `i`):
   - Stop check → `shot:stopped`
   - Emit `shot:start`
   - Filename: `` `${String(i+1).padStart(3,'0')}_${sanitizeFilename(url)}.png` ``
   - `newPage` → `goto` (`networkidle2`, 45s) → `autoScroll` → `screenshot({ fullPage: true })`
   - Success: `shot:done` with `file`; failure: `shot:error`
   - Close page in `finally`
   - Between pages (not after last): `shot:wait`, then `setTimeout(delayMs)`
3. Emit `shot:complete`, return `results[]`

**Caller responsibility:** pass only unique, non-error nodes (server filters).

---

## `galleries.js`

Filesystem-only; no database.

### `isJobDir(name)`

Regex: `/^[a-f0-9]{12}$/` — matches job ids from server.

### `listGalleries(shotsDir)`

- Scans subdirs of `shotsDir`
- Reads `meta.json` if present (`url`, `jobId`, `startedAt`)
- Counts image files (`.png`, `.jpg`, `.jpeg`, `.webp`)
- Includes dirs with images OR meta (partial runs after Stop)
- Sorted newest `createdAt` first

### `getGallery(shotsDir, id)`

Returns `{ id, baseDir, url, startedAt, images: [{ file, url, mtime, size }] }` or `null`.

### `writeGalleryMeta(outDir, { url, jobId })`

Writes `meta.json` at screenshot phase start (before first PNG).

---

## `health.js`

### `checkHealth()`

Returns report object (never throws to caller):

1. **puppeteer** — require module, read version from package.json
2. **chrome** — resolve executable path, check `fs.existsSync`
3. **launch** — actually launch headless Chrome, read `browser.version()`
4. **`ok`** — all three sub-checks pass

Runnable standalone: when `require.main === module`, prints JSON and exits 0/1.

---

## `outbound-ip.js`

### `getOutboundIp({ force })`

Resolves scanner egress IPv4 for Cloudflare whitelisting UI.

**Cache:** 1 hour in module-level `cached` (bypass with `force: true`).

**Priority order:**

1. `OUTBOUND_IP` or `SERVER_IP` env override
2. Native `fetch` against HTTPS providers (ipify, icanhazip, AWS, ifconfig.me, ipinfo)
3. Node `http`/`https` modules (HTTPS then HTTP providers)
4. `curl -4` subprocess
5. Puppeteer page navigation to same providers

Returns `{ ok, ip, source, provider }` or `{ ok: false, error, tried, attempts }`.

**Providers** listed near top as `PROVIDERS_HTTPS` / `PROVIDERS_HTTP`.

---

## Cross-module dependencies

```
server.js
  → browser.launchBrowser
  → crawler.crawl
  → screenshotter.screenshotPages
  → galleries.*
  → health.checkHealth
  → outbound-ip.getOutboundIp

crawler.js ──→ browser.newPage
screenshotter.js ──→ browser.newPage
outbound-ip.js ──→ puppeteer (standalone launch for IP probe)
health.js ──→ puppeteer (standalone launch for health)
```

---

## Modification guidelines

1. **Changing `normalizeUrl`** affects deduplication site-wide — update tests manually; UI duplicate display depends on `isDuplicate`.
2. **Crawl depth** is controlled by server clamping `maxLevel` 0–6; crawler trusts passed value.
3. **Screenshot timing** — `networkidle2` can hang on chatty sites; timeout is 45s per page.
4. **Proxy credentials** must use `parseProxy` + `page.authenticate`; never pass user:pass in `--proxy-server`.
5. **Gallery IDs** must remain 12 hex chars to match `isJobDir` validation.
