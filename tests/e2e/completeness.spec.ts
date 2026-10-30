// R4-8 (group part): Data completeness screen for the Admin — one row per case, pager, Excel, MRN opens the case;
// a Member is refused. Synthetic MRNs only.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open } from './flow';

test('Admin opens Data completeness from Admin; the new case is a row; MRN opens it; Excel downloads', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 9990000);
  const id = await createCase(page, m);
  await page.goto('/#/admin');
  await page.getByTestId('admin-completeness').click();
  const v = page.getByTestId('completeness-view');
  await expect(v.getByRole('heading', { name: 'Data completeness' })).toBeVisible();
  await expect(v.getByTestId('cm-in-progress')).toHaveAttribute('aria-pressed', 'true');
  await expect(v.getByTestId('cm-pager')).toContainText(/1–\d+ of \d+/);
  await expect(v).toContainText('Core answered counts recorded + not available with a reason.');
  // Rows go by group, then No.: the newest case is on the last page.
  const next = v.getByTestId('cm-next');
  while (await next.isEnabled()) await next.click();
  const row = v.getByTestId('cm-row').filter({ hasText: m });
  await expect(row).toHaveCount(1);
  // A new case has no procedure: nothing required under Procedure.
  await expect(row.locator('td[data-section="procedure"]')).toHaveText('—');
  await expect(row.locator('td[data-section="patient"]')).not.toHaveText('—');

  const file = page.waitForEvent('download');
  await v.getByTestId('cm-excel').click();
  expect((await file).suggestedFilename()).toBe('KAMC_EP_Registry_Data_completeness.xlsx');

  await row.getByTestId('cm-mrn').click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${id}`));
  await expect(page.getByTestId('case-head')).toContainText(m);
});

test('a Member is refused Data completeness, on screen and on the server', async ({ page }) => {
  await open(page, 'sara', '#/completeness');
  await expect(page.getByText('Admin only.')).toBeVisible();
  expect((await page.request.get('/api/completeness')).status()).toBe(403);
});
