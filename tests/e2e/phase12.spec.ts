// Phase 12: the follow-up bell is built but switched off (config/site.json followup_due.enabled: false).
import { expect, test } from '@playwright/test';
import { open } from './flow';

test('the follow-up bell is not shown while it is switched off', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('add-menu')).toBeVisible();
  await expect(page.getByTestId('followup-bell')).toHaveCount(0);
});
