// Owner, 4 Nov: a list or number field must stay open while the screen refreshes behind it (a message closing, a sync).
// A native list closes when focus leaves it, so focus staying on the field is what is checked. Synthetic data only.
import { expect, test, type Page } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

const focused = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-field]')?.getAttribute('data-field') ?? document.activeElement?.tagName);

test('a list and a number field keep focus while the screen refreshes behind them', async ({ page }, info) => {
  await open(page);
  await createCase(page, mrn(info, 9952000)); // its "created" message closes by itself a few seconds later
  await page.getByTestId('section-others').click();
  await page.getByTestId('section-sheet').getByRole('radiogroup', { name: 'Tilt-table test' }).getByRole('radio', { name: 'Done', exact: true }).click();
  const row = page.getByTestId('row-sheet');

  const list = row.locator('[data-field="TILT_TESTS.test_result"] select');
  await list.focus();
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 8000 }); // the screen refreshed
  expect(await focused(page)).toBe('TILT_TESTS.test_result');

  const number = row.locator('[data-field="TILT_TESTS.supine_hr_bpm"] input');
  await number.focus();
  await page.keyboard.type('7');
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); // a sync starts
  await page.waitForTimeout(1500);
  expect(await focused(page)).toBe('TILT_TESTS.supine_hr_bpm');
  await page.keyboard.type('2');
  await expect(number).toHaveValue('72');

  // Enter saves the number and stays on the field; the save coming back does not move focus either.
  await page.keyboard.press('Enter');
  await saved(page);
  expect(await focused(page)).toBe('TILT_TESTS.supine_hr_bpm');
  await expect(number).toHaveValue('72');

  // Escape still uses the newest close action: this study now has a value, so it asks first.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog', { name: /Discard this new/ })).toBeVisible();
});
