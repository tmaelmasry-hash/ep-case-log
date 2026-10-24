// Phase 8: CHA₂DS₂-VASc display (computed, incomplete until all known), case report, patients.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('CHA2DS2-VASc shows for AF care, incomplete until every item is known; report prints saved values', async ({ page }, info) => {
  const m = mrn(info, 9940000);
  await open(page);
  await createCase(page, m);
  // R3-3: the score is a line inside Baseline risk profile only (not on the case header or the list).
  await page.getByTestId('section-risk').click();
  await expect(page.getByTestId('cha-line')).toHaveCount(0); // no AF care yet
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('procedure-sheet').getByRole('group', { name: 'Procedure components' }).getByRole('button', { name: 'AF', exact: true }).click();
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('cha-chip')).toHaveCount(0);

  await page.getByTestId('section-patient').click();
  const ps = page.getByTestId('section-sheet');
  await ps.getByLabel('Date of birth').fill('1950-01-01');
  await ps.getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Female' }).click();
  await saved(page);
  await ps.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('section-risk').click();
  const rs = page.getByTestId('section-sheet');
  for (const [name, v] of [['Hypertension', 'Yes'], ['Diabetes', 'No'], ['Heart failure', 'No'], ['Vascular disease', 'No']] as const) {
    await rs.getByRole('radiogroup', { name, exact: true }).getByRole('radio', { name: v, exact: true }).click();
  }
  await saved(page);
  await expect(rs.getByTestId('cha-line')).toContainText('incomplete'); // stroke not answered yet
  // M-4a: stroke, TIA and thromboembolism are three questions.
  for (const name of ['Prior stroke', 'Prior TIA', 'Prior thromboembolic event']) {
    await rs.getByRole('radiogroup', { name, exact: true }).getByRole('radio', { name: 'No', exact: true }).click();
  }
  await saved(page);
  await expect(rs.getByTestId('cha-line')).toContainText('CHA₂DS₂-VASc (calculated)4'); // H1 + age ≥75 2 + female 1
  await rs.getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('report-row').click();
  const rep = page.getByTestId('report-sheet').getByTestId('case-report');
  await expect(rep).toContainText(`MRN ${m}`);
  await expect(rep).toContainText('CHA₂DS₂-VASc: 4');
  await expect(rep).toContainText('Hypertension');
  await expect(rep).toContainText('Procedure 1');
  await page.getByTestId('report-sheet').getByRole('button', { name: 'Print / Save as PDF' }).click();

  await page.goto(`/#/patients/${m}`);
  await expect(page.getByText(m).first()).toBeVisible();
  await expect(page.getByTestId('cha-list-chip')).toHaveCount(0);
});

test('a CIED implant opens device sections only: Device implant ticked, device + leads inside, no ablation fields', async ({ page }, info) => {
  const m = mrn(info, 9941000);
  await open(page);
  await createCase(page, m);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  const ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('radiogroup', { name: 'Primary procedure type' }).getByRole('radio', { name: 'CIED implant' }).click();
  await saved(page);
  const comps = ps.getByRole('group', { name: 'Procedure components' });
  await expect(comps.getByRole('button', { name: 'Device implant' })).toHaveAttribute('aria-pressed', 'true');
  await expect(comps.getByRole('button', { name: 'AF', exact: true })).toHaveCount(0);
  await expect(ps.getByTestId('module-DEVICE_IMPLANTS')).toBeVisible();
  await expect(ps.getByTestId('device-section')).toBeVisible();
  await expect(ps.getByTestId('device-leads')).toBeVisible();
  for (const f of ['electroanatomic_mapping_used', 'intracardiac_echo_used', 'transseptal_access']) await expect(ps.locator(`[data-field="EP_PROCEDURES.${f}"]`)).toHaveCount(0);

  // An ablation of AF shows the ablation fields and no device sections.
  await ps.getByRole('radiogroup', { name: 'Primary procedure type' }).getByRole('radio', { name: 'Ablation' }).click();
  await saved(page);
  await comps.getByRole('button', { name: 'Device implant' }).click(); // untick (it stays offered while chosen)
  await saved(page);
  await comps.getByRole('button', { name: 'AF', exact: true }).click();
  await saved(page);
  await expect(ps.locator('[data-field="EP_PROCEDURES.electroanatomic_mapping_used"]')).toBeVisible();
  await expect(ps.locator('[data-field="EP_PROCEDURES.transseptal_access"]')).toBeVisible();
  await expect(ps.getByTestId('device-section')).toHaveCount(0);
});
