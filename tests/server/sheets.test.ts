// Phase 4: the Google Sheet store over the real apps-script/Code.js (fake spreadsheet). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/dictionary.ts';
import { applyEdits, newCaseRecord } from '../../server/domain/cases.ts';
import { MemoryStore } from '../../server/store/memory.ts';
import { ENTITY_TABS, buildLayout } from '../../server/store/sheet-layout.ts';
import { SheetsStore } from '../../server/store/sheets.ts';
import { StaleCaseError, type RegistryStore } from '../../server/store/types.ts';
import { FakeAppsScript } from './fakeGoogle.ts';

const config = loadConfig();
const { dict } = config;
const a = (userId: string) => ({ userId, now: '2026-10-22T08:00:00.000Z' });

async function sheets() {
  const google = new FakeAppsScript();
  await google.call('init');
  const store = new SheetsStore(config, google);
  await store.setup();
  return { google, store };
}

function newCase(id = 'case_1', mrn = '0990101') {
  return newCaseRecord(dict, { caseId: id, patientId: 'patient_1', mrn, groupId: 'grp_1', groupSeq: 1, episodeStart: '2026-03-12', enrollmentDate: '2026-10-22', registryBasis: 'CLINICAL_QI' }, a('u1'));
}

describe.skipIf(process.env.TEST_STORE === 'sheets')('Google Sheet store', () => {
  it('lays every dictionary entity in exactly one tab, with dictionary column names only', () => {
    const layout = buildLayout(dict);
    expect(Object.keys(layout.tabOf).sort()).toEqual(Object.keys(dict.entities).sort());
    const all = Object.values(ENTITY_TABS).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const t of layout.tabs.filter((x) => Object.keys(ENTITY_TABS).includes(x.name))) {
      for (const h of t.headers.filter((x) => x.includes('__'))) {
        const [e, f] = h.split('__');
        expect(dict.entities[e].fields.some((x) => x.name === f), h).toBe(true);
      }
    }
  });

  it('refuses calls without the gateway secret; the secret is set once', async () => {
    const google = new FakeAppsScript('right-secret-0123456789-0123456789-abc');
    await google.call('init');
    const wrong = new FakeAppsScript('wrong-secret-0123456789-0123456789-abc');
    wrong.props = google.props;
    (wrong as unknown as { book: unknown }).book = google.book;
    await expect(new SheetsStore(config, wrong).listGroups()).rejects.toThrow(/FORBIDDEN/);
    expect(google.props.get('GATEWAY_SECRET')).toBe('right-secret-0123456789-0123456789-abc');
  });

  for (const kind of ['memory', 'sheets'] as const) {
    it(`two saves from the same starting point to different fields both survive (${kind})`, async () => {
      const store: RegistryStore = kind === 'memory' ? new MemoryStore() : (await sheets()).store;
      await store.putCase(newCase(), null);
      const r1 = (await store.getCase('case_1'))!;
      const r2 = (await store.getCase('case_1'))!;
      const b1 = structuredClone(r1);
      const b2 = structuredClone(r2);
      applyEdits(dict, r1, { changes: [{ entity: 'PATIENTS', id: 'patient_1', field: 'sex_at_birth', value: 'MALE' }] }, a('u1'), new Set());
      applyEdits(dict, r2, { changes: [{ entity: 'PATIENT_IDENTIFIERS', id: 'patient_1', field: 'date_of_birth', value: '1968-01-20' }] }, a('u2'), new Set()); // same edit as e2 below
      await store.putCase(r1, b1);
      // L1: the Sheet store refuses the second save as stale (row_version moved); like the route, read again and redo.
      const e2 = { changes: [{ entity: 'PATIENT_IDENTIFIERS', id: 'patient_1', field: 'date_of_birth', value: '1968-01-20' }] };
      try {
        await store.putCase(r2, b2);
        expect(kind).toBe('memory');
      } catch (e) {
        expect(e).toBeInstanceOf(StaleCaseError);
        const fresh = (await store.getCase('case_1'))!;
        const fb = structuredClone(fresh);
        applyEdits(dict, fresh, e2, a('u2'), new Set());
        await store.putCase(fresh, fb);
      }
      const after = (await store.getCase('case_1'))!;
      expect(after.rows.PATIENTS[0].sex_at_birth).toBe('MALE');
      expect(after.rows.PATIENT_IDENTIFIERS[0].date_of_birth).toBe('1968-01-20');
    });
  }

  it('keeps MRN leading zeros and dates as text; one history line per merged edit; activity holds no values', async () => {
    const { google, store } = await sheets();
    await store.putCase(newCase('case_1', '0990101'), null);
    const rec = (await store.getCase('case_1'))!;
    expect(rec.meta.mrn).toBe('0990101');
    expect(google.table('Cases')[0].mrn).toBe('0990101');
    expect(google.table('Episode')[0].EP_EPISODES__episode_start_date).toBe('2026-03-12');

    const edit = async (value: string) => {
      const r = (await store.getCase('case_1'))!;
      const base = structuredClone(r);
      applyEdits(dict, r, { changes: [{ entity: 'EP_EPISODES', id: r.meta.episode_id, field: 'episode_start_date', value }] }, a('u1'), new Set());
      await store.putCase(r, base);
    };
    await edit('2026-03-13');
    await edit('2026-03-14');
    const hist = google.table('History').filter((h) => h.kind === 'edit');
    expect(hist).toHaveLength(1);
    expect(JSON.parse(String(hist[0].new_json))).toBe('2026-03-14');
    expect((await store.getCase('case_1'))!.history!.filter((h) => h.kind === 'edit')).toHaveLength(1);

    await store.appendActivity([{ actor: 'u1', action: 'case.edit', detail: { case_id: 'case_1', fields: ['EP_EPISODES.episode_end_date'] } }]);
    const act = google.table('Activity');
    expect(act[0].activity_id).toBe(1);
    expect(JSON.stringify(act)).not.toContain('2026-03-14');
  });

  it('numbers cases per group under the lock and never reuses a number', async () => {
    const { store } = await sheets();
    await store.createGroup({ group_id: 'grp_1', name: 'Group 1', sort_order: 1, next_seq: 1, is_deleted: false, created_at: '2026-10-22T08:00:00.000Z' });
    expect([await store.allocateSeq('grp_1'), await store.allocateSeq('grp_1'), await store.allocateSeq('grp_1')]).toEqual([1, 2, 3]);
    expect((await store.listGroups())[0].next_seq).toBe(4);
  });

  it('reads a case in one gateway call and saves an edit in one more', async () => {
    const { google, store } = await sheets();
    await store.putCase(newCase(), null);
    const n0 = google.calls;
    const r = (await store.getCase('case_1'))!;
    const base = structuredClone(r);
    applyEdits(dict, r, { changes: [{ entity: 'PATIENTS', id: 'patient_1', field: 'sex_at_birth', value: 'FEMALE' }] }, a('u1'), new Set());
    await store.putCase(r, base);
    expect(google.calls - n0).toBe(2);
  });
});
