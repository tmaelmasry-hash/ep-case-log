// R4-9: patient page Timeline — recorded events by their own date, undated records listed apart, tap opens the case.
import { expect, test } from '@playwright/test';
import { createCase, mrn, open, saved } from './flow';

test('patient timeline shows the episode start by its date and the procedure; tapping opens the case', async ({ page }, info) => {
  const m = mrn(info, 9985000);
  await open(page);
  const id = await createCase(page, m, { date: '2026-03-12' });
  await page.getByRole('button', { name: 'Add Procedure' }).click();
  await page.getByTestId('addproc-sheet').getByRole('group', { name: 'Devices' }).getByRole('button', { name: 'Pacemaker' }).click();
  await page.getByTestId('addproc-next').click();
  await saved(page);
  await page.getByTestId('procedure-sheet').getByRole('button', { name: 'Done' }).click();

  await page.getByTestId('mrn-link').click();
  const view = page.getByTestId('patient-view');
  await expect(view.getByTestId('patient-proc')).toContainText('CIED implant'); // Cases = the page as before
  await view.getByRole('radiogroup', { name: 'Patient view' }).getByRole('radio', { name: 'Timeline' }).click();
  const tl = page.getByTestId('patient-timeline');
  await expect(tl.getByRole('heading', { name: '2026' })).toBeVisible();
  const ep = tl.getByTestId('timeline-event').filter({ hasText: 'Episode start' });
  await expect(ep).toContainText('12 Mar');
  await expect(ep).toContainText('Case No.');
  await expect(ep).toContainText('In progress');
  // The procedure is either dated (start / scheduled) or listed under "Without a date": never dated by when it was made.
  await expect(tl).toContainText('CIED implant');
  await expect(tl).toContainText('Planned follow-ups stay on the Follow-up tab');
  await ep.click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${id}$`));
});
