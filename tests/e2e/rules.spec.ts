// M-1 dynamic-form rules on the screen (EP Workspace): a field shows only when it applies; a change that makes
// answers not apply asks first (Remove n answers / Keep). Synthetic MRNs (9990xxx) only.
import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('mapping system follows "mapping used"; turning it off asks before removing the system', async ({ page }, info) => {
  await page.goto('/#/cases');
  const form = page.getByRole('form', { name: 'Sign in' });
  await expect(form.or(page.getByRole('navigation', { name: 'Main' }))).toBeVisible();
  if (await form.isVisible()) await signIn(page, 'admin');
  const m = String((info.project.name === 'desktop' ? 9991300 : 9991400) + Math.floor(Math.random() * 90));
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  await sheet.locator('#new-date').fill('2026-03-12');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  const ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  const used = ps.getByRole('radiogroup', { name: 'Electroanatomic mapping used' });
  const system = ps.getByRole('radiogroup', { name: 'Mapping system' });
  await expect(system).toHaveCount(0);
  await used.getByRole('radio', { name: 'Yes', exact: true }).click();
  await system.getByRole('radio', { name: 'Carto' }).click();
  await expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Synced');

  // Keep: nothing changes.
  await used.getByRole('radio', { name: 'No', exact: true }).click();
  await expect(page.getByTestId('rule-consequences')).toContainText('Mapping system');
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await expect(used.getByRole('radio', { name: 'Yes', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(system.getByRole('radio', { name: 'Carto' })).toHaveAttribute('aria-checked', 'true');

  // Remove: the system goes, and the field hides.
  await used.getByRole('radio', { name: 'No', exact: true }).click();
  await page.getByRole('button', { name: 'Remove 1 answer' }).click();
  await expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Synced');
  await expect(used.getByRole('radio', { name: 'No', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(system).toHaveCount(0);
});
