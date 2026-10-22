// Local Node server: serves the built app (dist/) and the /api handler. Node 22.18+ runs this TypeScript directly.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { buildRouter, handleApi } from './api.ts';
import type { AppContext } from './context.ts';
import { PAGE_HEADERS } from './headers.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
};


async function toRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = `http://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const chunks: Buffer[] = [];
  if (req.method !== 'GET' && req.method !== 'HEAD') for await (const c of req) chunks.push(c as Buffer);
  return new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
}

async function send(res: ServerResponse, r: Response) {
  const headers: Record<string, string | string[]> = {};
  r.headers.forEach((v, k) => {
    if (k === 'set-cookie') return;
    headers[k] = v;
  });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}

export function startServer(ctx: AppContext, opts: { port: number; host: string; distDir: string }) {
  const app = buildRouter(ctx);
  const dist = resolve(opts.distDir);
  const server = createServer(async (req, res) => {
    try {
      const path = (req.url ?? '/').split('?')[0];
      if (path.startsWith('/api/')) return send(res, await handleApi(app, await toRequest(req), req.socket.remoteAddress ?? ''));
      if (!existsSync(dist)) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        return res.end('The app is not built yet. Run: npm run build');
      }
      let rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
      let file = join(dist, rel);
      if (!file.startsWith(dist)) {
        res.writeHead(403);
        return res.end();
      }
      if (!existsSync(file) || statSync(file).isDirectory()) {
        rel = 'index.html';
        file = join(dist, rel);
      }
      res.writeHead(200, {
        ...PAGE_HEADERS,
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      createReadStream(file).pipe(res);
    } catch (e) {
      console.error('request failed', (e as Error).message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.listen(opts.port, opts.host);
  return server;
}
