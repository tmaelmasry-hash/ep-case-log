// Request/response types, the small router every /api route registers on, and the error envelope.
// No framework and no Node-only API (ported from EP Workspace server/http.ts).
import type { SessionUser } from './auth/auth.ts';
import { can, type Capability } from './auth/capabilities.ts';
import type { AppContext } from './context.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, 'NOT_FOUND', what);
export const forbidden = (msg = 'You do not have access to this.') => new HttpError(403, 'FORBIDDEN', msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'VALIDATION_FAILED', msg, details);
export const conflict = (code: string, msg: string, details?: unknown) => new HttpError(409, code, msg, details);

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  cookies: Record<string, string>;
  ip: string;
  user: SessionUser | null;
}

export interface CookieOptions {
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict';
  maxAge?: number;
}

export class Reply {
  statusCode = 200;
  headers: [string, string][] = [];
  status(n: number) {
    this.statusCode = n;
    return this;
  }
  header(k: string, v: string) {
    this.headers.push([k, v]);
    return this;
  }
  setCookie(name: string, value: string, o: CookieOptions = {}) {
    const parts = [`${name}=${value}`, `Path=${o.path ?? '/'}`];
    if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
    if (o.httpOnly) parts.push('HttpOnly');
    if (o.secure) parts.push('Secure');
    if (o.sameSite) parts.push(`SameSite=${o.sameSite === 'lax' ? 'Lax' : 'Strict'}`);
    return this.header('Set-Cookie', parts.join('; '));
  }
  clearCookie(name: string, o: CookieOptions = {}) {
    return this.setCookie(name, '', { ...o, maxAge: 0 });
  }
}

export type Handler = (req: Req, reply: Reply) => Promise<unknown>;
interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  readonly ctx: AppContext;
  readonly routes: Route[] = [];
  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }
  private add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(`^${path.replace(/[.]/g, '\\.').replace(/:([A-Za-z_]+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    this.routes.push({ method, re, keys, handler });
  }
  get(p: string, h: Handler) {
    this.add('GET', p, h);
  }
  post(p: string, h: Handler) {
    this.add('POST', p, h);
  }
  patch(p: string, h: Handler) {
    this.add('PATCH', p, h);
  }
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.re.exec(path);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

export function requireCap(req: Req, cap: Capability): SessionUser {
  const u = req.user;
  if (!u) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in.');
  if (!can(u.role, cap)) throw forbidden();
  return u;
}
