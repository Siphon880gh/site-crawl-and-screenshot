'use strict';

const { newPage } = require('./browser');

/**
 * Normalize a URL for de-duplication:
 *  - drop the hash fragment
 *  - strip a leading "www." from the host for comparison purposes
 *  - remove a trailing slash (except for the root path)
 * Returns null for non-http(s) URLs.
 */
function normalizeUrl(rawUrl, base) {
  let u;
  try {
    u = new URL(rawUrl, base);
  } catch (_) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  let host = u.host.toLowerCase().replace(/^www\./, '');
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const search = u.search || '';
  return `${u.protocol}//${host}${path}${search}`;
}

function sameSite(url, rootHost) {
  try {
    const host = new URL(url).host.toLowerCase().replace(/^www\./, '');
    return host === rootHost;
  } catch (_) {
    return false;
  }
}

/** Non-page assets (video, audio, images, fonts, archives, …) — not crawled or screenshotted. */
const ASSET_EXT_RE =
  /\.(mp4|mov|webm|avi|mkv|m4v|ogv|wmv|flv|3gp|mp3|wav|ogg|oga|m4a|aac|flac|wma|opus|aiff|mid|midi|jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff|tif|avif|heic|heif|pdf|zip|rar|7z|tar|gz|woff2?|ttf|eot|otf)$/i;

function isAssetUrl(url) {
  try {
    return ASSET_EXT_RE.test(new URL(url).pathname);
  } catch (_) {
    return false;
  }
}

/**
 * BFS crawl of internal links up to maxLevel.
 *
 * Level semantics: the start URL is level 0. Pages at level < maxLevel have
 * their links extracted; links discovered land at parent level + 1 (up to
 * maxLevel). A URL seen for the first time becomes a real node; any later
 * sighting becomes a `duplicate` node (grayed out, not crawled, not shot).
 *
 * onProgress receives { type, ... } events for live UI updates.
 * Returns { nodes, tree } where nodes is a flat list keyed by id.
 */
async function crawl({ startUrl, maxLevel = 2, browser, onProgress, shouldStop }) {
  const emit = (evt) => onProgress && onProgress(evt);

  const normalizedStart = normalizeUrl(startUrl);
  if (!normalizedStart) {
    throw new Error(`Invalid start URL: ${startUrl}`);
  }
  const rootHost = new URL(normalizedStart).host.toLowerCase().replace(/^www\./, '');

  const seen = new Set(); // canonical urls that already have a real node
  const nodes = new Map(); // id -> node
  let idCounter = 0;

  const makeNode = (url, depth, parentId, isDuplicate, isSkipped = false) => {
    const id = `n${idCounter++}`;
    const node = {
      id,
      url,
      depth,
      parentId,
      isDuplicate: !!isDuplicate,
      isSkipped: !!isSkipped,
      children: [],
      status: isSkipped ? 'skipped' : 'pending', // pending | crawled | error | skipped
    };
    nodes.set(id, node);
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId).children.push(id);
    }
    return node;
  };

  const root = makeNode(normalizedStart, 0, null, false);
  seen.add(normalizedStart);

  // BFS queue of real nodes to crawl.
  const queue = [root];
  let processed = 0;

  while (queue.length) {
    if (shouldStop && shouldStop()) {
      emit({ type: 'crawl:stopped' });
      break;
    }
    const node = queue.shift();
    processed += 1;
    emit({
      type: 'crawl:visit',
      id: node.id,
      url: node.url,
      depth: node.depth,
      processed,
      queued: queue.length,
    });

    // Only extract links if we haven't hit the depth limit.
    if (node.depth >= maxLevel) {
      node.status = 'crawled';
      continue;
    }

    let links = [];
    try {
      links = await extractLinks(browser, node.url);
      node.status = 'crawled';
    } catch (err) {
      node.status = 'error';
      node.error = err.message;
      emit({ type: 'crawl:error', id: node.id, url: node.url, error: err.message });
      continue;
    }

    const childDepth = node.depth + 1;
    const localSeen = new Set();
    for (const link of links) {
      const norm = normalizeUrl(link, node.url);
      if (!norm) continue;
      if (!sameSite(norm, rootHost)) continue; // internal only
      if (localSeen.has(norm)) continue; // dedupe within a single page
      localSeen.add(norm);

      if (isAssetUrl(norm)) {
        // Media / file links — grayed out, not crawled or screenshotted.
        if (seen.has(norm)) {
          makeNode(norm, childDepth, node.id, true);
        } else {
          seen.add(norm);
          makeNode(norm, childDepth, node.id, false, true);
        }
        continue;
      }

      if (seen.has(norm)) {
        // Already mapped elsewhere -> duplicate / grayed out leaf.
        makeNode(norm, childDepth, node.id, true);
      } else {
        seen.add(norm);
        const child = makeNode(norm, childDepth, node.id, false);
        queue.push(child);
      }
    }
    emit({
      type: 'crawl:expanded',
      id: node.id,
      childIds: node.children,
      total: nodes.size,
    });
  }

  const flat = Array.from(nodes.values());
  emit({
    type: 'crawl:done',
    total: flat.length,
    unique: flat.filter((n) => !n.isDuplicate && !n.isSkipped).length,
    duplicates: flat.filter((n) => n.isDuplicate).length,
    skipped: flat.filter((n) => n.isSkipped).length,
  });

  return { rootId: root.id, nodes: flat };
}

async function extractLinks(browser, url) {
  const page = await newPage(browser);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Give SPA routers a brief moment to render anchors.
    await new Promise((r) => setTimeout(r, 400));
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => a.href)
    );
    return hrefs;
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { crawl, normalizeUrl, sameSite, isAssetUrl };
