// Browser tests for phase 2: case = episode with several procedures, dictionary fields, group scope.
// One shared in-memory server: every test uses its own synthetic MRN (9990xxx).
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

let mrnSeq = 0;
function mrn(info: { project: { name: string } }) {
  const base = info.project.name === 'desktop' ? 9990100 : 9990500;
  return String(base + ++mrnSeq * 7 + Math.floor(Math.random() * 6));
}

async function open(page: Page, user = 'admin', hash = '#/cases') {
  await page.goto('/' + hash);
  const form = page.getByRole('form', { name: 'Sign in' });
  const app = page.getByRole('navigation', { name: 'Main' });
  await expect(form.or(app)).toBeVisible();
  if (await form.isVisible()) await signIn(page, user);
  await expect(app).toBeVisible();
}

async function createCase(page: Page, m: string, date = '2026-03-12', group?: string) {
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  if (group) await sheet.getByRole('radio', { name: group }).click();
  await sheet.locator('#new-date').fill(date);
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
}

const saved = (page: Page) => expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Saved');

test('create a case, add two procedures with components and module fields; it persists', async ({ page }, info) => {
  const m = mrn(info);
  await open(page);
  // MRN validation (site rule: exactly 7 digits).
  await page.getByTestId('new-case').click();
  const ns = page.getByTestId('new-case-sheet');
  await ns.locator('#new-mrn').fill('12345');
  await ns.getByRole('button', { name: 'Create case' }).click();
  await expect(ns.getByText('MRN must be exactly 7 digits.').first()).toBeVisible();
  await ns.getByRole('button', { name: 'Cancel' }).click();

  await createCase(page, m);
  await expect(page.getByTestId('case-head')).toContainText('Mar 12, 2026');
  await expect(page.getByTestId('case-head')).toContainText('In progress');

  // Procedure 1: EPS
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  let ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('radiogroup', { name: 'Primary procedure type' }).getByRole('radio', { name: 'EPS' }).click();
  await ps.getByLabel('Procedure date & time').fill('2026-03-12T10:00');
  await ps.getByRole('group', { name: 'Procedure components' }).getByRole('button', { name: 'Diagnostic EPS' }).click();
  await expect(ps.getByTestId('module-DIAGNOSTIC_EPS')).toBeVisible();
  await ps.getByTestId('module-DIAGNOSTIC_EPS').getByRole('radiogroup', { name: 'EPS indication' }).getByRole('radio', { name: 'Syncope' }).click();
  await saved(page);
  await ps.getByRole('button', { name: 'Done' }).click();

  // Procedure 2: ablation with AF + Flutter in the same session
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('radiogroup', { name: 'Primary procedure type' }).getByRole('radio', { name: 'Ablation' }).click();
  await ps.getByLabel('Procedure date & time').fill('2026-03-13T09:10');
  await ps.getByRole('group', { name: 'Procedure components' }).getByRole('button', { name: 'AF', exact: true }).click();
  await ps.getByRole('group', { name: 'Procedure components' }).getByRole('button', { name: 'Flutter', exact: true }).click();
  const af = ps.getByTestId('module-AF_ABLATIONS');
  await expect(af).toBeVisible();
  await expect(ps.getByTestId('module-FLUTTER_ABLATIONS')).toBeVisible();
  await af.getByRole('radiogroup', { name: 'Energy source' }).getByRole('radio', { name: 'PFA' }).click();
  await af.getByRole('radiogroup', { name: 'PV status at case end' }).getByRole('radio', { name: 'All target PVs isolated' }).click();
  // A number field refuses text, with a message under the field.
  await ps.getByLabel('Fluoroscopy time').fill('abc');
  await ps.getByLabel('Fluoroscopy time').blur();
  await expect(ps.getByText('Fluoroscopy time: enter a number.')).toBeVisible();
  await ps.getByLabel('Fluoroscopy time').fill('12.5');
  await ps.getByLabel('Fluoroscopy time').blur();
  await expect(ps.getByText('Fluoroscopy time: enter a number.')).toBeHidden();
  await saved(page);
  await ps.getByRole('button', { name: 'Done' }).click();

  const rows = page.getByTestId('procedure-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Procedure 1 · EPS');
  await expect(rows.nth(1)).toContainText('AF + Flutter');

  await page.reload();
  await expect(page.getByTestId('procedure-row')).toHaveCount(2);
  await page.getByTestId('procedure-row').nth(1).click();
  ps = page.getByTestId('procedure-sheet');
  await expect(ps.getByTestId('module-AF_ABLATIONS').getByRole('radio', { name: 'PFA' })).toHaveAttribute('aria-checked', 'true');
  await expect(ps.getByLabel('Fluoroscopy time')).toHaveValue('12.5');
  await ps.getByRole('button', { name: 'Done' }).click();

  // List: one case, two procedure chips, grouped under March 2026.
  await page.goto('/#/cases');
  await page.getByLabel('Search MRN').fill(m);
  const row = page.getByTestId('case-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Mar 12, 2026');
  await expect(row).toContainText('EPS');
  await expect(row).toContainText('AF + Flutter Ablation');
  await expect(row).toContainText('2 procedures');
  await expect(page.getByRole('heading', { name: 'March 2026' })).toBeVisible();
});

test('patient & history: age from date of birth, diagnosis subtype follows the diagnosis', async ({ page }, info) => {
  const m = mrn(info);
  await open(page);
  await createCase(page, m, '2026-03-12');
  await page.getByTestId('section-patient').click();
  const s = page.getByTestId('section-sheet');
  await expect(s.locator('[data-field="PATIENT_IDENTIFIERS.mrn"]')).toContainText(m);
  await s.getByLabel('Date of birth').fill('1968-01-20');
  await s.getByRole('radiogroup', { name: 'Sex at birth' }).getByRole('radio', { name: 'Male', exact: true }).click();
  await saved(page);
  await s.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('case-head')).toContainText('58M');

  await page.getByTestId('section-diagnosis').click();
  const d = page.getByTestId('section-sheet');
  await expect(d.getByText('Choose the primary ep diagnosis first.')).toBeVisible();
  await d.getByLabel('Primary EP diagnosis').selectOption({ label: 'AF' });
  const subtype = d.getByLabel('Diagnosis subtype');
  await expect(subtype.locator('option')).toHaveText(['Select', 'Paroxysmal AF', 'Persistent AF', 'Long-standing persistent AF']);
  await subtype.selectOption({ label: 'Paroxysmal AF' });
  await saved(page);
  await d.getByLabel('Primary EP diagnosis').selectOption({ label: 'AVNRT' });
  await saved(page);
  const sub = d.locator('[data-field="ARRHYTHMIA_INDICATIONS.diagnosis_subtype"]');
  await expect(sub).not.toContainText('Paroxysmal AF');
  await expect(sub.locator('[aria-checked="true"]')).toHaveCount(0);
  await saved(page);
  await d.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('section-diagnosis')).toContainText('1');
});

test('repeatable rows: add an ECG, fill it, remove it with confirmation', async ({ page }, info) => {
  await open(page);
  await createCase(page, mrn(info));
  await page.getByTestId('section-ecg').click();
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Add ecg' }).click();
  const r = page.getByTestId('row-sheet');
  await expect(r).toBeVisible();
  const date = r.locator('input[type="date"], input[type="datetime-local"]').first();
  await date.fill(await date.getAttribute('type') === 'date' ? '2026-03-11' : '2026-03-11T08:00');
  await saved(page);
  await r.getByRole('button', { name: 'Done' }).click();
  const list = page.getByTestId('section-sheet').getByTestId('list-row');
  await expect(list).toHaveCount(1);
  await expect(list).toContainText('Mar 11');
  await list.click();
  await page.getByTestId('row-sheet').getByRole('button', { name: /Remove ecg/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('section-sheet').getByTestId('list-row')).toHaveCount(0);
  await saved(page);
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('section-ecg')).toContainText('—');
});

test('remove a procedure asks first; additional information; delete the case', async ({ page }, info) => {
  const m = mrn(info);
  await open(page);
  await createCase(page, m);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  const ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('radiogroup', { name: 'Primary procedure type' }).getByRole('radio', { name: 'Ablation' }).click();
  await saved(page);
  await ps.getByRole('button', { name: 'Remove this procedure' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(ps).toBeVisible();
  await ps.getByRole('button', { name: 'Remove this procedure' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove procedure' }).click();
  await expect(page.getByTestId('procedure-row')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add Information' }).click();
  const a = page.getByTestId('additional-sheet');
  await a.getByLabel('New information').fill('Synthetic note: referred from another hospital');
  await a.getByRole('button', { name: 'Add information' }).click();
  await saved(page);
  await expect(a).toContainText('Synthetic note');
  await a.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: '1 item' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete case' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete case' }).click();
  await expect(page.getByText('Case moved to the recycle bin')).toBeVisible();
  await page.getByLabel('Search MRN').fill(m);
  await expect(page.getByTestId('case-row')).toHaveCount(0);
});

test('a Member sees only their group; another group\'s case looks not found', async ({ page, browser }, info) => {
  const m2 = mrn(info);
  await open(page);
  await createCase(page, m2, '2026-03-12', 'Group 2');
  const url = page.url();
  const ctx = await browser.newContext({ ...info.project.use });
  const p = await ctx.newPage();
  await open(p, 'sara');
  await expect(p.getByRole('radiogroup', { name: 'Group' })).toHaveCount(0); // Sara is only in Group 1
  await p.getByLabel('Search MRN').fill(m2);
  await expect(p.getByTestId('case-row')).toHaveCount(0);
  await p.goto(url);
  await expect(p.getByRole('heading', { name: 'Case not found' })).toBeVisible();
  await ctx.close();
});

test('patients and my work follow the cases', async ({ page }, info) => {
  const m = mrn(info);
  await open(page);
  await createCase(page, m, '2026-02-03');
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('procedure-sheet').getByRole('radiogroup', { name: 'Primary procedure type' }).getByRole('radio', { name: 'CIED implant' }).click();
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();
  await page.goto('/#/patients');
  await page.getByLabel('Search patients').fill(m);
  await page.getByTestId('patient-row').click();
  await expect(page.getByRole('heading', { name: `MRN ${m}` })).toBeVisible();
  await expect(page.getByTestId('case-row')).toContainText('CIED implant');
  await page.goto('/#/stats');
  await expect(page.getByTestId('mywork-row').filter({ hasText: m })).toContainText('core');
});

test('without the server the app says so clearly and recovers when it is back', async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cannot reach the registry server' })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Cases', exact: true })).toBeVisible();
});

test('layout fits the screen on every page', async ({ page }, info) => {
  await open(page);
  await createCase(page, mrn(info));
  for (const h of ['#/cases', '#/patients', '#/stats', '#/settings']) {
    await page.goto('/' + h);
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${h}`).toBeLessThanOrEqual(0);
  }
  await page.goto('/#/cases');
  await page.getByTestId('case-row').first().click();
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  const ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('group', { name: 'Procedure components' }).getByRole('button', { name: 'Device implant' }).click();
  await expect(ps.getByTestId('module-DEVICE_IMPLANTS')).toBeVisible();
  const sheetOverflow = await ps.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sheetOverflow).toBeLessThanOrEqual(0);
});
