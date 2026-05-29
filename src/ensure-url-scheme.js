'use strict';

/**
 * If raw has no http(s) scheme, prefix https:// so bare hostnames work.
 */
function ensureUrlScheme(raw) {
  const url = String(raw).trim();
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

module.exports = { ensureUrlScheme };
