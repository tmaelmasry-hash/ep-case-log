// Phase 11: AI Assistant with Test AI (synthetic sample notes only).
import { expect, test } from '@playwright/test';
import { createCase, mrn, open } from './flow';

test('AI Assistant fills from a sample note; values wait for review, then Accept all', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_310_000);
  await createCase(page, m);

  await page.getByTestId('ai-row').click();
  const sheet = page.getByTestId('ai-sheet');
  await expect(sheet.getByTestId('ai-provider')).toContainText('Test AI');
  // No procedure yet: the note goes into a new one.
  await expect(sheet.getByTestId('ai-target')).toHaveValue('new');
  await sheet.getByTestId('ai-sample').selectOption('N01');
  await expect(sheet.getByTestId('ai-note')).toHaveValue(new RegExp(`MRN ${m}\\.`));
  await sheet.getByTestId('ai-extract').click();
  await expect(sheet.getByTestId('ai-run')).toContainText('filled');
  expect(await sheet.getByTestId('ai-value').count()).toBeGreaterThan(5);
  await expect(sheet.getByTestId('ai-value').filter({ hasText: 'Hypertension' })).toContainText('hypertension on amlodipine');
  await sheet.getByRole('button', { name: 'Done' }).click();

  // On the case: a procedure was made, values carry the AI tag, and the banner holds Complete back.
  await expect(page.getByTestId('procedure-row')).toHaveCount(1);
  await expect(page.getByTestId('ai-banner')).toContainText('AI value');
  await page.getByTestId('section-risk').click();
  await expect(page.getByTestId('ai-tag').first()).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // Reject one, accept the rest.
  await page.getByTestId('ai-banner').getByRole('button', { name: 'Review' }).click();
  const before = await sheet.getByTestId('ai-value').count();
  await sheet.getByRole('button', { name: 'Reject Diabetes' }).click();
  await expect(sheet.getByTestId('ai-value')).toHaveCount(before - 1);
  await sheet.getByTestId('ai-accept-all').click();
  await expect(sheet.getByTestId('ai-value')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('ai-banner')).toHaveCount(0);
});

test('a note naming another MRN is stopped before anything is sent', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_320_000);
  await createCase(page, m);
  await page.getByTestId('ai-row').click();
  const sheet = page.getByTestId('ai-sheet');
  await sheet.getByTestId('ai-note').fill('EP note. MRN 9999999. Hypertension on amlodipine.');
  await sheet.getByTestId('ai-extract').click();
  await expect(sheet.getByTestId('ai-error')).toContainText('MRN 9999999');
  await expect(sheet.getByTestId('ai-value')).toHaveCount(0);
});

test('Admin sees the AI provider choice and key status', async ({ page }) => {
  await open(page, 'admin', '#/admin');
  await expect(page.getByTestId('ai-settings')).toContainText('Test AI');
  await expect(page.getByTestId('ai-settings')).toContainText('key not set');
});
