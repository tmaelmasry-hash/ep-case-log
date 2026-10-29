// Phase 12 / step 5: follow-ups due are a tab (config/site.json followup_due.enabled: true since step 5, owner 29 Oct).
import { expect, test } from '@playwright/test';
import { open } from './flow';

test('the Follow-up tab lists visits and device checks due, or says nothing is due', async ({ page }) => {
  await open(page, 'admin', '#/followup');
  await expect(page.getByTestId('followup-view')).toBeVisible();
  await expect(page.getByTestId('followup-view')).toContainText('due in the next 90 days');
  await expect(page.getByTestId('followup-bell')).toHaveCount(0);
});

test('opening the app lands on My work; a Member has no Dashboard tab', async ({ page }) => {
  await open(page, 'sara', '#/');
  await page.goto('/');
  await expect(page.getByTestId('mywork')).toBeVisible();
  await expect(page.getByTestId('done-this-week')).toBeVisible();
  await expect(page.getByTestId('tab-stats')).toHaveCount(0);
  await expect(page.getByTestId('tab-patients')).toHaveCount(0);
});
