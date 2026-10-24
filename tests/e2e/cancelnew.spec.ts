// Owner, 24 Oct: Cancel on a procedure (or row) just added leaves nothing behind, and the page behind an open sheet
// stays still. Synthetic MRNs (999xxxx) only.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('Cancel on a new procedure takes it away; with ticks it asks first; Done keeps it', async ({ page }, info) => {
  const m = mrn(info, 9960000);
  await open(page);
  await createCase(page, m);
  const rows = page.getByTestId('procedure-row');
  const ps = page.getByTestId('procedure-sheet');

  // Nothing entered: Cancel removes it at once.
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await expect(ps).toBeVisible();
  await ps.getByRole('button', { name: 'Cancel' }).click();
  await expect(ps).toHaveCount(0);
  await expect(rows).toHaveCount(0);

  // Something ticked: Cancel asks; "Cancel" in the question keeps the sheet open; Done keeps the procedure.
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await ps.getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'VT', exact: true }).click();
  await ps.getByRole('button', { name: 'Cancel' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Discard this new procedure?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(ps).toBeVisible();
  await ps.getByRole('button', { name: 'Done' }).click();
  await expect(rows).toHaveCount(1);

  // Opened again later, Cancel only closes it.
  await rows.first().click();
  await ps.getByRole('button', { name: 'Cancel' }).click();
  await expect(rows).toHaveCount(1);

  // Ticked, then Discard: gone.
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await ps.getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'PVC', exact: true }).click();
  await ps.getByRole('button', { name: 'Cancel' }).click();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(ps).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await saved(page);

  // The saved copy agrees after a reload.
  await page.reload();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  await expect(rows).toHaveCount(1);
});

test('the page behind an open sheet does not scroll', async ({ page }, info) => {
  await open(page);
  await createCase(page, mrn(info, 9961000));
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await expect(page.getByTestId('procedure-sheet')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
});
