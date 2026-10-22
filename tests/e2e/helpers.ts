import type { Page } from '@playwright/test';

export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'synthetic-e2e-pass';

export async function signIn(page: Page, username = 'admin', password = E2E_PASSWORD) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}
