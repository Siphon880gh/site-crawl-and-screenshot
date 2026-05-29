'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** e.g. mixotype.com_2026.05.29_0300_utc or …_utc_2 when colliding */
const GALLERY_ID_RE =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?_\d{4}\.\d{2}\.\d{2}_\d{4}_utc(?:_\d+)?$/;

function isJobDir(name) {
  return GALLERY_ID_RE.test(name);
}

function hostnameFromUrl(url) {
  return new URL(url).hostname.toLowerCase();
}

function utcTimestampSuffix(date = new Date()) {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  return `_${y}.${mo}.${day}_${h}${mi}_utc`;
}

/**
 * Gallery folder id: <hostname>_<YYYY.MM.DD>_<HHMM>_utc
 * Appends _2, _3, … if that folder already exists under shotsDir.
 */
function buildGalleryId(url, shotsDir) {
  const host = hostnameFromUrl(url).replace(/[^a-z0-9.-]+/g, '_');
  const base = `${host}${utcTimestampSuffix()}`;
  if (!shotsDir || !fs.existsSync(shotsDir)) return base;

  let id = base;
  let n = 2;
  while (fs.existsSync(path.join(shotsDir, id))) {
    id = `${base}_${n}`;
    n += 1;
  }
  return id;
}

function readMeta(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'meta.json'), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function listImages(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => {
      const filePath = path.join(dir, e.name);
      const stat = fs.statSync(filePath);
      return { file: e.name, mtime: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => a.file.localeCompare(b.file, undefined, { numeric: true }));
}

/**
 * List screenshot job folders on disk (includes partial runs after Stop).
 */
function listGalleries(shotsDir) {
  if (!fs.existsSync(shotsDir)) return [];

  return fs
    .readdirSync(shotsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isJobDir(e.name))
    .map((e) => {
      const dir = path.join(shotsDir, e.name);
      const images = listImages(dir);
      const meta = readMeta(dir);
      const stat = fs.statSync(dir);
      return {
        id: e.name,
        count: images.length,
        hasMeta: !!meta,
        createdAt: meta?.startedAt || stat.birthtimeMs || stat.mtimeMs,
        url: meta?.url || null,
      };
    })
    .filter((g) => g.count > 0 || g.hasMeta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getGallery(shotsDir, id) {
  if (!isJobDir(id)) return null;
  const dir = path.join(shotsDir, id);
  if (!fs.existsSync(dir)) return null;

  const images = listImages(dir);
  const meta = readMeta(dir);
  if (!images.length && !meta) return null;

  return {
    id,
    baseDir: `/screenshots/${id}`,
    url: meta?.url || null,
    startedAt: meta?.startedAt || null,
    images: images.map((img) => ({
      file: img.file,
      url: `/screenshots/${id}/${img.file}`,
      mtime: img.mtime,
      size: img.size,
    })),
  };
}

function writeGalleryMeta(outDir, { url, jobId }) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify({ url, jobId, startedAt: Date.now() }, null, 2)
  );
}

module.exports = {
  listGalleries,
  getGallery,
  writeGalleryMeta,
  buildGalleryId,
  isJobDir,
};
