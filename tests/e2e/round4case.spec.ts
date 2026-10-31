// Browser tests for round 4, case part (R4-7 "Next missing" in the procedure sheet, R4-8 Completeness sheet).
// Synthetic MRNs (999xxxx) only.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';
import { fillCore } from './fill';

test('Next missing walks the missing items of the procedure, opens a closed part, changes nothing', async ({ page }, info) => {
  await open(page);
  const id = await createCase(page, mrn(info, 9993000));
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await page.getByTestId('addproc-next').click();
  const ps = page.getByTestId('procedure-sheet');
  await expect(ps.getByTestId('module-AF_ABLATIONS')).toBeVisible();
  await saved(page);

  // The count is the procedure's missing core items (the same number as its row on the case page).
  const next = ps.getByTestId('next-missing');
  await expect(next).toBeVisible();
  await expect(next).toContainText(/Next missing\s*1 of \d+/);
  const total = Number((await next.textContent())!.match(/of (\d+)/)![1]);
  expect(total).toBeGreaterThan(1);

  // Close every part; the first press opens the part that holds the first missing item and marks the field.
  // Close the first open part until none is open (a fixed list of nth() locators shifts as parts close).
  const openHeads = ps.locator('.part-head[aria-expanded="true"]');
  while ((await openHeads.count()) > 0) await openHeads.first().click();
  await expect(ps.locator('.part-head[aria-expanded="true"]')).toHaveCount(0);
  await next.click();
  await expect(ps.locator('.part-head[aria-expanded="true"]')).toHaveCount(1);
  const mark = ps.locator('.next-mark');
  await expect(mark).toHaveCount(1);
  await expect(mark).toBeInViewport();
  // The count shows where you are now (owner, 30 Oct): on the first item it reads "1 of N".
  await expect(next).toContainText(`1 of ${total}`);
  // The mark goes after about 2 seconds.
  await expect(mark).toHaveCount(0, { timeout: 4000 });

  // It wraps around after the last one.
  for (let k = 2; k <= total; k++) await next.click();
  await expect(next).toContainText(`${total} of ${total}`);
  await next.click();
  await expect(next).toContainText(`1 of ${total}`);

  // Nothing was saved or changed by moving around.
  await ps.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('case-status')).toHaveText('In progress');
  await expect(page.getByTestId('procedure-row')).toContainText(`${total} missing`);

  // Everything filled: the button is gone.
  await fillCore(page, id);
  await page.reload();
  await page.getByTestId('procedure-row').click();
  await expect(page.getByTestId('procedure-sheet')).toBeVisible();
  await expect(page.getByTestId('next-missing')).toHaveCount(0);
});

test('Completeness sheet: tiles, a row per section, Fix goes to the field', async ({ page }, info) => {
  await open(page);
  const id = await createCase(page, mrn(info, 9993000));
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await page.getByTestId('addproc-next').click();
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();

  // Everything filled (synthetic) except LA/LAA thrombus status.
  await fillCore(page, id, ['AF_ABLATIONS.la_laa_thrombus_status']);
  await page.reload();

  await page.getByTestId('completeness-row').click();
  const sheet = page.getByTestId('completeness-sheet');
  await expect(sheet).toBeVisible();
  const answered = sheet.getByTestId('cmp-answered');
  const recorded = sheet.getByTestId('cmp-recorded');
  // After the reload the device copy shows first; wait for the server copy (one item left).
  const counts = async () => (await answered.locator('.cmp-num').textContent())!.match(/\d+/g)!.map(Number);
  await expect.poll(async () => { const [d, t] = await counts(); return t - d; }).toBe(1);
  const [, all] = await counts();
  await expect(recorded.locator('.cmp-num')).toContainText(`of ${all}`);

  // Sections without core items say so; the patient section is complete.
  await expect(sheet.getByTestId('cmp-s:labs')).toContainText('No core items here');
  await expect(sheet.getByTestId('cmp-s:patient')).toContainText('✓');
  await expect(sheet.getByRole('button', { name: 'Fix' })).toHaveCount(1);

  // Fix opens the procedure at the missing field.
  await sheet.getByRole('button', { name: 'Fix' }).click();
  const field = page.getByTestId('procedure-sheet').locator('[data-field="AF_ABLATIONS.la_laa_thrombus_status"]');
  await expect(field).toBeVisible();
});
