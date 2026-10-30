// R4-4 (owner 30 Oct): several NCDR pacing reasons and generator-replacement reasons beside the unchanged implant
// indication. Synthetic MRNs only.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('a pacemaker shows several pacing reasons; a generator change also shows replacement reasons; choices are kept', async ({ page }, info) => {
  const m = mrn(info, 9944000);
  await open(page);
  await createCase(page, m);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Devices' }).getByRole('button', { name: 'Pacemaker' }).click();
  await page.getByTestId('addproc-next').click();
  const ps = page.getByTestId('procedure-sheet');
  await saved(page);
  await ps.locator('[data-field="DEVICES.current_device_type"] select').selectOption({ label: 'Pacemaker, dual chamber' });
  await saved(page);

  const pacing = ps.locator('[data-field="DEVICE_IMPLANTS.pacing_indication_reasons"]');
  const replace = ps.locator('[data-field="DEVICE_IMPLANTS.generator_replacement_reasons"]');
  await expect(ps.locator('[data-field="DEVICE_IMPLANTS.implant_indication"]')).toBeVisible(); // the old item stays
  await expect(pacing).toBeVisible();
  await expect(replace).toHaveCount(0); // no generator change yet
  for (const r of ['Complete heart block', 'Chronotropic incompetence']) await pacing.getByRole('button', { name: r }).click();
  await saved(page);

  await ps.locator('[data-field="DEVICE_IMPLANTS.device_action"] select').selectOption({ label: 'Generator change' });
  await saved(page);
  await expect(replace).toBeVisible();
  for (const r of ['End of battery life', 'Manufacturer advisory / recall']) await replace.getByRole('button', { name: r }).click();
  await saved(page);

  // Kept after a reload.
  await page.reload();
  await page.getByTestId('procedure-row').first().click();
  for (const r of ['Complete heart block', 'Chronotropic incompetence']) await expect(pacing.getByRole('button', { name: r })).toHaveAttribute('aria-pressed', 'true');
  for (const r of ['End of battery life', 'Manufacturer advisory / recall']) await expect(replace.getByRole('button', { name: r })).toHaveAttribute('aria-pressed', 'true');
  await expect(pacing.getByRole('button', { name: '2:1 AV block' })).toHaveAttribute('aria-pressed', 'false');
});
