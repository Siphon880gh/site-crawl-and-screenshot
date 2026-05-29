'use strict';

const fs = require('fs');
const path = require('path');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function isJobDir(name) {
  return /^[a-f0-9]{12}$/.test(name);
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

module.exports = { listGalleries, getGallery, writeGalleryMeta };
