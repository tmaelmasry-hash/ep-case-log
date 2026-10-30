// The /api application: standard Request in, Response out (ported from EP Workspace server/api.ts), so it can run
// on the local Node server, in the tests, and later on Cloudflare unchanged.
// Every route except health and sign-in runs behind the guard: session, Origin, CSRF, forced password change.
import { resolveUser } from './auth/auth.ts';
import type { AppContext } from './context.ts';
import { HttpError, Reply, Router, type Req } from './http.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { bulkRoutes } from './routes/bulk.ts';
import { dashboardRoutes } from './routes/dashboard.ts';
import { followupRoutes } from './routes/followups.ts';
import { exportRoutes } from './routes/exports.ts';
import { aiRoutes } from './routes/ai.ts';
import { caseRoutes } from './routes/cases.ts';
import { cohortRoutes } from './routes/cohorts.ts';
import { completenessRoutes } from './routes/completeness.ts';

const PUBLIC = [/^\/api\/health$/, /^\/api\/auth\/login$/];
/** Reachable while a temporary password must still be changed. */
const WHILE_MUST_CHANGE = new Set(['/api/auth/me', '/api/auth/password', '/api/auth/logout']);
const BODY_LIMIT = 2 * 1024 * 1024;

export const SECURITY_HEADERS: [string, string][] = [
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'no-referrer'],
  ['X-Frame-Options', 'DENY'],
  ['Cache-Control', 'no-store'],
];

export function buildRouter(ctx: AppContext): Router {
  const app = new Router(ctx);
  app.get('/api/health', async () => ({ ok: true, store: ctx.store.kind, time: ctx.now().toISOString() }));
  authRoutes(app);
  adminRoutes(app);
  caseRoutes(app);
  cohortRoutes(app);
  bulkRoutes(app);
  dashboardRoutes(app);
  completenessRoutes(app);
  followupRoutes(app);
  exportRoutes(app);
  aiRoutes(app);
  return app;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* ignore malformed cookie */
      }
    }
  }
  return out;
}

function json(status: number, obj: unknown, headers: [string, string][] = []): Response {
  const h = new Headers();
  for (const [k, v] of [...SECURITY_HEADERS, ['Content-Type', 'application/json; charset=utf-8'] as [string, string], ...headers]) h.append(k, v);
  return new Response(JSON.stringify(obj), { status, headers: h });
}

export async function handleApi(app: Router, request: Request, ip = '127.0.0.1'): Promise<Response> {
  const { ctx } = app;
  const url = new URL(request.url);
  const reply = new Reply();
  try {
    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    let body: unknown = undefined;
    if (!['GET', 'HEAD'].includes(request.method)) {
      const text = await request.text();
      if (text.length > BODY_LIMIT) throw new HttpError(413, 'TOO_LARGE', 'Request is too large.');
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new HttpError(400, 'VALIDATION_FAILED', 'Request is not valid JSON.');
        }
      }
    }
    const req: Req = {
      method: request.method,
      path: url.pathname,
      params: {},
      query: Object.fromEntries(url.searchParams),
      body,
      headers,
      cookies: parseCookies(request.headers.get('cookie')),
      ip,
      user: null,
    };

    // ── guard ──
    req.user = await resolveUser(ctx, req);
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (unsafe && headers.origin) {
      let originHost = '';
      try {
        originHost = new URL(headers.origin).host;
      } catch {
        /* malformed */
      }
      if (originHost !== (headers.host ?? url.host)) throw new HttpError(403, 'BAD_ORIGIN', 'Cross-site request refused.');
    }
    if (!PUBLIC.some((re) => re.test(req.path))) {
      if (!req.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.');
      if (unsafe && headers['x-csrf-token'] !== req.user.csrf) throw new HttpError(403, 'CSRF', 'Your session expired. Reload the page.');
      if (req.user.mustChangePassword && !WHILE_MUST_CHANGE.has(req.path)) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Set your own password first.');
    }

    const m = app.match(req.method, req.path);
    if (!m) throw new HttpError(404, 'NOT_FOUND', 'Unknown API route.');
    req.params = m.params;
    const result = await m.handler(req, reply);
    return json(reply.statusCode, result ?? null, reply.headers);
  } catch (err) {
    const keep = reply.headers.filter(([k]) => k.toLowerCase() === 'set-cookie');
    if (err instanceof HttpError) return json(err.status, { error: { code: err.code, message: err.message, details: err.details } }, keep);
    // Never echo internals or request bodies.
    const e = err as Error;
    console.error('unhandled error', e?.message, e?.stack?.split('\n').slice(0, 4).join(' | '));
    return json(500, { error: { code: 'SERVER_ERROR', message: 'Something went wrong on the server. Nothing was lost; try again.' } });
  }
}
