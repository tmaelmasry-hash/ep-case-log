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
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  await sheet.locator('#new-date').fill('2026-03-12');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  const ps = page.getByTestId('procedure-sheet');
  await ps.getByRole('group', { name: 'Procedure components' }).getByRole('button', { name: 'AF', exact: true }).click();
  await expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Saved');
  await ps.getByRole('button', { name: 'Done' }).click();
  await page.goto('/#/cases');
  await page.getByRole('searchbox', { name: 'Search MRN' }).fill(m);
  const rows = page.getByTestId('case-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.chip.c-cat')).toHaveText('AF'); // colored by its category

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
