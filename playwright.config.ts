import { defineConfig, devices } from '@playwright/test';

const PORT = 8790;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `rm -rf .e2e-data && PORT=${PORT} DATA_DIR=.e2e-data SYNC_TOKEN=test-token node server/sync-server.mjs`,
    url: `http://localhost:${PORT}/api/status`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
