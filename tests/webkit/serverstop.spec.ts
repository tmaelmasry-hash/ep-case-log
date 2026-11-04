// WebKit only. Playwright's offline switch and request blocking do not work on WebKit for these flows (see
// playwright.webkit.config.ts), so this stops a real server instead. Synthetic data, in-memory store, its own port.
import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { createCase, mrn, open } from '../e2e/flow';

const PORT = 8795;
test.use({ baseURL: `http://127.0.0.1:${PORT}` });

let server: ChildProcess | null = null;
async function startServer() {
  server = spawn(process.execPath, ['server/main.ts', '--e2e'], { env: { ...process.env, PORT: String(PORT), E2E_PASSWORD: process.env.E2E_PASSWORD ?? 'synthetic-e2e-pass', SECURE_COOKIES: '0' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.ok, () => false);
    if (up) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('The test server did not start.');
}
test.afterEach(() => void server?.kill());

test('with the server stopped the app opens from the device, an edit waits, and it survives a reload', async ({ page }, info) => {
  await startServer();
  const m = mrn(info, 9980000);
  await open(page);
  await createCase(page, m);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByTestId('case-head')).toContainText(m);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  server!.kill();
  await expect.poll(() => fetch(`http://127.0.0.1:${PORT}/api/health`).then(() => 'up', () => 'down')).toBe('down');

  await page.reload();
  await expect(page.getByTestId('case-head')).toContainText(m);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  const indicator = page.getByTestId('save-indicator').filter({ visible: true }).first();
  await page.getByTestId('section-patient').click();
  const sheet = page.getByTestId('section-sheet');
  await sheet.getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Female' }).click();
  await expect(indicator).toHaveText(/Offline · \d+ waiting/);
  await sheet.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  await expect(page.getByTestId('case-head')).toContainText(m);
  await expect(indicator).toHaveText(/waiting|Syncing/);
  await page.getByTestId('section-patient').click();
  await expect(page.getByTestId('section-sheet').getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'true');
});

test('text fields are at least 16 px, so an iPhone does not zoom the page when one is tapped', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'A desktop browser does not zoom on tap.');
  await startServer();
  await open(page);
  await createCase(page, mrn(info, 9981000));
  const tooSmall = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio' && parseFloat(getComputedStyle(el).fontSize) < 16)
        .map((el) => `${el.tagName} ${el.className} ${el.getAttribute('aria-label') ?? ''} ${getComputedStyle(el).fontSize}`),
    );
  await page.getByTestId('section-patient').click();
  expect(await tooSmall()).toEqual([]);
  await page.goto('/#/cases');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  // Status and Order get 16 px through an iOS-only @supports rule, which WebKit on Windows does not apply: check the rule exists.
  expect((await tooSmall()).filter((s) => !/ (Status|Order) /.test(s))).toEqual([]);
  const iosRule = await page.evaluate(() =>
    [...document.styleSheets].some((sheet) =>
      [...sheet.cssRules].some((r) => r instanceof CSSSupportsRule && r.conditionText.includes('-webkit-touch-callout') && r.cssText.includes('select-chip') && r.cssText.includes('16px')),
    ),
  );
  expect(iosRule).toBe(true);
});
