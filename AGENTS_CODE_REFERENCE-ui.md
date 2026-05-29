# AGENTS_CODE_REFERENCE — UI (Frontend)

> **Note for AI tools:** Approximate location cues are used instead of exact line numbers. This is intentional.

Scope: `public/` — static HTML, CSS, vanilla JS. No bundler or framework.

Parent overview: [AGENTS_CODE_REFERENCE.md](./AGENTS_CODE_REFERENCE.md)

---

## Pages

| File | Lines | Role |
|------|-------|------|
| `index.html` | ~122 | Main app: scan controls, link tree, gallery |
| `credits.html` | ~63 | Author bio, links; nav back to `/` |
| `style.css` | ~490 | Shared dark theme (CSS variables in `:root`) |
| `app.js` | ~530 | All client logic (loaded only on index) |

Branding: **Site Crawl and Screenshot** (rebrand commit `b95396e`). Logo character `◎` in header.

---

## `index.html` structure

Top to bottom:

1. **Header** — brand, health widget (`#health`, `#recheck`), nav link to `/credits.html`
2. **Controls panel** — URL, scan level (0–6), shot delay (ms), optional proxy
3. **IP tip** (`#ipTip`) — outbound IP display + Cloudflare WAF whitelist guidance
4. **Actions** — Map links / Screenshot pages / Stop
5. **Stats** — total / unique / duplicates (hidden until crawl completes)
6. **Progress bar** — label + fill width
7. **Results** — link map tree (`#tree`), screenshot gallery selector + grid (`#galleryViewMode`, `#galleryToggleAll`)
8. **Footer** — link to credits, Weng Industries

Element IDs are the contract with `app.js`; preserve them when editing markup.

---

## `app.js` architecture

Single `'use strict'` IIFE-style file with sections marked by comment banners.

### Global state object (near top)

```javascript
const state = {
  jobId: null,
  source: null,           // EventSource
  nodes: [],
  nodeById: new Map(),
  expectedShots: 0,
  viewingGalleryId: null,
  galleries: [],
  expandedGalleryByFolder: new Map(), // persists expand/collapse per folder (full view)
  galleryViewModeByFolder: new Map(), // 'full' | 'thumbnails' per folder
  galleryImagesByFolder: new Map(),   // cached image list for re-render on view toggle
};
```

Helper `$ = (id) => document.getElementById(id)`.

---

## Feature areas in `app.js`

### Outbound IP (top section)

- `loadOutboundIp(force)` → `GET /api/ip` or `?force=1`
- Updates `#outboundIp`, copy button, tip text (Cloudflare guidance or error + `OUTBOUND_IP` hint)
- `copyOutboundIp()` uses clipboard API

### Gallery (below IP section)

- `loadGalleries(selectId?)` → `GET /api/galleries`, populates `#gallerySelect`
- `openGallery(id)` → `GET /api/galleries/:id`, caches images in `state.galleryImagesByFolder`, calls `renderGalleryRows`
- **View modes** (per folder, `#galleryViewMode` button):
  - **`full`** (default): vertical stack of collapsible `<details>` rows (`.gallery-row`) with full-width screenshots; **Expand all** / **Collapse all** via `#galleryToggleAll`
  - **`thumbnails`**: responsive grid (`.gallery-thumbs` / `.gallery-thumb`) of small previews; click opens full PNG in a new tab; **Expand all** hidden
- `toggleGalleryViewMode()` flips mode in `state.galleryViewModeByFolder` and re-renders from cache
- `renderGalleryFullStack`, `renderGalleryThumbnails`, `updateGalleryViewModeButton`, `toggleAllGallery`, `updateGalleryToggleButton`
- Expand/collapse state (full mode only) in `state.expandedGalleryByFolder`
- Live refresh on SSE `gallery:updated` and after `shot:result` (preserves view mode for that folder)

### Health (middle section)

- `loadHealth()` → `GET /api/health`, toggles `.health--ok|bad|unknown` on `#health`

### Link tree rendering (middle section)

- `renderTree(nodes, rootId)` — builds nested `.node` divs from flat `nodes` + `children` id refs
- `renderNode(node)` — badge (`L{n}` or `dup`), link; **unique nodes only** get an empty `.badge.shot` placeholder
- Duplicate nodes get class `dup` (gray styling in CSS); no shot badge and no green shot indicator
- `clearDupShotUi(url, exceptId)` — strips `.active` / `.shot-done` / `.shot-error` from duplicate rows sharing a URL (safety net)

### Progress UI

- `setProgress(label, pct?)` — shows `#progress`, sets label and optional bar width %

### SSE (middle section)

- `openStream(jobId)` — `EventSource('/api/events/' + jobId)`, parses JSON in `onmessage`
- `handleEvent(evt)` — large `switch (evt.type)` updating tree, progress, gallery, buttons

Important UI reactions:

| Event | UI behavior |
|-------|-------------|
| `crawl:visit` | Progress text with queue counts |
| `crawl:result` | `renderTree`, `updateStats`, `finishCrawl` |
| `crawl:fatal` | Error progress, `resetButtons` |
| `shot:start` | Unique nodes only: `.active`, badge `📷 shooting`, scroll into view; `clearDupShotUi` |
| `shot:done` | Unique nodes only: `.shot-done`, badge `✓ shot`; `clearDupShotUi` |
| `shot:error` | Unique nodes only: `.shot-error`, badge `✗ failed`; `clearDupShotUi` |
| `gallery:updated` | Refresh gallery list; re-open if viewing same job |
| `shot:result` | Complete progress, `resetButtons`, refresh galleries |

### Button state helpers (lower section)

- `busy(isBusy, phase)` — disables scan during work; stop enabled when busy
- `finishCrawl()` — enables screenshot if unique nodes exist
- `resetButtons()` — idle state after completion/error

### User actions (lower section)

- `ensureUrlScheme(raw)` — if the URL has no `http://` or `https://` prefix, prepends `https://` (mirrors server helper)
- `startScan()` → normalizes `#url`, writes it back to the input, then `POST /api/crawl`, stores `state.jobId`, opens SSE
- `startShots()` → `POST /api/screenshot` with delay from `#delay`
- `stopJob()` → `POST /api/stop`

### Initialization (end of file)

Event listeners wired; on load: `loadHealth()`, `loadOutboundIp()`, `loadGalleries()`.

---

## `style.css` conventions

Near the top: CSS custom properties (`--bg`, `--panel`, `--accent`, `--dup`, `--ok`, `--danger`, …).

Key class groups:

- **Layout:** `.topbar`, `.layout`, `.panel`, `.controls`, `.results`
- **Tree:** `.node`, `.node.dup`, `.node.active`, `.node.shot-done`, `.badge`, `.badge.shot`, `.node-children`
- **Dup + shot:** `.node.dup .badge.shot` forced `display: none` (shot indicators only on unique rows)
- **Gallery:** `.gallery-bar`, `.gallery-row` (`<details>`), `.gallery-list`, `.gallery-list--thumbnails`, `.gallery-thumbs`, `.gallery-thumb`
- **IP tip:** `.ip-tip`, `.ip-tip--bad`
- **Credits page:** `.credits-page`, `.credits-card`, `.credit-link` (used by `credits.html`)

Sticky header with backdrop blur. No responsive framework — flex/grid used ad hoc.

---

## `credits.html`

Standalone page sharing `style.css`. No `app.js`. Added in commit `1df6a9b`:

- Author block with `/me.jpeg`
- External links: wengindustries.com, LinkedIn, GitHub
- Back nav to `/`

---

## UI modification guidelines

1. **Event types are the API contract** — server and `handleEvent()` must stay aligned.
2. **No framework** — keep DOM APIs consistent; avoid introducing build tooling without explicit request.
3. **Gallery UI state** (expand/collapse and full vs thumbnails view) is per-folder in memory only (not persisted).
4. **Enter key** on URL field triggers scan (`keydown` listener at bottom of `app.js`).
5. **Screenshot button** stays disabled until crawl yields at least one non-duplicate node.
6. **Shot indicators** — only unique (non-`dup`) tree rows; duplicates must stay gray with no shot badge.
