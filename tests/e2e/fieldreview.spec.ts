// Owner field review, phase 2: patient basics with BMI, studies asked "Done / Not done" first, Holter duration with a
// unit, the Device interrogation row only when it applies. Synthetic MRNs (999xxxx) only.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('patient basics, Done / Not done studies, Holter duration and the device row', async ({ page }, info) => {
  const m = mrn(info, 9950000);
  await open(page);
  await createCase(page, m);
  // Device interrogation is listed in the owner's order of Investigations (28 Oct), device or not.
  await expect(page.getByTestId('section-devices')).toBeVisible();

  await page.getByTestId('section-patient').click();
  const ps = page.getByTestId('section-sheet');
  await ps.getByLabel('Height').fill('172');
  await ps.getByLabel('Height').press('Enter');
  await ps.getByLabel('Weight').fill('84');
  await ps.getByLabel('Weight').press('Enter');
  await saved(page);
  await expect(ps.getByTestId('bmi')).toHaveText('28.4');
  await ps.getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('section-cmr').click();
  const is = page.getByTestId('section-sheet');
  const cmr = is.getByRole('radiogroup', { name: 'CMR' });
  await expect(cmr.getByRole('radio', { name: 'Not done' })).toHaveAttribute('aria-checked', 'true');
  await cmr.getByRole('radio', { name: 'Done', exact: true }).click();
  const row = page.getByTestId('row-sheet');
  await expect(row.getByRole('radiogroup', { name: 'Imaging modality' }).getByRole('radio', { name: 'CMR' })).toHaveAttribute('aria-checked', 'true');
  await saved(page);
  await row.getByRole('button', { name: 'Done' }).click();
  await expect(cmr.getByRole('radio', { name: 'Done', exact: true })).toHaveAttribute('aria-checked', 'true');
  // Not done removes the study at once, with Undo (owner step 8).
  await cmr.getByRole('radio', { name: 'Not done' }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(cmr.getByRole('radio', { name: 'Not done' })).toHaveAttribute('aria-checked', 'true');

  // Holter (its own section since 28 Oct): 7 days is stored as 168 hours and shown again as 7 days.
  await is.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('section-holter').click();
  await is.getByRole('button', { name: 'Add holter / rhythm monitoring' }).click();
  const hs = page.getByTestId('row-sheet');
  await hs.getByLabel('Duration unit').selectOption('days');
  await hs.getByLabel('Duration', { exact: true }).fill('7');
  await hs.getByLabel('Duration', { exact: true }).press('Enter');
  await saved(page);
  await hs.getByRole('button', { name: 'Done' }).click();
  await is.getByTestId('list-row').filter({ hasText: 'Holter' }).first().click();
  await expect(page.getByTestId('row-sheet').getByLabel('Duration', { exact: true })).toHaveValue('7');
  await expect(page.getByTestId('row-sheet').getByLabel('Duration unit')).toHaveValue('24');
});
