// The same e2e tests on WebKit, Safari's engine: Mac and iPhone sizes. Needs `npm run build` and, once,
// `npx playwright install webkit`. WebKit on Windows is not real Safari: the owner's iPhone and Mac trial still decides.
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.ts';

export default defineConfig({
  ...base,
  testDir: 'tests',
  testMatch: ['e2e/**/*.spec.ts', 'webkit/**/*.spec.ts'],
  outputDir: 'test-results/webkit',
  reporter: [['list'], ['json', { outputFile: 'test-results/webkit-results.json' }]],
  // On WebKit, reload after context.setOffline() ends in "WebKit encountered an internal error", and page.route() did not
  // block the save in the edit test. tests/webkit/serverstop.spec.ts covers opening and editing with a really stopped server.
  // Not covered here: the send when the connection returns. Chromium runs these four, and the real-device trial checks it.
  grepInvert: /without the server the app says so clearly|L3: the app opens without internet|an edit made without connection waits|offline new case: the MRN note/,
  // WebKit drops a Secure cookie on http://127.0.0.1, unlike Chromium. Local test server only: the live site stays HTTPS with Secure cookies.
  webServer: {
    command: 'node server/main.ts --e2e',
    env: { PORT: '8790', E2E_PASSWORD: process.env.E2E_PASSWORD ?? 'synthetic-e2e-pass', SECURE_COOKIES: '0' },
    url: 'http://127.0.0.1:8790/api/health',
    reuseExistingServer: false,
    timeout: 20_000,
  },
  // Keep these two names: the tests choose their made-up MRN ranges from "desktop" or anything else.
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 820 } } },
    { name: 'mobile', use: { ...devices['iPhone 14'] } },
  ],
});
