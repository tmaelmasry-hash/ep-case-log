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
  await page.getByTestId('add-menu').click();
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  if (group) await sheet.getByRole('radio', { name: group }).click();
  await sheet.locator('#new-date').fill(date);
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`${m}`);
}

const saved = (page: Page) => expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Synced');

test('create a case, add two procedures with components and module fields; it persists', async ({ page }, info) => {
  const m = mrn(info);
  await open(page);
  // MRN validation (site rule: exactly 7 digits).
  await page.getByTestId('add-menu').click();
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
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Other' }).getByRole('button', { name: 'EP study' }).click();
  await page.getByTestId('addproc-next').click();
  let ps = page.getByTestId('procedure-sheet');
  await ps.getByLabel('Procedure date').fill('2026-03-12');
  // Field review phase 2: tick what was done; the procedure type follows.
  await expect(ps.getByTestId('procedure-type')).toContainText('EPS');
  await expect(ps.getByTestId('module-DIAGNOSTIC_EPS')).toBeVisible();
  await ps.getByTestId('module-DIAGNOSTIC_EPS').getByLabel('EPS indication').selectOption({ label: 'Syncope' });
  await saved(page);
  await ps.getByRole('button', { name: 'Done' }).click();

  // Procedure 2: ablation with AF + Flutter in the same session
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await page.getByTestId('addproc-next').click();
  ps = page.getByTestId('procedure-sheet');
  await ps.getByLabel('Procedure date').fill('2026-03-13');
  await ps.getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'Flutter', exact: true }).click();
  await expect(ps.getByTestId('procedure-type')).toContainText('Ablation');
  const af = ps.getByTestId('module-AF_ABLATIONS');
  await expect(af).toBeVisible();
  await expect(ps.getByTestId('module-FLUTTER_ABLATIONS')).toBeVisible();
  // 6 choices: a list on the question's line (owner, 28 Oct).
  await af.getByLabel('Energy source').selectOption({ label: 'PFA (pulsed field)' });
  await af.getByRole('radiogroup', { name: 'PV status at case end' }).getByRole('radio', { name: 'All target PVs isolated' }).click();
  // M-1: the reconnected vein count shows only at a redo with reconnection present.
  await expect(af.getByLabel('Reconnected PV count')).toHaveCount(0);
  await ps.getByRole('radiogroup', { name: 'First or redo' }).getByRole('radio', { name: 'Redo', exact: true }).click();
  await af.getByRole('radiogroup', { name: 'PV reconnection present at redo' }).getByRole('radio', { name: 'Yes', exact: true }).click();
  // A number field refuses text, with a message under the field.
  await af.getByLabel('Reconnected PV count').fill('abc');
  await af.getByLabel('Reconnected PV count').blur();
  await expect(ps.getByText('Reconnected PV count: enter a whole number.')).toBeVisible();
  await af.getByLabel('Reconnected PV count').fill('2');
  await af.getByLabel('Reconnected PV count').blur();
  await expect(ps.getByText('Reconnected PV count: enter a whole number.')).toBeHidden();
  await saved(page);
  await ps.getByRole('button', { name: 'Done' }).click();

  const rows = page.getByTestId('procedure-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Diagnostic EPS');
  await expect(rows.nth(1)).toContainText('AF + Flutter');

  await page.reload();
  await expect(page.getByTestId('procedure-row')).toHaveCount(2);
  await page.getByTestId('procedure-row').nth(1).click();
  ps = page.getByTestId('procedure-sheet');
  await expect(ps.getByTestId('module-AF_ABLATIONS').getByLabel('Energy source').locator('option:checked')).toHaveText('PFA (pulsed field)');
  await expect(ps.getByTestId('module-AF_ABLATIONS').getByLabel('Reconnected PV count')).toHaveValue('2');
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
  await s.getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Male', exact: true }).click();
  await saved(page);
  await s.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('case-head')).toContainText('58M');

  await page.getByTestId('section-diagnosis').click();
  const d = page.getByTestId('section-sheet');
  await expect(d.getByText('Choose the primary ep diagnosis first.')).toBeVisible();
  await d.getByLabel('Primary EP diagnosis').selectOption({ label: 'AF' });
  // 5 choices or fewer are buttons on the question (owner, 28 Oct).
  const subtype = d.getByRole('radiogroup', { name: 'Diagnosis subtype' });
  await expect(subtype.getByRole('radio')).toHaveText(['Paroxysmal AF', 'Persistent AF', 'Long-standing persistent AF']);
  await subtype.getByRole('radio', { name: 'Paroxysmal AF' }).click();
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
  await expect(page.getByTestId('section-ecg')).toContainText('Add');
});

test('remove a procedure asks first; additional information; delete the case', async ({ page }, info) => {
  const m = mrn(info);
  await open(page);
  await createCase(page, m);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await page.getByTestId('addproc-next').click();
  const ps = page.getByTestId('procedure-sheet');
  await saved(page);
  await ps.getByRole('button', { name: 'Remove this procedure' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(ps).toBeVisible();
  await ps.getByRole('button', { name: 'Remove this procedure' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove procedure' }).click();
  await expect(page.getByTestId('procedure-row')).toHaveCount(0);

  await page.getByRole('button', { name: 'Add note' }).click();
  const a = page.getByTestId('additional-sheet');
  await a.getByLabel('New information').fill('Synthetic note: referred from another hospital');
  await a.getByRole('button', { name: 'Add information' }).click();
  await saved(page);
  await expect(a).toContainText('Synthetic note');
  await a.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: '1 note' })).toBeVisible();

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
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Devices' }).getByRole('button', { name: 'Pacemaker' }).click();
  await page.getByTestId('addproc-next').click();
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();
  // Step 5: no Patients tab; the MRN in the case header and in search open the patient page.
  await page.getByTestId('mrn-link').click();
  await expect(page.getByTestId('patient-view').getByRole('heading', { name: m })).toBeVisible();
  await expect(page.getByTestId('patient-proc')).toContainText('CIED implant');
  await page.goto('/#/cases');
  await page.getByLabel('Search MRN or procedure').fill(m);
  await page.getByTestId('patient-hit').click();
  await expect(page.getByTestId('patient-view')).toContainText('1 case');
  await page.getByTestId('tab-mywork').click();
  await expect(page.getByTestId('mywork').getByTestId('mywork-row').filter({ hasText: m })).toContainText('missing');
});

test('without the server the app says so clearly and recovers when it is back', async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  // L3: signed in on this device before → it opens from the device copy.
  await expect(page.getByTestId('offline-bar')).toBeVisible();
  // Never signed in on this device (nothing remembered) → it says the server cannot be reached.
  await page.evaluate(() => localStorage.removeItem('kamc-registry-me'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cannot reach the registry server' })).toBeVisible();
  // Back online it recovers by itself (or with Try again).
  await context.setOffline(false);
  const again = page.getByRole('button', { name: 'Try again' });
  await again.click({ timeout: 2000 }).catch(() => undefined);
  await expect(page.getByRole('heading', { name: 'Registry Cases', exact: true })).toBeVisible();
});

test('layout fits the screen on every page', async ({ page }, info) => {
  await open(page);
  await createCase(page, mrn(info));
  for (const h of ['#/mywork', '#/cases', '#/followup', '#/stats', '#/settings']) {
    await page.goto('/' + h);
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${h}`).toBeLessThanOrEqual(0);
  }
  await page.goto('/#/cases');
  await page.getByTestId('case-row').first().click();
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Devices' }).getByRole('button', { name: 'Pacemaker' }).click();
  await page.getByTestId('addproc-next').click();
  const ps = page.getByTestId('procedure-sheet');
  await expect(ps.getByTestId('module-DEVICE_IMPLANTS')).toBeVisible();
  const sheetOverflow = await ps.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sheetOverflow).toBeLessThanOrEqual(0);
});
