// Dashboard click filter (owner R4-6): a month of "Cases by month" and/or a procedure type picked on the Dashboard.
// The browser only works out which cases match; the server counts them (POST /api/dashboard with case_ids), so every
// card follows the same rules as before. Pure, no React.
import type { CaseSummary } from '../../shared/caseTypes.ts';

export interface DashPick {
  /** "YYYY-MM" of the episode start date (as the server's "Cases by month"). */
  month: string | null;
  /** Dashboard type id: a key of the layout's core_categories (as the server's "By procedure type"). */
  type: string | null;
}

export const NO_PICK: DashPick = { month: null, type: null };

/** Same month rule as the server: the first seven characters of the episode start date. */
const monthOf = (c: CaseSummary) => (/^\d{4}-\d{2}/.test(c.episode_start_date ?? '') ? c.episode_start_date!.slice(0, 7) : null);

/** Does the case match the pick? `categoriesOf` maps a procedure's component codes to Dashboard type ids
 *  (shared/readiness.ts categoriesOf with the browser dictionary). Bulk add's planned type is not a procedure, and the
 *  server does not count it in a type either. */
export function matchesPick(c: CaseSummary, pick: DashPick, categoriesOf: (components: string[]) => string[]): boolean {
  if (pick.month && monthOf(c) !== pick.month) return false;
  if (pick.type && !c.procedures.some((p) => categoriesOf(p.components).includes(pick.type!))) return false;
  return true;
}

/** Ids of the cases (already narrowed by the menu filters, or all) that match the pick. */
export function pickCaseIds(cases: CaseSummary[], pick: DashPick, categoriesOf: (components: string[]) => string[]): string[] {
  return cases.filter((c) => matchesPick(c, pick, categoriesOf)).map((c) => c.case_id);
}

/** "Oct 2026 · AF Ablation" for the Filtered bar. */
export function pickText(pick: DashPick, typeLabel: (id: string) => string): string {
  const parts: string[] = [];
  if (pick.month) {
    const [y, m] = pick.month.split('-').map(Number);
    parts.push(new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }));
  }
  if (pick.type) parts.push(typeLabel(pick.type));
  return parts.join(' · ');
}
