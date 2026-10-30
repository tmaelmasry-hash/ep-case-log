// Local-first L2 (owner R3-4): an edit is kept on this device when the server cannot be reached, survives a page
// reload, and is sent by itself once the connection is back.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('L3: the app opens without internet; a new case gets "No. pending", is filled offline, and gets its number when back', async ({ page, context }, info) => {
  const m = mrn(info, 9943000);
  await open(page);
  // The app files are kept by the service worker after the first visit.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-bar')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  await page.getByTestId('add-menu').click();
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await expect(sheet.getByTestId('offline-new-case')).toBeVisible();
  await sheet.locator('#new-mrn').fill(m);
  await sheet.locator('#new-date').fill('2026-03-12');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText(`${m}`);
  await expect(page.getByTestId('case-head')).toContainText('No. pending');
  await expect(page.getByTestId('device-only').first()).toBeVisible();
  await expect(page.getByTestId('complete-bar')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('offline-new-case.png') });

  // Filled offline.
  await page.getByTestId('section-patient').click();
  const ps = page.getByTestId('section-sheet');
  await ps.getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Male', exact: true }).click();
  await ps.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('save-indicator').filter({ visible: true }).first()).toHaveText(/Offline · \d+ waiting/);

  // Back online: created on the server, numbered, the edit sent.
  await context.setOffline(false);
  await expect(page.getByTestId('case-head')).toContainText(/No\. \d+/, { timeout: 30_000 });
  await expect(page.getByTestId('device-only')).toHaveCount(0);
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('case-head')).toContainText(/No\. \d+/);
  await page.getByTestId('section-patient').click();
  await expect(page.getByTestId('section-sheet').getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Male', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('an edit made without connection waits on the device, survives a reload, and syncs when back', async ({ page }, info) => {
  const m = mrn(info, 9942000);
  await open(page);
  const id = await createCase(page, m);
  const ind = page.getByTestId('save-indicator').filter({ visible: true }).first();

  // The server cannot be reached for saves.
  const block = (route: import('@playwright/test').Route) => (route.request().method() === 'PATCH' ? route.abort('internetdisconnected') : route.continue());
  await page.route('**/api/cases/**', block);
  await page.getByTestId('section-patient').click();
  const ps = page.getByTestId('section-sheet');
  await ps.getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Female' }).click();
  await expect(ind).toHaveText(/Offline · \d+ waiting/);
  await ps.getByRole('button', { name: 'Done' }).click();

  // Reload: the edit is still on the device and still shown.
  await page.reload();
  await expect(page.getByTestId('case-head')).toContainText(`${m}`);
  await expect(ind).toHaveText(/waiting|Syncing/);
  await page.getByTestId('section-patient').click();
  await expect(page.getByTestId('section-sheet').getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('section-sheet').getByRole('button', { name: 'Done' }).click();

  // Back online: it is sent by itself (Sync now speeds it up) and is in the server's copy.
  await page.unroute('**/api/cases/**', block);
  await ind.click();
  const sheet = page.getByRole('dialog', { name: 'Sync' });
  await sheet.getByRole('button', { name: 'Sync now' }).click();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await saved(page);
  // The server's copy has it: a fresh page with this device's copy removed still shows Female.
  await page.evaluate(async (caseId) => {
    const dbs = (await indexedDB.databases()).map((d) => d.name).filter((n): n is string => !!n?.startsWith('kamc-registry-'));
    for (const name of dbs) {
      const db = await new Promise<IDBDatabase>((ok) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => ok(r.result);
      });
      await new Promise((ok) => {
        const tx = db.transaction('cases', 'readwrite');
        tx.objectStore('cases').delete(caseId);
        tx.oncomplete = ok;
      });
      db.close();
    }
  }, id);
  await page.reload();
  await page.getByTestId('section-patient').click();
  await expect(page.getByTestId('section-sheet').getByRole('radiogroup', { name: 'Sex' }).getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'true');
});

test('offline new case: the MRN note says "this device only"; back online, other cases of the MRN on the server are told once', async ({ page, context, browser }, info) => {
  const m = mrn(info, 9944000);
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('offline-bar')).toBeVisible();

  // Meanwhile another device adds a case of this MRN to the Sheet; this device does not know it.
  const other = await browser.newContext({ ...info.project.use });
  const p2 = await other.newPage();
  await open(p2);
  await createCase(p2, m, { date: '2026-03-01' });
  await other.close();

  await page.getByTestId('add-menu').click();
  await page.getByTestId('new-case').click();
  const sheet = page.getByTestId('new-case-sheet');
  await sheet.locator('#new-mrn').fill(m);
  await expect(sheet.getByTestId('mrn-live')).toContainText('New patient');
  await expect(sheet.getByTestId('mrn-offline')).toHaveText('Offline: checked against cases on this device only.');
  await sheet.locator('#new-date').fill('2026-03-12');
  await sheet.getByRole('button', { name: 'Create case' }).click();
  await expect(page.getByTestId('case-head')).toContainText('No. pending');

  // Back online: the case is created as it is (nothing merged) and the user is told, with a link to the patient page.
  await context.setOffline(false);
  await expect(page.getByTestId('case-head')).toContainText(/No\. \d+/, { timeout: 30_000 });
  const toast = page.locator('.toast').filter({ hasText: `MRN ${m} already has 1 other case in the Google Sheet.` });
  await expect(toast).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('offline-mrn-recheck.png') });
  await toast.getByTestId('toast-link').click();
  await expect(page).toHaveURL(new RegExp(`#/patients/${m}$`));
  await expect(page.locator('.toast').filter({ hasText: `MRN ${m} already has` })).toHaveCount(0);
});
