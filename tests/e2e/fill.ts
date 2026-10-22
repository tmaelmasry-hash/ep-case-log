// Test helper: fills the empty core fields of a case through the API (synthetic values only), the way the forms
// would, so browser tests can focus on readiness, "Not available", Completed and Reopen.
import { expect, type Page } from '@playwright/test';
import { loadConfig } from '../../server/dictionary.ts';
import { expectedSlot } from '../../server/domain/cases.ts';
import { idPrefix, type CaseDetail } from '../../shared/caseTypes.ts';
import { offeredCodes } from '../../shared/dictionary.ts';
import { evaluateReadiness } from '../../shared/readiness.ts';

const { dict } = loadConfig();

function sample(entity: string, field: string, row: Record<string, unknown>): unknown {
  const f = dict.entities[entity].fields.find((x) => x.name === field)!;
  if (field === 'complications_reviewed') return 'NONE_DOCUMENTED';
  if (field === 'pilgrim_status') return 'NON_PILGRIM';
  if (field === 'lvef_assessment') return 'NOT_REPORTED';
  if (f.type === 'boolean') return true;
  if (f.type === 'date') return '2026-03-12';
  if (f.type === 'datetime') return '2026-03-12T10:00';
  if (f.type === 'integer' || f.type === 'decimal') return f.min ?? 1;
  if (f.type === 'lookup_array') return [f.codes![0].code];
  if (f.codes) return offeredCodes(f, row)[0];
  return 'synthetic';
}

/** A request from inside the signed-in page (the session cookie is Secure, so it stays in the browser). */
async function call(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const me = await (await fetch('/api/auth/me')).json();
      const res = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': me.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, data: await res.json() };
    },
    { method, path, body },
  );
}

export async function fillCore(page: Page, caseId: string, skip: string[] = []) {
  for (let round = 0; round < 5; round++) {
    const got = await call(page, 'GET', `/api/cases/${caseId}`);
    expect(got.status, JSON.stringify(got.data)).toBe(200);
    const d = got.data as CaseDetail;
    const r = evaluateReadiness(dict, d.rows, d.not_available);
    const missing = r.checks.filter((x) => x.state === 'missing' && !skip.includes(`${x.entity}.${x.field}`));
    if (!missing.length) return;
    const creates: unknown[] = [];
    const changes: unknown[] = [];
    for (const m of missing) {
      const def = dict.entities[m.entity];
      let id: string;
      if (m.entity === 'PATIENTS' || m.entity === 'PATIENT_IDENTIFIERS') id = d.meta.patient_id;
      else if (m.entity === 'EP_EPISODES') id = d.meta.episode_id;
      else if (m.entity === 'EP_PROCEDURES') id = m.procedure_id!;
      else if (def.cardinality === 'single') id = expectedSlot(dict, m.entity, m.procedure_id ?? caseId);
      else id = (d.rows[m.entity] ?? []).find((x) => !m.procedure_id || x.procedure_id === m.procedure_id)?._id ?? `${idPrefix(def.pk)}_${crypto.randomUUID()}`;
      const row = (d.rows[m.entity] ?? []).find((x) => x._id === id);
      if (!row && !creates.some((x) => (x as { id: string }).id === id)) creates.push({ entity: m.entity, id, parent_id: def.scope === 'procedure' ? m.procedure_id : null });
      changes.push({ entity: m.entity, id, field: m.field, value: sample(m.entity, m.field, row ?? {}) });
    }
    const res = await call(page, 'PATCH', `/api/cases/${caseId}`, { creates, changes });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.results.filter((x: { ok: boolean }) => !x.ok)).toEqual([]);
  }
}
