// Cases: list (user's groups), create (= one episode), read, edit (field-level), complete / reopen, history,
// delete (to the recycle bin) and restore (Admin).
import { checkMrn } from '../../shared/mrn.ts';
import type { CaseRecord, EditBatch } from '../../shared/caseTypes.ts';
import { siteLocalDate } from '../appconfig.ts';
import { addHistory, applyEdits, completeCase, historyItems, newCaseRecord, reopenCase, summarize, toDetail } from '../domain/cases.ts';
import { HttpError, badRequest, groupIdsFor, notFound, requireCap, type Req, type Router } from '../http.ts';
import type { AppContext } from '../context.ts';
import { newId } from '../util.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function caseRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;
  const { dict, site } = ctx.config;

  /** A case the user may open; out of scope looks exactly like not found. */
  async function requireCase(req: Req, id: string): Promise<CaseRecord> {
    const rec = await store.getCase(id);
    const groups = await groupIdsFor(ctx, req.user!);
    if (!rec || rec.meta.is_deleted || !groups.includes(rec.meta.group_id)) throw notFound('Case not found.');
    return rec;
  }

  async function nameLookup(c: AppContext) {
    const users = await c.store.listUsers();
    const names = new Map(users.map((u) => [u.user_id, u.display_name]));
    return { users, nameOf: (id: string) => names.get(id) ?? 'Unknown' };
  }

  async function detail(c: AppContext, rec: CaseRecord) {
    const [groups, { users, nameOf }] = await Promise.all([c.store.listGroups(), nameLookup(c)]);
    return toDetail(
      dict,
      rec,
      groups.find((g) => g.group_id === rec.meta.group_id)?.name ?? '',
      users.filter((u) => u.status === 'ACTIVE').map((u) => ({ id: u.user_id, name: u.display_name })),
      nameOf,
    );
  }

  const actor = (userId: string) => ({ userId, now: ctx.now().toISOString() });

  app.get('/api/cases', async (req) => {
    requireCap(req, 'case.read');
    const groups = await groupIdsFor(ctx, req.user!);
    const want = req.query.group && req.query.group !== 'ALL' ? [req.query.group] : groups;
    const cases = (await store.listCases()).filter((c) => !c.meta.is_deleted && groups.includes(c.meta.group_id) && want.includes(c.meta.group_id));
    return { cases: cases.map((c) => summarize(dict, c)) };
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
    const gname = (await store.listGroups()).find((g) => g.group_id === b.group_id)?.name ?? '';
    addHistory(rec, { kind: 'create', text: `Case created in ${gname} as No. ${seq}` }, { userId: u.userId, now });
    await store.putCase(rec, null);
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
    const base = rec && structuredClone(rec);
    if (rec.meta.collection_status === 'COMPLETED') throw new HttpError(409, 'CASE_COMPLETED', 'This case is completed. Reopen it to make changes.');
    const batch = (req.body ?? {}) as EditBatch;
    const users = new Set((await store.listUsers()).map((x) => x.user_id));
    const results = applyEdits(dict, rec, batch, { userId: u.userId, now: ctx.now().toISOString() }, users);
    if (results.some((r) => r.ok)) {
      await store.putCase(rec, base);
      // Field and section names only, never values (EP Workspace F-17).
      const ok = (kind: string, i: number) => !!results.find((r) => r.kind === kind && r.i === i)?.ok;
      const uniq = (xs: string[]) => [...new Set(xs)].slice(0, 50);
      const fields = uniq([
        ...(batch.changes ?? []).filter((_, i) => ok('change', i)).map((c) => `${c.entity}.${c.field === 'other_specify_json' ? c.key : c.field}`),
        ...(batch.not_available ?? []).filter((_, i) => ok('na', i)).map((n) => `${n.entity}.${n.field}`),
      ]);
      const added = uniq((batch.creates ?? []).filter((c, i) => ok('create', i) && dict.entities[c.entity]?.cardinality === 'multi').map((c) => c.entity));
      const removed = uniq((batch.removes ?? []).filter((_, i) => ok('remove', i)).map((c) => c.entity));
      const info = (batch.additional ?? []).some((_, i) => ok('additional', i));
      await store.appendActivity([{ actor: u.userId, action: 'case.edit', detail: { case_id: rec.meta.case_id, fields, added, removed, additional: info } }]);
    }
    return { results, case: await detail(ctx, rec) };
  });

  /** Mark completed (Admin and Member): only when every core field has a value or "Not available" + reason. */
  app.post('/api/cases/:id/complete', async (req) => {
    const u = requireCap(req, 'case.complete');
    const rec = await requireCase(req, req.params.id);
    const base = rec && structuredClone(rec);
    if (rec.meta.collection_status === 'COMPLETED') return { ok: true, case: await detail(ctx, rec) };
    const expected = (req.body ?? {}).row_version;
    if (typeof expected === 'number' && expected !== rec.meta.row_version) throw new HttpError(409, 'STALE_CASE', 'The case changed since you checked it. Check again.');
    const r = completeCase(dict, rec, actor(u.userId));
    if (!r.canComplete) throw new HttpError(409, 'NOT_READY', `Not ready to complete: ${r.blockers.length} core field${r.blockers.length === 1 ? '' : 's'} missing.`);
    await store.putCase(rec, base);
    await store.appendActivity([{ actor: u.userId, action: 'case.complete', detail: { case_id: rec.meta.case_id, core: `${r.done}/${r.total}` } }]);
    return { ok: true, case: await detail(ctx, rec) };
  });

  /** Reopen (Admin and Member, owner decision phase 3) with a reason kept in the case history. */
  app.post('/api/cases/:id/reopen', async (req) => {
    const u = requireCap(req, 'case.reopen');
    const rec = await requireCase(req, req.params.id);
    const base = rec && structuredClone(rec);
    const reason = String((req.body ?? {}).reason ?? '').trim().slice(0, 300);
    if (!reason) throw badRequest('Say briefly why the case is reopened.', { field: 'reason' });
    if (rec.meta.collection_status !== 'COMPLETED') return { ok: true, case: await detail(ctx, rec) };
    reopenCase(rec, reason, actor(u.userId));
    await store.putCase(rec, base);
    await store.appendActivity([{ actor: u.userId, action: 'case.reopen', detail: { case_id: rec.meta.case_id } }]);
    return { ok: true, case: await detail(ctx, rec) };
  });

  /** The case's own history: values before → after. Shown only inside the case (never in the activity log). */
  app.get('/api/cases/:id/history', async (req) => {
    requireCap(req, 'case.read');
    const rec = await requireCase(req, req.params.id);
    const { nameOf } = await nameLookup(ctx);
    return { items: historyItems(dict, rec, nameOf) };
  });

  /** Moves a case to the recycle bin. */
  app.post('/api/cases/:id/delete', async (req) => {
    const u = requireCap(req, 'case.delete');
    const rec = await requireCase(req, req.params.id);
    const base = rec && structuredClone(rec);
    rec.meta.is_deleted = true;
    rec.meta.deleted_at = ctx.now().toISOString();
    rec.meta.deleted_by = u.userId;
    addHistory(rec, { kind: 'delete', text: 'Moved to the recycle bin' }, actor(u.userId));
    await store.putCase(rec, base);
    await store.appendActivity([{ actor: u.userId, action: 'case.delete', detail: { case_id: rec.meta.case_id } }]);
    return { ok: true };
  });

  /** Recycle bin (Admin): deleted cases, newest first. */
  app.get('/api/recycle-bin', async (req) => {
    const u = requireCap(req, 'case.restore');
    const groups = await groupIdsFor(ctx, u);
    const [all, gl, { nameOf }] = await Promise.all([store.listCases(), store.listGroups(), nameLookup(ctx)]);
    return {
      cases: all
        .filter((c) => c.meta.is_deleted && groups.includes(c.meta.group_id))
        .sort((x, y) => String(y.meta.deleted_at).localeCompare(String(x.meta.deleted_at)))
        .map((c) => ({
          case_id: c.meta.case_id,
          mrn: c.meta.mrn,
          group_name: gl.find((g) => g.group_id === c.meta.group_id)?.name ?? '',
          group_seq: c.meta.group_seq,
          deleted_at: c.meta.deleted_at,
          deleted_by: c.meta.deleted_by ? nameOf(c.meta.deleted_by) : null,
        })),
    };
  });

  /** Restore (Admin): back in its group with its old number. */
  app.post('/api/cases/:id/restore', async (req) => {
    const u = requireCap(req, 'case.restore');
    const rec = await store.getCase(req.params.id);
    const base = rec && structuredClone(rec);
    const groups = await groupIdsFor(ctx, u);
    if (!rec || !rec.meta.is_deleted || !groups.includes(rec.meta.group_id)) throw notFound('Case not found in the recycle bin.');
    Object.assign(rec.meta, { is_deleted: false, deleted_at: null, deleted_by: null });
    addHistory(rec, { kind: 'restore', text: 'Restored from the recycle bin' }, actor(u.userId));
    await store.putCase(rec, base);
    await store.appendActivity([{ actor: u.userId, action: 'case.restore', detail: { case_id: rec.meta.case_id } }]);
    return { ok: true };
  });
}
