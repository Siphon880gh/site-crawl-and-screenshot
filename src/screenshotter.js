'use strict';

const fs = require('fs');
const path = require('path');
const { newPage } = require('./browser');

function sanitizeFilename(url) {
  try {
    const u = new URL(url);
    let name = `${u.host}${u.pathname}`;
    if (u.search) name += u.search;
    name = name.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '');
    if (!name) name = 'page';
    if (name.length > 120) name = name.slice(0, 120);
    return name;
  } catch (_) {
    return 'page';
  }
}

/**
 * Scroll the full height of the page to trigger lazy-loaded content, then
 * return to the top so the full-page screenshot captures everything.
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const step = 400;
      const timer = setInterval(() => {
        const { scrollHeight } = document.body;
        window.scrollBy(0, step);
        total += step;
        if (total >= scrollHeight - window.innerHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 300));
}

/**
 * Take full-page screenshots of the provided pages (already de-duplicated:
 * grayed-out / duplicate nodes are excluded by the caller). A configurable
 * delay is applied between pages. onProgress emits live indicators.
 */
async function screenshotPages({
  pages,
  browser,
  outDir,
  delayMs = 2000,
  onProgress,
  shouldStop,
}) {
  const emit = (evt) => onProgress && onProgress(evt);
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  const total = pages.length;

  for (let i = 0; i < total; i++) {
    if (shouldStop && shouldStop()) {
      emit({ type: 'shot:stopped', index: i, total });
      break;
    }
    const node = pages[i];
    emit({
      type: 'shot:start',
      index: i + 1,
      total,
      id: node.id,
      url: node.url,
    });

    const filename = `${String(i + 1).padStart(3, '0')}_${sanitizeFilename(node.url)}.png`;
    const filePath = path.join(outDir, filename);
    let page;
    try {
      page = await newPage(browser);
      await page.goto(node.url, { waitUntil: 'networkidle2', timeout: 45000 });
      await autoScroll(page);
      await page.screenshot({ path: filePath, fullPage: true });
      const result = {
        id: node.id,
        url: node.url,
        file: filename,
        ok: true,
      };
      results.push(result);
      emit({ type: 'shot:done', index: i + 1, total, ...result });
    } catch (err) {
      const result = { id: node.id, url: node.url, ok: false, error: err.message };
      results.push(result);
      emit({ type: 'shot:error', index: i + 1, total, ...result });
    } finally {
      if (page) await page.close().catch(() => {});
    }

    // Delay between pages (skip after the last one).
    if (i < total - 1 && delayMs > 0) {
      emit({ type: 'shot:wait', ms: delayMs, next: i + 2, total });
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  emit({ type: 'shot:complete', total: results.length });
  return results;
}

module.exports = { screenshotPages, sanitizeFilename };
