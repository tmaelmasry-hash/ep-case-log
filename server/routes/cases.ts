// Cases: list (user's groups), create (= one episode), read, edit (field-level), delete (to the recycle bin).
import { checkMrn } from '../../shared/mrn.ts';
import type { CaseRecord, EditBatch } from '../../shared/caseTypes.ts';
import { loadConfig, siteLocalDate } from '../dictionary.ts';
import { applyEdits, newCaseRecord, summarize, toDetail } from '../domain/cases.ts';
import { HttpError, badRequest, groupIdsFor, notFound, requireCap, type Req, type Router } from '../http.ts';
import type { AppContext } from '../context.ts';
import { newId } from '../util.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function caseRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;
  const { dict, site } = loadConfig();

  /** A case the user may open; out of scope looks exactly like not found. */
  async function requireCase(req: Req, id: string): Promise<CaseRecord> {
    const rec = await store.getCase(id);
    const groups = await groupIdsFor(ctx, req.user!);
    if (!rec || rec.meta.is_deleted || !groups.includes(rec.meta.group_id)) throw notFound('Case not found.');
    return rec;
  }

  async function detail(c: AppContext, rec: CaseRecord) {
    const [groups, users] = await Promise.all([c.store.listGroups(), c.store.listUsers()]);
    return toDetail(
      dict,
      rec,
      groups.find((g) => g.group_id === rec.meta.group_id)?.name ?? '',
      users.filter((u) => u.status === 'ACTIVE').map((u) => ({ id: u.user_id, name: u.display_name })),
    );
  }

  app.get('/api/cases', async (req) => {
    requireCap(req, 'case.read');
    const groups = await groupIdsFor(ctx, req.user!);
    const want = req.query.group && req.query.group !== 'ALL' ? [req.query.group] : groups;
    const cases = (await store.listCases()).filter((c) => !c.meta.is_deleted && groups.includes(c.meta.group_id) && want.includes(c.meta.group_id));
    return { cases: cases.map(summarize) };
  });

  app.post('/api/cases', async (req) => {
    const u = requireCap(req, 'case.create');
    const b = req.body ?? {};
    const groups = await groupIdsFor(ctx, u);
    if (typeof b.group_id !== 'string' || !groups.includes(b.group_id)) throw new HttpError(403, 'GROUP_SCOPE', 'Choose one of your groups.', { field: 'group_id' });
    const mrn = checkMrn(String(b.mrn ?? ''), site.mrn);
    if (!mrn.ok) throw badRequest(mrn.error!, { field: 'mrn' });
    if (typeof b.episode_start_date !== 'string' || !DATE.test(b.episode_start_date)) throw badRequest('Episode start date: enter a valid date.', { field: 'episode_start_date' });
    const today = siteLocalDate(site.timezone, ctx.now());
    if (b.episode_start_date > today) throw badRequest('Episode start date cannot be in the future.', { field: 'episode_start_date' });
    // All cases of one MRN share one patient id (EP Workspace P3-1). The MRN prompt and copy-forward come in phase 5.
    const prior = (await store.listCases()).filter((c) => c.meta.mrn === mrn.value).sort((x, y) => y.meta.created_at.localeCompare(x.meta.created_at))[0];
    const caseId = newId('case');
    const seq = await store.allocateSeq(b.group_id);
    const now = ctx.now().toISOString();
    const rec = newCaseRecord(
      dict,
      {
        caseId,
        patientId: prior?.meta.patient_id ?? newId('patient'),
        mrn: mrn.value,
        groupId: b.group_id,
        groupSeq: seq,
        episodeStart: b.episode_start_date,
        enrollmentDate: today,
        registryBasis: site.registry_basis_default,
      },
      { userId: u.userId, now },
    );
    await store.putCase(rec);
    await store.appendActivity([{ actor: u.userId, action: 'case.create', detail: { case_id: caseId, group_id: b.group_id, group_seq: seq } }]);
    return { case_id: caseId, group_seq: seq, warning: mrn.warning ?? null };
  });

  app.get('/api/cases/:id', async (req) => {
    requireCap(req, 'case.read');
    return detail(ctx, await requireCase(req, req.params.id));
  });

  app.patch('/api/cases/:id', async (req) => {
    const u = requireCap(req, 'case.edit');
    const rec = await requireCase(req, req.params.id);
    if (rec.meta.collection_status === 'COMPLETED') throw new HttpError(409, 'CASE_COMPLETED', 'This case is completed. Reopen it to make changes.');
    const batch = (req.body ?? {}) as EditBatch;
    const users = new Set((await store.listUsers()).map((x) => x.user_id));
    const results = applyEdits(dict, rec, batch, { userId: u.userId, now: ctx.now().toISOString() }, users);
    if (results.some((r) => r.ok)) {
      await store.putCase(rec);
      // Field names only, never values (EP Workspace F-17).
      const fields = (batch.changes ?? []).filter((_, i) => results.find((r) => r.kind === 'change' && r.i === i)?.ok).map((c) => `${c.entity}.${c.field}`);
      await store.appendActivity([{ actor: u.userId, action: 'case.edit', detail: { case_id: rec.meta.case_id, fields: [...new Set(fields)].slice(0, 50) } }]);
    }
    return { results, case: await detail(ctx, rec) };
  });

  /** Moves a case to the recycle bin (restore and the recycle-bin screen come in phase 3). */
  app.post('/api/cases/:id/delete', async (req) => {
    const u = requireCap(req, 'case.delete');
    const rec = await requireCase(req, req.params.id);
    rec.meta.is_deleted = true;
    rec.meta.deleted_at = ctx.now().toISOString();
    rec.meta.deleted_by = u.userId;
    await store.putCase(rec);
    await store.appendActivity([{ actor: u.userId, action: 'case.delete', detail: { case_id: rec.meta.case_id } }]);
    return { ok: true };
  });
}
