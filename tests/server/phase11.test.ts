// Phase 11: AI Assistant (EP Workspace P5) on the synthetic sample notes (Test AI) and a stubbed live provider.
// Synthetic data only; the note is never stored or logged.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyExtraction, fixtureExtract } from '../../server/ai/extract.ts';
import { redact } from '../../server/ai/redact.ts';
import { expectedSlot } from '../../server/domain/cases.ts';
import { as, config, edit, harness, newCase, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const sample = (id: string, mrn: string) => {
  const fx = config.aiFixtures.find((f) => f.id === id)!;
  return fx.text.join('\n').split(fx.identifiers.mrn).join(mrn);
};

type Client = Awaited<ReturnType<typeof as>>;
type Item = { status: string; entity: string; field: string; row?: string; value?: unknown; evidence?: string };
/** What the device sends when a person accepts: every proposed value, or those `only` picks. */
const accept = (c: Client, id: string, r: { data: { target: string | null; items: Item[] } }, only: (i: Item) => boolean = () => true, rowIds: Record<string, string> = {}) =>
  c.call('POST', `/api/cases/${id}/ai/apply`, {
    procedure_id: r.data.target,
    row_ids: rowIds,
    values: r.data.items.filter((i) => i.status === 'FILLED' && only(i)).map((i) => ({ entity: i.entity, field: i.field, row: i.row, value: i.value, evidence: i.evidence })),
    additional: r.data.items.filter((i) => i.status === 'ADDITIONAL' && only(i)).map((i) => ({ text: i.value, evidence: i.evidence })),
  });
/** AI values waiting in the Sheet, as older versions saved them at extract. */
async function savedAsBefore(id: string, note: string, mrn: string) {
  const rec = (await h.store.getCase(id))!;
  const base = structuredClone(rec);
  const red = redact(note, { mrn });
  applyExtraction(config.dict, rec, fixtureExtract(config, red.text)!.raw, red.text, null, { userId: 'old', now: '2026-10-01T00:00:00Z' });
  await h.store.putCase(rec, base);
  return rec;
}

describe('AI Assistant (Test AI)', () => {
  it('extract saves nothing; accepted values go in, procedure fields into a new procedure, with no AI marks left', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1184420');
    const before = (await sara.call('GET', `/api/cases/${case_id}`)).data;
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420'), procedure_id: 'new' });
    expect(r.status).toBe(200);
    expect(r.data.recognised).toBe(true);
    expect(r.data.summary.filled).toBeGreaterThan(20);
    expect(r.data.removed.name).toBeGreaterThan(0); // the name was taken out before anything was matched/sent
    // Nothing reached the store, so nothing can reach the Sheet, Excel or the Dashboard.
    const still = (await sara.call('GET', `/api/cases/${case_id}`)).data;
    expect(still.meta.row_version).toBe(before.meta.row_version);
    expect(still.rows.EP_PROCEDURES ?? []).toEqual([]);
    expect(still.ai).toEqual({});
    expect(still.rows.CLINICAL_PROFILE_SNAPSHOTS?.[0]?.hypertension ?? null).toBeNull();
    expect((await sara.call('GET', `/api/cases/${case_id}/history`)).data.items.some((x: { text: string }) => x.text.includes('AI'))).toBe(false);

    // Reject one by not sending it; accept the rest, in one save.
    const saves = vi.spyOn(h.store, 'putCase');
    const done = await accept(sara, case_id, r, (i) => i.field !== 'diabetes');
    expect(done.status).toBe(200);
    expect(saves).toHaveBeenCalledTimes(1);
    const d = done.data.case;
    const pid = done.data.procedure_id;
    expect(d.rows.EP_PROCEDURES.map((p: { _id: string }) => p._id)).toEqual([pid]);
    expect(d.rows.AF_ABLATIONS[0]).toMatchObject({ procedure_id: pid, af_energy_source: 'PFA', acute_af_endpoint: 'COMPLETE_PVI_OR_REISOLATION' });
    expect(d.rows.CLINICAL_PROFILE_SNAPSHOTS[0].hypertension).toBe('YES');
    expect(d.rows.CLINICAL_PROFILE_SNAPSHOTS[0].diabetes ?? null).toBeNull();
    expect(d.rows.PATIENT_IDENTIFIERS[0].date_of_birth).toBeNull(); // never inferred from "67-year-old"
    expect(d.ai).toEqual({});
    const hist = (await sara.call('GET', `/api/cases/${case_id}/history`)).data.items;
    expect(hist.some((x: { text: string }) => x.text.includes('(AI, accepted)'))).toBe(true);
    // The activity log holds counts only, never the note.
    const log = JSON.stringify(await h.store.listActivity());
    expect(log).not.toContain('apixaban');
    expect(log).not.toContain('Testname');
  });

  it('a note naming another MRN stops before anything is sent or filled', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990701');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420'), procedure_id: 'new' });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('MRN_MISMATCH');
    expect(((await sara.call('GET', `/api/cases/${case_id}`)).data.rows.EP_PROCEDURES ?? []).length).toBe(0);
  });

  it('without a chosen procedure, procedure values are dropped with a reason; a saved different value becomes a conflict', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1184420');
    const d0 = (await sara.call('GET', `/api/cases/${case_id}`)).data;
    await edit(sara, case_id, { changes: [{ entity: 'PATIENTS', id: d0.meta.patient_id, field: 'sex_at_birth', value: 'FEMALE' }] });
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420') });
    expect(r.data.items.filter((i: { reason?: string }) => i.reason?.startsWith('procedure field')).length).toBeGreaterThan(5);
    const conflict = r.data.items.find((i: { status: string; field: string }) => i.status === 'CONFLICT' && i.field === 'sex_at_birth');
    expect(conflict).toMatchObject({ value: 'FEMALE', proposed: ['MALE'] });
    // Never overwritten without a person's choice, not even by accepting the same value as a plain one.
    const plain = await sara.call('POST', `/api/cases/${case_id}/ai/apply`, { procedure_id: null, values: [{ entity: 'PATIENTS', field: 'sex_at_birth', row: '', value: 'MALE', evidence: conflict.evidence }] });
    expect(plain.data.case.rows.PATIENTS[0].sex_at_birth).toBe('FEMALE');
    const used = await sara.call('POST', `/api/cases/${case_id}/ai/apply`, { procedure_id: null, values: [{ entity: 'PATIENTS', field: 'sex_at_birth', row: '', value: 'MALE', evidence: conflict.evidence, overwrite: true }] });
    expect(used.data.case.rows.PATIENTS[0].sex_at_birth).toBe('MALE');
    expect(used.data.case.ai).toEqual({});
  });

  it('values accepted in two goes land in one row, and a procedure made by the first go is used by the second', async () => {
    const admin = await as(h, 'admin');
    const { case_id } = await newCase(admin, '1184420');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420'), procedure_id: 'new' });
    const items: Item[] = r.data.items;
    const echo = items.filter((i) => i.status === 'FILLED' && i.entity === 'ECHO_STUDIES');
    expect(echo.length).toBeGreaterThan(1);
    const first = await accept(admin, case_id, r, (i) => i === echo[0]);
    const second = await accept(admin, case_id, r, (i) => i === echo[1], first.data.row_ids);
    expect(second.data.case.rows.ECHO_STUDIES).toHaveLength(1);
    expect(second.data.case.rows.ECHO_STUDIES[0][echo[0].field]).toBeTruthy();
    expect(second.data.case.rows.ECHO_STUDIES[0][echo[1].field]).toBeTruthy();

    const p1 = await accept(admin, case_id, r, (i) => i.entity === 'AF_ABLATIONS');
    const pid = p1.data.procedure_id;
    expect(pid).toBeTruthy();
    const p2 = await accept(admin, case_id, { data: { ...r.data, target: pid } }, (i) => i.entity === 'EP_PROCEDURES');
    expect(p2.data.case.rows.EP_PROCEDURES).toHaveLength(1);
  });

  it('a value that is not valid for the dictionary is refused at accept, and an edited value is taken', async () => {
    const admin = await as(h, 'admin');
    const { case_id } = await newCase(admin, '9990705');
    const bad = await admin.call('POST', `/api/cases/${case_id}/ai/apply`, { procedure_id: null, values: [{ entity: 'PATIENTS', field: 'sex_at_birth', row: '', value: 'NOT_A_CODE', evidence: '' }] });
    expect(bad.data.items[0].status).toBe('DROPPED');
    expect(bad.data.case.rows.PATIENTS[0].sex_at_birth ?? null).toBeNull();
    const yes = await admin.call('POST', `/api/cases/${case_id}/ai/apply`, { procedure_id: null, values: [{ entity: 'PATIENTS', field: 'sex_at_birth', row: '', value: 'FEMALE', evidence: 'typed over' }] });
    expect(yes.data.case.rows.PATIENTS[0].sex_at_birth).toBe('FEMALE');
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/apply`, { values: [] })).status).toBe(400);
  });

  it('a note about a cancelled procedure flags its module values, not the status itself', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1009315');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N02', '1009315'), procedure_id: 'new' });
    const items: (Item & { flag?: string })[] = r.data.items;
    expect(items.find((i) => i.field === 'procedure_status')).toMatchObject({ value: expect.stringContaining('CANCEL') });
    expect(items.find((i) => i.field === 'procedure_status')?.flag).toBeUndefined();
    const af = items.filter((i) => i.entity === 'AF_ABLATIONS' && i.status === 'FILLED');
    expect(af.length).toBeGreaterThan(0);
    expect(af.every((i) => i.flag === 'procedure_cancelled')).toBe(true);
    expect(items.find((i) => i.entity === 'CLINICAL_PROFILE_SNAPSHOTS')?.flag).toBeUndefined();
  });

  it('AI values saved by an older version stay readable and can still be reviewed; completion waits for them', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1184420');
    await savedAsBefore(case_id, sample('N01', '1184420'), '1184420');
    const d = (await sara.call('GET', `/api/cases/${case_id}`)).data;
    expect(Object.values(d.ai).every((m: any) => m.source === 'AI')).toBe(true);
    expect((await sara.call('POST', `/api/cases/${case_id}/complete`, {})).data.error.code).toBe('NOT_READY');
    const key = Object.keys(d.ai).find((k) => k.startsWith('CLINICAL_PROFILE_SNAPSHOTS|') && k.endsWith('|diabetes'))!;
    const rej = await sara.call('POST', `/api/cases/${case_id}/ai/review`, { actions: [{ key, action: 'reject' }] });
    expect(rej.data.case.rows.CLINICAL_PROFILE_SNAPSHOTS[0].diabetes).toBeNull();
    const all = await sara.call('POST', `/api/cases/${case_id}/ai/review`, { accept_all: true });
    expect(Object.keys(all.data.case.ai).filter((k) => !k.endsWith('|*'))).toEqual([]);
  });

  it('a completed case refuses the Assistant; a note not in the samples fills nothing', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990702');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'Free text that is not one of the sample notes at all.' });
    expect(r.data).toMatchObject({ recognised: false, summary: { filled: 0 } });
  });
});

describe('This is what will be sent', () => {
  const MADE_UP = 'Name: Ahmed Zahrani. DOB 12/03/1961. MRN 9990710. National ID 1012345678. Mail a.z@example.com. Seen by Dr. Salem Testperson. Hypertension on amlodipine.';

  /** A stubbed live Claude that keeps what it was sent, and quotes `evidence`. */
  async function liveAdmin(evidence: string) {
    const admin = await as(h, 'admin');
    await admin.call('POST', '/api/settings/ai', { provider: 'anthropic' });
    (h.app.ctx.env as { anthropicKey?: string }).anthropicKey = 'sk-test-synthetic';
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push(String(init?.body));
      const answer = { proposals: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'hypertension', value: 'YES', row: '', evidence }], conflicts: [], additional_info: [] };
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    return { admin, sent };
  }

  it('returns the de-identified text and counts; no provider is called and nothing is stored', async () => {
    const { admin, sent } = await liveAdmin('hypertension on amlodipine');
    const { case_id } = await newCase(admin, '9990710');
    const log = (await h.store.listActivity()).length;
    const usage = (await admin.call('GET', '/api/ai/status')).data.usage;
    const before = (await admin.call('GET', `/api/cases/${case_id}`)).data.meta.row_version;
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/preview`, { note: MADE_UP });
    expect(r.status).toBe(200);
    expect(r.data.text).toBe('Name: [NAME]. DOB 12/03/1961. MRN [MRN]. National ID [ID]. Mail [EMAIL]. Seen by Dr. [NAME]. Hypertension on amlodipine.');
    expect(r.data.removed).toEqual({ mrn: 1, id: 1, email: 1, phone: 0, name: 2, instruction: 0 });
    expect(sent).toHaveLength(0);
    expect(await h.store.listActivity()).toHaveLength(log);
    expect((await admin.call('GET', '/api/ai/status')).data.usage).toEqual(usage);
    expect((await admin.call('GET', `/api/cases/${case_id}`)).data.meta.row_version).toBe(before);
  });

  it('a note naming another MRN stops at the preview; an empty note is refused', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990711');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/preview`, { note: 'EP note. MRN 9990799. Hypertension.' });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('MRN_MISMATCH');
    expect((await sara.call('POST', `/api/cases/${case_id}/ai/preview`, { note: '  ' })).status).toBe(400);
  });

  it('the edited text is de-identified again and is what the provider receives; the date of birth goes through', async () => {
    const { admin, sent } = await liveAdmin('Hypertension on amlodipine');
    const { case_id } = await newCase(admin, '9990712');
    const edited = 'Name: Typed Backin. DOB 12/03/1961. Iqama 2412345678. Hypertension on amlodipine.';
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: MADE_UP.replace('9990710', '9990712'), sent_text: edited });
    expect(r.status).toBe(200);
    expect(r.data.summary.filled).toBe(1);
    expect(r.data.removed).toMatchObject({ name: 1, id: 1 });
    const body = JSON.parse(sent[0]);
    const text = JSON.stringify(body.messages);
    expect(text).toContain('Name: [NAME]. DOB 12/03/1961. Iqama [ID]. Hypertension on amlodipine.');
    for (const gone of ['Typed', 'Backin', '2412345678', 'Zahrani', 'Salem', '1012345678', 'example.com']) expect(JSON.stringify(body)).not.toContain(gone);
    // Counts only in the log.
    const log = JSON.stringify(await h.store.listActivity());
    expect(log).not.toContain('amlodipine');
    expect(log).not.toContain('12/03/1961');
  });

  it('the MRN check reads the original note and also the edited text', async () => {
    const { admin, sent } = await liveAdmin('Hypertension');
    const { case_id } = await newCase(admin, '9990713');
    const a = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'MRN 9990799. Hypertension.', sent_text: 'Hypertension.' });
    expect(a.data.error.code).toBe('MRN_MISMATCH');
    const b = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'Hypertension.', sent_text: 'MRN 9990799. Hypertension.' });
    expect(b.data.error.code).toBe('MRN_MISMATCH');
    expect(sent).toHaveLength(0);
  });

  it('a quote only in the original note, deleted while editing, is dropped: quotes are checked against the text sent', async () => {
    const { admin } = await liveAdmin('Hypertension on amlodipine');
    const { case_id } = await newCase(admin, '9990714');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'Hypertension on amlodipine. LVEF 55%.', sent_text: 'LVEF 55%.' });
    expect(r.data.summary).toMatchObject({ filled: 0, dropped: 1 });
    expect(r.data.items[0].reason).toBe('the quote is not in the note');
  });

  it('an empty edited text is refused', async () => {
    const { admin, sent } = await liveAdmin('x');
    const { case_id } = await newCase(admin, '9990715');
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'Hypertension.', sent_text: ' ' })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('the AI fills the date of birth from an explicit birth date (owner, 4 Nov)', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1009315');
    const r = await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N02', '1009315'), procedure_id: 'new' });
    expect((await accept(sara, case_id, r)).data.case.rows.PATIENT_IDENTIFIERS[0].date_of_birth).toBe('1961-03-02');
  });

  it('a new procedure is made only if the note really fills one (owner, 4 Nov)', async () => {
    const { admin } = await liveAdmin('Hypertension on amlodipine');
    const procs = async (id: string) => (await admin.call('GET', `/api/cases/${id}`)).data.rows.EP_PROCEDURES ?? [];

    // Case data only: filled, and no empty procedure.
    const a = (await newCase(admin, '9990716')).case_id;
    const r = await admin.call('POST', `/api/cases/${a}/ai/extract`, { note: 'Hypertension on amlodipine.', procedure_id: 'new' });
    expect(r.data.summary.filled).toBe(1);
    const saved = await accept(admin, a, r);
    expect(saved.data.procedure_id).toBeNull();
    expect(saved.data.case.rows.CLINICAL_PROFILE_SNAPSHOTS[0].hypertension).toBe('YES');
    expect(await procs(a)).toHaveLength(0);

    // Nothing found: nothing changes.
    const b = (await newCase(admin, '9990717')).case_id;
    const before = (await admin.call('GET', `/api/cases/${b}`)).data.meta.row_version;
    const none = await admin.call('POST', `/api/cases/${b}/ai/extract`, { note: 'A note with no such quote.', procedure_id: 'new' });
    expect(none.data.summary).toMatchObject({ filled: 0, dropped: 1 });
    expect(await procs(b)).toHaveLength(0);
    expect((await admin.call('GET', `/api/cases/${b}`)).data.meta.row_version).toBe(before);
  });

  it('procedure details make the new procedure, and fill it', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '1184420');
    const r = await accept(sara, case_id, await sara.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420'), procedure_id: 'new' }));
    expect(r.data.procedure_id).toBeTruthy();
    expect(r.data.case.rows.EP_PROCEDURES.map((p: { _id: string }) => p._id)).toEqual([r.data.procedure_id]);
    expect(r.data.case.rows.AF_ABLATIONS[0].procedure_id).toBe(r.data.procedure_id);
  });

  it('the sample-note list is gone', async () => {
    const sara = await as(h, 'sara');
    expect((await sara.call('GET', '/api/ai/status')).data.sample_notes).toBeUndefined();
    expect((await sara.call('GET', '/api/ai/sample/N01')).status).toBe(404);
  });
});

describe('Device Interrogation filled by the AI (owner, 4 Nov)', () => {
  const NOTE = sample('N16', '9990731');
  const rowsOf = (r: { data: { case: { rows: Record<string, Record<string, unknown>[]> } } }, e: string) => r.data.case.rows[e] ?? [];
  const extract = async (c: Client, id: string, note = NOTE) => c.call('POST', `/api/cases/${id}/ai/extract`, { note });
  const run = async (c: Client, id: string, note = NOTE) => accept(c, id, await extract(c, id, note));

  /** A saved row, by the same route the case page uses. */
  async function addRow(c: Awaited<ReturnType<typeof as>>, id: string, entity: string, rowId: string, values: Record<string, unknown>) {
    const r = await c.call('PATCH', `/api/cases/${id}`, { creates: [{ entity, id: rowId, values }] });
    expect(r.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    return rowId;
  }
  const leadId = () => `lead_${crypto.randomUUID()}`;

  it('no device in the case: accepting makes the device, the check and the channel, linked', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990731');
    const r = await run(sara, case_id);
    expect(r.data.summary).toMatchObject({ filled: 10, dropped: 0 });
    const [device] = rowsOf(r, 'DEVICES');
    const [check] = rowsOf(r, 'DEVICE_INTERROGATIONS');
    const [channel] = rowsOf(r, 'DEVICE_CHECK_CHANNELS');
    expect(rowsOf(r, 'DEVICES')).toHaveLength(1);
    expect(device).toMatchObject({ manufacturer: 'MEDTRONIC', current_device_type: 'ICD_DUAL' });
    expect(check).toMatchObject({ device_id: device._id, check_datetime: '2026-10-12', programmed_mode: 'DDD', lower_rate_bpm: 60, rv_pacing_pct: 3 });
    expect(channel).toMatchObject({ device_check_id: check._id, channel_type: 'PHYSICAL_LEAD', capture_threshold_v: 0.75, sensing_mv: 11, impedance_ohm: 520 });
    expect(channel.lead_id ?? null).toBeNull(); // no lead saved: a person chooses
    expect(r.data.case.ai).toEqual({});
  });

  it('the same note twice adds no second check or channel', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990731');
    await run(sara, case_id);
    const again = await extract(sara, case_id);
    expect(again.data.summary.filled).toBe(0);
    const d = await sara.call('GET', `/api/cases/${case_id}`);
    for (const e of ['DEVICES', 'DEVICE_INTERROGATIONS', 'DEVICE_CHECK_CHANNELS']) expect(d.data.rows[e]).toHaveLength(1);
  });

  it('one saved device: the check goes to it, with no new device', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990731');
    const slot = expectedSlot(config.dict, 'DEVICES', case_id);
    await addRow(sara, case_id, 'DEVICES', slot, { manufacturer: 'MEDTRONIC', current_device_type: 'ICD_DUAL' });
    const r = await run(sara, case_id);
    expect(rowsOf(r, 'DEVICES').map((d) => d._id)).toEqual([slot]);
    expect(rowsOf(r, 'DEVICE_INTERROGATIONS')[0].device_id).toBe(slot);
  });

  it('the channel links to a lead only when one lead has that location', async () => {
    const sara = await as(h, 'sara');
    const one = (await newCase(sara, '9990731')).case_id;
    const rv = await addRow(sara, one, 'DEVICE_LEADS', leadId(), { lead_location: 'RV' });
    await addRow(sara, one, 'DEVICE_LEADS', leadId(), { lead_location: 'RA' });
    expect(rowsOf(await run(sara, one), 'DEVICE_CHECK_CHANNELS')[0].lead_id).toBe(rv);

    const admin = await as(h, 'admin');
    const two = (await newCase(admin, '9990732')).case_id;
    await addRow(admin, two, 'DEVICE_LEADS', leadId(), { lead_location: 'RV' });
    await addRow(admin, two, 'DEVICE_LEADS', leadId(), { lead_location: 'RV' });
    const r = await run(admin, two, sample('N16', '9990732'));
    expect(rowsOf(r, 'DEVICE_CHECK_CHANNELS')[0].lead_id ?? null).toBeNull();
  });

  it('older AI values: rejecting them all removes the channel, the check and the device the AI made', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990731');
    const rec = await savedAsBefore(case_id, NOTE, '9990731');
    const actions = Object.entries(rec.ai as Record<string, { field: string }>).filter(([, m]) => m.field !== '*').map(([key]) => ({ key, action: 'reject' }));
    const done = await sara.call('POST', `/api/cases/${case_id}/ai/review`, { actions });
    for (const e of ['DEVICES', 'DEVICE_INTERROGATIONS', 'DEVICE_CHECK_CHANNELS']) expect(rowsOf(done, e)).toHaveLength(0);
  });

  it('older AI values: rejecting only the check values keeps the check while a channel value still waits', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990731');
    const rec = await savedAsBefore(case_id, NOTE, '9990731');
    const actions = Object.entries(rec.ai as Record<string, { entity: string; field: string }>).filter(([, m]) => m.entity === 'DEVICE_INTERROGATIONS' && m.field !== '*').map(([key]) => ({ key, action: 'reject' }));
    const done = await sara.call('POST', `/api/cases/${case_id}/ai/review`, { actions });
    expect(rowsOf(done, 'DEVICE_INTERROGATIONS')).toHaveLength(1);
    expect(rowsOf(done, 'DEVICE_CHECK_CHANNELS')[0].sensing_mv).toBe(11);
  });
});

describe('Dates only, never a time (owner, 4 Nov)', () => {
  const dated = [
    ['COMPLICATIONS', 'event_datetime'],
    ['DEVICE_INTERROGATIONS', 'check_datetime'],
    ['DEVICE_INTERROGATIONS', 'review_period_start_datetime'],
    ['DEVICE_LEAD_CONNECTIONS', 'connected_from_datetime'],
    ['DEVICE_LEAD_CONNECTIONS', 'connected_to_datetime'],
    ['ECG_STUDIES', 'ecg_datetime'],
    ['EP_PROCEDURES', 'procedure_start_datetime'],
    ['EP_PROCEDURES', 'procedure_end_datetime'],
    ['RHYTHM_MONITORING', 'start_datetime'],
    ['RHYTHM_MONITORING', 'end_datetime'],
    ['TILT_TESTS', 'test_datetime'],
  ];

  it('no field in the app asks for a time', () => {
    for (const def of Object.values(config.dict.entities)) for (const f of def.fields) expect(`${def.entity}.${f.name}:${f.type}`).not.toMatch(/:datetime$/);
    for (const [e, n] of dated) expect(config.dict.entities[e].fields.find((f) => f.name === n)).toMatchObject({ type: 'date', date_only: true });
  });

  it('a time from an older device is cut; a time already stored shows as the date and is not rewritten', async () => {
    const sara = await as(h, 'sara');
    const { case_id } = await newCase(sara, '9990741');
    const ecg = `ecg_${crypto.randomUUID()}`;
    const made = await sara.call('PATCH', `/api/cases/${case_id}`, { creates: [{ entity: 'ECG_STUDIES', id: ecg, values: { ecg_datetime: '2026-03-02T10:00' } }] });
    expect(made.data.results[0].ok).toBe(true);
    const rec = (await h.store.getCase(case_id))!;
    expect(rec.rows.ECG_STUDIES[0].ecg_datetime).toBe('2026-03-02');
    // A row saved before this change.
    const base = structuredClone(rec);
    rec.rows.ECG_STUDIES[0].ecg_datetime = '2026-03-02T10:00';
    await h.store.putCase(rec, base);
    expect((await h.store.getCase(case_id))!.rows.ECG_STUDIES[0].ecg_datetime).toBe('2026-03-02T10:00');
    const seen = (await sara.call('GET', `/api/cases/${case_id}`)).data.rows.ECG_STUDIES[0];
    expect(seen.ecg_datetime).toBe('2026-03-02');
    expect((await h.store.getCase(case_id))!.rows.ECG_STUDIES[0].ecg_datetime).toBe('2026-03-02T10:00');
  });

  /** A stubbed live Claude answering `answer`. */
  async function liveWith(answer: object) {
    const admin = await as(h, 'admin');
    await admin.call('POST', '/api/settings/ai', { provider: 'anthropic' });
    (h.app.ctx.env as { anthropicKey?: string }).anthropicKey = 'sk-test-synthetic';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    return admin;
  }

  it('the AI fills a date with no time; two ECGs become two rows with their own dates', async () => {
    const admin = await liveWith({
      proposals: [
        { entity: 'ECG_STUDIES', field: 'ecg_datetime', value: '2026-01-12', row: 'ecg-1', evidence: 'ECG 12 Jan 2026' },
        { entity: 'ECG_STUDIES', field: 'ecg_datetime', value: '2026-03-03', row: 'ecg-2', evidence: 'ECG 3 Mar 2026' },
      ],
      conflicts: [],
      additional_info: [],
    });
    const { case_id } = await newCase(admin, '9990742');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'ECG 12 Jan 2026: sinus. ECG 3 Mar 2026: SVT.' });
    expect(r.data.summary.filled).toBe(2);
    expect((await accept(admin, case_id, r)).data.case.rows.ECG_STUDIES.map((x: { ecg_datetime: string }) => x.ecg_datetime).sort()).toEqual(['2026-01-12', '2026-03-03']);
  });

  it('a lab with no date in the note fills its values and leaves the date empty for a person', async () => {
    const admin = await liveWith({ proposals: [{ entity: 'LAB_RESULTS', field: 'inr', value: '2.4', row: 'lab-1', evidence: 'INR 2.4' }], conflicts: [], additional_info: [] });
    const { case_id } = await newCase(admin, '9990743');
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'INR 2.4.' });
    expect(r.data.summary.filled).toBe(1);
    expect((await accept(admin, case_id, r)).data.case.rows.LAB_RESULTS[0].lab_date ?? null).toBeNull();
  });
});

describe('AI Assistant (live provider, stubbed)', () => {
  it('Admin switches to Claude; without a key it says what to add; with a key only de-identified text is sent, with fallbacks on', async () => {
    const admin = await as(h, 'admin');
    const set = await admin.call('POST', '/api/settings/ai', { provider: 'anthropic' });
    expect(set.data).toMatchObject({ provider: 'anthropic', configured: false });
    expect(set.data.reason).toContain('ANTHROPIC_API_KEY');
    const { case_id } = await newCase(admin, '1184420');
    expect((await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: 'x' })).data.error.code).toBe('AI_NOT_CONFIGURED');

    // Same app with a key (synthetic) and a stubbed Claude API.
    (h.app.ctx.env as { anthropicKey?: string }).anthropicKey = 'sk-test-synthetic';
    const sent: { body: any; headers: Headers }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url instanceof Request ? url.url : url);
      if (!u.includes('api.anthropic.com')) throw new Error(`unexpected fetch ${u}`);
      sent.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      const answer = { proposals: [{ entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'hypertension', value: 'YES', row: '', evidence: 'hypertension on amlodipine' }, { entity: 'CLINICAL_PROFILE_SNAPSHOTS', field: 'diabetes', value: 'YES', row: '', evidence: 'invented quote' }], conflicts: [], additional_info: [] };
      return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(answer) }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const r = await admin.call('POST', `/api/cases/${case_id}/ai/extract`, { note: sample('N01', '1184420') });
    expect(r.status).toBe(200);
    expect(r.data.summary).toMatchObject({ filled: 1, dropped: 1 }); // the invented quote is dropped
    expect(sent).toHaveLength(1);
    const req = sent[0];
    expect(req.body.model).toBe('claude-opus-5-5');
    expect(req.body.fallbacks).toBe('default');
    expect(req.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(req.body.output_config.format.type).toBe('json_schema');
    const text = JSON.stringify(req.body);
    expect(text).not.toContain('1184420'); // MRN removed
    expect(text).not.toContain('Testname'); // name removed
    expect(text).not.toContain('0551234567'); // phone removed
    const status = (await admin.call('GET', '/api/ai/status')).data;
    expect(status.usage.runs).toBe(1);
    expect(status.usage.cost_usd).toBeGreaterThan(0);
  });
});
