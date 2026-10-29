// Screen review step 8 (owner, 29 Oct): Undo after deleting a case — the person who deleted it may restore it within a
// minute; after that, or for anyone else, only the Admin (recycle bin). Synthetic MRNs (9990xxx) only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('Undo a case delete', () => {
  it('the deleter may restore within a minute; later only the Admin', async () => {
    const sara = await as(h, 'sara');
    const admin = await as(h, 'admin');
    const a = (await newCase(sara, '9990801')).case_id;
    const b = (await newCase(sara, '9990802')).case_id;

    expect((await sara.call('POST', `/api/cases/${a}/delete`, {})).status).toBe(200);
    h.clock.now = new Date(h.clock.now.getTime() + 30_000);
    expect((await sara.call('POST', `/api/cases/${a}/restore`, {})).status).toBe(200);
    expect((await sara.call('GET', `/api/cases/${a}`)).status).toBe(200);

    expect((await sara.call('POST', `/api/cases/${b}/delete`, {})).status).toBe(200);
    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    expect((await sara.call('POST', `/api/cases/${b}/restore`, {})).status).toBe(403);
    expect((await admin.call('POST', `/api/cases/${b}/restore`, {})).status).toBe(200);
  });
});
