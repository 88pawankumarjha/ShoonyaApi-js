#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

try {
  require('dotenv').config();
} catch (_) {
  // dotenv is optional.
}

const host = process.env.ALGO_DASHBOARD_HOST || '127.0.0.1';
const port = Number(process.env.ALGO_DASHBOARD_PORT || 8787);
const pin = String(process.env.ALGO_DASHBOARD_PIN || '').trim();
const secret = String(process.env.ALGO_DASHBOARD_SECRET || process.env.ALGO_WEBHOOK_TOKEN || pin || '').trim();
const webhookToken = String(process.env.ALGO_WEBHOOK_TOKEN || '').trim();
const retentionHours = Number(process.env.ALGO_EVENTS_RETENTION_HOURS || 48);
const maxRecentEvents = Number(process.env.ALGO_DASHBOARD_MAX_EVENTS || 500);
const dataFile = path.resolve(process.cwd(), process.env.ALGO_EVENTS_FILE || 'data/algo-dashboard-events.jsonl');
const clients = new Set();

if (!/^\d{4}$/.test(pin)) {
  console.error('ALGO_DASHBOARD_PIN must be a 4 digit PIN.');
  process.exit(1);
}
if (!secret) {
  console.error('ALGO_DASHBOARD_SECRET or ALGO_WEBHOOK_TOKEN is required.');
  process.exit(1);
}

const ensureDataDir = () => {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
};

const cutoffMs = () => Date.now() - (retentionHours * 60 * 60 * 1000);

const parseCookies = (header = '') => Object.fromEntries(header
  .split(';')
  .map(part => part.trim())
  .filter(Boolean)
  .map(part => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));

const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest('hex');

const createSessionCookie = () => {
  const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
  const value = `${expiresAt}.${sign(String(expiresAt))}`;
  return `algo_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Max-Age=86400; Path=/algo`;
};

const isAuthed = (req) => {
  const cookie = parseCookies(req.headers.cookie || '').algo_session;
  if (!cookie) {
    return false;
  }
  const [expiresAt, signature] = cookie.split('.');
  const expiresNumber = Number(expiresAt);
  if (!Number.isFinite(expiresNumber) || Date.now() > expiresNumber) {
    return false;
  }
  const expected = sign(String(expiresAt));
  if (!signature || signature.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
};

const send = (res, statusCode, body, headers = {}) => {
  res.writeHead(statusCode, headers);
  res.end(body);
};

const sendJson = (res, statusCode, body) => send(res, statusCode, JSON.stringify(body), {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      reject(new Error('request too large'));
      req.destroy();
    }
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const normalizeEvent = (payload) => ({
  id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
  ts: new Date().toISOString(),
  source: String(payload.source || 'algo').slice(0, 32),
  important: Boolean(payload.important),
  message: String(payload.message || '').slice(0, 8000),
});

const readEvents = () => {
  ensureDataDir();
  if (!fs.existsSync(dataFile)) {
    return [];
  }
  const cutoff = cutoffMs();
  return fs.readFileSync(dataFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (_) {
        return null;
      }
    })
    .filter(event => event && Date.parse(event.ts) >= cutoff)
    .slice(-maxRecentEvents);
};

const pruneEvents = () => {
  const events = readEvents();
  fs.writeFileSync(dataFile, `${events.map(event => JSON.stringify(event)).join('\n')}${events.length ? '\n' : ''}`);
};

const storeEvent = (event) => {
  ensureDataDir();
  fs.appendFileSync(dataFile, `${JSON.stringify(event)}\n`);
  if (Math.random() < 0.05) {
    pruneEvents();
  }
};

const broadcast = (event) => {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
};

const loginPage = (error = '') => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Algo Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b141a; color: #e9edef; }
    form { width: min(320px, calc(100vw - 32px)); background: #111b21; border: 1px solid #233138; border-radius: 8px; padding: 22px; }
    h1 { font-size: 18px; margin: 0 0 16px; font-weight: 650; }
    input, button { width: 100%; box-sizing: border-box; border-radius: 7px; border: 1px solid #2a3942; background: #202c33; color: #e9edef; font-size: 18px; padding: 12px; }
    input { text-align: center; letter-spacing: 8px; }
    button { margin-top: 12px; background: #00a884; border-color: #00a884; color: #06130f; font-weight: 700; cursor: pointer; letter-spacing: 0; }
    p { color: #ffb4a9; min-height: 20px; margin: 12px 0 0; font-size: 13px; }
  </style>
</head>
<body>
  <form method="post" action="/algo/login">
    <h1>Algo Dashboard</h1>
    <input name="pin" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="one-time-code" autofocus />
    <button type="submit">Open</button>
    <p>${error}</p>
  </form>
</body>
</html>`;

const dashboardPage = () => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Algo Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0b141a; color: #e9edef; }
    header { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #202c33; border-bottom: 1px solid #263942; }
    h1 { font-size: 16px; margin: 0; font-weight: 700; }
    .sub { color: #8696a0; font-size: 12px; }
    .actions { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #8696a0; white-space: nowrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #667781; display: inline-block; }
    .dot.live { background: #00a884; }
    main { max-width: 720px; margin: 0 auto; padding: 14px 10px 24px; }
    .event { display: flex; margin: 7px 0; }
    .bubble { max-width: min(92vw, 610px); border-radius: 8px; padding: 8px 10px 7px; background: #202c33; box-shadow: 0 1px 0 rgba(0,0,0,.2); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.34; font-size: 13px; }
    .event.important .bubble { background: #3a2a18; border-left: 3px solid #f6b04d; }
    .meta { display: flex; gap: 8px; align-items: center; color: #8696a0; font-size: 11px; margin-bottom: 4px; white-space: nowrap; }
    .tag { color: #53bdeb; font-weight: 650; }
    .event.important .tag { color: #f6b04d; }
    .empty { color: #8696a0; text-align: center; margin-top: 20vh; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Algo Dashboard</h1>
      <div class="sub">Last 2 days</div>
    </div>
    <div class="actions"><span id="dot" class="dot"></span><span id="status">connecting</span></div>
  </header>
  <main id="feed"><div class="empty">No events yet</div></main>
  <script>
    const feed = document.getElementById('feed');
    const statusEl = document.getElementById('status');
    const dotEl = document.getElementById('dot');
    const seen = new Set();
    const timeText = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    function addEvent(event) {
      if (!event || seen.has(event.id)) return;
      seen.add(event.id);
      const empty = feed.querySelector('.empty');
      if (empty) empty.remove();
      const row = document.createElement('div');
      row.className = 'event' + (event.important ? ' important' : '');
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = '<span class="tag">' + (event.important ? 'myappnotifications' : event.source || 'algo') + '</span><span>' + timeText(event.ts) + '</span>';
      const text = document.createElement('div');
      text.textContent = event.message || '';
      bubble.append(meta, text);
      row.appendChild(bubble);
      feed.appendChild(row);
      while (feed.children.length > 500) feed.removeChild(feed.firstChild);
      window.scrollTo({ top: document.body.scrollHeight });
    }
    fetch('/algo/recent').then(r => r.json()).then(events => events.forEach(addEvent)).catch(() => {});
    const stream = new EventSource('/algo/stream');
    stream.onopen = () => { statusEl.textContent = 'live'; dotEl.classList.add('live'); };
    stream.onerror = () => { statusEl.textContent = 'reconnecting'; dotEl.classList.remove('live'); };
    stream.onmessage = (message) => addEvent(JSON.parse(message.data));
  </script>
</body>
</html>`;

const handleLogin = async (req, res) => {
  const body = await readBody(req);
  const params = new URLSearchParams(body);
  if (params.get('pin') === pin) {
    send(res, 302, '', {
      location: '/algo',
      'set-cookie': createSessionCookie(),
    });
    return;
  }
  send(res, 401, loginPage('Wrong PIN'), { 'content-type': 'text/html; charset=utf-8' });
};

const handleEvent = async (req, res) => {
  if (webhookToken && req.headers['x-algo-webhook-token'] !== webhookToken) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const body = await readBody(req);
  const payload = JSON.parse(body || '{}');
  if (!payload.message) {
    sendJson(res, 400, { error: 'message required' });
    return;
  }
  const event = normalizeEvent(payload);
  storeEvent(event);
  broadcast(event);
  sendJson(res, 202, { ok: true, id: event.id });
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && (url.pathname === '/algo' || url.pathname === '/algo/')) {
      send(res, 200, isAuthed(req) ? dashboardPage() : loginPage(), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/algo/login') {
      await handleLogin(req, res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/algo/recent') {
      if (!isAuthed(req)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      sendJson(res, 200, readEvents());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/algo/stream') {
      if (!isAuthed(req)) {
        send(res, 401, 'unauthorized');
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/events' || url.pathname === '/algo/events')) {
      await handleEvent(req, res);
      return;
    }
    send(res, 404, 'not found');
  } catch (error) {
    console.error('dashboard request failed:', error.message || error);
    sendJson(res, 500, { error: 'server error' });
  }
});

ensureDataDir();
pruneEvents();
setInterval(pruneEvents, 30 * 60 * 1000).unref();
server.listen(port, host, () => {
  console.log(`Algo dashboard listening on http://${host}:${port}/algo`);
});
