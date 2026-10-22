import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { signIn } from './helpers';

const PNG = readFileSync('public/icon-512.png');
const img = (name = 'scan.png') => ({ name, mimeType: 'image/png', buffer: PNG });


async function open(page: Page, hash = '#/cases') {
  await page.goto('/' + hash);
  const form = page.getByRole('form', { name: 'Sign in' });
  const app = page.getByRole('navigation', { name: 'Main' });
  await expect(form.or(app)).toBeVisible();
  if (await form.isVisible()) await signIn(page);
  await expect(page.getByRole('heading', { name: /Cases|Stats|Settings|Patients|Image Inbox/ }).first()).toBeVisible();
}

async function newCase(page: Page, mrn: string, age = '70', sex: 'M' | 'F' = 'M', date?: string) {
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('case-info-sheet');
  if (date) await sheet.locator('input[type=date]').fill(date);
  await sheet.getByPlaceholder('Medical record number').fill(mrn);
  await sheet.getByPlaceholder('years').fill(age);
  await sheet.getByRole('radio', { name: sex, exact: true }).click();
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('procedure-picker')).toBeVisible();
}

async function addAf(page: Page) {
  await page.getByTestId('procedure-picker').getByRole('button', { name: 'AF Ablation' }).click();
  const s = page.getByTestId('procedure-sheet');
  await s.getByRole('radio', { name: 'PFA' }).click();
  for (const v of ['LSPV', 'LIPV', 'RSPV', 'RIPV', 'SVC isolation']) await s.getByRole('button', { name: v, exact: true }).click();
  await s.getByRole('button', { name: 'Add procedure' }).click();
}

const caseList = (page: Page) => page.getByRole('region', { name: 'Cases' });

test('empty state, validation, create case with AF ablation + CHA2DS2-VASc, persists after reload', async ({ page }) => {
  await open(page);
  await expect(page.getByText('No cases yet')).toBeVisible();

  // Invalid input is blocked with messages.
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('case-info-sheet');
  await sheet.locator('input[type=date]').fill('2099-01-01');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(sheet.getByText('MRN is required')).toBeVisible();
  await expect(sheet.getByText('Date cannot be in the future')).toBeVisible();
  await sheet.getByPlaceholder('Medical record number').fill('bad mrn!');
  await expect(sheet.getByText('Letters, digits or dashes (max 20)')).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();

  await newCase(page, '12345678', '70', 'M', '2026-03-29');
  // Required field enforcement in the procedure sheet.
  await page.getByTestId('procedure-picker').getByRole('button', { name: 'AF Ablation' }).click();
  const ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('button', { name: 'Add procedure' }).click();
  await expect(ps.getByText('Please complete: Energy')).toBeVisible();
  await ps.getByRole('radio', { name: 'PFA' }).click();
  for (const v of ['LSPV', 'LIPV', 'RSPV', 'RIPV', 'SVC isolation']) await ps.getByRole('button', { name: v, exact: true }).click();
  await ps.getByRole('button', { name: 'Add procedure' }).click();

  // CHA2DS2-VASc is prompted for AF.
  const cha = page.getByTestId('cha-sheet');
  await expect(cha).toBeVisible();
  await expect(cha.getByTestId('cha-result')).toContainText('1'); // age 70
  await cha.getByText('Hypertension').click();
  await expect(cha.getByTestId('cha-result')).toContainText('2');
  await cha.getByRole('button', { name: 'Save score' }).click();

  await expect(page.getByText('PFA · LSPV, LIPV, RSPV, RIPV · SVC isolation')).toBeVisible();
  await expect(page.getByText('CHA₂DS₂-VASc 2').first()).toBeVisible();

  // Notes autosave.
  await page.getByLabel('Case notes').fill('Uneventful. Home same day.');
  await expect(page.getByTestId('save-indicator').filter({ visible: true })).toHaveText(/Saved/);

  await page.reload();
  await expect(page.getByText('PFA · LSPV, LIPV, RSPV, RIPV · SVC isolation')).toBeVisible();
  await expect(page.getByLabel('Case notes')).toHaveValue('Uneventful. Home same day.');

  await page.goto('/#/cases');
  const row = page.getByTestId('case-row').first();
  await expect(row).toContainText('Mar 29, 2026');
  await expect(row).toContainText('12345678 · 70M');
  await expect(row).toContainText('AF Ablation');
  await expect(row).toContainText('CHA₂DS₂-VASc 2');
  await expect(page.getByRole('heading', { name: /March 2026/ })).toBeVisible();
});

test('device implant, edit, remove with confirm + undo, delete case with undo', async ({ page }) => {
  await open(page);
  await newCase(page, '87654321', '60');
  await page.getByTestId('procedure-picker').getByRole('button', { name: 'Device Implant' }).click();
  const s = page.getByTestId('procedure-sheet');
  await s.getByRole('radio', { name: 'New' }).click();
  await s.getByLabel('Device type').selectOption('ICD dual');
  await s.getByRole('radio', { name: 'Abbott' }).click();
  await s.getByRole('button', { name: 'RA', exact: true }).click();
  await s.getByRole('button', { name: 'RV', exact: true }).click();
  await s.getByRole('button', { name: 'Add procedure' }).click();
  await expect(page.getByText('New · ICD dual · Abbott · RA, RV')).toBeVisible();
  // No CHA prompt for device-only cases.
  await expect(page.getByTestId('cha-sheet')).toBeHidden();
  await expect(page.getByTestId('update-cha')).toHaveCount(0);

  // Edit
  await page.getByText('New · ICD dual · Abbott · RA, RV').click();
  await page.getByTestId('procedure-sheet').getByRole('radio', { name: 'Gen change' }).click();
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Save procedure' }).click();
  await expect(page.getByText('Gen change · ICD dual · Abbott · RA, RV')).toBeVisible();

  // Remove with confirm, then undo
  await page.getByText('Gen change · ICD dual').click();
  await page.getByRole('button', { name: 'Remove procedure' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Gen change · ICD dual')).toBeHidden();
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Gen change · ICD dual · Abbott · RA, RV')).toBeVisible();

  // Delete case with confirm, then undo
  await page.getByRole('button', { name: 'Delete case' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete case' }).click();
  await expect(page.getByText('No cases yet')).toBeVisible();
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('case-row')).toHaveCount(1);

  // Delete for real, survives reload
  await page.getByTestId('case-row').click();
  await page.getByRole('button', { name: 'Delete case' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete case' }).click();
  await expect(page.getByText('No cases yet')).toBeVisible();
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByText('No cases yet')).toBeVisible();
});

test('search, filter, month grouping, patients and live stats', async ({ page }) => {
  await open(page);
  await newCase(page, 'AAA111', '72', 'F', '2026-01-15');
  await addAf(page);
  await page.getByTestId('cha-sheet').getByRole('button', { name: 'Cancel' }).click();
  await page.goto('/#/cases');
  await newCase(page, 'BBB222', '45', 'M', '2026-02-03');
  await page.getByTestId('procedure-picker').getByRole('button', { name: 'SVT Ablation' }).click();
  await page.getByTestId('procedure-sheet').getByLabel('Mechanism').selectOption('AVNRT');
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Add procedure' }).click();
  await page.getByRole('button', { name: 'Add Complications' }).click();
  await page.getByRole('button', { name: 'Vascular access complication' }).click();
  await page.getByRole('dialog', { name: 'Complications' }).getByRole('button', { name: 'Save' }).click();
  await page.goto('/#/cases');

  await expect(page.getByTestId('case-count')).toHaveText('2 cases');
  await expect(page.getByRole('heading', { name: /January 2026/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /February 2026/ })).toBeVisible();
  // Missing CHA flagged with a label (not colour only).
  await expect(page.getByTestId('case-row').filter({ hasText: 'AAA111' })).toContainText('CHA₂DS₂-VASc ?');

  await page.getByLabel('Search cases').fill('avnrt');
  await expect(page.getByTestId('case-row')).toHaveCount(1);
  await expect(page.getByTestId('case-row')).toContainText('BBB222');
  await page.getByLabel('Search cases').fill('zzz');
  await expect(page.getByText('No matching cases')).toBeVisible();
  await page.getByLabel('Search cases').fill('');

  await caseList(page).getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('button', { name: 'Has complications' }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('case-row')).toHaveCount(1);
  await expect(page.getByTestId('case-row')).toContainText('BBB222');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByTestId('case-row')).toHaveCount(2);

  await page.goto('/#/patients');
  await expect(page.getByTestId('patient-row')).toHaveCount(2);
  await page.getByTestId('patient-row').filter({ hasText: 'AAA111' }).click();
  await expect(page.getByRole('heading', { name: 'MRN AAA111' })).toBeVisible();

  await page.goto('/#/stats');
  await expect(page.getByTestId('kpi-cases')).toHaveText('2');
  await expect(page.getByTestId('kpi-procedures')).toHaveText('2');
  await expect(page.getByTestId('kpi-comp')).toHaveText('50.0%');
  await expect(page.getByTestId('by-type')).toContainText('AF Ablation');
  await expect(page.getByTestId('by-type')).toContainText('50%');
  await expect(page.getByRole('img', { name: /Cases by month: January 2026 1, February 2026 1/ })).toBeVisible();

  // Stats update immediately when data changes.
  await page.goto('/#/cases');
  await newCase(page, 'CCC333', '80', 'M', '2026-02-10');
  await page.getByTestId('procedure-picker').getByRole('button', { name: 'EP Study' }).click();
  await page.getByTestId('procedure-sheet').getByLabel('Indication').selectOption('Syncope');
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Add procedure' }).click();
  await page.getByRole('link', { name: 'Stats' }).click();
  await expect(page.getByTestId('kpi-cases')).toHaveText('3');
  await expect(page.getByTestId('by-type')).toContainText('Diagnostic');
  // Custom range validation
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.getByLabel('From').fill('2026-03-01');
  await page.getByLabel('To').fill('2026-02-01');
  await expect(page.getByText('Start date must be before end date')).toBeVisible();
});

test('op note scan with filter/rotate/undo, images, inbox assign, PDF report', async ({ page }) => {
  await open(page);
  await newCase(page, 'IMG001', '66');
  await addAf(page);
  await page.getByTestId('cha-sheet').getByRole('button', { name: 'Save score' }).click();

  await page.getByTestId('opnote-input').setInputFiles(img());
  const ed = page.getByTestId('image-editor');
  await expect(ed).toBeVisible();
  await expect(ed.getByRole('radio', { name: 'Optimized' })).toHaveAttribute('aria-checked', 'true');
  await ed.getByRole('button', { name: 'Rotate right' }).click();
  await ed.getByRole('radio', { name: 'B&W' }).click();
  await ed.getByRole('button', { name: 'Undo' }).click();
  await expect(ed.getByRole('radio', { name: 'Optimized' })).toHaveAttribute('aria-checked', 'true');
  await ed.getByRole('button', { name: 'Save' }).last().click();
  await expect(ed).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add Page' })).toBeVisible();

  await page.getByTestId('image-input').setInputFiles([img('a.png'), img('b.png')]);
  await expect(page.getByText('2 images added')).toBeVisible();

  // Delete an image (confirm + undo available)
  const thumbs = page.locator('.thumbs .thumb');
  await expect(thumbs).toHaveCount(3);
  await thumbs.nth(2).click();
  await page.getByTestId('image-viewer').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(thumbs).toHaveCount(2);

  // Inbox import + assign
  await page.goto('/#/inbox');
  await expect(page.getByText('Inbox is empty')).toBeVisible();
  await page.getByTestId('inbox-input').setInputFiles(img('inbox.png'));
  await expect(page.getByTestId('inbox-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Assign' }).click();
  await page.getByTestId('assign-sheet').getByRole('button', { name: /IMG001/ }).click();
  await expect(page.getByText('Inbox is empty')).toBeVisible();

  // PDF report renders into the print container (print dialog stubbed).
  await page.goto('/#/cases');
  await page.getByTestId('case-row').click();
  await expect(page.locator('.thumbs .thumb')).toHaveCount(3);
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed++;
    };
  });
  await page.getByRole('button', { name: 'Export PDF report' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  const report = page.locator('#print-root .report');
  await expect(report).toContainText('EP Case Report');
  await expect(report).toContainText('IMG001');
  await expect(report).toContainText('LSPV, LIPV, RSPV, RIPV');
  await expect(report.locator('img')).toHaveCount(3);
  await page.emulateMedia({ media: 'print' });
  await expect(report).toBeVisible();
  await expect(page.locator('#root')).toBeHidden();
});

test('backup download, erase all (typed confirm), restore from backup', async ({ page }) => {
  await open(page);
  await newCase(page, 'BKP001', '58');
  await page.getByTestId('procedure-picker').getByRole('button', { name: 'Flutter Ablation' }).click();
  await page.getByTestId('procedure-sheet').getByRole('radio', { name: 'Typical CTI' }).click();
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Add procedure' }).click();
  await page.getByTestId('cha-sheet').getByRole('button', { name: 'Save score' }).click();

  await page.goto('/#/settings');
  await expect(page.getByTestId('last-backup')).toHaveText('Never');
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download full backup/ }).click();
  const file = await (await dl).path();
  await expect(page.getByTestId('last-backup')).not.toHaveText('Never');

  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export case log/ }).click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);

  await page.getByRole('button', { name: /Erase all data/ }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg.getByRole('button', { name: 'Erase everything' })).toBeDisabled();
  await dlg.getByLabel('Confirmation text').fill('ERASE');
  await dlg.getByRole('button', { name: 'Erase everything' }).click();
  await page.goto('/#/cases');
  await expect(page.getByText('No cases yet')).toBeVisible();

  // Invalid file is rejected with a message.
  await page.goto('/#/settings');
  await page.getByTestId('import-input').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText('This is not an EP Case Log backup file.')).toBeVisible();

  await page.getByTestId('import-input').setInputFiles(file!);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Merge backup' }).click();
  await expect(page.getByText(/Imported 1 case/)).toBeVisible();
  await page.reload();
  await page.goto('/#/cases');
  await expect(page.getByTestId('case-row')).toContainText('BKP001');
  await expect(page.getByTestId('case-row')).toContainText('Flutter Ablation');
});

test('without the server the app says so clearly and recovers when it is back', async ({ page, context }) => {
  await open(page);
  await expect(page.getByText('No cases yet')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cannot reach the registry server' })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toBeVisible();
});

test('layout fits the viewport without horizontal scrolling', async ({ page }, info) => {
  await open(page);
  await newCase(page, 'LAYOUT01', '77', 'F');
  await addAf(page);
  await page.getByTestId('cha-sheet').getByRole('button', { name: 'Save score' }).click();
  for (const h of ['#/cases', '#/patients', '#/stats', '#/settings']) {
    await page.goto('/' + h);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${h}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/screens/${info.project.name}-${h.slice(2)}.png` });
  }
  await page.goto('/#/cases');
  await page.getByTestId('case-row').click();
  await page.screenshot({ path: `test-results/screens/${info.project.name}-case.png`, fullPage: true });
  const tabbar = page.getByRole('navigation', { name: 'Main' });
  await expect(tabbar).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});
