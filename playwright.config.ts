import { defineConfig, devices } from '@playwright/test';

const PORT = 8790;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `PORT=${PORT} E2E_PASSWORD=${process.env.E2E_PASSWORD ?? 'synthetic-e2e-pass'} node server/main.ts --e2e`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
