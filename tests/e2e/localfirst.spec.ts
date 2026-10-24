// Local-first L2 (owner R3-4): an edit is kept on this device when the server cannot be reached, survives a page
// reload, and is sent by itself once the connection is back.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

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
  await ps.getByRole('radiogroup', { name: 'Sex at birth' }).getByRole('radio', { name: 'Female' }).click();
  await expect(ind).toHaveText(/Offline · \d+ waiting/);
  await ps.getByRole('button', { name: 'Done' }).click();

  // Reload: the edit is still on the device and still shown.
  await page.reload();
  await expect(page.getByTestId('case-head')).toContainText(`MRN: ${m}`);
  await expect(ind).toHaveText(/waiting|Syncing/);
  await page.getByTestId('section-patient').click();
  await expect(page.getByTestId('section-sheet').getByRole('radiogroup', { name: 'Sex at birth' }).getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'true');
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
  await expect(page.getByTestId('section-sheet').getByRole('radiogroup', { name: 'Sex at birth' }).getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'true');
});
