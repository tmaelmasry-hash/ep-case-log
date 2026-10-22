// One open case: the server's copy plus the edits made on this device that are not saved yet.
// Edits are sent in order, one batch at a time; values typed while a save is on its way are laid over the answer,
// so the screen never shows an older value. Field-level: the last save of a field wins (EP Workspace P3-4).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaseDetail, DecodedRow, EditBatch, EditResult } from '../shared/caseTypes.ts';
import { idPrefix, slotId } from '../shared/caseTypes.ts';
import { dict } from './lib/dict';
import { api, ApiError } from './lib/api';
import { useStore } from './store';

type Op =
  | { kind: 'create'; entity: string; id: string; parent_id?: string | null; values?: Record<string, unknown> }
  | { kind: 'change'; entity: string; id: string; field: string; value: unknown; key?: string }
  | { kind: 'remove'; entity: string; id: string }
  | { kind: 'additional'; op: 'add' | 'set' | 'remove'; id: string; text?: string; fact_date?: string | null };

export interface CaseEditor {
  detail: CaseDetail | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  pending: number;
  /** Rows of an entity as the screen should show them (server copy + local edits). */
  rows: (entity: string) => DecodedRow[];
  fieldError: (entity: string, id: string, field: string) => string | undefined;
  setField: (entity: string, id: string, field: string, value: unknown, opts?: { key?: string; create?: { parent_id?: string | null } }) => void;
  addRow: (entity: string, parentId?: string | null, values?: Record<string, unknown>) => string;
  removeRow: (entity: string, id: string) => void;
  slot: (entity: string, scopeId: string) => string;
  additional: (op: 'add' | 'set' | 'remove', id: string, text?: string, factDate?: string | null) => void;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
}

function errKey(entity: string, id: string, field: string) {
  return `${entity}|${id}|${field}`;
}

export function newId(entity: string): string {
  return `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;
}

export function useCaseEditor(caseId: string): CaseEditor {
  const { setSaveStatus, toast, refreshCases } = useStore();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Op[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const queueRef = useRef<Op[]>([]);
  queueRef.current = queue;
  const inFlight = useRef<Op[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const retry = useRef(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<CaseDetail>('GET', `/api/cases/${caseId}`);
      setDetail(d);
      setNotFound(false);
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) setNotFound(true);
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    setDetail(null);
    setQueue([]);
    setErrors({});
    reload();
  }, [reload]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inFlight.current || !queueRef.current.length) return;
    const ops = queueRef.current;
    inFlight.current = ops;
    setSaveStatus('saving');
    const batch: EditBatch = { creates: [], changes: [], removes: [], additional: [] };
    const index: { kind: EditResult['kind']; op: Op }[] = [];
    for (const op of ops) {
      if (op.kind === 'create') batch.creates!.push({ entity: op.entity, id: op.id, parent_id: op.parent_id, values: op.values });
      else if (op.kind === 'change') batch.changes!.push({ entity: op.entity, id: op.id, field: op.field, value: op.value, key: op.key });
      else if (op.kind === 'remove') batch.removes!.push({ entity: op.entity, id: op.id });
      else batch.additional!.push({ op: op.op, id: op.id, text: op.text, fact_date: op.fact_date });
      index.push({ kind: op.kind, op });
    }
    try {
      const r = await api<{ results: EditResult[]; case: CaseDetail }>('PATCH', `/api/cases/${caseId}`, batch);
      retry.current = 0;
      setDetail(r.case);
      setQueue((q) => q.slice(ops.length));
      const counters: Record<string, number> = { create: 0, change: 0, remove: 0, additional: 0 };
      const byKind = new Map(r.results.map((x) => [`${x.kind}:${x.i}`, x]));
      setErrors((prev) => {
        const next = { ...prev };
        for (const { kind, op } of index) {
          const res = byKind.get(`${kind}:${counters[kind]++}`);
          const key = op.kind === 'change' ? errKey(op.entity, op.id, op.key ? `${op.field}:${op.key}` : op.field) : op.kind === 'additional' ? `additional|${op.id}` : `${op.kind}|${'entity' in op ? op.entity : ''}`;
          if (res?.ok) delete next[key];
          else if (res) next[key] = res.message ?? 'Not saved.';
        }
        return next;
      });
      const failed = r.results.filter((x) => !x.ok);
      setSaveStatus(failed.length ? 'error' : 'saved');
      if (failed.length && failed.some((x) => x.kind !== 'change')) toast({ message: failed[0].message ?? 'Some changes were not saved.', kind: 'error' });
      if (ops.some((o) => o.kind === 'create' || o.kind === 'remove' || (o.kind === 'change' && (o.entity === 'EP_PROCEDURES' || o.entity === 'EP_EPISODES' || o.entity === 'PATIENTS' || o.entity === 'PATIENT_IDENTIFIERS')))) refreshCases();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404 || err.status === 409) {
        setQueue([]);
        setSaveStatus('error');
        toast({ message: err.message, kind: 'error' });
        reload();
      } else {
        setSaveStatus(err.status === 0 ? 'offline' : 'error');
        retry.current = Math.min(retry.current + 1, 5);
        timer.current = window.setTimeout(() => flush(), [2000, 4000, 8000, 15000, 30000][retry.current - 1]);
      }
    } finally {
      inFlight.current = null;
      if (queueRef.current.length > ops.length && retry.current === 0) timer.current = window.setTimeout(() => flush(), 50);
    }
  }, [caseId, reload, refreshCases, setSaveStatus, toast]);

  const push = useCallback(
    (ops: Op[], delay = 250) => {
      setQueue((q) => {
        const next = [...q, ...ops];
        queueRef.current = next;
        return next;
      });
      setSaveStatus('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(), delay);
    },
    [flush, setSaveStatus],
  );

  // Send waiting edits before the page goes away; warn if some cannot be sent.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (queueRef.current.length || inFlight.current) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      if (queueRef.current.length) flush();
    };
  }, [flush]);

  const view = useMemo(() => {
    const rows: Record<string, DecodedRow[]> = {};
    if (detail) for (const [e, rs] of Object.entries(detail.rows)) rows[e] = rs.map((r) => ({ ...r }));
    // The queue still holds the batch on its way until the answer arrives, so it covers both.
    for (const op of queue) {
      if (op.kind === 'create') {
        const list = (rows[op.entity] ??= []);
        if (!list.some((r) => r._id === op.id)) {
          const def = dict.entities[op.entity];
          const row: DecodedRow = { _id: op.id, [def.pk]: op.id, ...(op.values ?? {}) };
          if (def.nest_under && op.parent_id) row[def.nest_under.fk] = op.parent_id;
          if (def.scope === 'procedure' && op.parent_id) row.procedure_id = op.parent_id;
          list.push(row);
        }
      } else if (op.kind === 'change') {
        const row = rows[op.entity]?.find((r) => r._id === op.id);
        if (row) {
          if (op.field === 'other_specify_json') row.other_specify_json = { ...((row.other_specify_json as Record<string, string>) ?? {}), [op.key!]: String(op.value ?? '') };
          else row[op.field] = op.value;
        }
      } else if (op.kind === 'remove') {
        rows[op.entity] = (rows[op.entity] ?? []).filter((r) => r._id !== op.id);
        // children disappear with their parent on the server; hide them now too
        for (const def of Object.values(dict.entities)) {
          if (def.nest_under?.entity === op.entity) rows[def.entity] = (rows[def.entity] ?? []).filter((r) => r[def.nest_under!.fk] !== op.id);
          if (op.entity === 'EP_PROCEDURES' && def.scope === 'procedure') rows[def.entity] = (rows[def.entity] ?? []).filter((r) => r.procedure_id !== op.id);
        }
      }
    }
    return rows;
  }, [detail, queue]);

  const rows = useCallback((entity: string) => view[entity] ?? [], [view]);

  const slot = useCallback((entity: string, scopeId: string) => slotId(idPrefix(dict.entities[entity].pk), entity, scopeId), []);

  const setField: CaseEditor['setField'] = useCallback(
    (entity, id, field, value, opts) => {
      const ops: Op[] = [];
      if (opts?.create && !view[entity]?.some((r) => r._id === id)) ops.push({ kind: 'create', entity, id, parent_id: opts.create.parent_id ?? null });
      ops.push({ kind: 'change', entity, id, field, value, key: opts?.key });
      push(ops);
    },
    [push, view],
  );

  const addRow: CaseEditor['addRow'] = useCallback(
    (entity, parentId, values) => {
      const def = dict.entities[entity];
      const id = def.cardinality === 'single' ? slotId(idPrefix(def.pk), entity, parentId ?? detail!.meta.case_id) : newId(entity);
      push([{ kind: 'create', entity, id, parent_id: def.scope === 'procedure' || def.nest_under ? parentId : null, values }], 50);
      return id;
    },
    [push, detail],
  );

  const removeRow: CaseEditor['removeRow'] = useCallback((entity, id) => push([{ kind: 'remove', entity, id }], 50), [push]);

  const additional: CaseEditor['additional'] = useCallback(
    (op, id, text, factDate) => push([{ kind: 'additional', op, id, text, fact_date: factDate }], op === 'set' ? 600 : 50),
    [push],
  );

  const fieldError = useCallback((entity: string, id: string, field: string) => errors[errKey(entity, id, field)], [errors]);

  return { detail, loading, notFound, error, pending: queue.length, rows, fieldError, setField, addRow, removeRow, slot, additional, flush, reload };
}
