# Site Crawl and Screenshot

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
- Puppeteer's Chrome binary (downloaded separately if missing — see
  [Installing Chrome for Puppeteer](#installing-chrome-for-puppeteer-when-missing))
- Optional: point at system Chrome with `PUPPETEER_EXECUTABLE_PATH`

## Getting started

Install and run the app:

```bash
npm install
npm start
```

Open http://localhost:3000.

Check the **environment** pill in the header (see next section). If it is green,
you are ready to scan. If it is red, Puppeteer or Chrome still needs setup —
follow [Installing Chrome for Puppeteer](#installing-chrome-for-puppeteer-when-missing).

## Environment check (header)

The pill in the top bar shows whether the server can run scans. It updates on
load and when you click **Recheck**.

| Indicator | Meaning |
| --------- | ------- |
| Amber pulsing dot · `Checking environment…` | Health request in progress |
| Green dot · `Puppeteer v24.x · HeadlessChrome/…` (or similar) | Ready — Puppeteer is installed and Chrome launched successfully |
| Red dot · error message | Not ready — fix Puppeteer/Chrome before mapping links or taking screenshots |

Typical red-dot messages:

- **`Puppeteer is not installed: … Run "npm install".`** — dependencies missing; run `npm install` in the project directory.
- **`Chrome executable not found at "…". Run "npx puppeteer browsers install chrome".`** — Puppeteer is present but its Chrome binary was never downloaded (or the cache path is wrong for the user running the app).
- **`Could not resolve Chrome executable: …`** — Puppeteer cannot determine where Chrome should live (often a broken or partial install).
- **`Failed to launch Chrome: …`** — binary exists but cannot start (common on Linux when OS libraries are missing — see [Installing Chrome for Puppeteer](#installing-chrome-for-puppeteer-when-missing)).
- **`Environment not ready`** — generic fallback when the check fails without a specific message.
- **`Health check failed`** — the browser could not reach `/api/health` (server down or network error).

The same check runs in the terminal when you start the server (`npm start`) and via `npm run health`.

### Health check from the CLI

```bash
npm run health
```

Prints a JSON report with the same pass/fail details as the header.

## Installing Chrome for Puppeteer (when missing)

`npm install` pulls in the **Puppeteer npm package** but does not always download
the **Chrome browser binary** Puppeteer drives. You only need this section if the
header environment check is red (or `npm run health` reports failure).

Download Chrome for Puppeteer:

```bash
npx puppeteer browsers install chrome
```

On **Linux servers**, Chrome also needs system libraries. Install the browser and
OS dependencies together:

```bash
npx puppeteer browsers install chrome --install-deps
```

(`--install-deps` uses `apt` on Debian/Ubuntu; run with sufficient privileges
if packages are installed system-wide.)

### Linux server (app runs as root)

If Node runs as **root** (common on shared hosting), Puppeteer stores Chrome
under `/root/.cache/puppeteer`. Create the cache directory first, then install
as the same user that runs the app:

```bash
sudo mkdir -p /root/.cache/puppeteer
sudo chown -R root:root /root/.cache/puppeteer

cd /path/to/site-crawl-and-screenshot
sudo -H npx puppeteer browsers install chrome --install-deps
```

Verify the binary exists:

```bash
sudo find /root/.cache/puppeteer -type f -name "chrome" | head
```

Reload the app and click **Recheck** — the header should turn green.

### Linux server (app runs as a non-root user)

Run `npx puppeteer browsers install chrome --install-deps` as that user (no
`sudo` on the install command unless `--install-deps` needs it). Chrome is cached
under that user's home, e.g. `~/.cache/puppeteer`.

### macOS / local dev

After `npm install`, usually:

```bash
npx puppeteer browsers install chrome
```

No `--install-deps` needed on macOS.

## How scan levels work

- Level `0` = just the start URL.
- Level `1` = start URL + the links found on it.
- Level `2` (default) = the above + links found on those pages.

Each URL is mapped only once. The first time it is seen it becomes a real
(crawlable, screenshot-able) node; later sightings at deeper levels are marked as
duplicates and grayed out.

## Output

Screenshots are written to `screenshots/<hostname>_<YYYY.MM.DD>_<HHMM>_utc/` (UTC
timestamp at crawl start; `_2` suffix if that folder already exists) and served at
`/screenshots/<jobId>/`.

## Configuration

| Env var                     | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| `PORT`                      | Server port (default `3000`).             |
| `PUPPETEER_EXECUTABLE_PATH` | Use a specific Chrome/Chromium binary.    |
