// Phase 10: Excel export from Settings.
import { expect, test } from '@playwright/test';
import { open } from './flow';

test('Admin downloads the whole registry; a Member only their group', async ({ page }) => {
  await open(page, 'admin', '#/settings');
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-all').click()]);
  expect(file.suggestedFilename()).toMatch(/^EP_Case_Log_All_.*\.xlsx$/);
  await page.context().clearCookies();
  await page.reload();
  await open(page, 'sara', '#/settings');
  await expect(page.getByTestId('export-all')).toHaveCount(0);
  const [g] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-group').first().click()]);
  expect(g.suggestedFilename()).toMatch(/^EP_Case_Log_Group1_.*\.xlsx$/);
});
