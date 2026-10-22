// Excel export (phase 10; EP Workspace routes/exports.ts). Admin: everything (export.all). Members (and Admins for
// one group): one of their groups (export.group). The file goes to the browser in the answer; nothing is kept.
import { EXPORT_DROP, GROUP_TABS, localExport } from '../domain/export.ts';
import { HttpError, groupIdsFor, requireCap, type Router } from '../http.ts';
import type { ExportRequest } from '../store/types.ts';

export function exportRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;

  app.post('/api/exports', async (req) => {
    const b = req.body ?? {};
    const group = b.scope === 'GROUP';
    const u = requireCap(req, group ? 'export.group' : 'export.all');
    let label = 'All';
    let caseIds: string[] | null = null;
    if (group) {
      if (!(await groupIdsFor(ctx, u)).includes(String(b.group_id))) throw new HttpError(403, 'GROUP_SCOPE', 'Choose one of your groups.', { field: 'group_id' });
      const [cases, groups] = await Promise.all([store.listCases(), store.listGroups()]);
      caseIds = cases.filter((c) => !c.meta.is_deleted && c.meta.group_id === b.group_id).map((c) => c.meta.case_id);
      label = (groups.find((x) => x.group_id === b.group_id)?.name ?? 'Group').replace(/[^A-Za-z0-9]+/g, '');
    }
    const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: ctx.config.site.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(ctx.now())
      .replace(', ', '_')
      .replace(':', '');
    const request: ExportRequest = { fileName: `EP_Case_Log_${label}_${stamp}.xlsx`, keepTabs: group ? GROUP_TABS : null, dropColumns: EXPORT_DROP, caseIds };
    const [file] = await Promise.all([
      store.exportXlsx ? store.exportXlsx(request) : localExport(ctx, request),
      store.appendActivity([{ actor: u.userId, action: 'export.create', detail: { scope: group ? 'GROUP' : 'ALL', group_id: group ? b.group_id : null, cases: caseIds?.length ?? null, file_name: request.fileName } }]),
    ]);
    return file;
  });
}
