# Site Scanner

Crawl a website's internal links and capture full-page screenshots using
Puppeteer + Chrome.

## Features

- **Link mapping** — enter a URL and a scan level (default `2`). The crawler maps
  internal links as a tree. Internal links that were already mapped earlier are
  shown **grayed out** (duplicates are not re-crawled or re-screenshotted).
- **Full-page screenshots** — capture every unique page. The page is scrolled to
  the bottom first so lazy-loaded content renders, then a full-height screenshot
  is taken. A configurable **delay between pages** (default `2s`) keeps things
  gentle, and a **live indicator** shows which page is being shot.
- **Proxy support** — set an optional proxy (`http://user:pass@host:port`) used
  for both crawling and screenshots.
- **Health check** — on startup (and on demand in the UI) the app verifies that
  Puppeteer is installed and a Chrome binary can actually launch.

## Requirements

- Node.js 18+
- Chrome (Puppeteer downloads its own Chromium on install; system Chrome can be
  used via `PUPPETEER_EXECUTABLE_PATH`).

## Install

```bash
npm install
```

If Chrome was not downloaded automatically:

```bash
npx puppeteer browsers install chrome
```

## Run

```bash
npm start
```

Open http://localhost:3000.

### Health check from the CLI

```bash
npm run health
```

## How scan levels work

- Level `0` = just the start URL.
- Level `1` = start URL + the links found on it.
- Level `2` (default) = the above + links found on those pages.

Each URL is mapped only once. The first time it is seen it becomes a real
(crawlable, screenshot-able) node; later sightings at deeper levels are marked as
duplicates and grayed out.

## Output

Screenshots are written to `screenshots/<jobId>/` and served at
`/screenshots/<jobId>/`.

## Configuration

| Env var                     | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| `PORT`                      | Server port (default `3000`).             |
| `PUPPETEER_EXECUTABLE_PATH` | Use a specific Chrome/Chromium binary.    |
