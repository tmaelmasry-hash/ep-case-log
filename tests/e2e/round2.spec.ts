// Browser tests for round 2 part 2 (owner R2-4 / R2-6, revised 23 Oct): category menu (sidebar on desktop, left
// drawer on phones), several items at once, cohorts, period presets and Clear. Synthetic MRNs (9990xxx) only.
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

let seq = 0;
function mrn(info: { project: { name: string } }) {
  const base = info.project.name === 'desktop' ? 9991100 : 9991200;
  return String(base + ++seq * 5 + Math.floor(Math.random() * 4));
}

async function open(page: Page) {
  await page.goto('/#/cases');
  const form = page.getByRole('form', { name: 'Sign in' });
  const app = page.getByRole('navigation', { name: 'Main' });
  await expect(form.or(app)).toBeVisible();
  if (await form.isVisible()) await signIn(page, 'admin');
  await expect(app).toBeVisible();
}

/** Clicks menu entries (sidebar on desktop; on phones the drawer stays open until Done). */
async function inMenu(page: Page, ...clicks: { id?: string; parent?: string; period?: string }[]) {
  const menu = page.getByTestId('open-categories');
  const phone = await menu.isVisible();
  if (phone) await menu.click();
  for (const c of clicks) {
    const arrow = c.parent ? page.getByRole('button', { name: `Open ${c.parent}`, exact: true }) : null;
    if (arrow && (await arrow.count())) await arrow.click();
    if (c.id) await page.getByTestId(`cat-${c.id}`).click();
    if (c.period) await page.getByTestId('period-menu').getByRole('button', { name: c.period }).click();
  }
  if (phone) {
    await page.getByTestId('category-drawer').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('category-drawer')).toHaveCount(0);
  }
}

test('AF case: under AF, not SVT; AF or SVT together; cohort and period combine; Clear', async ({ page }, info) => {
  await open(page);
  const m = mrn(info);
  await page.getByTestId('add-menu').click();
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  await sheet.locator('#new-date').fill('2026-03-12');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  const ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AF', exact: true }).click();
  await expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Synced');
  await ps.getByRole('button', { name: 'Done' }).click();
  await page.goto('/#/cases');
  await page.getByRole('searchbox', { name: 'Search MRN' }).fill(m);
  const rows = page.getByTestId('case-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.chip.c-cat').first()).toHaveText(/^AF\b/); // colored by its category ("AF Ablation" once the type is set)

  await inMenu(page, { id: 'SVT' });
  await expect(page.getByTestId('filter-bar')).toContainText('SVT ablation');
  await expect(rows).toHaveCount(0);
  await inMenu(page, { id: 'AF' }); // SVT or AF
  await expect(page.getByTestId('filter-bar')).toContainText('AF ablation');
  await expect(rows).toHaveCount(1);

  // Cohort combines with the procedure items: no pilgrim status recorded yet.
  await inMenu(page, { id: 'PILGRIM_NOT_RECORDED', parent: 'Pilgrims' });
  await expect(rows).toHaveCount(1);
  await inMenu(page, { id: 'PILGRIM_NOT_RECORDED', parent: 'Pilgrims' });

  // Period: "Last year" drops it (episode 12 March 2026); the filters are kept after a reload.
  await inMenu(page, { period: 'Last year' });
  await expect(rows).toHaveCount(0);
  await page.reload();
  await page.getByRole('searchbox', { name: 'Search MRN' }).fill(m);
  await expect(page.getByTestId('filter-bar')).toContainText('AF ablation');
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId('filter-bar')).not.toContainText('AF ablation');
});

test('Admin makes a tag cohort, adds a case from inside it, and filters by it; a rule shows its live count', async ({ page }, info) => {
  await open(page);
  const m = mrn(info);
  const name = `Study ${m}`;
  await page.getByTestId('add-menu').click();
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  await sheet.locator('#new-date').fill('2026-03-12');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  const caseUrl = page.url();

  // New tag cohort from the menu.
  await page.goto('/#/cases');
  const menu = page.getByTestId('open-categories');
  const phone = await menu.isVisible();
  if (phone) await menu.click();
  await page.getByTestId('new-cohort').click();
  const cs = page.getByTestId('cohort-sheet');
  await cs.locator('#cohort-name').fill(name);
  await cs.getByRole('radio', { name: 'By rule' }).click();
  await cs.getByRole('searchbox', { name: 'Search fields' }).fill('pilgrim');
  await cs.getByRole('button', { name: /Pilgrim status/ }).first().click();
  await cs.getByRole('button', { name: 'Hajj', exact: true }).click();
  await expect(cs.getByTestId('cohort-count')).toContainText(/\d+ cases? match(es)? now/);
  await cs.getByRole('radio', { name: 'By tag' }).click();
  await cs.getByRole('button', { name: 'Save cohort' }).click();
  await expect(cs).toHaveCount(0);
  if (phone) await page.getByTestId('category-drawer').getByRole('button', { name: 'Done' }).click();

  // Tag the case from inside it.
  await page.goto(caseUrl);
  await page.getByTestId('cohorts-row').click();
  await page.getByTestId('case-cohorts-sheet').getByRole('checkbox', { name }).check();
  await expect(page.getByTestId('case-cohorts-sheet').getByRole('checkbox', { name })).toBeChecked();
  await page.getByTestId('case-cohorts-sheet').getByRole('button', { name: 'Close' }).click();

  // Filter by it.
  await page.goto('/#/cases');
  if (phone) await menu.click();
  await page.getByTestId('cat-custom').filter({ hasText: name }).click();
  if (phone) await page.getByTestId('category-drawer').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('filter-bar')).toContainText(name);
  await page.getByRole('searchbox', { name: 'Search MRN' }).fill(m);
  await expect(page.getByTestId('case-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
});

test('Admin renames and hides a built-in cohort, then brings it back from Hidden cohorts', async ({ page }) => {
  await open(page);
  const menu = page.getByTestId('open-categories');
  const phone = await menu.isVisible();
  if (phone) await menu.click();
  await page.getByRole('button', { name: 'Edit Complications', exact: true }).click();
  const s = page.getByTestId('builtin-cohort-sheet');
  await s.locator('#builtin-name').fill('Complications seen');
  await s.getByRole('checkbox', { name: 'Hide from the menu' }).check();
  await s.getByRole('button', { name: 'Save', exact: true }).last().click();
  await expect(s).toHaveCount(0);
  await expect(page.getByTestId('cat-COMPLICATIONS')).toHaveCount(0);
  await page.getByRole('button', { name: 'Complications seen' }).click(); // listed under Hidden cohorts
  await page.getByTestId('builtin-cohort-sheet').getByRole('button', { name: 'Reset to default' }).click();
  await expect(page.getByTestId('cat-COMPLICATIONS')).toContainText('Complications');
});

test('part 4: same MRN and date warns of a duplicate; search by MRN and procedure (No. dropped 28 Oct); Dashboard follows the menu', async ({ page }, info) => {
  await open(page);
  const m = mrn(info);
  const create = async () => {
    await page.getByTestId('add-menu').click();
  await page.getByTestId('new-case').click();
    const sheet = page.getByTestId('new-case-sheet');
    await sheet.locator('#new-mrn').fill(m);
    await sheet.locator('#new-date').fill('2026-03-12');
    await sheet.getByRole('button', { name: 'Create case' }).click();
    return sheet;
  };
  await create();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  const no = (await page.getByTestId('case-head').textContent())!.match(/No\. (\d+)/)![1];
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  const ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('group', { name: 'Ablation' }).getByRole('button', { name: 'AVNRT', exact: true }).click();
  await expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Synced');
  await ps.getByRole('button', { name: 'Done' }).click();
  await page.goto('/#/cases');
  const sheet = await create();
  await expect(sheet.getByTestId('duplicate-warning')).toContainText(`No. ${no}`);
  await sheet.getByRole('button', { name: 'Cancel' }).click();

  const search = page.getByRole('searchbox', { name: /Search MRN/ });
  await search.fill(m);
  await expect(page.getByTestId('case-row')).toHaveCount(1);
  await search.fill(`avnrt ${m.slice(0, 0)}`.trim());
  await expect(page.getByTestId('case-row').filter({ hasText: m })).toHaveCount(1);
  await search.fill('');

  await inMenu(page, { id: 'SVT' });
  await page.goto('/#/stats');
  await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Dashboard' }).click();
  await expect(page.getByTestId('dashboard-filter')).toContainText('SVT ablation');
  await page.getByTestId('dashboard-filter').getByRole('button', { name: 'All cases' }).click();
  await expect(page.getByTestId('dashboard-filter')).toHaveCount(0);
});
