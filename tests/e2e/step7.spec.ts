// Screen review step 7 (owner, 29 Oct): Dashboard period chips, chart, Hajj season split, Excel buttons, statistics
// file. Synthetic MRNs only.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open } from './flow';

test('Dashboard shows the month chart and the Hajj season table; a table and the statistics file download', async ({ page }, info) => {
  await open(page);
  await createCase(page, mrn(info, 9970000));
  await page.goto('/#/stats');
  const d = page.getByTestId('dashboard');
  await expect(d.getByTestId('month-chart')).toBeVisible();
  await expect(d.getByTestId('hajj-split')).toContainText('Hajj season vs rest of year');
  await expect(d.getByTestId('kpi-no-change')).toContainText('No change 14+ days');

  const table = page.waitForEvent('download');
  await d.getByRole('button', { name: 'Cases by month to Excel' }).click();
  expect((await table).suggestedFilename()).toBe('KAMC_EP_Registry_Cases_by_month.xlsx');

  await d.getByTestId('stats-file').click();
  const s = page.getByTestId('stats-sheet');
  await s.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name: 'All dates' }).click();
  await s.getByRole('radiogroup', { name: 'Cases' }).getByRole('radio', { name: 'All' }).click();
  const file = page.waitForEvent('download');
  await s.getByTestId('stats-download').click();
  expect((await file).suggestedFilename()).toBe('KAMC_EP_Registry_statistics_all_dates.xlsx');
});

test('Dashboard period chips set the period', async ({ page }) => {
  await open(page, 'admin', '#/stats');
  await page.getByRole('radiogroup', { name: 'Dashboard period' }).getByRole('radio', { name: 'This year' }).click();
  await expect(page.getByTestId('dashboard-filter')).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Dashboard period' }).getByRole('radio', { name: 'This year' }).click();
  await expect(page.getByTestId('dashboard-filter')).toHaveCount(0);
});
