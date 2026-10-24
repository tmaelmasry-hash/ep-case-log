// One open case: the saved copy plus the edits made on this device that the server has not answered yet.
// Local-first (owner R3-4, L2): the case opens from this device's copy at once and is refreshed from the server in
// the background; edits go to the device outbox (src/lib/sync.ts) and are sent in order in the background, so a
// save never waits for the Google Sheet. Field-level: the last save of a field wins (EP Workspace P3-4).
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { CaseDetail, DecodedRow } from '../shared/caseTypes.ts';
import { idPrefix, slotId } from '../shared/caseTypes.ts';
import { deriveChanges } from '../shared/derive.ts';
import { naKey, type NotAvailable } from '../shared/readiness.ts';
import { dict } from './lib/dict';
import { api, ApiError } from './lib/api';
import { caseDelete, caseGet, casePut } from './lib/localdb';
import { sync, type Op } from './lib/sync';
import { useStore } from './store';

export interface CaseEditor {
  detail: CaseDetail | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
  pending: number;
  /** Completed cases are read only until reopened. */
  readOnly: boolean;
  /** "Not available" + reason by naKey (server copy + local edits). */
  notAvailable: Record<string, Pick<NotAvailable, 'reason'>>;
  setNotAvailable: (entity: string, field: string, procedureId: string | null, reason: string | null) => void;
  /** Use a fresh server copy (after Complete / Reopen). */
  replace: (d: CaseDetail) => void;
  /** Rows of an entity as the screen should show them (server copy + local edits). */
  rows: (entity: string) => DecodedRow[];
  fieldError: (entity: string, id: string, field: string) => string | undefined;
  setField: (entity: string, id: string, field: string, value: unknown, opts?: { key?: string; create?: { parent_id?: string | null } }) => void;
  addRow: (entity: string, parentId?: string | null, values?: Record<string, unknown>) => string;
  removeRow: (entity: string, id: string) => void;
  slot: (entity: string, scopeId: string) => string;
  additional: (op: 'add' | 'set' | 'remove', id: string, text?: string, factDate?: string | null) => void;
  /** Sends what waits on this device; resolves when sent (or when sending stopped: offline / refused). */
  flush: () => Promise<void>;
  reload: () => Promise<void>;
}

function errKey(entity: string, id: string, field: string) {
  return `${entity}|${id}|${field}`;
}

function opKey(op: Op): string {
  return op.kind === 'change' ? errKey(op.entity, op.id, op.key ? `${op.field}:${op.key}` : op.field) : op.kind === 'additional' ? `additional|${op.id}` : op.kind === 'na' ? `na|${naKey(op.entity, op.field, op.procedure_id)}` : `${op.kind}|${op.entity}`;
}

export function newId(entity: string): string {
  return `${idPrefix(dict.entities[entity].pk)}_${crypto.randomUUID()}`;
}

export function useCaseEditor(caseId: string): CaseEditor {
  const { toast, upsertCase } = useStore();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Re-render whenever the outbox changes; the edits of this case come from it.
  useSyncExternalStore(sync.subscribe, sync.getState);
  const queue = sync.pending(caseId);

  const keep = useCallback(
    (d: CaseDetail) => {
      setDetail(d);
      void casePut(caseId, d);
    },
    [caseId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<CaseDetail>('GET', `/api/cases/${caseId}`);
      keep(d);
      setNotFound(false);
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 404) {
        setNotFound(true);
        void caseDelete(caseId);
      } else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [caseId, keep]);

  // This device's copy first (instant), then the server's.
  useEffect(() => {
    let live = true;
    setDetail(null);
    setErrors({});
    setLoading(true);
    void caseGet<CaseDetail>(caseId).then((local) => {
      if (live && local) {
        setDetail((d) => d ?? local);
        setLoading(false);
      }
    });
    // A case made offline is not on the server yet: this device's copy is the case until it is sent.
    if (sync.isLocalOnly(caseId)) return () => void (live = false);
    void api<CaseDetail>('GET', `/api/cases/${caseId}`)
      .then((d) => {
        if (!live) return;
        keep(d);
        setNotFound(false);
        setError(null);
      })
      .catch((e: ApiError) => {
        if (!live) return;
        if (e.status === 404) {
          setNotFound(true);
          void caseDelete(caseId);
        } else setError(e.message);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [caseId, keep]);

  // The server's answers to this case's edits: fresh copy, per-field messages, refusals.
  useEffect(
    () =>
      sync.onCase(caseId, (e) => {
        if (e.kind === 'saved') {
          setDetail(e.detail);
          upsertCase(e.detail.summary);
          const counters: Record<string, number> = { create: 0, change: 0, remove: 0, additional: 0, na: 0 };
          const byKind = new Map(e.results.map((x) => [`${x.kind}:${x.i}`, x]));
          setErrors((prev) => {
            const next = { ...prev };
            for (const op of e.ops) {
              const res = byKind.get(`${op.kind}:${counters[op.kind]++}`);
              if (res?.ok) delete next[opKey(op)];
              else if (res) next[opKey(op)] = res.message ?? 'Not saved.';
            }
            return next;
          });
          const failed = e.results.filter((x) => !x.ok);
          if (failed.some((x) => x.kind !== 'change')) toast({ message: failed[0].message ?? 'Some changes were not saved.', kind: 'error' });
        } else if (e.kind === 'refused') {
          toast({ message: `${e.message} The change is kept on this device (Sync).`, kind: 'error' });
          if ((e.status === 404 || e.status === 409) && !sync.isLocalOnly(caseId)) void reload();
        } else setNotFound(true);
      }),
    [caseId, reload, upsertCase, toast],
  );

  const label = detail ? `No. ${detail.meta.group_seq} · ${detail.meta.mrn}` : caseId;
  const push = useCallback((ops: Op[], delay = 250) => sync.enqueue(caseId, label, ops, delay), [caseId, label]);

  // Edits are on the device already; warn only when this browser cannot keep them.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      const s = sync.getState();
      if (!s.persistent && s.waiting) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const overlay = useMemo(() => {
    const rows: Record<string, DecodedRow[]> = {};
    if (detail) for (const [e, rs] of Object.entries(detail.rows)) rows[e] = rs.map((r) => ({ ...r }));
    // Waiting edits (also those on their way) are laid over the saved copy until the server answers.
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
    // Values the app fills (shared/derive.ts, also stored by the server): shown at once, offline too.
    const season = dict.layout.form?.hajj_season;
    if (detail && season) {
      const ctx = { caseId: detail.meta.case_id, episodeId: detail.meta.episode_id, patientId: detail.meta.patient_id, slot: (e: string, s: string) => slotId(idPrefix(dict.entities[e].pk), e, s), season };
      for (let pass = 0; pass < 3; pass++) {
        const list = deriveChanges(dict, (e) => rows[e] ?? [], ctx);
        if (!list.length) break;
        for (const d of list) {
          let row = rows[d.entity]?.find((r) => r._id === d.id);
          if (!row && d.create) (rows[d.entity] ??= []).push((row = { _id: d.id, [dict.entities[d.entity].pk]: d.id }));
          if (row) row[d.field] = d.value;
        }
      }
    }
    const na: Record<string, Pick<NotAvailable, 'reason'>> = { ...(detail?.not_available ?? {}) };
    for (const op of queue) {
      if (op.kind !== 'na') continue;
      const k = naKey(op.entity, op.field, op.procedure_id);
      if (op.reason) na[k] = { reason: op.reason };
      else delete na[k];
    }
    return { rows, na };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, JSON.stringify(queue)]);

  const view = overlay.rows;
  const rows = useCallback((entity: string) => view[entity] ?? [], [view]);

  const setNotAvailable: CaseEditor['setNotAvailable'] = useCallback(
    (entity, field, procedureId, reason) => push([{ kind: 'na', entity, field, procedure_id: procedureId, reason }], 50),
    [push],
  );

  const replace = useCallback(
    (d: CaseDetail) => {
      keep(d);
      setErrors({});
      upsertCase(d.summary);
    },
    [keep, upsertCase],
  );

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
  const flush = useCallback(() => sync.flush(), []);

  const readOnly = detail?.meta.collection_status === 'COMPLETED';
  return { detail, loading, notFound, error, pending: queue.length, readOnly, notAvailable: overlay.na, setNotAvailable, replace, rows, fieldError, setField, addRow, removeRow, slot, additional, flush, reload };
}
