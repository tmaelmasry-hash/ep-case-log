// Phase 11: AI Assistant with Test AI (synthetic sample notes only).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createCase, mrn, open } from './flow';

/** A made-up sample note, with this test's MRN. */
const sampleNote = (id: string, m: string) => {
  const notes = JSON.parse(readFileSync('config/ai_fixtures.json', 'utf8')).notes as { id: string; identifiers: { mrn: string }; text: string[] }[];
  const fx = notes.find((f) => f.id === id)!;
  return fx.text.join('\n').split(fx.identifiers.mrn).join(m);
};
const n01 = (m: string) => sampleNote('N01', m);

test('AI Assistant fills from a note after the review step; values wait for review, then Accept all', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_310_000);
  await createCase(page, m);

  await page.getByTestId('ai-row').click();
  const sheet = page.getByTestId('ai-sheet');
  await expect(sheet.getByTestId('ai-provider')).toContainText('Test AI');
  // The owner's choices are gone: no "This note describes", no sample notes.
  await expect(sheet.getByTestId('ai-target')).toHaveCount(0);
  await expect(sheet.getByTestId('ai-sample')).toHaveCount(0);
  const note = n01(m);
  await sheet.getByTestId('ai-note').fill(note);
  await sheet.getByTestId('ai-preview').click();

  // What will be sent: identifiers out, clinical text in. Nothing has been filled yet.
  await expect(sheet.getByTestId('ai-removed')).toContainText('MRN');
  const text = sheet.getByTestId('ai-sent-text');
  await expect(text).toHaveValue(/MRN \[MRN\]\./);
  await expect(text).toHaveValue(/hypertension on amlodipine/);
  await expect(text).not.toHaveValue(new RegExp(m));
  await expect(page.getByTestId('procedure-row')).toHaveCount(0);

  // Back keeps what was typed.
  await sheet.getByTestId('ai-back').click();
  await expect(sheet.getByTestId('ai-note')).toHaveValue(note);
  await sheet.getByTestId('ai-preview').click();

  await sheet.getByTestId('ai-send').click();
  await expect(sheet.getByTestId('ai-run')).toContainText('to review');
  expect(await sheet.getByTestId('ai-value').count()).toBeGreaterThan(5);
  await expect(sheet.getByTestId('ai-value').filter({ hasText: 'Hypertension' })).toContainText('hypertension on amlodipine');
  await sheet.getByRole('button', { name: 'Done' }).click();

  // On the case: nothing is in it yet. The banner holds Complete back.
  await expect(page.getByTestId('procedure-row')).toHaveCount(0);
  await expect(page.getByTestId('ai-banner')).toContainText('AI value');
  await page.getByTestId('section-risk').click();
  await expect(page.getByTestId('ai-tag')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();

  // They wait on this device: a reload keeps them.
  await page.reload();
  await expect(page.getByTestId('ai-banner')).toContainText('AI value');

  // Reject one, take one back, change one, accept the rest.
  await page.getByTestId('ai-banner').getByRole('button', { name: 'Review' }).click();
  const before = await sheet.getByTestId('ai-value').count();
  await sheet.getByRole('button', { name: 'Reject Diabetes' }).click();
  await expect(sheet.getByTestId('ai-value')).toHaveCount(before - 1);
  await sheet.getByRole('button', { name: 'Accept Hypertension' }).click();
  await expect(sheet.getByTestId('ai-value')).toHaveCount(before - 2); // at once, with no wait for the Sheet
  await sheet.getByTestId('ai-accepted').filter({ hasText: 'Hypertension' }).getByRole('button', { name: 'Undo' }).click();
  await expect(sheet.getByTestId('ai-value')).toHaveCount(before - 1);
  await sheet.getByRole('button', { name: 'Edit Sex' }).click();
  await sheet.getByTestId('ai-edit-input').selectOption('FEMALE');
  await sheet.getByTestId('ai-edit-accept').click();
  await sheet.getByTestId('ai-accept-all').click();
  await expect(sheet.getByTestId('ai-value')).toHaveCount(0);
  await expect(sheet.getByTestId('ai-save')).toContainText('Saved', { timeout: 15_000 });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('ai-banner')).toHaveCount(0);
  await expect(page.getByTestId('procedure-row')).toHaveCount(1);

  // In the case now, as ordinary values, and still after a reload.
  await page.reload();
  await page.getByTestId('section-patient').click();
  await expect(page.getByTestId('section-sheet')).toContainText('Female');
  await expect(page.getByTestId('ai-tag')).toHaveCount(0);
});

test('a device check note fills Device Interrogation; the review list names the device and the case page shows it', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_330_000);
  await createCase(page, m);
  await page.getByTestId('ai-row').click();
  const sheet = page.getByTestId('ai-sheet');
  await sheet.getByTestId('ai-note').fill(sampleNote('N16', m));
  await sheet.getByTestId('ai-preview').click();
  await sheet.getByTestId('ai-send').click();
  await expect(sheet.getByTestId('ai-run')).toContainText('10 to review');
  const mode = sheet.getByTestId('ai-value').filter({ hasText: 'Programmed Mode' });
  await expect(mode).toContainText('Medtronic');
  await expect(mode).toContainText('Device Interrogation');
  await expect(sheet.getByTestId('ai-value').filter({ hasText: 'Capture Threshold' })).toContainText('threshold 0.75 V');
  await sheet.getByTestId('ai-accept-all').click();
  await expect(sheet.getByTestId('ai-value')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('section-devices')).not.toContainText('Add');
});

test('a note about a cancelled procedure flags its values, and Accept All leaves them for a person', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_370_000);
  await createCase(page, m);
  await page.getByTestId('ai-row').click();
  const sheet = page.getByTestId('ai-sheet');
  await sheet.getByTestId('ai-note').fill(sampleNote('N02', m));
  await sheet.getByTestId('ai-preview').click();
  await sheet.getByTestId('ai-send').click();
  await expect(sheet.getByTestId('ai-run')).toBeVisible();
  const flagged = sheet.getByTestId('ai-flag');
  const n = await flagged.count();
  expect(n).toBeGreaterThan(0);
  await sheet.getByTestId('ai-accept-all').click();
  await expect(sheet.getByTestId('ai-accepted').first()).toBeVisible();
  // Still waiting: every flagged value. (A study with no date in the note waits too, for its date.)
  await expect(flagged).toHaveCount(n);
  await expect(sheet.getByTestId('ai-value').filter({ has: page.getByTestId('ai-flag') })).toHaveCount(n);
});

test('a study with no date in the note asks for the date before its values can be accepted', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_340_000);
  await createCase(page, m);
  await page.getByTestId('ai-row').click();
  const sheet = page.getByTestId('ai-sheet');
  await sheet.getByTestId('ai-note').fill(sampleNote('N17', m));
  await sheet.getByTestId('ai-preview').click();
  await sheet.getByTestId('ai-send').click();
  const ask = sheet.getByTestId('ai-date-missing');
  await expect(ask).toHaveCount(1);
  await expect(ask).toContainText('Date missing');
  const inr = sheet.getByRole('button', { name: /^Accept INR/ });
  await expect(inr).toBeDisabled();
  await ask.locator('input[type="date"]').fill('2026-10-01');
  await expect(ask).toHaveCount(0);
  await expect(inr).toBeEnabled();
  await sheet.getByTestId('ai-accept-all').click();
  await expect(sheet.getByTestId('ai-value')).toHaveCount(0);
});

test('no field in the app asks for a time', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_350_000);
  await createCase(page, m);
  await page.getByTestId('section-ecg').click();
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Add ecg' }).click();
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
  await expect(page.locator('input[type="time"]')).toHaveCount(0);
  await expect(page.locator('input[type="date"]').first()).toBeVisible();
});

test('a note naming another MRN is stopped before anything is sent', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_320_000);
  await createCase(page, m);
  await page.getByTestId('ai-row').click();
  const sheet = page.getByTestId('ai-sheet');
  await sheet.getByTestId('ai-note').fill('EP note. MRN 9999999. Hypertension on amlodipine.');
  await sheet.getByTestId('ai-preview').click();
  await expect(sheet.getByTestId('ai-error')).toContainText('MRN 9999999');
  await expect(sheet.getByTestId('ai-sent-text')).toHaveCount(0);
  await expect(sheet.getByTestId('ai-value')).toHaveCount(0);
});

test('Admin sees the AI provider choice and key status', async ({ page }) => {
  await open(page, 'admin', '#/admin');
  await expect(page.getByTestId('ai-settings')).toContainText('Test AI');
  await expect(page.getByTestId('ai-settings')).toContainText('key not set');
});
