import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, signIn } from './helpers';

test.describe.configure({ mode: 'serial' });

test('wrong password is refused with a clear message; right one opens the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText('Enter your username and password.')).toBeVisible();
  await signIn(page, 'sara', 'not-the-password');
  await expect(page.getByText('Username or password is not correct.')).toBeVisible();
  await signIn(page, 'sara');
  await expect(page.getByRole('heading', { name: 'Procedures', exact: true })).toBeVisible();
  // Session survives a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Procedures', exact: true })).toBeVisible();
});

test('a Member does not see Users; sign out asks first and returns to sign-in', async ({ page }) => {
  await page.goto('/#/settings');
  await signIn(page, 'sara');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByTestId('me-name')).toHaveText('Sara (test)');
  await expect(page.getByTestId('users-list')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
});

test('Admin adds a user; the user must choose their own password, then signs in with it', async ({ page, browser }, info) => {
  const uname = `omar.${info.project.name}`;
  await page.goto('/#/settings');
  await signIn(page, 'admin');
  await expect(page.getByTestId('users-list')).toBeVisible();
  await page.getByRole('button', { name: 'Add user' }).click();
  const sheet = page.getByTestId('add-user-sheet');
  await sheet.getByRole('button', { name: 'Add user' }).click();
  await expect(sheet.getByText('Username: 3–32 characters', { exact: false })).toBeVisible();
  await sheet.getByLabel('Display name').fill('Omar (test)');
  await sheet.getByLabel('Username').fill(uname);
  await sheet.getByRole('button', { name: 'Add user' }).click();
  const creds = page.getByTestId('credentials-text');
  await expect(creds).toContainText(`Username: ${uname}`);
  const text = (await creds.textContent())!;
  const temp = /Password: (\S+)/.exec(text)![1];
  expect(temp).toMatch(/^[a-z]+-\d{4}-[a-z]+$/);
  await page.getByTestId('credentials-sheet').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('user-row').filter({ hasText: uname })).toContainText('Must set own password');

  const ctx2 = await browser.newContext({ ...info.project.use });
  const p2 = await ctx2.newPage();
  await p2.goto('/');
  await signIn(p2, uname, temp);
  await expect(p2.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
  await p2.getByLabel('Current password').fill(temp);
  await p2.getByLabel('New password', { exact: true }).fill('omar-own-pass-1');
  await p2.getByLabel('New password again').fill('omar-own-pass-2');
  await p2.getByRole('button', { name: 'Save and continue' }).click();
  await expect(p2.getByText('The two new passwords are not the same.')).toBeVisible();
  await p2.getByLabel('New password again').fill('omar-own-pass-1');
  await p2.getByRole('button', { name: 'Save and continue' }).click();
  await expect(p2.getByRole('heading', { name: 'Procedures', exact: true })).toBeVisible();
  await ctx2.close();

  // Admin disables the account (with confirmation); the user can no longer sign in.
  await page.reload();
  await page.getByTestId('user-row').filter({ hasText: uname }).click();
  await page.getByRole('button', { name: 'Disable account' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disable' }).click();
  await expect(page.getByTestId('user-row').filter({ hasText: uname })).toContainText('Disabled');
  const ctx3 = await browser.newContext({ ...info.project.use });
  const p3 = await ctx3.newPage();
  await p3.goto('/');
  await signIn(p3, uname, 'omar-own-pass-1');
  await expect(p3.getByText('Username or password is not correct.')).toBeVisible();
  await ctx3.close();
});

test('sign-in screen fits phone and desktop', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByRole('form', { name: 'Sign in' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `test-results/screens/${info.project.name}-signin.png` });
  void E2E_PASSWORD;
});
