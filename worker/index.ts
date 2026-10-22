// Cloudflare Worker (phase 4, decision D2): serves the built app (dist/, static assets) and the /api application.
// Data lives in the Google Sheet through the Apps Script gateway. Settings come from the Worker's secrets, set with
// `npx wrangler secret put NAME` (never in git): SESSION_SECRET, APPS_SCRIPT_URL, GATEWAY_SECRET.
import raw from '../server/generated/raw-config.json' with { type: 'json' };
import { buildRouter, handleApi } from '../server/api.ts';
import { buildAppConfig, type RawConfig } from '../server/appconfig.ts';
import { makeContext } from '../server/context.ts';
import { PAGE_HEADERS } from '../server/headers.ts';
import type { Router } from '../server/http.ts';
import { AppsScriptGateway, SheetsStore } from '../server/store/sheets.ts';

export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SESSION_SECRET?: string;
  APPS_SCRIPT_URL?: string;
  GATEWAY_SECRET?: string;
  /** "test" points at the TEST Sheet (synthetic data only). */
  SHEETS_TARGET?: string;
}

// One app per isolate, so the short users/groups cache lives across requests.
let router: Router | null = null;

function app(env: WorkerEnv): Router {
  if (router) return router;
  if (!env.APPS_SCRIPT_URL || !env.GATEWAY_SECRET) throw new Error('APPS_SCRIPT_URL and GATEWAY_SECRET must be set as Worker secrets');
  const config = buildAppConfig(raw as unknown as RawConfig);
  const store = new SheetsStore(config, new AppsScriptGateway(env.APPS_SCRIPT_URL, env.GATEWAY_SECRET, env.SHEETS_TARGET === 'test' ? 'test' : 'main'));
  router = buildRouter(makeContext({ sessionSecret: env.SESSION_SECRET ?? '', secureCookies: true }, store, config));
  return router;
}

function withHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(PAGE_HEADERS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(app(env), request, request.headers.get('cf-connecting-ip') ?? '0.0.0.0');
      } catch (e) {
        // Missing settings: say so without details (the details are in the Worker log).
        console.error(e);
        return Response.json({ error: { code: 'SERVER_NOT_CONFIGURED', message: 'The registry server is not set up yet.' } }, { status: 503 });
      }
    }
    return withHeaders(await env.ASSETS.fetch(request));
  },
};
