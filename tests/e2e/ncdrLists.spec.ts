// Q-S1 (31 Oct): printed NCDR dynamic-list values. Prior AF ablation strategies show for a redo only; the energies
// used offer Ethanol. Synthetic MRNs only.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('AF redo asks for prior ablation strategies; energies used offer Ethanol; choices are kept', async ({ page }, info) => {
  const m = mrn(info, 9945000);
  await open(page);
  await createCase(page, m);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await page.getByTestId('addproc-next').click();
  const ps = page.getByTestId('procedure-sheet');
  const af = ps.getByTestId('module-AF_ABLATIONS');
  await expect(af).toBeVisible();
  await saved(page);

  const strategies = ps.locator('[data-field="AF_ABLATIONS.prior_af_ablation_strategies"]');
  await expect(strategies).toHaveCount(0); // first procedure: not asked
  await ps.getByRole('radiogroup', { name: 'First or redo' }).getByRole('radio', { name: 'Redo', exact: true }).click();
  await saved(page);
  await expect(strategies).toBeVisible();
  for (const s of ['Pulmonary vein isolation', 'Empiric LA linear lesions']) await strategies.getByRole('button', { name: s }).click();
  await saved(page);

  await af.getByLabel('Energy source').selectOption({ label: 'Multiple' });
  await saved(page);
  const energies = ps.locator('[data-field="AF_ABLATIONS.af_energy_sources_used"]');
  for (const e of ['RF', 'Ethanol']) await energies.getByRole('button', { name: e, exact: true }).click();
  await saved(page);

  await page.reload();
  await page.getByTestId('procedure-row').first().click();
  for (const s of ['Pulmonary vein isolation', 'Empiric LA linear lesions']) await expect(strategies.getByRole('button', { name: s })).toHaveAttribute('aria-pressed', 'true');
  await expect(strategies.getByRole('button', { name: 'Focal ablation' })).toHaveAttribute('aria-pressed', 'false');
  for (const e of ['RF', 'Ethanol']) await expect(energies.getByRole('button', { name: e, exact: true })).toHaveAttribute('aria-pressed', 'true');
});
