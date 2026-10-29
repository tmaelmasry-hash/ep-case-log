// Browser tests for phase 3: core progress, "Not available", Ready to complete, Completed (read only), Reopen,
// case history, groups, recycle bin and activity log. Synthetic MRNs (9990xxx) and synthetic accounts only.
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';
import { fillCore } from './fill';

let seq = 0;
function mrn(info: { project: { name: string } }) {
  const base = info.project.name === 'desktop' ? 9990700 : 9990800;
  return String(base + ++seq * 5 + Math.floor(Math.random() * 4));
}

async function open(page: Page, user = 'admin', hash = '#/cases') {
  await page.goto('/' + hash);
  const form = page.getByRole('form', { name: 'Sign in' });
  const app = page.getByRole('navigation', { name: 'Main' });
  await expect(form.or(app)).toBeVisible();
  if (await form.isVisible()) await signIn(page, user);
  await expect(app).toBeVisible();
}

async function createCase(page: Page, m: string, group?: string) {
  await page.getByTestId('add-menu').click();
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  if (group) await sheet.getByRole('radio', { name: group }).click();
  await sheet.locator('#new-date').fill('2026-03-12');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`${m}`);
  return page.url().split('#/cases/')[1];
}

const saved = (page: Page) => expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Synced');

test('core progress, "Not available", complete, read only, reopen with a reason, history', async ({ page }, info) => {
  await open(page);
  const id = await createCase(page, mrn(info));
  await expect(page.getByTestId('core-progress')).toContainText(/\d+ missing/);
  await expect(page.getByTestId('section-patient')).toContainText('3 missing');

  // A procedure with AF: its core count includes the AF ablation items.
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await page.getByTestId('addproc-next').click();
  const ps = page.getByTestId('procedure-sheet');
  await expect(ps.getByTestId('module-AF_ABLATIONS')).toBeVisible();
  await saved(page);
  await ps.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('procedure-row')).toContainText('12 missing'); // date and type are filled by the app (field review phase 2)

  // Everything else filled (synthetic), except LA/LAA thrombus status and date of birth.
  await fillCore(page, id, ['AF_ABLATIONS.la_laa_thrombus_status', 'PATIENT_IDENTIFIERS.date_of_birth']);
  await page.reload();
  await expect(page.getByTestId('complete-bar')).toContainText("What's missing? (2)");
  await expect(page.getByTestId('complete-bar').getByRole('button', { name: 'Complete', exact: true })).toBeDisabled();

  // Ready to complete? lists both; Go opens the procedure at the field.
  await page.getByRole('button', { name: /What's missing/ }).click();
  const ready = page.getByTestId('ready-sheet');
  await expect(ready.getByTestId('blocker')).toHaveCount(2);
  await expect(ready).toContainText('LA/LAA thrombus status is empty');
  await expect(ready.getByTestId('mark-completed')).toBeDisabled();
  await ready.getByTestId('blocker').filter({ hasText: 'LA/LAA thrombus status' }).getByRole('button', { name: 'Go' }).click();
  const field = page.getByTestId('procedure-sheet').locator('[data-field="AF_ABLATIONS.la_laa_thrombus_status"]');
  await expect(field).toBeVisible();
  await field.getByTestId('na-open').click();
  const dlg = page.getByTestId('na-dialog');
  await dlg.getByRole('radio', { name: 'Not documented in the record' }).click();
  await dlg.getByRole('button', { name: 'Save "Not available"' }).click();
  await expect(field.getByTestId('na-tag')).toHaveText('Not available · Not documented in the record');
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();

  // Date of birth: a typed reason; it stays a warning.
  await page.getByTestId('section-patient').click();
  const dob = page.getByTestId('section-sheet').locator('[data-field="PATIENT_IDENTIFIERS.date_of_birth"]');
  await dob.getByTestId('na-open').click();
  await page.getByTestId('na-dialog').getByLabel('Another reason').fill('Old paper file only');
  await page.getByTestId('na-dialog').getByRole('button', { name: 'Save "Not available"' }).click();
  await expect(dob.getByTestId('na-tag')).toContainText('Old paper file only');
  await saved(page);
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Done' }).click();

  await page.getByRole('button', { name: /What's missing/ }).click();
  await expect(ready).toContainText('Date of birth not available (Old paper file only)');
  await ready.getByTestId('mark-completed').click();
  await expect(page.getByTestId('case-status')).toHaveText('Completed');
  await expect(page.getByTestId('completed-banner')).toContainText('Completed by Test Admin');

  // Read only: no adding or removing, and fields show values instead of inputs.
  await expect(page.getByRole('button', { name: 'Add Procedure' })).toHaveCount(0);
  await expect(page.getByTestId('complete-bar')).toHaveCount(0);
  await page.getByTestId('procedure-row').click();
  await expect(page.getByTestId('procedure-sheet').locator('input, select, textarea')).toHaveCount(0);
  await expect(page.getByTestId('procedure-sheet').getByRole('button', { name: 'Remove this procedure' })).toHaveCount(0);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();

  // Reopen needs a reason.
  await page.getByTestId('completed-banner').getByRole('button', { name: 'Reopen…' }).click();
  const ro = page.getByTestId('reopen-dialog');
  await expect(ro.getByRole('button', { name: 'Reopen' })).toBeDisabled();
  await ro.getByLabel('Reason for reopening').fill('Discharge date was wrong');
  await ro.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByTestId('case-status')).toHaveText('In progress');
  await expect(page.getByRole('button', { name: 'Add Procedure' })).toBeVisible();

  // History: who, when, before → after.
  await page.getByTestId('history-row').click();
  const h = page.getByTestId('history-sheet');
  await expect(h.getByTestId('history-item').first()).toContainText('Reopened — Discharge date was wrong');
  await expect(h).toContainText('Marked completed');
  await expect(h).toContainText('Procedure 1 · LA/LAA thrombus status: Not available (Not documented in the record)');
  await expect(h).toContainText('Component AF added to Procedure 1');
  await expect(h.getByTestId('history-item').last()).toContainText('Case created in');
  await h.getByRole('button', { name: 'Done' }).click();

  // The list shows what is still missing (owner, 28 Oct), not the core count.
  await open(page, 'admin', '#/cases');
  await expect(page.getByTestId('case-row').first()).not.toContainText(/core \d+\/\d+/);
});

test('Admin: add and rename a group, restore from the recycle bin, activity log', async ({ page }, info) => {
  await open(page);
  const name = `Fellows ${info.project.name} ${Date.now() % 10000}`;
  // Adding a group is in Settings (owner, 28 Oct).
  await page.goto('/#/admin');
  await page.getByTestId('admin-groups').click();
  await page.getByRole('button', { name: 'Add group' }).click();
  await page.getByTestId('group-dialog').getByLabel('Group name').fill(name);
  await page.getByTestId('group-dialog').getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('groups-sheet').getByText(name)).toBeVisible();
  await page.goto('/#/cases');

  const m = mrn(info);
  await createCase(page, m, name);
  await expect(page.getByTestId('case-head')).toContainText('No. 1');
  await page.getByRole('button', { name: 'Delete case' }).click();
  await expect(page.getByText(/moved to the recycle bin/)).toBeVisible();
  await expect(page.getByTestId('case-row').filter({ hasText: m })).toHaveCount(0);

  await page.goto('/#/admin');
  await page.getByTestId('admin-groups').click();
  const gs = page.getByTestId('groups-sheet');
  const row = gs.getByTestId('group-row').filter({ hasText: name });
  await expect(row).toContainText('0 cases · next No. 2');
  await row.getByRole('button', { name: 'Rename' }).click();
  await page.getByTestId('group-dialog').getByLabel('Group name').fill(`${name} R`);
  await page.getByTestId('group-dialog').getByRole('button', { name: 'Rename' }).click();
  await expect(gs.getByTestId('group-row').filter({ hasText: `${name} R` })).toBeVisible();
  await gs.getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('admin-bin').click();
  const bin = page.getByTestId('bin-sheet');
  const binRow = bin.getByTestId('bin-row').filter({ hasText: m });
  await expect(binRow).toContainText(`${name} R · No. 1`);
  await binRow.getByRole('button', { name: 'Restore' }).click();
  await expect(bin.getByTestId('bin-row').filter({ hasText: m })).toHaveCount(0);
  await bin.getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('admin-activity').click();
  const act = page.getByTestId('activity-sheet');
  await expect(act.getByTestId('activity-item').first()).toContainText('RESTORE');
  await act.getByLabel('Filter by MRN or person').fill(m);
  await expect(act.getByTestId('activity-item').filter({ hasText: 'DELETE' })).toHaveCount(1);
  await expect(act.getByTestId('activity-item').filter({ hasText: 'NEW CASE' })).toHaveCount(1);
  await act.getByRole('button', { name: 'Done' }).click();

  await page.goto('/#/cases');
  await expect(page.getByTestId('case-row').filter({ hasText: m })).toHaveCount(1);
});

test('a Member has no Admin screens and cannot add groups', async ({ page }) => {
  await open(page, 'sara', '#/settings');
  await expect(page.getByTestId('admin-groups')).toHaveCount(0);
  await expect(page.getByTestId('admin-bin')).toHaveCount(0);
  await page.goto('/#/cases');
  await expect(page.getByTestId('add-group')).toHaveCount(0);
  // Only the Admin adds cases (owner, 28 Oct).
  await expect(page.getByTestId('add-menu')).toHaveCount(0);
});
