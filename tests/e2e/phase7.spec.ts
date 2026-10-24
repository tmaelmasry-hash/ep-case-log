// Phase 7: light follow-up (per procedure; main fields first; quick events as Yes + date).
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('add a 6-month follow-up to a procedure with a quick event', async ({ page }, info) => {
  await open(page);
  await createCase(page, mrn(info, 9930000));
  await page.getByTestId('section-followup').click();
  await expect(page.getByTestId('followups-sheet')).toContainText('Add a procedure first');
  await page.getByTestId('followups-sheet').getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('procedure-sheet').getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('section-followup').click();
  await page.getByTestId('followups-sheet').getByRole('button', { name: 'Add follow-up visit' }).click();
  const s = page.getByTestId('followup-sheet');
  await s.getByRole('radiogroup', { name: 'Followup timepoint' }).getByRole('radio', { name: 'M6' }).click();
  await s.getByLabel('Actual followup date').fill('2026-09-10');
  const q = s.getByTestId('quick-events').locator('[data-quick="ARRHYTHMIA_RECURRENCE"]');
  await q.getByRole('radio', { name: 'Yes' }).click();
  await q.getByLabel(/date/).fill('2026-08-01');
  await saved(page);
  await expect(s.getByText('More fields')).toBeVisible();
  await s.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('followup-row')).toContainText('Sep 10, 2026');
  await expect(page.getByTestId('followup-row')).toContainText('1 events');

  // Saved on the server.
  await page.reload();
  await page.getByTestId('section-followup').click();
  await page.getByTestId('followup-row').click();
  await expect(page.getByTestId('followup-sheet').getByTestId('quick-events').locator('[data-quick="ARRHYTHMIA_RECURRENCE"]').getByLabel(/date/)).toHaveValue('2026-08-01');
});
