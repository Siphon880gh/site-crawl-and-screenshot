'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  jobId: null,
  source: null,
  nodes: [],
  nodeById: new Map(),
  expectedShots: 0,
  viewingGalleryId: null,
  galleries: [],
  expandedGalleryByFolder: new Map(),
  galleryViewModeByFolder: new Map(),
  galleryImagesByFolder: new Map(),
};

function galleryViewModeFor(folderId) {
  return state.galleryViewModeByFolder.get(folderId) || 'full';
}

function expandedFilesFor(folderId) {
  if (!state.expandedGalleryByFolder.has(folderId)) {
    state.expandedGalleryByFolder.set(folderId, new Set());
  }
  return state.expandedGalleryByFolder.get(folderId);
}

function ensureUrlScheme(raw) {
  const url = String(raw).trim();
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

// ---- Outbound IP + Cloudflare tip ----------------------------------------
async function loadOutboundIp(force = false) {
  const el = $('outboundIp');
  const copyBtn = $('copyIp');
  const tip = $('ipTip');
  el.textContent = '…';
  copyBtn.disabled = true;
  tip.classList.remove('ip-tip--bad');
  try {
    const r = await fetch(`/api/ip${force ? '?force=1' : ''}`);
    const data = await r.json();
    if (data.ok && data.ip) {
      el.textContent = data.ip;
      copyBtn.disabled = false;
      const src = data.source ? ` via ${data.source}` : '';
      tip.querySelector('.ip-tip-text').innerHTML = `
        Scanning your own site or a client site behind Cloudflare? In
        <strong>Security &rarr; WAF &rarr; Custom rules</strong>, add a rule to
        <strong>Skip</strong> requests from this IP so the crawler is not blocked.
        If you use a proxy above, whitelist the proxy IP instead.
        <br><small>Detected${src}.</small>`;
    } else {
      el.textContent = 'Unavailable';
      tip.classList.add('ip-tip--bad');
      const tried = data.tried ? ` Tried: ${data.tried.join(', ')}.` : '';
      tip.querySelector('.ip-tip-text').innerHTML = `
        Could not detect outbound IP.${tried} Click <strong>Retry</strong> or set
        <code>OUTBOUND_IP</code> in the server environment.`;
    }
  } catch (_) {
    el.textContent = 'Unavailable';
    tip.classList.add('ip-tip--bad');
  }
}

function copyOutboundIp() {
  const ip = $('outboundIp').textContent;
  if (!ip || ip === '…' || ip === 'Unavailable') return;
  navigator.clipboard.writeText(ip).then(() => {
    const btn = $('copyIp');
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = prev), 1500);
  });
}

// ---- Gallery -----------------------------------------------------------
function formatGalleryLabel(g) {
  const when = new Date(g.createdAt).toLocaleString();
  const host = g.url ? (() => { try { return new URL(g.url).host; } catch (_) { return g.url; } })() : g.id;
  return `${host} · ${g.count} shot${g.count === 1 ? '' : 's'} · ${when}`;
}

async function loadGalleries(selectId) {
  try {
    const r = await fetch('/api/galleries');
    const data = await r.json();
    state.galleries = data.galleries || [];
    const sel = $('gallerySelect');
    const prev = selectId || sel.value;
    sel.innerHTML = '<option value="">Select folder…</option>';
    state.galleries.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = formatGalleryLabel(g);
      sel.appendChild(opt);
    });
    if (prev && state.galleries.some((g) => g.id === prev)) {
      sel.value = prev;
    } else if (selectId && state.galleries.some((g) => g.id === selectId)) {
      sel.value = selectId;
    }
    $('galleryOpen').disabled = !sel.value;
  } catch (_) {
    /* ignore */
  }
}

async function openGallery(id) {
  if (!id) return;
  try {
    const r = await fetch(`/api/galleries/${id}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not open gallery');

    state.viewingGalleryId = id;
    $('gallery').classList.remove('hidden');
    $('galleryViewMode').disabled = !data.images.length;

    const meta = $('galleryMeta');
    const parts = [`<strong>${data.id}</strong>`];
    if (data.url) parts.push(` · ${data.url}`);
    parts.push(` · ${data.images.length} screenshot${data.images.length === 1 ? '' : 's'}`);
    meta.innerHTML = parts.join('');

    state.galleryImagesByFolder.set(data.id, data.images);
    renderGalleryRows(data.id, data.images);
  } catch (err) {
    $('galleryMeta').textContent = err.message;
    $('galleryGrid').innerHTML = '';
    $('gallery').classList.remove('hidden');
    $('galleryToggleAll').disabled = true;
    $('galleryViewMode').disabled = true;
  }
}

function updateGalleryViewModeButton() {
  const btn = $('galleryViewMode');
  if (!state.viewingGalleryId) {
    btn.disabled = true;
    btn.textContent = 'Thumbnails';
    return;
  }
  const images = state.galleryImagesByFolder.get(state.viewingGalleryId);
  if (!images || !images.length) {
    btn.disabled = true;
    btn.textContent = 'Thumbnails';
    return;
  }
  btn.disabled = false;
  const mode = galleryViewModeFor(state.viewingGalleryId);
  btn.textContent = mode === 'full' ? 'Thumbnails' : 'Full size';
}

function toggleGalleryViewMode() {
  if (!state.viewingGalleryId) return;
  const id = state.viewingGalleryId;
  const images = state.galleryImagesByFolder.get(id);
  if (!images || !images.length) return;
  const next = galleryViewModeFor(id) === 'full' ? 'thumbnails' : 'full';
  state.galleryViewModeByFolder.set(id, next);
  renderGalleryRows(id, images);
}

function renderGalleryRows(folderId, images) {
  const grid = $('galleryGrid');
  grid.innerHTML = '';
  grid.className = 'gallery-list';
  if (!images.length) {
    grid.innerHTML = '<p class="empty">No screenshots yet — they will appear here as they are captured.</p>';
    $('galleryToggleAll').disabled = true;
    $('galleryToggleAll').classList.add('hidden');
    updateGalleryViewModeButton();
    return;
  }

  state.galleryImagesByFolder.set(folderId, images);
  const mode = galleryViewModeFor(folderId);
  if (mode === 'thumbnails') {
    renderGalleryThumbnails(grid, images);
    $('galleryToggleAll').disabled = true;
    $('galleryToggleAll').classList.add('hidden');
    updateGalleryViewModeButton();
    return;
  }

  renderGalleryFullStack(grid, folderId, images);
  updateGalleryViewModeButton();
}

function renderGalleryThumbnails(grid, images) {
  grid.classList.add('gallery-list--thumbnails');
  const wrap = document.createElement('div');
  wrap.className = 'gallery-thumbs';
  images.forEach((img) => {
    const a = document.createElement('a');
    a.className = 'gallery-thumb';
    a.href = img.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = img.file;
    a.innerHTML = `
      <img loading="lazy" src="${img.url}" alt="${img.file}">
      <span class="gallery-thumb-name">${img.file}</span>`;
    wrap.appendChild(a);
  });
  grid.appendChild(wrap);
}

function renderGalleryFullStack(grid, folderId, images) {
  const expanded = expandedFilesFor(folderId);
  $('galleryToggleAll').classList.remove('hidden');
  $('galleryToggleAll').disabled = false;
  images.forEach((img) => {
    const row = document.createElement('details');
    row.className = 'gallery-row';
    row.dataset.file = img.file;
    if (expanded.has(img.file)) row.open = true;

    row.innerHTML = `
      <summary class="gallery-row-head">
        <span class="gallery-row-chevron" aria-hidden="true"></span>
        <span class="gallery-row-title">${img.file}</span>
      </summary>
      <div class="gallery-row-body">
        <a href="${img.url}" target="_blank" rel="noopener">
          <img loading="lazy" src="${img.url}" alt="${img.file}">
        </a>
      </div>`;

    row.addEventListener('toggle', () => {
      if (row.open) expanded.add(img.file);
      else expanded.delete(img.file);
      updateGalleryToggleButton();
    });

    grid.appendChild(row);
  });
  updateGalleryToggleButton();
}

function galleryRows() {
  return Array.from(document.querySelectorAll('.gallery-row'));
}

function updateGalleryToggleButton() {
  const btn = $('galleryToggleAll');
  const rows = galleryRows();
  if (!rows.length) {
    btn.disabled = true;
    btn.textContent = 'Expand all';
    return;
  }
  btn.disabled = false;
  const allOpen = rows.every((row) => row.open);
  btn.textContent = allOpen ? 'Collapse all' : 'Expand all';
}

function toggleAllGallery() {
  if (!state.viewingGalleryId) return;
  const rows = galleryRows();
  if (!rows.length) return;

  const expanded = expandedFilesFor(state.viewingGalleryId);
  const allOpen = rows.every((row) => row.open);

  if (allOpen) {
    expanded.clear();
    rows.forEach((row) => {
      row.open = false;
    });
  } else {
    rows.forEach((row) => {
      row.open = true;
      expanded.add(row.dataset.file);
    });
  }
  updateGalleryToggleButton();
}

function onGallerySelectChange() {
  $('galleryOpen').disabled = !$('gallerySelect').value;
}

// ---- Health --------------------------------------------------------------
async function loadHealth() {
  const el = $('health');
  const text = el.querySelector('.health-text');
  el.className = 'health health--unknown';
  text.textContent = 'Checking environment…';
  try {
    const r = await fetch('/api/health');
    const h = await r.json();
    if (h.ok) {
      el.className = 'health health--ok';
      text.textContent = `Puppeteer v${h.puppeteer.version} · ${h.launch.browserVersion}`;
    } else {
      el.className = 'health health--bad';
      const reason =
        (!h.puppeteer.ok && h.puppeteer.error) ||
        (!h.chrome.ok && h.chrome.error) ||
        (!h.launch.ok && h.launch.error) ||
        'Environment not ready';
      text.textContent = reason;
    }
  } catch (err) {
    el.className = 'health health--bad';
    text.textContent = 'Health check failed';
  }
}

// ---- Rendering -----------------------------------------------------------
function isGrayedNode(node) {
  return node.isDuplicate || node.isSkipped;
}

function isShotNode(node) {
  return node && !isGrayedNode(node);
}

function badge(node) {
  if (node.isDuplicate) return 'dup';
  return `L${node.depth}`;
}

function clearDupShotUi(url, exceptId) {
  if (!url) return;
  state.nodes
    .filter((n) => isGrayedNode(n) && n.url === url && n.id !== exceptId)
    .forEach((n) => {
      const el = $(`node-${n.id}`);
      if (!el) return;
      el.classList.remove('active', 'shot-done', 'shot-error');
      const sb = el.querySelector('.badge.shot');
      if (sb) sb.textContent = '';
    });
}

function renderTree(nodes, rootId) {
  state.nodes = nodes;
  state.nodeById = new Map(nodes.map((n) => [n.id, n]));
  const tree = $('tree');
  tree.innerHTML = '';
  const root = state.nodeById.get(rootId);
  if (!root) {
    tree.innerHTML = '<p class="empty">No links found.</p>';
    return;
  }
  tree.appendChild(renderNode(root));
}

function renderNode(node) {
  const wrap = document.createElement('div');
  const grayed = isGrayedNode(node);
  wrap.className = 'node' + (node.isDuplicate ? ' dup' : '') + (node.isSkipped ? ' skipped' : '');
  wrap.id = `node-${node.id}`;

  const row = document.createElement('div');
  row.className = 'node-row';

  const b = document.createElement('span');
  b.className = 'badge';
  b.textContent = badge(node);
  row.appendChild(b);

  const a = document.createElement('a');
  a.className = 'node-url';
  a.href = node.url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = node.url;
  row.appendChild(a);

  if (!grayed) {
    const shot = document.createElement('span');
    shot.className = 'badge shot';
    shot.textContent = '';
    row.appendChild(shot);
  }

  wrap.appendChild(row);

  if (node.children && node.children.length) {
    const kids = document.createElement('div');
    kids.className = 'node-children';
    node.children.forEach((cid) => {
      const child = state.nodeById.get(cid);
      if (child) kids.appendChild(renderNode(child));
    });
    wrap.appendChild(kids);
  }
  return wrap;
}

function setProgress(label, pct) {
  $('progress').classList.remove('hidden');
  $('progressLabel').textContent = label;
  if (typeof pct === 'number') $('progressFill').style.width = `${Math.min(100, pct)}%`;
}

// ---- SSE event handling --------------------------------------------------
function openStream(jobId) {
  if (state.source) state.source.close();
  const es = new EventSource(`/api/events/${jobId}`);
  state.source = es;
  es.onmessage = (e) => {
    let evt;
    try {
      evt = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    handleEvent(evt);
  };
  es.onerror = () => {
    /* keep-alive will reconnect; ignore transient errors */
  };
}

function handleEvent(evt) {
  switch (evt.type) {
    case 'crawl:visit':
      setProgress(`Crawling: ${evt.url}  (${evt.processed} done · ${evt.queued} queued)`);
      break;
    case 'crawl:error':
      setProgress(`Error on ${evt.url}`);
      break;
    case 'crawl:result':
      renderTree(evt.nodes, evt.rootId);
      updateStats(evt.nodes);
      finishCrawl();
      break;
    case 'crawl:fatal':
      setProgress(`Crawl failed: ${evt.error}`);
      resetButtons();
      break;
    case 'shot:start': {
      clearActive();
      const node = state.nodeById.get(evt.id);
      if (!isShotNode(node)) break;
      const el = $(`node-${evt.id}`);
      if (el) {
        el.classList.add('active');
        const sb = el.querySelector('.badge.shot');
        if (sb) sb.textContent = '📷 shooting';
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      clearDupShotUi(evt.url, evt.id);
      setProgress(
        `Screenshotting ${evt.index}/${evt.total}: ${evt.url}`,
        (evt.index / evt.total) * 100
      );
      break;
    }
    case 'shot:done': {
      const node = state.nodeById.get(evt.id);
      if (!isShotNode(node)) break;
      const el = $(`node-${evt.id}`);
      if (el) {
        el.classList.remove('active');
        el.classList.add('shot-done');
        const sb = el.querySelector('.badge.shot');
        if (sb) sb.textContent = '✓ shot';
      }
      clearDupShotUi(evt.url, evt.id);
      break;
    }
    case 'shot:error': {
      const node = state.nodeById.get(evt.id);
      if (!isShotNode(node)) break;
      const el = $(`node-${evt.id}`);
      if (el) {
        el.classList.remove('active');
        el.classList.add('shot-error');
        const sb = el.querySelector('.badge.shot');
        if (sb) sb.textContent = '✗ failed';
      }
      clearDupShotUi(evt.url, evt.id);
      break;
    }
    case 'shot:wait':
      setProgress(`Waiting ${evt.ms}ms before page ${evt.next}/${evt.total}…`);
      break;
    case 'gallery:updated':
      loadGalleries(evt.jobId);
      if (state.viewingGalleryId === evt.jobId) openGallery(evt.jobId);
      break;
    case 'shot:result':
      loadGalleries(evt.baseDir ? evt.baseDir.split('/').pop() : state.jobId);
      setProgress(evt.state === 'stopped' ? 'Stopped — partial gallery saved' : 'Screenshots complete', 100);
      resetButtons();
      break;
    case 'shot:stopped':
      setProgress('Stopped — open gallery to view captured shots.');
      resetButtons();
      break;
    case 'shot:fatal':
      setProgress(`Screenshots failed: ${evt.error}`);
      resetButtons();
      break;
    case 'crawl:stopped':
      setProgress('Crawl stopped.');
      break;
  }
}

function updateStats(nodes) {
  const total = nodes.length;
  const dup = nodes.filter((n) => n.isDuplicate).length;
  const skipped = nodes.filter((n) => n.isSkipped).length;
  $('statTotal').textContent = total;
  $('statUnique').textContent = total - dup - skipped;
  $('statDup').textContent = dup;
  $('stats').classList.remove('hidden');
}

function shotCandidateCount() {
  return state.nodes.filter((n) => isShotNode(n)).length;
}

function clearActive() {
  document.querySelectorAll('.node.active').forEach((n) => n.classList.remove('active'));
}

function busy(isBusy, phase) {
  $('scanBtn').disabled = isBusy;
  $('stopBtn').disabled = !isBusy;
  if (phase === 'crawl') $('shotBtn').disabled = true;
}
function finishCrawl() {
  $('scanBtn').disabled = false;
  $('stopBtn').disabled = true;
  $('shotBtn').disabled = shotCandidateCount() === 0;
}
function resetButtons() {
  $('scanBtn').disabled = false;
  $('stopBtn').disabled = true;
  $('shotBtn').disabled = shotCandidateCount() === 0;
}

async function startScan() {
  let url = $('url').value.trim();
  if (!url) {
    $('url').focus();
    return;
  }
  url = ensureUrlScheme(url);
  $('url').value = url;
  const level = parseInt($('level').value, 10);
  const proxy = $('proxy').value.trim();

  $('tree').innerHTML = '<p class="empty">Crawling…</p>';
  $('stats').classList.add('hidden');
  busy(true, 'crawl');
  setProgress('Launching browser…', 0);

  try {
    const r = await fetch('/api/crawl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, level, proxy }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to start crawl');
    state.jobId = data.jobId;
    openStream(state.jobId);
  } catch (err) {
    setProgress(`Error: ${err.message}`);
    resetButtons();
  }
}

async function startShots() {
  if (!state.jobId) return;
  const delay = parseInt($('delay').value, 10);
  busy(true, 'shot');
  setProgress('Starting screenshots…', 0);
  try {
    const r = await fetch('/api/screenshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: state.jobId, delay }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to start screenshots');
  } catch (err) {
    setProgress(`Error: ${err.message}`);
    resetButtons();
  }
}

async function stopJob() {
  if (!state.jobId) return;
  $('stopBtn').disabled = true;
  await fetch('/api/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: state.jobId }),
  }).catch(() => {});
}

// ---- Wire up -------------------------------------------------------------
$('scanBtn').addEventListener('click', startScan);
$('shotBtn').addEventListener('click', startShots);
$('stopBtn').addEventListener('click', stopJob);
$('recheck').addEventListener('click', loadHealth);
$('copyIp').addEventListener('click', copyOutboundIp);
$('retryIp').addEventListener('click', () => loadOutboundIp(true));
$('gallerySelect').addEventListener('change', onGallerySelectChange);
$('galleryOpen').addEventListener('click', () => openGallery($('gallerySelect').value));
$('galleryRefresh').addEventListener('click', () => loadGalleries());
$('galleryToggleAll').addEventListener('click', toggleAllGallery);
$('galleryViewMode').addEventListener('click', toggleGalleryViewMode);
$('url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startScan();
});

loadHealth();
loadOutboundIp();
loadGalleries();
