// Excel export (phase 10; EP Workspace P4): the registry as .xlsx with the Google Sheet's tabs and columns.
// Admin: every tab (sign-in secrets removed). Group export: that group's live cases only — case tabs, History and
// Lookups. On the Google Sheet the Sheet exports itself (Apps Script); local stores build the same file here.
import { buildXlsx } from '../../shared/xlsx.ts';
import type { AppContext } from '../context.ts';
import { buildLayout, ENTITY_TABS } from '../store/sheet-layout.ts';
import { SheetsStore } from '../store/sheets.ts';
import type { ExportFile, ExportRequest } from '../store/types.ts';

/** Never in a file: sign-in secrets and lockout state. */
export const EXPORT_DROP: Record<string, string[]> = { Users: ['password_hash', 'session_epoch', 'failed_logins', 'locked_until'] };
/** A group export holds case data only (no people, activity or other groups). */
export const GROUP_TABS = ['Cases', ...Object.keys(ENTITY_TABS), 'History', 'Lookups'];

function toBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function localExport(ctx: AppContext, req: ExportRequest): Promise<ExportFile> {
  const { store, config } = ctx;
  // Conversion only: this instance never calls Google.
  const codec = new SheetsStore(config, { call: async () => Promise.reject(new Error('not used')) });
  const want = req.caseIds ? new Set(req.caseIds) : null;
  const recs = [];
  for (const c of await store.listCases()) {
    if (want && !want.has(c.meta.case_id)) continue;
    recs.push((await store.getCase(c.meta.case_id)) ?? c); // with its history
  }
  const rows = codec.caseRows(recs);
  rows.Users = (await store.listUsers()).map((u) => codec.userRow(u));
  rows.Groups = (await store.listGroups()).map((g) => codec.groupRow(g));
  rows.Activity = (await store.listActivity()).map((a) => codec.activityRow(a));
  rows.Lookups = codec.lookupRows();
  const layout = buildLayout(config.dict);
  const sheets = [];
  for (const t of layout.tabs) {
    if (req.keepTabs && !req.keepTabs.includes(t.name)) continue;
    const drop = req.dropColumns[t.name] ?? [];
    const headers = t.headers.filter((h) => !drop.includes(h));
    const body = (rows[t.name] ?? []).filter((r) => !want || !headers.includes('case_id') || want.has(String(r.case_id))).map((r) => headers.map((h) => r[h] ?? null));
    sheets.push({ name: t.name, rows: [headers, ...body] });
  }
  const bytes = buildXlsx(sheets);
  return { file_name: req.fileName, base64: toBase64(bytes), bytes: bytes.length, tabs: sheets.map((s) => s.name), cases: rows.Cases?.length ?? 0 };
}
