// Excel export (phase 10; EP Workspace routes/exports.ts). Admin: everything (export.all). Members (and Admins for
// one group): one of their groups (export.group). Anyone with export.group: the cases of the filtered list (scope CASES,
// owner R2-6), limited to their groups. The file goes to the browser in the answer; nothing is kept.
import { EXPORT_DROP, GROUP_TABS, localExport } from '../domain/export.ts';
import { HttpError, badRequest, groupIdsFor, requireCap, type Router } from '../http.ts';
import type { ExportRequest } from '../store/types.ts';

export function exportRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;

  app.post('/api/exports', async (req) => {
    const b = req.body ?? {};
    const group = b.scope === 'GROUP';
    const listed = b.scope === 'CASES';
    const u = requireCap(req, group || listed ? 'export.group' : 'export.all');
    let label = 'All';
    let caseIds: string[] | null = null;
    if (group) {
      if (!(await groupIdsFor(ctx, u)).includes(String(b.group_id))) throw new HttpError(403, 'GROUP_SCOPE', 'Choose one of your groups.', { field: 'group_id' });
      const [cases, groups] = await Promise.all([store.listCases(), store.listGroups()]);
      caseIds = cases.filter((c) => !c.meta.is_deleted && c.meta.group_id === b.group_id).map((c) => c.meta.case_id);
      label = (groups.find((x) => x.group_id === b.group_id)?.name ?? 'Group').replace(/[^A-Za-z0-9]+/g, '');
    }
    if (listed) {
      if (!Array.isArray(b.case_ids) || !b.case_ids.length || b.case_ids.length > 10_000) throw badRequest('Choose the cases to export.', { field: 'case_ids' });
      const [mine, cases] = await Promise.all([groupIdsFor(ctx, u), store.listCases()]);
      const want = new Set(b.case_ids.map(String));
      caseIds = cases.filter((c) => !c.meta.is_deleted && mine.includes(c.meta.group_id) && want.has(c.meta.case_id)).map((c) => c.meta.case_id);
      if (!caseIds.length) throw new HttpError(403, 'GROUP_SCOPE', 'None of these cases is in your groups.');
      label = 'Filtered';
    }
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.config.site.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(ctx.now())
      .replace(', ', '_')
      .replace(':', '');
    const request: ExportRequest = { fileName: `KAMC_EP_Registry_${label}_${stamp}.xlsx`, keepTabs: group || listed ? GROUP_TABS : null, dropColumns: EXPORT_DROP, caseIds };
    const [file] = await Promise.all([
      store.exportXlsx ? store.exportXlsx(request) : localExport(ctx, request),
      store.appendActivity([{ actor: u.userId, action: 'export.create', detail: { scope: listed ? 'CASES' : group ? 'GROUP' : 'ALL', group_id: group ? b.group_id : null, cases: caseIds?.length ?? null, file_name: request.fileName } }]),
    ]);
    return file;
  });
}
