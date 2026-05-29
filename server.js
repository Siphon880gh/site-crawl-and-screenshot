'use strict';

const path = require('path');
const express = require('express');

const { checkHealth } = require('./src/health');
const { getOutboundIp } = require('./src/outbound-ip');
const { listGalleries, getGallery, writeGalleryMeta, buildGalleryId } = require('./src/galleries');
const { launchBrowser } = require('./src/browser');
const { crawl } = require('./src/crawler');
const { screenshotPages } = require('./src/screenshotter');
const { ensureUrlScheme } = require('./src/ensure-url-scheme');

const PORT = process.env.PORT || 3000;
const SHOTS_DIR = path.join(__dirname, 'screenshots');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(SHOTS_DIR));

// ---- In-memory job store -------------------------------------------------
const jobs = new Map();

function createJob(opts) {
  const id = buildGalleryId(opts.url, SHOTS_DIR);
  const job = {
    id,
    ...opts,
    state: 'created', // created | crawling | crawled | shooting | done | error | stopped
    listeners: new Set(),
    events: [], // buffered events for late SSE subscribers
    nodes: null,
    browser: null,
    stop: false,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

function pushEvent(job, evt) {
  job.events.push(evt);
  for (const res of job.listeners) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }
}

async function closeJobBrowser(job) {
  if (job.browser) {
    try {
      await job.browser.close();
    } catch (_) {
      /* ignore */
    }
    job.browser = null;
  }
}

// ---- Routes --------------------------------------------------------------

app.get('/api/health', async (_req, res) => {
  try {
    const report = await checkHealth();
    res.json(report);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/ip', async (req, res) => {
  try {
    const force = req.query.force === '1';
    const result = await getOutboundIp({ force });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/galleries', (_req, res) => {
  try {
    res.json({ galleries: listGalleries(SHOTS_DIR) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/galleries/:id', (req, res) => {
  try {
    const gallery = getGallery(SHOTS_DIR, req.params.id);
    if (!gallery) return res.status(404).json({ error: 'Gallery not found or empty.' });
    res.json(gallery);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start a crawl. Returns a job id; progress streamed via SSE.
app.post('/api/crawl', async (req, res) => {
  const { url, level, proxy } = req.body || {};
  if (!url || !String(url).trim()) {
    return res.status(400).json({ error: 'A URL is required.' });
  }
  const maxLevel = Number.isFinite(+level) ? Math.max(0, Math.min(6, +level)) : 2;
  const job = createJob({ url: ensureUrlScheme(url), maxLevel, proxy: proxy || '' });
  res.json({ jobId: job.id, maxLevel });

  // Run the crawl asynchronously.
  (async () => {
    job.state = 'crawling';
    try {
      job.browser = await launchBrowser({ proxy: job.proxy });
      const result = await crawl({
        startUrl: job.url,
        maxLevel: job.maxLevel,
        browser: job.browser,
        shouldStop: () => job.stop,
        onProgress: (evt) => pushEvent(job, evt),
      });
      job.nodes = result.nodes;
      job.rootId = result.rootId;
      job.state = job.stop ? 'stopped' : 'crawled';
      pushEvent(job, {
        type: 'crawl:result',
        rootId: result.rootId,
        nodes: result.nodes,
        state: job.state,
      });
    } catch (err) {
      job.state = 'error';
      pushEvent(job, { type: 'crawl:fatal', error: err.message });
      await closeJobBrowser(job);
    }
  })();
});

// Start screenshots for a previously crawled job.
app.post('/api/screenshot', async (req, res) => {
  const { jobId, delay } = req.body || {};
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Unknown job. Crawl first.' });
  if (!job.nodes) return res.status(409).json({ error: 'Crawl has not finished yet.' });

  const delayMs = Number.isFinite(+delay) ? Math.max(0, +delay) : 2000;
  // Only screenshot unique (non-duplicate) pages with a usable status.
  const pages = job.nodes.filter((n) => !n.isDuplicate && n.status !== 'error');
  res.json({ ok: true, count: pages.length });

  (async () => {
    job.state = 'shooting';
    job.stop = false;
    try {
      if (!job.browser) job.browser = await launchBrowser({ proxy: job.proxy });
      const outDir = path.join(SHOTS_DIR, job.id);
      writeGalleryMeta(outDir, { url: job.url, jobId: job.id });
      pushEvent(job, { type: 'gallery:updated', jobId: job.id });

      const results = await screenshotPages({
        pages,
        browser: job.browser,
        outDir,
        delayMs,
        shouldStop: () => job.stop,
        onProgress: (evt) => {
          pushEvent(job, { ...evt, baseDir: `/screenshots/${job.id}` });
          if (evt.type === 'shot:done') {
            pushEvent(job, { type: 'gallery:updated', jobId: job.id });
          }
        },
      });
      job.shots = results;
      job.state = job.stop ? 'stopped' : 'done';
      pushEvent(job, { type: 'shot:result', results, baseDir: `/screenshots/${job.id}`, state: job.state });
    } catch (err) {
      job.state = 'error';
      pushEvent(job, { type: 'shot:fatal', error: err.message });
    } finally {
      await closeJobBrowser(job);
    }
  })();
});

// Stop a running job (crawl or screenshots).
app.post('/api/stop', (req, res) => {
  const { jobId } = req.body || {};
  const job = jobs.get(jobId);
  if (!job) return res.status(404).json({ error: 'Unknown job.' });
  job.stop = true;
  res.json({ ok: true });
});

// SSE stream of all events for a job.
app.get('/api/events/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Replay buffered events so a late subscriber catches up.
  for (const evt of job.events) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }
  job.listeners.add(res);

  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    job.listeners.delete(res);
  });
});

// ---- Startup -------------------------------------------------------------

app.listen(PORT, async () => {
  console.log(`\nSite Crawl and Screenshot running at http://localhost:${PORT}`);
  console.log('Running startup health check (Puppeteer + Chrome)...');
  try {
    const report = await checkHealth();
    if (report.ok) {
      console.log(
        `  OK  Puppeteer v${report.puppeteer.version} | Chrome: ${report.launch.browserVersion}`
      );
    } else {
      console.warn('  WARNING  Health check failed:');
      if (!report.puppeteer.ok) console.warn('   - ' + report.puppeteer.error);
      if (!report.chrome.ok) console.warn('   - ' + (report.chrome.error || 'Chrome not found'));
      if (!report.launch.ok) console.warn('   - ' + report.launch.error);
      console.warn('  Fix with: npx puppeteer browsers install chrome');
    }
  } catch (err) {
    console.warn('  Health check error:', err.message);
  }
});
