// Round 4 (owner, 30 Oct): R4-6 Dashboard click filter — a month and/or a procedure type, Filtered bar, Clear.
// Synthetic MRNs only.
import { expect, test } from '@playwright/test';
import { mrn, open, saved } from './flow';

test('R4-6: clicking a type and a month filters the Dashboard; the same click or Clear removes it', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 9940000);
  await page.getByTestId('add-menu').click();
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  await sheet.locator('#new-date').fill('2026-09-14');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(m);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await page.getByTestId('addproc-next').click();
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();

  await page.goto('/#/stats');
  const d = page.getByTestId('dashboard');
  await d.getByRole('radio', { name: 'Include In progress' }).click();
  const types = d.getByTestId('by-category');
  await expect(types).toContainText('A case with two procedure types counts once in each type');
  await expect(d.getByTestId('dash-pick')).toHaveCount(0);

  // A type: Filtered bar, the row marked as pressed; the tables still answer.
  const af = types.getByRole('button', { name: /^AF Ablation:/ });
  await af.click();
  await expect(d.getByTestId('dash-pick')).toContainText('Filtered: AF Ablation');
  await expect(af).toHaveAttribute('aria-pressed', 'true');
  await expect(d.getByTestId('by-type')).toContainText('AF Ablation');
  await expect(d.getByTestId('acute')).toContainText('AF Ablation');

  // A month (keyboard): combines with the type.
  const sep = d.getByTestId('month-chart').getByRole('button', { name: /^Sept? 2026:/ });
  await sep.focus();
  await page.keyboard.press('Enter');
  await expect(d.getByTestId('dash-pick')).toContainText(/Sept? 2026 · AF Ablation/);
  await expect(sep).toHaveAttribute('aria-pressed', 'true');
  await expect(d.getByRole('heading', { name: 'Clinical counts' })).toBeVisible();
  await expect(d.locator('.kpi b').first()).not.toHaveText('0'); // the new case is in Sep 2026 and AF

  // The same month again clears only the month; Clear removes the rest.
  await sep.click();
  await expect(d.getByTestId('dash-pick')).not.toContainText('2026');
  await expect(d.getByTestId('dash-pick')).toContainText('AF Ablation');
  await d.getByTestId('dash-pick').getByRole('button', { name: 'Clear' }).click();
  await expect(d.getByTestId('dash-pick')).toHaveCount(0);
  await expect(af).toHaveAttribute('aria-pressed', 'false');
});
