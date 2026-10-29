// Screen review step 6 (owner, 29 Oct): Settings look, Admin page, move a case, Bulk add's planned type, AI switch.
// Synthetic MRNs only.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open } from './flow';

test('Settings: theme and text size apply on this device; the Admin page has users and the AI switch', async ({ page }) => {
  await open(page, 'admin', '#/settings');
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radiogroup', { name: 'Text size' }).getByRole('radio', { name: 'Larger' }).click();
  expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('21px');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Auto' }).click();
  await page.getByRole('radiogroup', { name: 'Text size' }).getByRole('radio', { name: 'Normal' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);

  await page.getByTestId('admin-link').click();
  await expect(page.getByTestId('admin-view')).toBeVisible();
  await expect(page.getByTestId('users-list')).toBeVisible();
  // The switch itself is tested on the server (tests/server/step6.test.ts): flipping it here would hide the AI
  // Assistant from the AI tests running at the same time.
  await expect(page.getByTestId('ai-visible')).toBeChecked();
  await expect(page.getByTestId('ai-settings')).toBeVisible();
});

test('Admin moves a case to another group; it gets a new number', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 9961000);
  await createCase(page, m, { group: 'Group 1' });
  await page.getByTestId('move-row').click();
  const s = page.getByTestId('move-sheet');
  await s.getByRole('radio', { name: 'Group 3' }).click();
  await s.getByTestId('move-confirm').click();
  await expect(s).toHaveCount(0);
  await expect(page.getByTestId('case-head')).toContainText('Group 3');
  await page.getByTestId('history-row').click();
  await expect(page.getByText(/Moved from Group 1 No\. \d+ to Group 3 No\. \d+/)).toBeVisible();
});

test('Bulk add with one procedure type shows it as planned and the menu finds it', async ({ page }, info) => {
  const a = mrn(info, 9962000);
  await open(page);
  await page.getByTestId('add-menu').click();
  await page.getByTestId('bulk-add').click();
  const s = page.getByTestId('bulk-sheet');
  await s.getByTestId('bulk-planned').getByRole('radio', { name: 'Flutter' }).click();
  await s.getByLabel('MRNs').fill(a);
  await s.getByRole('button', { name: 'Review' }).click();
  await s.getByTestId('bulk-add-btn').click();
  await expect(s.getByTestId('bulk-results')).toContainText(a);
  await s.getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Search MRN').fill(a);
  await expect(page.getByTestId('planned-chip')).toHaveText('Flutter (planned)');
});
