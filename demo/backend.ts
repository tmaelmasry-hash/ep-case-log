// Try-it demo: the real registry server (server/api.ts) runs inside the page on a made-up registry kept in this
// browser only. The app's /api calls are answered here instead of over the network. Synthetic data only.
import raw from '../server/generated/raw-config.json' with { type: 'json' };
import { buildRouter, handleApi } from '../server/api.ts';
import { buildAppConfig, type RawConfig } from '../server/appconfig.ts';
import { makeContext } from '../server/context.ts';
import { Reply, type Router } from '../server/http.ts';
import { seedTestUsers } from '../server/seed.ts';
import { MemoryStore, emptyData, type StoreData } from '../server/store/memory.ts';

export const DEMO_PASSWORD = 'demo-pass-2026';
const KEY = 'ep-case-log-demo-v1';
const ORIGIN = 'https://demo.ep-case-log.invalid';

/** The registry in memory, copied to this browser's storage after each change (when the browser allows it). */
class DemoStore extends MemoryStore {
  constructor() {
    let data: StoreData = emptyData();
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) data = { ...emptyData(), ...JSON.parse(saved) };
    } catch {
      /* storage blocked: start fresh */
    }
    super(data);
  }
  protected override async persist(): Promise<void> {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage blocked or full: the demo keeps working in memory */
    }
  }
  get empty() {
    return !this.data.users.length;
  }
}

// The browser never hands a page's own Set-Cookie headers back to it, so the session cookie is kept here.
const jar = new Map<string, string>();
try {
  const s = sessionStorage.getItem(`${KEY}-cookie`);
  if (s) for (const [k, v] of JSON.parse(s) as [string, string][]) jar.set(k, v);
} catch {
  /* ignore */
}
const setCookie = Reply.prototype.setCookie;
Reply.prototype.setCookie = function (name, value, o = {}) {
  if (o.maxAge === 0 || !value) jar.delete(name);
  else jar.set(name, value);
  try {
    sessionStorage.setItem(`${KEY}-cookie`, JSON.stringify([...jar]));
  } catch {
    /* ignore */
  }
  return setCookie.call(this, name, value, o);
};

/** A request as the server code reads it. Not a browser Request: browsers drop Cookie/Host/Origin from those. */
function demoRequest(method: string, url: string, headers: Record<string, string>, body: string | undefined): Request {
  const map = new Map(Object.entries(headers));
  return {
    method,
    url,
    headers: { get: (k: string) => map.get(k.toLowerCase()) ?? null, forEach: (fn: (v: string, k: string) => void) => map.forEach(fn) },
    text: async () => body ?? '',
  } as unknown as Request;
}

async function call(router: Router, method: string, path: string, body?: unknown, csrf?: string): Promise<Response> {
  const headers: Record<string, string> = { host: new URL(ORIGIN).host };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers.origin = ORIGIN;
  if (csrf) headers['x-csrf-token'] = csrf;
  return handleApi(router, demoRequest(method, `${ORIGIN}${path}`, headers, body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)));
}

/** Made-up cases: each one is a synthetic sample note read by the Test AI, then accepted (dates spread over months). */
async function seedCases(router: Router) {
  const cfg = router.ctx.config;
  const login = await (await call(router, 'POST', '/api/auth/login', { username: 'admin', password: DEMO_PASSWORD })).json();
  const csrf = login.csrf as string;
  const groups = (await router.ctx.store.listGroups()).sort((a, b) => a.sort_order - b.sort_order);
  const months = ['2026-10-05', '2026-09-21', '2026-09-08', '2026-08-17', '2026-07-30', '2026-07-02', '2026-06-11', '2026-05-19'];
  for (const [i, fx] of cfg.aiFixtures.slice(0, 8).entries()) {
    const created = await call(router, 'POST', '/api/cases', { group_id: groups[i % 2].group_id, mrn: fx.identifiers.mrn, episode_start_date: months[i], new_case: true }, csrf);
    if (!created.ok) continue;
    const { case_id } = await created.json();
    const r = await call(router, 'POST', `/api/cases/${case_id}/ai/extract`, { note: fx.text.join('\n'), procedure_id: 'new' }, csrf);
    if (r.ok && i % 3 !== 2) await call(router, 'POST', `/api/cases/${case_id}/ai/review`, { accept_all: true }, csrf);
  }
  await call(router, 'POST', '/api/auth/logout', {}, csrf);
  jar.clear();
}

async function start(): Promise<Router> {
  const config = buildAppConfig(raw as unknown as RawConfig);
  const store = new DemoStore();
  const router = buildRouter(makeContext({ sessionSecret: 'demo-only-session-secret-not-a-real-one-0123', secureCookies: false }, store, config));
  if (store.empty) {
    await seedTestUsers(store, DEMO_PASSWORD, [
      { username: 'admin', name: 'Demo Admin', role: 'ADMIN', groupIndex: [0, 1, 2] },
      { username: 'sara', name: 'Sara (demo Member)', role: 'MEMBER', groupIndex: [0] },
    ]);
    await seedCases(router);
  }
  return router;
}

// Installed as soon as this module loads (before the app's first request); requests wait until the registry is ready.
const ready = start();
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = url.startsWith('/') ? url : new URL(url).pathname + new URL(url).search;
  if (!path.startsWith('/api/')) return realFetch(input, init);
  const router = await ready;
  const h = new Headers(init?.headers);
  return call(router, init?.method ?? 'GET', path, init?.body ?? undefined, h.get('x-csrf-token') ?? undefined);
};
