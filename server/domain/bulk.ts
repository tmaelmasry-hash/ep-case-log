// Bulk add MRNs (phase 6; ported from EP Workspace server/domain/bulk.ts; Admin only): paste → preview (no writes)
// → commit (idempotent, input order, server-allocated numbers) → results. The preview token binds actor, group,
// list fingerprint and episode date; commit re-checks every row against the store, claims the idempotency key, then
// adds all ready rows in one store call, so a stale preview or a retried click cannot create duplicates.
// An MRN that already has a case in this group is flagged and skipped unless the Admin ticks it (a new case = a new
// episode); an MRN with cases only in other groups is ready. History is copied forward as for a single new case.
import type { CaseRecord } from '../../shared/caseTypes.ts';
import { checkMrn } from '../../shared/mrn.ts';
import type { AppContext } from '../context.ts';
import { hmac } from '../crypto.ts';
import type { ImportItem, ImportJob } from '../store/types.ts';
import { b64url, newId } from '../util.ts';
import { addHistory, copyForward, newCaseRecord } from './cases.ts';

export const BULK_MAX_ROWS = 1000;

export type RowStatus = 'READY' | 'REPEATED' | 'ALREADY_HERE' | 'INVALID';
export interface PreviewRow {
  position: number;
  line: number;
  input: string;
  value: string;
  status: RowStatus;
  message: string;
  warning?: string;
  repeatOf?: number;
  existing?: { case_id: string; group_seq: number } | null;
  /** The MRN also has a live case in another group (no details shown). */
  elsewhere?: boolean;
}

/** One token per line; commas, semicolons and tabs also separate (a pasted spreadsheet row). */
export function splitPaste(text: string): { line: number; input: string }[] {
  const out: { line: number; input: string }[] = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((l, i) => {
      for (const part of l.split(/[,;\t]/)) if (part.trim() !== '') out.push({ line: i + 1, input: part });
    });
  return out;
}

export async function fingerprint(text: string): Promise<string> {
  const data = new TextEncoder().encode(splitPaste(text).map((t) => t.input.trim()).join('\n'));
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

/** Classifies a paste against the stored cases (no writes). */
export function classify(ctx: AppContext, cases: CaseRecord[], text: string, groupId: string) {
  const tokens = splitPaste(text);
  const blank = String(text ?? '').split(/\r?\n/).filter((l) => l.trim() === '').length;
  const index = new Map<string, CaseRecord[]>();
  for (const c of [...cases].sort((a, b) => a.meta.created_at.localeCompare(b.meta.created_at))) {
    if (c.meta.is_deleted) continue;
    index.set(c.meta.mrn, [...(index.get(c.meta.mrn) ?? []), c]);
  }
  const seen = new Map<string, number>();
  const rows: PreviewRow[] = tokens.map((t, i) => {
    const c = checkMrn(t.input, ctx.config.site.mrn);
    const base = { position: i + 1, line: t.line, input: t.input.trim(), value: c.value };
    if (!c.ok) return { ...base, status: 'INVALID', message: c.error! };
    if (seen.has(c.value)) return { ...base, status: 'REPEATED', message: `Repeated in the list (line ${tokens[seen.get(c.value)! - 1].line})`, repeatOf: seen.get(c.value) };
    seen.set(c.value, i + 1);
    const live = index.get(c.value) ?? [];
    const here = live.filter((m) => m.meta.group_id === groupId);
    const elsewhere = live.some((m) => m.meta.group_id !== groupId);
    const note = /[٠-٩۰-۹]/.test(t.input) ? 'Arabic digits normalised' : /\s/.test(t.input.trim()) ? 'Spaces removed' : '';
    if (here.length) {
      const last = here.at(-1)!;
      return { ...base, status: 'ALREADY_HERE', message: `Already has a case here (No. ${here.map((m) => m.meta.group_seq).join(', No. ')})`, existing: { case_id: last.meta.case_id, group_seq: last.meta.group_seq }, elsewhere };
    }
    // Never say which other group holds the patient.
    return { ...base, status: 'READY', message: elsewhere ? 'Also has a case in another group' : note || 'New', warning: c.warning, elsewhere };
  });
  const summary = {
    total: rows.length,
    blank,
    ready: rows.filter((r) => r.status === 'READY').length,
    repeated: rows.filter((r) => r.status === 'REPEATED').length,
    already_here: rows.filter((r) => r.status === 'ALREADY_HERE').length,
    other_group: rows.filter((r) => r.status === 'READY' && r.elsewhere).length,
    invalid: rows.filter((r) => r.status === 'INVALID').length,
    warnings: rows.filter((r) => r.warning).length,
  };
  return { rows, summary };
}

export async function previewToken(ctx: AppContext, actorId: string, groupId: string, fp: string, episodeStart: string | null): Promise<string> {
  return hmac(ctx.env.sessionSecret, 'bulk_preview/v1', [actorId, groupId, fp, episodeStart ?? ''].join('\u0000'));
}

export interface CommitResult {
  import_job_id: string;
  status: string;
  added: number;
  rows: ImportItem[];
  replayed: boolean;
}

export function jobResult(job: ImportJob, replayed: boolean): CommitResult {
  return { import_job_id: job.import_job_id, status: job.status, added: job.added, rows: job.items, replayed };
}

export async function commit(
  ctx: AppContext,
  args: { actorId: string; groupId: string; text: string; episodeStart: string | null; idempotencyKey: string; addExisting: number[]; visibleGroups: string[]; today: string },
): Promise<CommitResult> {
  const { store, config } = ctx;
  const now = ctx.now().toISOString();
  const job: ImportJob = {
    import_job_id: newId('imp'),
    idempotency_key: args.idempotencyKey,
    actor_user_id: args.actorId,
    group_id: args.groupId,
    list_fingerprint: await fingerprint(args.text),
    status: 'RUNNING',
    total_rows: 0,
    added: 0,
    created_at: now,
    finished_at: null,
    items: [],
  };
  if (!(await store.claimImport(job))) return jobResult((await store.getImport({ key: args.idempotencyKey }))!, true);
  // Re-check against the store now: a single add between preview and commit is not duplicated.
  const cases = await store.listCases();
  const p = classify(ctx, cases, args.text, args.groupId);
  const ticked = new Set(args.addExisting);
  const ready = p.rows.filter((r) => r.status === 'READY' || (r.status === 'ALREADY_HERE' && ticked.has(r.position)));
  const groups = await store.listGroups();
  const gname = (id: string) => groups.find((g) => g.group_id === id)?.name ?? 'group';
  const first = ready.length ? await store.allocateSeqs(args.groupId, ready.length) : 0;
  const a = { userId: args.actorId, now };
  const created = ready.map((r, i) => {
    const all = cases.filter((c) => c.meta.mrn === r.value).sort((x, y) => x.meta.created_at.localeCompare(y.meta.created_at));
    const source = all.filter((c) => !c.meta.is_deleted && args.visibleGroups.includes(c.meta.group_id)).at(-1) ?? null;
    const rec = newCaseRecord(
      config.dict,
      {
        caseId: newId('case'),
        patientId: all.at(-1)?.meta.patient_id ?? newId('patient'),
        mrn: r.value,
        groupId: args.groupId,
        groupSeq: first + i,
        episodeStart: args.episodeStart,
        enrollmentDate: args.today,
        registryBasis: config.site.registry_basis_default,
      },
      a,
    );
    addHistory(rec, { kind: 'create', text: `Case created in ${gname(args.groupId)} as No. ${first + i} (bulk add)` }, a);
    if (source) copyForward(config.dict, rec, source, `Copied from ${gname(source.meta.group_id)} No. ${source.meta.group_seq}`, a);
    return rec;
  });
  if (created.length) await store.putNewCases(created);
  const byPos = new Map(ready.map((r, i) => [r.position, created[i]]));
  job.items = p.rows.map((r) => {
    const c = byPos.get(r.position);
    if (c) {
      return {
        position: r.position,
        mrn: r.value,
        outcome: 'ADDED',
        case_id: c.meta.case_id,
        group_seq: c.meta.group_seq,
        message: r.status === 'ALREADY_HERE' ? `Another case for this MRN — ${r.message.toLowerCase()}` : (r.warning ?? (r.elsewhere ? r.message : null)),
      };
    }
    return {
      position: r.position,
      mrn: r.status === 'INVALID' ? r.input.slice(0, 40) : r.value,
      outcome: r.status as ImportItem['outcome'],
      case_id: r.existing?.case_id ?? null,
      group_seq: r.existing?.group_seq ?? null,
      message: r.message,
    };
  });
  Object.assign(job, { status: 'DONE', total_rows: p.rows.length, added: created.length, finished_at: ctx.now().toISOString() });
  await store.saveImport(job);
  await store.appendActivity([{ actor: args.actorId, action: 'import.mrns', detail: { import_job_id: job.import_job_id, group_id: args.groupId, total: p.rows.length, added: created.length } }]);
  return jobResult(job, false);
}
