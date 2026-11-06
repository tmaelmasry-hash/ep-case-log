// The AI line in each case section, the top AI button, and the two lines of tools. Test AI, made-up notes only.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createCase, mrn, open } from './flow';

const n01 = (m: string) => {
  const notes = JSON.parse(readFileSync('config/ai_fixtures.json', 'utf8')).notes as { id: string; identifiers: { mrn: string }; text: string[] }[];
  const fx = notes.find((f) => f.id === 'N01')!;
  return fx.text.join('\n').split(fx.identifiers.mrn).join(m);
};

test('Fill From a Note fills only its section; the note stays between sections; the top button fills them all', async ({ page }, info) => {
  await open(page);
  const m = mrn(info, 7_320_000);
  await createCase(page, m);

  await page.getByTestId('section-risk').click();
  await page.getByTestId('section-sheet').getByTestId('ai-line').click();
  const sheet = page.getByTestId('ai-sheet');
  await expect(sheet.getByTestId('ai-scope')).toBeVisible();
  const note = n01(m);
  await sheet.getByTestId('ai-note').fill(note);

  // Closing goes back to the section, and the note is still there in another section.
  await sheet.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('section-patient').click();
  await page.getByTestId('section-sheet').getByTestId('ai-line').click();
  await expect(sheet.getByTestId('ai-note')).toHaveValue(note);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('section-risk').click();
  await page.getByTestId('section-sheet').getByTestId('ai-line').click();
  await sheet.getByTestId('ai-preview').click();
  await sheet.getByTestId('ai-send').click();
  await expect(sheet.getByTestId('ai-run')).toContainText('filled');
  await expect(sheet.getByTestId('ai-value').filter({ hasText: 'Hypertension' })).toBeVisible();
  // N01 also has a diagnosis and a procedure: neither was filled from this section.
  await expect(sheet.getByTestId('ai-value').filter({ hasText: 'Primary EP Diagnosis' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('procedure-row')).toHaveCount(0);

  // The top button has no section line and fills all sections.
  await page.getByTestId('ai-row').click();
  await expect(sheet.getByTestId('ai-scope')).toHaveCount(0);
  await sheet.getByTestId('ai-note').fill(n01(m));
  await sheet.getByTestId('ai-preview').click();
  await sheet.getByTestId('ai-send').click();
  await expect(sheet.getByTestId('ai-value').filter({ hasText: 'Primary EP Diagnosis' })).toBeVisible();
});

test('the tools sit on two lines, with AI and Completeness first, and no label is cut', async ({ page }, info) => {
  await open(page);
  await createCase(page, mrn(info, 7_330_000));
  const top = async (id: string) => (await page.getByTestId(id).boundingBox())!.y;
  expect(await top('ai-row')).toBe(await top('completeness-row'));
  expect(await top('history-row')).toBeGreaterThan(await top('ai-row'));
  for (const b of await page.getByTestId('case-tools').locator('.tool span').all()) {
    expect(await b.evaluate((e) => e.scrollWidth <= e.parentElement!.clientWidth)).toBe(true);
  }
});
