// EP Case Log — optional self-hosted sync server. Zero dependencies (Node 18+).
//   PORT=8787 SYNC_TOKEN=secret DATA_DIR=./data node server/sync-server.mjs
// Serves the built app from ./dist and a small last-write-wins sync API under /api.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.SYNC_TOKEN || '';
const DATA_DIR = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
const DB_FILE = join(DATA_DIR, 'sync-db.json');
const DIST = join(ROOT, 'dist');
const MAX_BODY = 50 * 1024 * 1024;
const STORES = new Set(['cases', 'images']);

mkdirSync(DATA_DIR, { recursive: true });

/** @type {{ seq: number, records: Record<string, { store: string, seq: number, rec: any }> }} */
let db = { seq: 0, records: {} };
if (existsSync(DB_FILE)) db = JSON.parse(readFileSync(DB_FILE, 'utf8'));

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, DB_FILE); // atomic replace
  }, 200);
}

function accept(local, incoming) {
  if (!local) return true;
  if (incoming.updatedAt !== local.updatedAt) return incoming.updatedAt > local.updatedAt;
  return JSON.stringify(incoming) > JSON.stringify(local);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  if (!TOKEN) return true;
  const got = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' }, CORS);

  if (url.pathname === '/api/status' && req.method === 'GET') {
    return send(res, 200, { ok: true, seq: db.seq, records: Object.keys(db.records).length }, CORS);
  }
  if (url.pathname === '/api/push' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, e.status || 400, { error: e.message || 'bad json' }, CORS);
    }
    if (!Array.isArray(body?.records)) return send(res, 400, { error: 'records[] required' }, CORS);
    let accepted = 0;
    for (const item of body.records) {
      const rec = item?.rec;
      if (!STORES.has(item?.store) || !rec || typeof rec.id !== 'string' || typeof rec.updatedAt !== 'number') continue;
      const key = `${item.store}:${rec.id}`;
      if (accept(db.records[key]?.rec, rec)) {
        db.records[key] = { store: item.store, seq: ++db.seq, rec };
        accepted++;
      }
    }
    if (accepted) save();
    return send(res, 200, { ok: true, accepted, seq: db.seq }, CORS);
  }
  if (url.pathname === '/api/pull' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    const newer = Object.values(db.records).filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    const page = newer.slice(0, limit);
    const last = page.length ? page[page.length - 1].seq : Math.max(since, db.seq);
    return send(res, 200, { records: page.map(({ store, rec }) => ({ store, rec })), last, more: newer.length > limit }, CORS);
  }
  return send(res, 404, { error: 'not found' }, CORS);
}

function serveStatic(req, res, url) {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Sync API running. Build the app (npm run build) to also serve it from here.');
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(DIST, p);
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const ext = extname(file);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (file.includes(`${join(DIST, 'assets')}`)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      console.error(e);
      send(res, 500, { error: 'server error' }, CORS);
    });
  } else serveStatic(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log(`EP Case Log server on http://${HOST}:${PORT}  (data: ${DB_FILE}${TOKEN ? ', token required' : ', NO token set'})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clearTimeout(saveTimer);
    writeFileSync(DB_FILE, JSON.stringify(db));
    process.exit(0);
  });
}
