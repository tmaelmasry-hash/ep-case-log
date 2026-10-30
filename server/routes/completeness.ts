// Data completeness for a whole group (R4-8, Admin, same right as the Dashboard): one row per case, core checks
// counted per section (shared/completeness.ts over shared/readiness.ts). Cases are read once per request (no request
// per case) and readiness is worked out only for the rows of the page. No PHI beyond MRN and case No.; no free text.
import { COMPLETENESS_SECTIONS, completenessOf } from '../../shared/completeness.ts';
import type { CaseRecord } from '../../shared/caseTypes.ts';
import { badRequest, HttpError, requireCap, type Router } from '../http.ts';
import { readinessOf } from '../domain/cases.ts';

export const COMPLETENESS_PAGE = 25;
/** "page=all" (the Excel of the whole filtered table) is capped so one answer stays small. */
const ALL_CAP = 5000;

export function completenessRoutes(app: Router) {
  const { ctx } = app;
  const { store } = ctx;
  const { dict } = ctx.config;

  const codeLabel = (entity: string, field: string, code: unknown) =>
    dict.entities[entity]?.fields.find((f) => f.name === field)?.codes?.find((c) => c.code === String(code))?.label ?? String(code);
  const live = (rec: CaseRecord, entity: string) => (rec.rows[entity] ?? []).filter((r) => !r._deleted);
  /** Procedure label(s): each procedure's components, else its procedure type; procedures in date order. */
  const proceduresOf = (rec: CaseRecord): string[] => {
    const comps = live(rec, 'PROCEDURE_COMPONENTS');
    return live(rec, 'EP_PROCEDURES')
      .sort((x, y) => String(x.procedure_start_datetime ?? '9999').localeCompare(String(y.procedure_start_datetime ?? '9999')))
      .map((p) => {
        const mine = comps.filter((c) => c.procedure_id === p._id).sort((x, y) => Number(x.component_sequence) - Number(y.component_sequence));
        if (mine.length) return mine.map((c) => codeLabel('PROCEDURE_COMPONENTS', 'component_type', c.component_type)).join(' + ');
        return p.primary_procedure_type ? codeLabel('EP_PROCEDURES', 'primary_procedure_type', p.primary_procedure_type) : 'Procedure';
      });
  };

  app.get('/api/completeness', async (req) => {
    requireCap(req, 'dashboard.view');
    const q = req.query;
    const status = q.status === 'all' ? 'all' : 'in_progress';
    const all = q.page === 'all';
    const page = all ? 1 : Number(q.page ?? 1);
    if (!Number.isInteger(page) || page < 1) throw badRequest('Invalid page.');
    const [cases, groups] = await Promise.all([store.listCases(), store.listGroups()]);
    let scope = groups.filter((g) => !g.is_deleted).sort((a, b) => a.sort_order - b.sort_order);
    if (q.group && q.group !== 'all' && q.group !== 'ALL') {
      scope = scope.filter((g) => g.group_id === q.group);
      if (!scope.length) throw new HttpError(404, 'NOT_FOUND', 'Unknown group.');
    }
    const order = new Map(scope.map((g, i) => [g.group_id, i]));
    const name = new Map(scope.map((g) => [g.group_id, g.name]));
    const rows = cases
      .filter((c) => !c.meta.is_deleted && order.has(c.meta.group_id) && (status === 'all' || c.meta.collection_status !== 'COMPLETED'))
      .sort((a, b) => order.get(a.meta.group_id)! - order.get(b.meta.group_id)! || a.meta.group_seq - b.meta.group_seq);
    const size = all ? ALL_CAP : COMPLETENESS_PAGE;
    const slice = rows.slice((page - 1) * size, page * size);
    return {
      sections: COMPLETENESS_SECTIONS,
      total: rows.length,
      page,
      page_size: size,
      rows: slice.map((c) => ({
        case_id: c.meta.case_id,
        group_id: c.meta.group_id,
        group_name: name.get(c.meta.group_id) ?? '',
        no: c.meta.group_seq,
        mrn: c.meta.mrn,
        collection_status: c.meta.collection_status,
        procedures: proceduresOf(c),
        ...completenessOf(dict, readinessOf(dict, c).checks),
      })),
    };
  });
}
