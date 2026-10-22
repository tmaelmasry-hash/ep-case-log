// Shared browser-test steps (phase 5 on). Synthetic MRNs only.
import { expect, type Page } from '@playwright/test';
import { signIn } from './helpers';

let seq = 0;
/** A synthetic MRN unique to this run and project. */
export function mrn(info: { project: { name: string } }, base: number) {
  return String(base + (info.project.name === 'desktop' ? 0 : 5_000) + ++seq * 11 + Math.floor(Math.random() * 9));
}

export async function open(page: Page, user = 'admin', hash = '#/cases') {
  await page.goto('/' + hash);
  const form = page.getByRole('form', { name: 'Sign in' });
  const app = page.getByRole('navigation', { name: 'Main' });
  await expect(form.or(app)).toBeVisible();
  if (await form.isVisible()) await signIn(page, user);
  await expect(app).toBeVisible();
  if (!page.url().includes(hash)) await page.goto('/' + hash);
}

export async function createCase(page: Page, m: string, opts: { date?: string; group?: string } = {}) {
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  if (opts.group) await sheet.getByRole('radio', { name: opts.group }).click();
  await sheet.locator('#new-date').fill(opts.date ?? '2026-03-12');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  return page.url().split('#/cases/')[1];
}

export const saved = (page: Page) => expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText('Saved');
