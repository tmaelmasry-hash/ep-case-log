// Cases: list (user's groups), create (= one episode), read, edit (field-level), complete / reopen, history,
// delete (to the recycle bin) and restore (Admin).
import { checkMrn } from '../../shared/mrn.ts';
import type { CaseRecord, EditBatch } from '../../shared/caseTypes.ts';
import { siteLocalDate } from '../appconfig.ts';
import { addHistory, applyEdits, completeCase, copyForward, historyItems, moveCase, newCaseRecord, reopenCase, summarize, toDetail } from '../domain/cases.ts';
import { followupState } from '../domain/followups.ts';
import { cohortMembership } from './cohorts.ts';
import { HttpError, badRequest, groupIdsFor, notFound, requireCap, type Req, type Router } from '../http.ts';
import type { AppContext } from '../context.ts';
import { newId } from '../util.ts';
import { StaleCaseError } from '../store/types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_CASE_ID = /^case_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIENT_PATIENT_ID = /^patient_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** How long the person who deleted a case may undo it (owner step 8). */
const UNDO_WINDOW_MS = 60_000;

export function caseRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;
  const { dict, site } = ctx.config;

  /** A case the user may open; out of scope looks exactly like not found. */
  async function requireCase(req: Req, id: string, forEdit = false): Promise<CaseRecord> {
    const rec = await store.getCase(id, { forEdit });
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
    const [groups, { users, nameOf }, cohorts] = await Promise.all([c.store.listGroups(), nameLookup(c), cohortMembership(c, [rec])]);
    const d = toDetail(
      dict,
      rec,
      groups.find((g) => g.group_id === rec.meta.group_id)?.name ?? '',
      users.filter((u) => u.status === 'ACTIVE').map((u) => ({ id: u.user_id, name: u.display_name })),
      nameOf,
      followupState(site.followup_due, [rec], siteLocalDate(site.timezone, ctx.now())).get(rec.meta.case_id) ?? null,
    );
    d.summary.cohorts = cohorts.get(rec.meta.case_id) ?? [];
    return d;
  }

  const actor = (userId: string) => ({ userId, now: ctx.now().toISOString() });

  app.get('/api/cases', async (req) => {
    requireCap(req, 'case.read');
    const groups = await groupIdsFor(ctx, req.user!);
    const want = req.query.group && req.query.group !== 'ALL' ? [req.query.group] : groups;
    const cases = (await store.listCases()).filter((c) => !c.meta.is_deleted && groups.includes(c.meta.group_id) && want.includes(c.meta.group_id));
    const due = followupState(site.followup_due, cases, siteLocalDate(site.timezone, ctx.now()));
    const cohorts = await cohortMembership(ctx, cases);
    return { cases: cases.map((c) => ({ ...summarize(dict, c, due.get(c.meta.case_id) ?? null), cohorts: cohorts.get(c.meta.case_id) ?? [] })) };
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
    // MRN prompt (EP Workspace): an MRN with live cases is answered with them first (409 MRN_HAS_CASES: this group's
    // cases by number; other groups only as "also registered in another group"); new_case: true then adds one more.
    const all = (await store.listCases()).filter((c) => c.meta.mrn === mrn.value).sort((x, y) => x.meta.created_at.localeCompare(y.meta.created_at));
    const live = all.filter((c) => !c.meta.is_deleted);
    // Local-first L3: a case made offline brings its own id; sending it again answers with the case already made.
    const clientId = typeof b.case_id === 'string' ? b.case_id : null;
    if (clientId !== null && !CLIENT_CASE_ID.test(clientId)) throw badRequest('Invalid case id.');
    const made = clientId ? all.find((c) => c.meta.case_id === clientId) : undefined;
    // Offline new case (owner, 30 Oct): the device checked the MRN only against the cases it kept (known_case_ids); the
    // answer counts the other live cases of this MRN and those the device did not know, so the app can say so once.
    const known = Array.isArray(b.known_case_ids) ? new Set((b.known_case_ids as unknown[]).slice(0, 500).filter((x): x is string => typeof x === 'string')) : null;
    const others = live.filter((c) => c.meta.case_id !== clientId);
    const mrnCases = { other_cases: others.length, unseen_cases: known ? others.filter((c) => !known.has(c.meta.case_id)).length : null };
    if (made) {
      if (made.meta.is_deleted || !groups.includes(made.meta.group_id)) throw new HttpError(409, 'CASE_ID_TAKEN', 'This case id is already used.');
      return { case_id: made.meta.case_id, group_seq: made.meta.group_seq, patient_id: made.meta.patient_id, warning: null, case_of_mrn: null, copied_from: null, copied: 0, ...mrnCases };
    }
    if (live.length && b.new_case !== true) {
      const here = live.filter((c) => c.meta.group_id === b.group_id).map((c) => summarize(dict, c));
      const elsewhere = live.some((c) => c.meta.group_id !== b.group_id);
      throw new HttpError(
        409,
        'MRN_HAS_CASES',
        here.length
          ? `This MRN already has ${here.length} case${here.length > 1 ? 's' : ''} in this group.${elsewhere ? ' It is also registered in another group.' : ''}`
          : 'This MRN is already registered in another group.',
        { here: here.map((c) => ({ case_id: c.case_id, group_seq: c.group_seq, episode_start_date: c.episode_start_date, collection_status: c.collection_status, procedures: c.procedures })), elsewhere },
      );
    }
    // All cases of one MRN share one patient id (EP Workspace P3-1); history is copied from the latest case the user can see.
    const source = live.filter((c) => groups.includes(c.meta.group_id)).at(-1) ?? null;
    const caseId = clientId ?? newId('case');
    const seq = await store.allocateSeq(b.group_id);
    const now = ctx.now().toISOString();
    const rec = newCaseRecord(
      dict,
      {
        caseId,
        // One patient id per MRN: an earlier case's wins over the one an offline device chose.
        patientId: all.at(-1)?.meta.patient_id ?? (typeof b.patient_id === 'string' && CLIENT_PATIENT_ID.test(b.patient_id) ? b.patient_id : newId('patient')),
        mrn: mrn.value,
        groupId: b.group_id,
        groupSeq: seq,
        episodeStart: b.episode_start_date,
        enrollmentDate: today,
        registryBasis: site.registry_basis_default,
      },
      { userId: u.userId, now },
    );
    const groupList = await store.listGroups();
    const gname = groupList.find((g) => g.group_id === b.group_id)?.name ?? '';
    addHistory(rec, { kind: 'create', text: `Case created in ${gname} as No. ${seq}` }, { userId: u.userId, now });
    const note = source ? `Copied from ${groupList.find((g) => g.group_id === source.meta.group_id)?.name ?? 'group'} No. ${source.meta.group_seq}` : null;
    const copied = source && note ? copyForward(dict, rec, source, note, { userId: u.userId, now }) : 0;
    await store.putCase(rec, null, [{ actor: u.userId, action: 'case.create', detail: { case_id: caseId, group_id: b.group_id, group_seq: seq, ...(copied ? { copied_from: source!.meta.case_id, copied_fields: copied } : {}) } }]);
    return { case_id: caseId, group_seq: seq, patient_id: rec.meta.patient_id, warning: mrn.warning ?? null, case_of_mrn: live.length ? live.length + 1 : null, copied_from: copied ? note : null, copied, ...mrnCases };
  });

  app.get('/api/cases/:id', async (req) => {
    requireCap(req, 'case.read');
    return detail(ctx, await requireCase(req, req.params.id));
  });

  app.patch('/api/cases/:id', async (req) => {
    const u = requireCap(req, 'case.edit');
    const batch = (req.body ?? {}) as EditBatch;
    const users = new Set((await store.listUsers()).map((x) => x.user_id));
    // L1: start from the copy this server kept (no Sheet read); if someone saved the case meanwhile, the save is
    // refused as stale, and the edit is applied again once to a fresh read.
    for (let attempt = 0; ; attempt++) {
      const rec = await requireCase(req, req.params.id, attempt === 0);
      const base = structuredClone(rec);
      if (rec.meta.collection_status === 'COMPLETED') throw new HttpError(409, 'CASE_COMPLETED', 'This case is completed. Reopen it to make changes.');
      const results = applyEdits(dict, rec, batch, { userId: u.userId, now: ctx.now().toISOString() }, users);
      if (results.some((r) => r.ok)) {
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
        try {
          await store.putCase(rec, base, [{ actor: u.userId, action: 'case.edit', detail: { case_id: rec.meta.case_id, fields, added, removed, additional: info } }]);
        } catch (e) {
          if (e instanceof StaleCaseError && attempt === 0) continue;
          if (e instanceof StaleCaseError) throw new HttpError(409, 'STALE_CASE', 'The case changed while saving. Try again.');
          throw e;
        }
      }
      return { results, case: await detail(ctx, rec) };
    }
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
    await store.putCase(rec, base, [{ actor: u.userId, action: 'case.complete', detail: { case_id: rec.meta.case_id, core: `${r.done}/${r.total}` } }]);
    return { ok: true, case: await detail(ctx, rec) };
  });

  /** Admin moves a case to another group (owner step 6): next number there, old one kept in History. Its collector stays
   * only if they are in the new group; otherwise the case becomes work for the new group's Members. */
  app.post('/api/cases/:id/move', async (req) => {
    const u = requireCap(req, 'case.reassign');
    const rec = await requireCase(req, req.params.id);
    const base = structuredClone(rec);
    const to = String((req.body ?? {}).group_id ?? '');
    const groups = (await store.listGroups()).filter((g) => !g.is_deleted);
    const target = groups.find((g) => g.group_id === to);
    if (!target) throw badRequest('Choose a group.', { field: 'group_id' });
    if (to === rec.meta.group_id) return { ok: true, case: await detail(ctx, rec) };
    const from = groups.find((g) => g.group_id === rec.meta.group_id);
    const seq = await store.allocateSeq(to);
    const old = `${from?.name ?? 'group'} No. ${rec.meta.group_seq}`;
    moveCase(rec, { group_id: to, seq, from_label: old, to_label: `${target.name} No. ${seq}` }, actor(u.userId));
    const collector = rec.meta.collector_user_id ? await store.getUser(rec.meta.collector_user_id) : null;
    if (collector && collector.role !== 'ADMIN' && !collector.groups.includes(to)) rec.meta.collector_user_id = null;
    await store.putCase(rec, base, [{ actor: u.userId, action: 'case.move', detail: { case_id: rec.meta.case_id, from: base.meta.group_id, to, group_seq: seq } }]);
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
    await store.putCase(rec, base, [{ actor: u.userId, action: 'case.reopen', detail: { case_id: rec.meta.case_id } }]);
    return { ok: true, case: await detail(ctx, rec) };
  });

  /** The case's own history: values before → after. Shown only inside the case (never in the activity log). */
  app.get('/api/cases/:id/history', async (req) => {
    requireCap(req, 'case.read');
    const rec = await requireCase(req, req.params.id);
    const { nameOf } = await nameLookup(ctx);
    return { items: historyItems(dict, rec, nameOf) };
  });

  /** Records that the case report was printed / saved as PDF (who and which case; no values). */
  app.post('/api/cases/:id/printed', async (req) => {
    const u = requireCap(req, 'report.pdf');
    const rec = await requireCase(req, req.params.id);
    await store.appendActivity([{ actor: u.userId, action: 'report.pdf', detail: { case_id: rec.meta.case_id } }]);
    return { ok: true };
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
    await store.putCase(rec, base, [{ actor: u.userId, action: 'case.delete', detail: { case_id: rec.meta.case_id } }]);
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
    // Admin restores from the recycle bin; the person who deleted a case may undo it within a minute (owner step 8).
    const u = requireCap(req, 'case.read');
    const rec = await store.getCase(req.params.id);
    const base = rec && structuredClone(rec);
    const groups = await groupIdsFor(ctx, u);
    if (!rec || !rec.meta.is_deleted || !groups.includes(rec.meta.group_id)) throw notFound('Case not found in the recycle bin.');
    const undo = rec.meta.deleted_by === u.userId && !!rec.meta.deleted_at && ctx.now().getTime() - Date.parse(rec.meta.deleted_at) <= UNDO_WINDOW_MS;
    if (!undo) requireCap(req, 'case.restore');
    Object.assign(rec.meta, { is_deleted: false, deleted_at: null, deleted_by: null });
    addHistory(rec, { kind: 'restore', text: 'Restored from the recycle bin' }, actor(u.userId));
    await store.putCase(rec, base, [{ actor: u.userId, action: 'case.restore', detail: { case_id: rec.meta.case_id } }]);
    return { ok: true };
  });
}
