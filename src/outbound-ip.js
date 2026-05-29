'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const puppeteer = require('puppeteer');

const execFileAsync = promisify(execFile);
const CACHE_MS = 60 * 60 * 1000;
let cached = null;

const PROVIDERS_HTTPS = [
  'https://api.ipify.org',
  'https://ipv4.icanhazip.com',
  'https://checkip.amazonaws.com',
  'https://ifconfig.me/ip',
  'https://ipinfo.io/ip',
];

const PROVIDERS_HTTP = ['http://api.ipify.org', 'http://ipv4.icanhazip.com'];

function isIpv4(value) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(String(value).trim());
}

function pickIp(text) {
  const trimmed = String(text).trim();
  if (isIpv4(trimmed)) return trimmed;
  const match = trimmed.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return match ? match[1] : null;
}

function fetchTextNode(url, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchTextFetch(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function tryProviders(label, urls, fetcher) {
  const attempts = [];
  for (const url of urls) {
    try {
      const body = await fetcher(url);
      const ip = pickIp(body);
      if (!ip) throw new Error(`Unexpected response: ${body.slice(0, 80)}`);
      return { ok: true, ip, source: label, provider: url };
    } catch (err) {
      attempts.push({ provider: url, error: err.message });
    }
  }
  return { ok: false, attempts };
}

async function tryCurl() {
  const attempts = [];
  for (const url of PROVIDERS_HTTPS) {
    try {
      const { stdout } = await execFileAsync(
        'curl',
        ['-4', '-s', '--max-time', '6', url],
        { timeout: 8000 }
      );
      const ip = pickIp(stdout);
      if (!ip) throw new Error(`Unexpected response: ${stdout.slice(0, 80)}`);
      return { ok: true, ip, source: 'curl', provider: url };
    } catch (err) {
      attempts.push({ provider: url, error: err.message });
    }
  }
  return { ok: false, attempts };
}

async function tryPuppeteer() {
  let browser;
  const attempts = [];
  try {
    const launchOpts = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    };
    try {
      const executablePath = puppeteer.executablePath();
      if (executablePath && fs.existsSync(executablePath)) {
        launchOpts.executablePath = executablePath;
      }
    } catch (_) {
      /* bundled chrome */
    }
    browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();
    for (const url of PROVIDERS_HTTPS) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        const body = await page.evaluate(() => document.body.innerText || '');
        const ip = pickIp(body);
        if (!ip) throw new Error(`Unexpected response: ${body.slice(0, 80)}`);
        return { ok: true, ip, source: 'puppeteer', provider: url };
      } catch (err) {
        attempts.push({ provider: url, error: err.message });
      }
    }
    return { ok: false, attempts };
  } catch (err) {
    return { ok: false, attempts: [{ provider: 'puppeteer', error: err.message }] };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function tryEnvOverride() {
  const ip = process.env.OUTBOUND_IP || process.env.SERVER_IP;
  if (ip && isIpv4(ip.trim())) {
    return { ok: true, ip: ip.trim(), source: 'env', provider: 'OUTBOUND_IP/SERVER_IP' };
  }
  return null;
}

/**
 * Resolve outbound IPv4 using several mechanisms (local dev, hosted server, etc.).
 * Tries each until one succeeds; returns which mechanism worked.
 */
async function getOutboundIp({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.value;
  }

  const envHit = tryEnvOverride();
  if (envHit) {
    cached = { at: Date.now(), value: envHit };
    return envHit;
  }

  const allAttempts = [];
  const mechanisms = [];

  // 1. Native fetch (works well on modern Node locally and on servers).
  if (typeof fetch === 'function') {
    const r = await tryProviders('fetch', PROVIDERS_HTTPS, fetchTextFetch);
    if (r.ok) {
      cached = { at: Date.now(), value: r };
      return r;
    }
    mechanisms.push('fetch');
    allAttempts.push(...(r.attempts || []));
  }

  // 2. Node http/https modules.
  let r = await tryProviders('node-https', PROVIDERS_HTTPS, fetchTextNode);
  if (r.ok) {
    cached = { at: Date.now(), value: r };
    return r;
  }
  mechanisms.push('node-https');
  allAttempts.push(...(r.attempts || []));

  r = await tryProviders('node-http', PROVIDERS_HTTP, fetchTextNode);
  if (r.ok) {
    cached = { at: Date.now(), value: r };
    return r;
  }
  mechanisms.push('node-http');
  allAttempts.push(...(r.attempts || []));

  // 3. curl subprocess (common on servers).
  r = await tryCurl();
  if (r.ok) {
    cached = { at: Date.now(), value: r };
    return r;
  }
  mechanisms.push('curl');
  allAttempts.push(...(r.attempts || []));

  // 4. Puppeteer/Chrome — same stack used for scanning; often works when raw HTTP fails.
  r = await tryPuppeteer();
  if (r.ok) {
    cached = { at: Date.now(), value: r };
    return r;
  }
  mechanisms.push('puppeteer');
  allAttempts.push(...(r.attempts || []));

  return {
    ok: false,
    error: 'Could not resolve outbound IP',
    tried: mechanisms,
    attempts: allAttempts.slice(0, 12),
  };
}

module.exports = { getOutboundIp };
