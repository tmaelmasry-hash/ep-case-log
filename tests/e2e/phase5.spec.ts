// Phase 5: MRN prompt and copy-forward.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('an MRN with a case is answered with it; a new case copies the history, marked "Copied"', async ({ page }, info) => {
  const m = mrn(info, 9910000);
  await open(page);
  await createCase(page, m);
  await page.getByTestId('section-patient').click();
  await page.getByTestId('section-sheet').getByRole('radiogroup', { name: 'Sex at birth' }).getByRole('radio', { name: 'Female' }).click();
  await saved(page);
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Done' }).click();

  await page.goto('/#/cases');
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  await sheet.getByRole('radio', { name: 'Group 1' }).click();
  await sheet.getByRole('button', { name: 'Create case' }).click();
  const prompt = sheet.getByTestId('mrn-prompt');
  await expect(prompt).toContainText('This MRN already has 1 case in this group.');
  await expect(prompt.getByRole('link')).toContainText('No. ');
  await prompt.getByRole('button', { name: 'Add a new case for this MRN' }).click();

  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  await expect(page.getByTestId('copied-banner')).toContainText('1 history value was copied from Group 1 No.');
  await page.getByTestId('section-patient').click();
  const sex = page.getByTestId('section-sheet').locator('[data-field="PATIENTS.sex_at_birth"]');
  await expect(sex.getByTestId('copied-tag')).toBeVisible();
  await sex.getByRole('radio', { name: 'Male', exact: true }).click();
  await saved(page);
  await expect(sex.getByTestId('copied-tag')).toHaveCount(0);
});
