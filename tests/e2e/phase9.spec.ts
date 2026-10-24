// Phase 9: My work (everyone) and the Admin dashboard.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open } from './flow';

test('My work lists my open case with what is missing; Admin sees the dashboard, a Member does not', async ({ page }, info) => {
  const m = mrn(info, 9950000);
  await open(page, 'sara');
  await createCase(page, m);
  await page.goto('/#/stats');
  await expect(page.getByTestId('mywork')).toBeVisible();
  await expect(page.getByTestId('mywork-row').filter({ hasText: m })).toContainText('missing: Sex');
  await expect(page.getByRole('radio', { name: 'Dashboard' })).toHaveCount(0);

  await page.context().clearCookies();
  await page.reload();
  await open(page, 'admin', '#/stats');
  await page.getByRole('radio', { name: 'Dashboard' }).click();
  const d = page.getByTestId('dashboard');
  await expect(d.getByTestId('acute')).toContainText('AF Ablation');
  await expect(d).not.toContainText(m);
  await d.getByRole('radio', { name: 'Include In progress' }).click();
  await expect(d).toContainText('Clinical counts');
});
