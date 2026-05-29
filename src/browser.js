'use strict';

const fs = require('fs');
const puppeteer = require('puppeteer');

/**
 * Launch a Chrome instance, optionally behind a proxy.
 * proxy example: "http://user:pass@host:port" or "http://host:port".
 * Puppeteer's --proxy-server does not accept credentials inline, so we parse
 * them out and return them for page.authenticate().
 */
async function launchBrowser({ proxy } = {}) {
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  let proxyAuth = null;

  if (proxy && proxy.trim()) {
    const { server, auth } = parseProxy(proxy.trim());
    if (server) args.push(`--proxy-server=${server}`);
    proxyAuth = auth;
  }

  const launchOpts = { headless: true, args };
  const executablePath =
    process.env.PUPPETEER_EXECUTABLE_PATH || safeExecutablePath();
  if (executablePath && fs.existsSync(executablePath)) {
    launchOpts.executablePath = executablePath;
  }

  const browser = await puppeteer.launch(launchOpts);
  browser.__proxyAuth = proxyAuth; // stash for pages to use
  return browser;
}

function safeExecutablePath() {
  try {
    return puppeteer.executablePath();
  } catch (_) {
    return null;
  }
}

function parseProxy(raw) {
  // Accept forms with or without scheme.
  let value = raw;
  if (!/^\w+:\/\//.test(value)) value = `http://${value}`;
  try {
    const u = new URL(value);
    const server = `${u.protocol}//${u.host}`; // host includes port
    const auth =
      u.username || u.password
        ? { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
        : null;
    return { server, auth };
  } catch (_) {
    // Fall back to treating the whole thing as a server string.
    return { server: raw, auth: null };
  }
}

/**
 * Create a page with proxy auth applied (if any) and a sane viewport/UA.
 */
async function newPage(browser) {
  const page = await browser.newPage();
  if (browser.__proxyAuth) {
    await page.authenticate(browser.__proxyAuth);
  }
  await page.setViewport({ width: 1366, height: 900 });
  return page;
}

module.exports = { launchBrowser, newPage, parseProxy };
