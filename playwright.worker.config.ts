// The same browser tests, run against the Cloudflare Worker (wrangler dev, local workerd runtime) with the Google
// Sheet store talking to a local stand-in for the Apps Script web app (real Code.js, fake sheet). `npm run e2e:worker`
import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

const PORT = 8793;
const FAKE = 8794;
const PASS = process.env.E2E_PASSWORD ?? 'synthetic-e2e-pass';
const GW = 'local-fake-gateway-secret-0123456789abcdef';
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORT}` },
  webServer: [
    { command: `node tests/e2e/fakeAppsScriptServer.ts ${FAKE} ${GW} ${PASS}`, port: FAKE, reuseExistingServer: false, timeout: 20_000 },
    {
      command: `npx wrangler dev --port ${PORT} --ip 127.0.0.1 --var SESSION_SECRET:e2e-worker-session-secret-0123456789abcdef --var APPS_SCRIPT_URL:http://127.0.0.1:${FAKE}/exec --var GATEWAY_SECRET:${GW}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
  ],
});
