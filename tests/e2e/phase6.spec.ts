// Phase 6: bulk add MRNs (Admin).
import { expect, test } from '@playwright/test';
import { mrn, open } from './flow';

test('Admin pastes MRNs, reviews, adds; a Member has no bulk add', async ({ page }, info) => {
  const a = mrn(info, 9920000);
  const b = mrn(info, 9920000);
  await open(page);
  await page.getByTestId('add-menu').click();
  await page.getByTestId('bulk-add').click();
  const s = page.getByTestId('bulk-sheet');
  await s.getByRole('radio', { name: 'Group 2' }).click();
  await s.getByLabel('MRNs').fill(`${a}\n${b}\n${a}\n12345`);
  await s.getByRole('button', { name: 'Review' }).click();
  await expect(s.getByTestId('bulk-summary')).toContainText('2ready');
  await expect(s.getByTestId('bulk-preview')).toContainText('Repeated in the list');
  await expect(s.getByTestId('bulk-preview')).toContainText('MRN must be exactly 7 digits.');
  await s.getByTestId('bulk-add-btn').click();
  await expect(s.getByTestId('bulk-results')).toContainText(a);
  await expect(s.getByTestId('bulk-results').getByRole('link', { name: 'Open' })).toHaveCount(2);
  await s.getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Search MRN').fill(b);
  await expect(page.getByTestId('case-row')).toHaveCount(1);

  await page.context().clearCookies();
  await page.reload();
  await open(page, 'sara');
  await expect(page.getByTestId('bulk-add')).toHaveCount(0);
});
