// New case without connection (owner R3-4, L3, approved preview): built on this device with the server's own case
// code (the same rows a new case gets), kept here with "No. pending", and created on the server under the same id
// when the connection is back (src/lib/sync.ts). History of an earlier case of this MRN is copied by the server then.
import site from '../../config/site.json';
import { newCaseRecord, toDetail } from '../../server/domain/cases.ts';
import type { CaseDetail } from '../../shared/caseTypes.ts';
import { dict } from './dict';
import { caseAll, casePut } from './localdb';
import { sync } from './sync';
import { todayISO } from './util';

export async function makeOfflineCase(input: { mrn: string; groupId: string; groupName: string; date: string; me: { id: string; name: string }; knownCaseIds: string[] }): Promise<CaseDetail> {
  const caseId = `case_${crypto.randomUUID()}`;
  // One patient id per MRN: reuse the one of a case of this MRN kept on this device (the server corrects it if needed).
  const known = ((await caseAll<CaseDetail>()) ?? []).find((d) => d.meta.mrn === input.mrn)?.meta.patient_id;
  const patientId = known ?? `patient_${crypto.randomUUID()}`;
  const rec = newCaseRecord(
    dict,
    { caseId, patientId, mrn: input.mrn, groupId: input.groupId, groupSeq: 0, episodeStart: input.date, enrollmentDate: todayISO(), registryBasis: (site as { registry_basis_default: string }).registry_basis_default },
    { userId: input.me.id, now: new Date().toISOString() },
  );
  const detail = toDetail(dict, rec, input.groupName, [{ id: input.me.id, name: input.me.name }], (id) => (id === input.me.id ? input.me.name : 'Unknown'));
  await casePut(caseId, detail);
  sync.enqueueCreate(caseId, `New case · ${input.mrn}`, { mrn: input.mrn, group_id: input.groupId, episode_start_date: input.date, patient_id: patientId, known_case_ids: input.knownCaseIds });
  return detail;
}

/** "No. 12", or "No. pending" for a case made offline that has no number yet. */
export const seqText = (n: number | null | undefined) => (n ? `No. ${n}` : 'No. pending');
