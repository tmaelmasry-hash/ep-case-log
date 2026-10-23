// Phase 8: CHA₂DS₂-VASc display (computed, incomplete until all known), case report, patients.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('CHA2DS2-VASc shows for AF care, incomplete until every item is known; report prints saved values', async ({ page }, info) => {
  const m = mrn(info, 9940000);
  await open(page);
  await createCase(page, m);
  await expect(page.getByTestId('cha-chip')).toHaveCount(0); // no AF care yet
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('procedure-sheet').getByRole('group', { name: 'Procedure components' }).getByRole('button', { name: 'AF', exact: true }).click();
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('cha-chip')).toHaveText('CHA₂DS₂-VASc incomplete');

  await page.getByTestId('section-patient').click();
  const ps = page.getByTestId('section-sheet');
  await ps.getByLabel('Date of birth').fill('1950-01-01');
  await ps.getByRole('radiogroup', { name: 'Sex at birth' }).getByRole('radio', { name: 'Female' }).click();
  await saved(page);
  await ps.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('section-risk').click();
  const rs = page.getByTestId('section-sheet');
  for (const [name, v] of [['Hypertension', 'Yes'], ['Diabetes', 'No'], ['Heart failure', 'No'], ['Vascular disease', 'No']] as const) {
    await rs.getByRole('radiogroup', { name, exact: true }).getByRole('radio', { name: v, exact: true }).click();
  }
  await saved(page);
  await expect(page.getByTestId('cha-chip')).toHaveText('CHA₂DS₂-VASc incomplete'); // stroke not answered yet
  // M-4a: stroke, TIA and thromboembolism are three questions.
  for (const name of ['Prior stroke', 'Prior TIA', 'Prior thromboembolic event']) {
    await rs.getByRole('radiogroup', { name, exact: true }).getByRole('radio', { name: 'No', exact: true }).click();
  }
  await saved(page);
  await rs.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('cha-chip')).toHaveText('CHA₂DS₂-VASc 4'); // H1 + age ≥75 2 + female 1
  await page.getByTestId('cha-chip').click();
  await expect(page.getByTestId('cha-sheet')).toContainText('+2');
  await page.getByTestId('cha-sheet').getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('report-row').click();
  const rep = page.getByTestId('report-sheet').getByTestId('case-report');
  await expect(rep).toContainText(`MRN ${m}`);
  await expect(rep).toContainText('CHA₂DS₂-VASc: 4');
  await expect(rep).toContainText('Hypertension');
  await expect(rep).toContainText('Procedure 1');
  await page.getByTestId('report-sheet').getByRole('button', { name: 'Print / Save as PDF' }).click();

  await page.goto(`/#/patients/${m}`);
  await expect(page.getByTestId('cha-list-chip')).toHaveText('CHA₂DS₂-VASc 4');
});
