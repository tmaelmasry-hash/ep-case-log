// AI values that wait on this device until a person decides (owner, 6 Nov). They never reach the Sheet before that.
// Kept in this browser so closing the app does not spend the AI quota again. Gone on Sign Out, or after 7 days. Not encrypted,
// like the device copy of the cases. The note itself is never kept here, only the short quote beside each value.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { CaseDetail } from '../../shared/caseTypes.ts';

export interface AiServerItem {
  entity: string;
  field: string;
  status: 'FILLED' | 'SAME' | 'CONFLICT' | 'DROPPED' | 'ADDITIONAL';
  value?: unknown;
  proposed?: unknown[];
  evidence: string | null;
  evidences?: string[];
  reason?: string;
  row?: string;
  flag?: 'procedure_cancelled';
}

export interface PendingItem {
  id: string;
  run: string;
  kind: 'value' | 'conflict' | 'additional';
  entity: string;
  field: string;
  row: string;
  /** What is proposed. For a conflict, what the person chose. */
  value: unknown;
  /** A conflict: the value saved in the case, and what the note says. */
  saved?: unknown;
  proposed?: unknown[];
  evidence: string;
  evidences?: string[];
  flag?: boolean;
  st: 'wait' | 'ok' | 'no' | 'keep' | 'sent';
  overwrite?: boolean;
  error?: string;
}

interface PendingRun {
  id: string;
  /** The procedure the note goes to; 'new' until the first accepted procedure value makes one. */
  target: string | null;
  rowIds: Record<string, string>;
}

interface Pending {
  at: number;
  runs: PendingRun[];
  items: PendingItem[];
}

const PREFIX = 'ep-ai-pending:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_AFTER_MS = 2000;
const empty = (): Pending => ({ at: Date.now(), runs: [], items: [] });

function read(key: string): Pending {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return empty();
    const p = JSON.parse(raw) as Pending;
    if (Date.now() - p.at > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return empty();
    }
    // Already saved in an earlier session: nothing more to show.
    return { ...p, items: p.items.filter((i) => i.st !== 'sent') };
  } catch {
    return empty();
  }
}

function write(key: string, p: Pending) {
  try {
    if (p.items.some((i) => i.st === 'wait' || i.st === 'ok')) localStorage.setItem(key, JSON.stringify(p));
    else localStorage.removeItem(key);
  } catch {
    /* Storage is off: the values stay for this visit only. */
  }
}

/** On Sign Out: nothing stays waiting on this device. */
export function clearAiPending() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* Storage is off: nothing was kept. */
  }
}

/** Which of the waiting values Accept All may take: not a conflict, not flagged. */
export const plainWaiting = (i: PendingItem) => i.st === 'wait' && i.kind !== 'conflict' && !i.flag;

export function useAiPending(caseId: string, userId: string | undefined, hooks: { flushEdits: () => Promise<unknown>; replace: (d: CaseDetail) => void; onError: (message: string) => void }) {
  const key = `${PREFIX}${userId ?? ''}:${caseId}`;
  const [state, setState] = useState<Pending>(() => read(key));
  const [saving, setSaving] = useState<'idle' | 'waiting' | 'saving' | 'saved' | 'failed'>('idle');
  const [savedCount, setSavedCount] = useState(0);
  const ref = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  const put = useCallback((next: Pending) => {
    ref.current = next;
    write(key, next);
    setState(next);
  }, [key]);

  // Another case on the same screen.
  useEffect(() => {
    const p = read(key);
    ref.current = p;
    setState(p);
    setSaving('idle');
    setSavedCount(0);
  }, [key]);

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (busy.current || !ref.current.items.some((i) => i.st === 'ok')) return;
    if (!navigator.onLine) {
      setSaving('failed');
      return;
    }
    busy.current = true;
    setSaving('saving');
    let saved = 0;
    try {
      await hooksRef.current.flushEdits();
      for (const run of ref.current.runs) {
        const batch = ref.current.items.filter((i) => i.run === run.id && i.st === 'ok');
        if (!batch.length) continue;
        const r = await api<{ procedure_id: string | null; row_ids: Record<string, string>; items: AiServerItem[]; case: CaseDetail }>('POST', `/api/cases/${caseId}/ai/apply`, {
          procedure_id: run.target,
          row_ids: run.rowIds,
          values: batch.filter((i) => i.kind !== 'additional').map((i) => ({ entity: i.entity, field: i.field, row: i.row, value: i.value, evidence: i.evidence, overwrite: i.overwrite === true })),
          additional: batch.filter((i) => i.kind === 'additional').map((i) => ({ text: String(i.value), evidence: i.evidence })),
        });
        const refused = r.items.filter((x) => x.status === 'DROPPED');
        const cur = ref.current;
        const inBatch = new Set(batch.map((i) => i.id));
        put({
          ...cur,
          runs: cur.runs.map((x) => (x.id === run.id ? { ...x, target: r.procedure_id ?? x.target, rowIds: r.row_ids } : x)),
          items: cur.items.map((i) => {
            if (!inBatch.has(i.id)) return i;
            const no = refused.find((x) => x.entity === i.entity && x.field === i.field);
            if (no) return { ...i, st: 'wait', error: no.reason };
            saved++;
            return { ...i, st: 'sent', error: undefined };
          }),
        });
        hooksRef.current.replace(r.case);
      }
      setSavedCount((n) => n + saved);
      setSaving('saved');
    } catch (e) {
      setSaving('failed');
      hooksRef.current.onError((e as Error).message);
    } finally {
      busy.current = false;
    }
    // Accepted while that save was running.
    if (ref.current.items.some((i) => i.st === 'ok')) timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, [caseId, put]);

  const schedule = useCallback(() => {
    setSaving('waiting');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
  }, [flush]);

  // Accepted earlier with no connection: send on opening, on coming back online, and on leaving the case.
  useEffect(() => {
    void flush();
    const again = () => void flush();
    window.addEventListener('online', again);
    return () => {
      window.removeEventListener('online', again);
      void flush();
    };
  }, [flush]);

  const change = useCallback((ids: string[], patch: Partial<PendingItem>) => {
    const cur = ref.current;
    put({ ...cur, items: cur.items.map((i) => (ids.includes(i.id) ? { ...i, ...patch, error: undefined } : i)) });
  }, [put]);

  const addRun = useCallback((target: string | null, items: AiServerItem[]) => {
    const cur = ref.current;
    const id = `r${Date.now().toString(36)}`;
    const label = (row?: string) => (row ? `${id}-${row}` : '');
    const same = (a: PendingItem, e: string, f: string, v: unknown) => a.st === 'wait' && a.entity === e && a.field === f && String(a.value) === String(v);
    const fresh: PendingItem[] = [];
    items.forEach((x, n) => {
      const base = { id: `${id}-${n}`, run: id, entity: x.entity, field: x.field, row: label(x.row), evidence: x.evidence ?? '', st: 'wait' as const, flag: !!x.flag };
      if (x.status === 'FILLED' && !cur.items.some((a) => same(a, x.entity, x.field, x.value))) fresh.push({ ...base, kind: 'value', value: x.value });
      else if (x.status === 'CONFLICT') fresh.push({ ...base, kind: 'conflict', value: null, saved: x.value ?? null, proposed: x.proposed ?? [], evidences: x.evidences });
      else if (x.status === 'ADDITIONAL') fresh.push({ ...base, kind: 'additional', value: x.value });
    });
    put({ at: Date.now(), runs: [...cur.runs, { id, target, rowIds: {} }], items: [...cur.items, ...fresh] });
    return fresh.length;
  }, [put]);

  return {
    items: state.items,
    waiting: state.items.filter((i) => i.st === 'wait'),
    saving,
    savedCount,
    flush,
    addRun,
    targetOf: (run: string) => state.runs.find((r) => r.id === run)?.target ?? null,
    rowIdOf: (run: string, entity: string, row: string) => state.runs.find((r) => r.id === run)?.rowIds[`${entity}|${row}`],
    accept(ids: string[]) {
      change(ids, { st: 'ok' });
      schedule();
    },
    acceptEdited(id: string, value: unknown) {
      change([id], { st: 'ok', value });
      schedule();
    },
    use(id: string, value: unknown) {
      change([id], { st: 'ok', value, overwrite: true });
      schedule();
    },
    reject: (id: string) => change([id], { st: 'no' }),
    keep: (id: string) => change([id], { st: 'keep' }),
    undo: (id: string) => change([id], { st: 'wait' }),
    /** The date a person gives for a row the note did not date. It waits for acceptance with the row's values. */
    addDate(run: string, entity: string, field: string, row: string, value: string) {
      const cur = ref.current;
      put({ ...cur, items: [...cur.items, { id: `${run}-date-${entity}-${row}`, run, kind: 'value', entity, field, row, value, evidence: '', st: 'wait' }] });
    },
  };
}

export type AiPending = ReturnType<typeof useAiPending>;
