// Bulk add MRNs (phase 6, Admin): preview → commit → results (EP Workspace routes/cases.ts imports).
import { siteLocalDate } from '../appconfig.ts';
import { BULK_MAX_ROWS, classify, commit, fingerprint, jobResult, previewToken, splitPaste } from '../domain/bulk.ts';
import { HttpError, badRequest, groupIdsFor, notFound, requireCap, type Req, type Router } from '../http.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function bulkRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;

  async function input(req: Req) {
    const u = requireCap(req, 'case.import');
    const b = req.body ?? {};
    const groups = await groupIdsFor(ctx, u);
    if (typeof b.group_id !== 'string' || !groups.includes(b.group_id)) throw new HttpError(403, 'GROUP_SCOPE', 'Choose one of your groups.', { field: 'group_id' });
    const text = String(b.text ?? '');
    if (!splitPaste(text).length) throw badRequest('Paste at least one MRN.', { field: 'text' });
    if (splitPaste(text).length > BULK_MAX_ROWS) throw badRequest(`Paste at most ${BULK_MAX_ROWS} MRNs at a time.`, { field: 'text' });
    let episodeStart: string | null = null;
    if (b.episode_start_date) {
      if (typeof b.episode_start_date !== 'string' || !DATE.test(b.episode_start_date)) throw badRequest('Episode start date: enter a valid date.', { field: 'episode_start_date' });
      if (b.episode_start_date > siteLocalDate(ctx.config.site.timezone, ctx.now())) throw badRequest('Episode start date cannot be in the future.', { field: 'episode_start_date' });
      episodeStart = b.episode_start_date;
    }
    // Owner step 6: one procedure type for the whole list, kept as an operational "planned" mark (no procedure is opened).
    let plannedType: string | null = null;
    if (b.planned_type) {
      const codes = ctx.config.dict.entities.PROCEDURE_COMPONENTS.fields.find((f) => f.name === 'component_type')?.codes ?? [];
      if (!codes.some((c) => c.code === b.planned_type)) throw badRequest('Choose a procedure type from the list.', { field: 'planned_type' });
      plannedType = String(b.planned_type);
    }
    return { u, groups, groupId: b.group_id as string, text, episodeStart, plannedType };
  }

  app.post('/api/imports/mrns/preview', async (req) => {
    const { u, groupId, text, episodeStart } = await input(req);
    const [cases, groups] = await Promise.all([store.listCases(), store.listGroups()]);
    const p = classify(ctx, cases, text, groupId);
    const next = groups.find((g) => g.group_id === groupId)!.next_seq;
    return {
      ...p,
      next_seq: next,
      numbers: p.summary.ready ? { from: next, to: next + p.summary.ready - 1 } : null,
      preview_token: await previewToken(ctx, u.userId, groupId, await fingerprint(text), episodeStart),
    };
  });

  app.post('/api/imports/mrns/commit', async (req) => {
    const { u, groups, groupId, text, episodeStart, plannedType } = await input(req);
    const b = req.body ?? {};
    const key = String(b.idempotency_key ?? '');
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw badRequest('idempotency_key is required');
    const prior = await store.getImport({ key });
    if (prior) {
      if (prior.actor_user_id !== u.userId) throw notFound();
      return jobResult(prior, true);
    }
    if (b.preview_token !== (await previewToken(ctx, u.userId, groupId, await fingerprint(text), episodeStart))) {
      throw new HttpError(409, 'STALE_PREVIEW', 'The list or destination changed after review. Review again before adding.');
    }
    const addExisting = Array.isArray(b.add_existing) ? b.add_existing.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
    return commit(ctx, { actorId: u.userId, groupId, text, episodeStart, idempotencyKey: key, addExisting, plannedType, visibleGroups: groups, today: siteLocalDate(ctx.config.site.timezone, ctx.now()) });
  });
}
