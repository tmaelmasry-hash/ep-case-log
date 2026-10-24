// Local-first sync (owner R3-4, L2). Every edit is put in this device's outbox at once (IndexedDB), then sent to the
// server in the background: per case, in order, in batches the server accepts. Network trouble keeps the edits and
// retries (backoff, on "online", every 30 s); a refusal by the server (case completed, removed, out of your groups)
// marks them "needs attention" with Retry / Discard. Edits are safe to resend: the server ignores a repeated add or
// remove and a change sets the same value again.
import type { CaseDetail, EditBatch, EditResult } from '../../shared/caseTypes.ts';
import { api, ApiError } from './api';
import { casePut, hasLocal, kvGet, kvSet, openLocalFor, outboxAll, outboxDelete, outboxPut } from './localdb';

export type Op =
  | { kind: 'create'; entity: string; id: string; parent_id?: string | null; values?: Record<string, unknown> }
  | { kind: 'change'; entity: string; id: string; field: string; value: unknown; key?: string }
  | { kind: 'remove'; entity: string; id: string }
  | { kind: 'additional'; op: 'add' | 'set' | 'remove'; id: string; text?: string; fact_date?: string | null }
  | { kind: 'na'; entity: string; field: string; procedure_id: string | null; reason: string | null };

export interface OutboxItem {
  seq: number;
  case_id: string;
  /** Shown in the Sync sheet: MRN and case number when known. */
  label: string;
  ops: Op[];
  at: number;
  attention?: string;
}

/** What the server answered for a batch of one case (the case editor maps results to fields). */
export type CaseEvent = { kind: 'saved'; ops: Op[]; results: EditResult[]; detail: CaseDetail } | { kind: 'refused'; message: string; status: number };

export interface SyncState {
  waiting: number;
  attention: number;
  sending: boolean;
  offline: boolean;
  lastSynced: number | null;
  persistent: boolean;
}

// Server limits per batch (server/domain/cases.ts applyEdits).
const LIMITS: Record<Op['kind'], number> = { create: 50, change: 200, remove: 50, additional: 20, na: 50 };
const BACKOFF = [2000, 4000, 8000, 15000, 30000];

/** Splits one case's ops, in order, into batches within the server's limits. */
export function chunkOps(ops: Op[]): Op[][] {
  const out: Op[][] = [];
  let cur: Op[] = [];
  let n: Record<string, number> = {};
  for (const op of ops) {
    if ((n[op.kind] ?? 0) >= LIMITS[op.kind]) {
      out.push(cur);
      cur = [];
      n = {};
    }
    cur.push(op);
    n[op.kind] = (n[op.kind] ?? 0) + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function toBatch(ops: Op[]): EditBatch {
  const batch: EditBatch = { creates: [], changes: [], removes: [], additional: [], not_available: [] };
  for (const op of ops) {
    if (op.kind === 'create') batch.creates!.push({ entity: op.entity, id: op.id, parent_id: op.parent_id, values: op.values });
    else if (op.kind === 'change') batch.changes!.push({ entity: op.entity, id: op.id, field: op.field, value: op.value, key: op.key });
    else if (op.kind === 'remove') batch.removes!.push({ entity: op.entity, id: op.id });
    else if (op.kind === 'na') batch.not_available!.push({ entity: op.entity, field: op.field, procedure_id: op.procedure_id, reason: op.reason });
    else batch.additional!.push({ op: op.op, id: op.id, text: op.text, fact_date: op.fact_date });
  }
  return batch;
}

class SyncEngine {
  private items: OutboxItem[] = [];
  private seq = 0;
  private user: string | null = null;
  private running = false;
  private timer: number | undefined;
  private retry = 0;
  private persistent = false;
  private offline = false;
  private lastSynced: number | null = null;
  private listeners = new Set<() => void>();
  private caseListeners = new Map<string, Set<(e: CaseEvent) => void>>();
  private snapshot: SyncState = { waiting: 0, attention: 0, sending: false, offline: false, lastSynced: null, persistent: false };
  private waiters: (() => void)[] = [];

  /** Loads this user's outbox from the device and starts sending. */
  async start(user: string) {
    if (this.user === user) return;
    this.user = user;
    openLocalFor(user);
    this.persistent = await hasLocal();
    const saved = (await outboxAll<OutboxItem>()) ?? [];
    this.items = saved.sort((a, b) => a.seq - b.seq);
    this.seq = Math.max(Date.now(), ...this.items.map((i) => i.seq + 1));
    this.lastSynced = (await kvGet<number>('lastSynced')) ?? null;
    this.emit();
    window.addEventListener('online', () => this.kick(0));
    window.setInterval(() => this.kick(0), 30_000);
    this.kick(0);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.snapshot;

  onCase(caseId: string, fn: (e: CaseEvent) => void) {
    const set = this.caseListeners.get(caseId) ?? new Set();
    set.add(fn);
    this.caseListeners.set(caseId, set);
    return () => void set.delete(fn);
  }

  private emit() {
    const waiting = this.items.filter((i) => !i.attention).length;
    this.snapshot = { waiting, attention: this.items.length - waiting, sending: this.running, offline: this.offline, lastSynced: this.lastSynced, persistent: this.persistent };
    for (const fn of this.listeners) fn();
    if (!waiting || this.offline) for (const w of this.waiters.splice(0)) w();
  }

  /** Edits not yet answered by the server for this case (in order), shown over the saved copy. */
  pending(caseId: string): Op[] {
    return this.items.filter((i) => i.case_id === caseId && !i.attention).flatMap((i) => i.ops);
  }
  list(): OutboxItem[] {
    return [...this.items];
  }

  /** Keeps the edits on this device at once, sends them after `delay` ms (typing is grouped). */
  enqueue(caseId: string, label: string, ops: Op[], delay = 250) {
    const item: OutboxItem = { seq: this.seq++, case_id: caseId, label, ops, at: Date.now() };
    this.items.push(item);
    void outboxPut(item);
    this.emit();
    this.kick(delay);
  }

  /** Sends now and resolves when nothing waits (or sending stopped: offline or refused). */
  flush(): Promise<void> {
    if (!this.items.some((i) => !i.attention)) return Promise.resolve();
    const p = new Promise<void>((r) => this.waiters.push(r));
    this.kick(0);
    return p;
  }

  retryItem(seq: number) {
    const it = this.items.find((i) => i.seq === seq);
    if (!it) return;
    delete it.attention;
    void outboxPut(it);
    this.emit();
    this.kick(0);
  }
  discard(seq: number) {
    this.items = this.items.filter((i) => i.seq !== seq);
    void outboxDelete([seq]);
    this.emit();
  }

  kick(delay: number) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), delay);
  }

  private async run() {
    if (this.running || !this.user) return;
    const go = async () => {
      this.running = true;
      this.emit();
      try {
        await this.sendAll();
      } finally {
        this.running = false;
        this.emit();
      }
    };
    // Two open windows of the app share the outbox: only one sends at a time.
    const locks = (navigator as Navigator & { locks?: { request(name: string, fn: () => Promise<void>): Promise<void> } }).locks;
    if (locks) await locks.request(`kamc-sync-${this.user}`, go);
    else await go();
  }

  private async sendAll() {
    for (;;) {
      const first = this.items.find((i) => !i.attention);
      if (!first) return;
      const caseId = first.case_id;
      const batchItems = this.items.filter((i) => i.case_id === caseId && !i.attention);
      const ops = batchItems.flatMap((i) => i.ops);
      const chunks = chunkOps(ops);
      // Send the first chunk; items are removed only when every op of them was answered.
      const sent = chunks[0];
      try {
        const r = await api<{ results: EditResult[]; case: CaseDetail }>('PATCH', `/api/cases/${encodeURIComponent(caseId)}`, toBatch(sent));
        this.retry = 0;
        this.offline = false;
        this.lastSynced = Date.now();
        void kvSet('lastSynced', this.lastSynced);
        this.consume(caseId, sent.length);
        void casePut(caseId, r.case);
        this.toCase(caseId, { kind: 'saved', ops: sent, results: r.results, detail: r.case });
      } catch (e) {
        const err = e as ApiError;
        if (err.status === 0 || err.status >= 500 || err.status === 429 || err.status === 401) {
          // Kept on the device; try again later (401: the sign-in screen shows; sending resumes after sign-in).
          this.offline = err.status === 0;
          this.retry = Math.min(this.retry + 1, BACKOFF.length);
          this.emit();
          if (err.status !== 401) this.kick(BACKOFF[this.retry - 1]);
          for (const w of this.waiters.splice(0)) w();
          return;
        }
        // Refused (case completed, removed, out of scope, or stale twice): keep for Retry / Discard.
        for (const it of batchItems) {
          it.attention = err.message;
          void outboxPut(it);
        }
        this.toCase(caseId, { kind: 'refused', message: err.message, status: err.status });
      }
      this.emit();
    }
  }

  /** Removes the first n ops of this case's waiting items (whole items, or the front of a split item). */
  private consume(caseId: string, n: number) {
    const done: number[] = [];
    for (const it of this.items) {
      if (n <= 0) break;
      if (it.case_id !== caseId || it.attention) continue;
      if (it.ops.length <= n) {
        n -= it.ops.length;
        done.push(it.seq);
      } else {
        it.ops = it.ops.slice(n);
        n = 0;
        void outboxPut(it);
      }
    }
    this.items = this.items.filter((i) => !done.includes(i.seq));
    void outboxDelete(done);
  }

  private toCase(caseId: string, e: CaseEvent) {
    for (const fn of this.caseListeners.get(caseId) ?? []) fn(e);
    for (const fn of this.caseListeners.get('*') ?? []) fn(e);
  }
}

export const sync = new SyncEngine();
