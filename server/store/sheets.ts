// Google Sheet store (phase 4, decision D2): the registry lives in a Google Sheet; apps-script/Code.js is a thin
// gateway (read / append / update cells under a lock). Ported idea: EP Workspace server/store/sheets.ts.
// Cases are written cell by cell from a patch (server/store/patch.ts), never as whole rows, so two people saving
// different fields of one case at the same moment both keep their values. WebCrypto/fetch only (Cloudflare-ready).
import type { CaseMeta, CaseRecord, HistoryEntry, StoredRow } from '../../shared/caseTypes.ts';
import type { AppConfig } from '../appconfig.ts';
import { readinessOf } from '../domain/cases.ts';
import { diffCase, isEmptyPatch, type CasePatch } from './patch.ts';
import { CASE_COLUMNS, ROW_META, SUPPORT_TABS, buildLayout, col, type SheetLayout } from './sheet-layout.ts';
import type { Activity, ActivityInput, Group, RegistryStore, User } from './types.ts';

/** The Apps Script web app (or a test double with the same operations). */
export interface Gateway {
  call(action: string, body?: Record<string, unknown>): Promise<unknown>;
}

/** Calls the deployed Apps Script web app. The secret is in the Worker's secrets / local .env, never in git. */
export class AppsScriptGateway implements Gateway {
  private url: string;
  private secret: string;
  private target: 'main' | 'test';
  constructor(url: string, secret: string, target: 'main' | 'test' = 'main') {
    this.url = url;
    this.secret = secret;
    this.target = target;
  }
  async call(action: string, body: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, action, secret: this.secret, target: this.target }), redirect: 'follow' });
    const text = await res.text();
    let out: { ok: boolean; result?: unknown; error?: string };
    try {
      out = JSON.parse(text);
    } catch {
      throw new Error(`Google Sheet gateway answered ${res.status} without data`);
    }
    if (!out.ok) throw new Error(`Google Sheet gateway: ${out.error ?? 'failed'}`);
    return out.result;
  }
}

type Cell = string | number | boolean;
type SheetRow = Record<string, Cell>;
type Op = Record<string, unknown> & { op: string };

const toCell = (v: unknown): Cell => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : (v as Cell));
const fromCell = (v: unknown): unknown => (v === '' || v === undefined ? null : v);
const num = (v: unknown, d = 0) => (v === '' || v === null || v === undefined ? d : Number(v));
const bool = (v: unknown) => v === true || v === 'TRUE' || v === 'true' || v === 1;
const json = <T>(v: unknown, d: T): T => {
  if (typeof v !== 'string' || !v) return d;
  try {
    return JSON.parse(v) as T;
  } catch {
    return d;
  }
};

/** Unique per tab: the patient rows of one MRN share their id across cases, and two entities of one tab share it. */
const rowKey = (caseId: string, entity: string, rowId: string) => `${caseId}/${entity}/${rowId}`;

const NUMBER_META = new Set(['group_seq', 'row_version']);
const CACHE_MS = 20_000;

export class SheetsStore implements RegistryStore {
  readonly kind = 'sheets' as const;
  readonly layout: SheetLayout;
  private users: { at: number; list: User[] } | null = null;
  private groups: { at: number; list: Group[] } | null = null;

  private config: AppConfig;
  private gw: Gateway;

  constructor(config: AppConfig, gw: Gateway) {
    this.config = config;
    this.gw = gw;
    this.layout = buildLayout(config.dict);
  }

  // ── gateway ──
  async batch(ops: Op[]): Promise<{ rows?: SheetRow[]; ids?: number[]; value?: number; row?: SheetRow; found?: boolean }[]> {
    return (await this.gw.call('batch', { ops })) as never;
  }

  /** First call only: stores the gateway secret in the script (trust on first use). */
  init() {
    return this.gw.call('init');
  }

  /** Creates missing tabs and columns (never removes or reorders). */
  setup() {
    return this.gw.call('setup', { tabs: this.layout.tabs });
  }

  // ── users ──
  private userFrom(r: SheetRow): User {
    return {
      user_id: String(r.user_id),
      username: String(r.username),
      display_name: String(r.display_name),
      role: r.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
      status: r.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
      groups: String(r.groups ?? '').split(',').map((x) => x.trim()).filter(Boolean),
      password_hash: (fromCell(r.password_hash) as string | null) ?? null,
      must_change_password: bool(r.must_change_password),
      session_epoch: num(r.session_epoch),
      failed_logins: num(r.failed_logins),
      locked_until: (fromCell(r.locked_until) as string | null) ?? null,
      created_at: String(r.created_at ?? ''),
      created_by: (fromCell(r.created_by) as string | null) ?? null,
      updated_at: String(r.updated_at ?? ''),
      last_login_at: (fromCell(r.last_login_at) as string | null) ?? null,
    };
  }
  private userCells(u: Partial<User>): SheetRow {
    const out: SheetRow = {};
    for (const [k, v] of Object.entries(u)) out[k] = k === 'groups' ? (v as string[]).join(',') : toCell(v);
    return out;
  }

  async listUsers() {
    if (this.users && Date.now() - this.users.at < CACHE_MS) return structuredClone(this.users.list);
    const [r] = await this.batch([{ op: 'read', tab: 'Users' }]);
    this.users = { at: Date.now(), list: (r.rows ?? []).filter((x) => x.user_id).map((x) => this.userFrom(x)) };
    return structuredClone(this.users.list);
  }
  async getUser(id: string) {
    return (await this.listUsers()).find((u) => u.user_id === id) ?? null;
  }
  async findUserByUsername(username: string) {
    return (await this.listUsers()).find((u) => u.username === username) ?? null;
  }
  async createUser(u: User) {
    this.users = null;
    const [r] = await this.batch([{ op: 'appendIfAbsent', tab: 'Users', key: 'username', row: this.userCells(u) }]);
    if (!(r as { inserted?: boolean }).inserted) throw new Error('duplicate user');
  }
  async updateUser(id: string, patch: Partial<User>) {
    this.users = null;
    const set = this.userCells(Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'user_id')));
    const [r] = await this.batch([{ op: 'update', tab: 'Users', key: 'user_id', id, set, returnRow: true }]);
    return r.found && r.row ? this.userFrom(r.row) : null;
  }

  // ── groups ──
  private groupFrom(r: SheetRow): Group {
    return { group_id: String(r.group_id), name: String(r.name), sort_order: num(r.sort_order), next_seq: num(r.next_seq, 1), is_deleted: bool(r.is_deleted), created_at: String(r.created_at ?? '') };
  }
  async listGroups() {
    if (this.groups && Date.now() - this.groups.at < CACHE_MS) return structuredClone(this.groups.list);
    const [r] = await this.batch([{ op: 'read', tab: 'Groups' }]);
    this.groups = { at: Date.now(), list: (r.rows ?? []).filter((x) => x.group_id).map((x) => this.groupFrom(x)) };
    return structuredClone(this.groups.list);
  }
  async createGroup(g: Group) {
    this.groups = null;
    await this.batch([{ op: 'append', tab: 'Groups', rows: [Object.fromEntries(Object.entries(g).map(([k, v]) => [k, toCell(v)]))] }]);
  }
  async updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'sort_order'>>) {
    this.groups = null;
    const [r] = await this.batch([{ op: 'update', tab: 'Groups', key: 'group_id', id, set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, toCell(v)])), returnRow: true }]);
    return r.found && r.row ? this.groupFrom(r.row) : null;
  }
  /** Next case number in a group, counted under the script lock (never reused). */
  async allocateSeq(groupId: string) {
    this.groups = null;
    const [r] = await this.batch([{ op: 'increment', tab: 'Groups', key: 'group_id', id: groupId, col: 'next_seq' }]);
    return Number(r.value);
  }

  // ── activity (field names only, never values: the routes decide what goes in detail) ──
  async appendActivity(entries: ActivityInput[]) {
    if (!entries.length) return;
    const at = new Date().toISOString();
    await this.batch([{ op: 'append', tab: 'Activity', idCol: 'activity_id', rows: entries.map((e) => ({ at, actor: toCell(e.actor), action: e.action, detail_json: e.detail === undefined ? '' : JSON.stringify(e.detail) })) }]);
  }
  async listActivity(): Promise<Activity[]> {
    const [r] = await this.batch([{ op: 'read', tab: 'Activity' }]);
    return (r.rows ?? [])
      .filter((x) => x.action)
      .map((x) => ({ activity_id: num(x.activity_id), at: String(x.at), actor: (fromCell(x.actor) as string | null) ?? null, action: String(x.action), ...(x.detail_json ? { detail: json(x.detail_json, null) } : {}) }));
  }

  // ── cases ──
  private entityTabs(): string[] {
    return this.layout.tabs.map((t) => t.name).filter((n) => n !== 'Cases' && !(n in SUPPORT_TABS));
  }

  private assemble(caseRows: SheetRow[], tabRows: SheetRow[], histRows: SheetRow[]): CaseRecord[] {
    const out = new Map<string, CaseRecord>();
    for (const r of caseRows) {
      if (!r.case_id) continue;
      const meta = {} as Record<string, unknown>;
      for (const k of CASE_COLUMNS) {
        if (k === 'core_done' || k === 'core_total' || k.endsWith('_json')) continue;
        meta[k] = k === 'is_deleted' ? bool(r[k]) : NUMBER_META.has(k) ? num(r[k]) : fromCell(r[k]);
      }
      const additional = json<Record<string, CaseRecord['additional'][number]>>(r.additional_json, {});
      out.set(String(r.case_id), {
        meta: meta as unknown as CaseMeta,
        rows: {},
        additional: Object.values(additional).sort((a, b) => a.created_at.localeCompare(b.created_at)),
        not_available: json(r.not_available_json, {}),
        history: [],
      });
    }
    for (const r of tabRows) {
      const rec = out.get(String(r.case_id));
      const def = this.config.dict.entities[String(r.record_type)];
      if (!rec || !def) continue;
      const row = { _id: String(r.row_id), _created_at: String(r.created_at ?? ''), _created_by: String(r.created_by ?? ''), _updated_at: String(r.updated_at ?? ''), _updated_by: String(r.updated_by ?? '') } as StoredRow;
      if (bool(r.deleted)) row._deleted = true;
      for (const f of def.fields) row[f.name] = fromCell(r[col(def.entity, f.name)]);
      if (r.procedure_id && !def.fields.some((f) => f.name === 'procedure_id')) row.procedure_id = String(r.procedure_id);
      (rec.rows[def.entity] ??= []).push(row);
    }
    for (const h of histRows) {
      const rec = out.get(String(h.case_id));
      if (!rec) continue;
      const e: HistoryEntry = { id: String(h.id), at: String(h.at), by: String(h.by), kind: String(h.kind) as HistoryEntry['kind'] };
      for (const k of ['where', 'entity', 'field', 'row_id', 'text'] as const) if (h[k] !== '' && h[k] !== undefined) e[k] = String(h[k]);
      if (h.old_json !== '' && h.old_json !== undefined) e.old = json(h.old_json, null);
      if (h.new_json !== '' && h.new_json !== undefined) e.new = json(h.new_json, null);
      rec.history!.push(e);
    }
    return [...out.values()];
  }

  /** Every case (lists, counts). History is not read here; it is read with one case (getCase). */
  async listCases() {
    const tabs = this.entityTabs();
    const res = await this.batch([{ op: 'read', tab: 'Cases' }, ...tabs.map((tab) => ({ op: 'read', tab }))]);
    return this.assemble(res[0].rows ?? [], res.slice(1).flatMap((r) => r.rows ?? []), []);
  }

  async getCase(id: string) {
    const where = { col: 'case_id', in: [id] };
    const tabs = this.entityTabs();
    const res = await this.batch([{ op: 'read', tab: 'Cases', where }, ...tabs.map((tab) => ({ op: 'read', tab, where })), { op: 'read', tab: 'History', where }]);
    return this.assemble(res[0].rows ?? [], res.slice(1, -1).flatMap((r) => r.rows ?? []), res[res.length - 1].rows ?? [])[0] ?? null;
  }

  private rowCells(entity: string, caseId: string, set: Partial<StoredRow>, created: boolean): SheetRow {
    const def = this.config.dict.entities[entity];
    const out: SheetRow = {};
    for (const [k, v] of Object.entries(set)) {
      if (ROW_META[k]) out[ROW_META[k]] = k === '_deleted' ? !!v : toCell(v);
      else if (def.fields.some((f) => f.name === k)) out[col(entity, k)] = toCell(v);
      else if (k === 'procedure_id') out.procedure_id = toCell(v);
    }
    if (created) Object.assign(out, { row_key: rowKey(caseId, entity, String(set._id)), case_id: caseId, record_type: entity, procedure_id: toCell(set.procedure_id), deleted: !!set._deleted });
    return out;
  }

  private historyCells(caseId: string, h: Partial<HistoryEntry>, created: boolean): SheetRow {
    const out: SheetRow = {};
    for (const [k, v] of Object.entries(h)) {
      if (k === 'old' || k === 'new') out[`${k}_json`] = v === undefined ? '' : JSON.stringify(v);
      else out[k] = toCell(v);
    }
    if (created) out.case_id = caseId;
    return out;
  }

  /** Writes what changed from `base` (null = new case). Without base the stored copy is read first. */
  async putCase(rec: CaseRecord, base?: CaseRecord | null) {
    const before = base === undefined ? await this.getCase(rec.meta.case_id) : base;
    const p: CasePatch = diffCase(before, rec);
    if (isEmptyPatch(p)) return;
    const id = rec.meta.case_id;
    const ops: Op[] = [];
    const r = readinessOf(this.config.dict, rec);
    const meta: SheetRow = Object.fromEntries(Object.entries(p.meta).map(([k, v]) => [k, toCell(v)]));
    Object.assign(meta, { core_done: r.done, core_total: r.total });
    if (!before) {
      ops.push({ op: 'append', tab: 'Cases', rows: [meta] });
    } else ops.push({ op: 'update', tab: 'Cases', key: 'case_id', id, set: meta });

    const merge: Record<string, { set?: Record<string, unknown>; unset?: string[] }> = {};
    if (p.additional.length) merge.additional_json = { set: Object.fromEntries(p.additional.map((c) => [c.id, rec.additional.find((a) => a.info_id === c.id)])) };
    const na = Object.entries(p.not_available);
    if (na.length) merge.not_available_json = { set: Object.fromEntries(na.filter(([, v]) => v)), unset: na.filter(([, v]) => !v).map(([k]) => k) };
    if (Object.keys(merge).length) ops.push({ op: 'update', tab: 'Cases', key: 'case_id', id, merge });

    const appends = new Map<string, SheetRow[]>();
    for (const [entity, list] of Object.entries(p.rows)) {
      const tab = this.layout.tabOf[entity];
      for (const c of list) {
        if (c.created) appends.set(tab, [...(appends.get(tab) ?? []), this.rowCells(entity, id, c.set, true)]);
        else ops.push({ op: 'update', tab, key: 'row_key', id: rowKey(id, entity, c.id), set: this.rowCells(entity, id, c.set, false) });
      }
    }
    for (const [tab, rows] of appends) ops.push({ op: 'append', tab, rows });
    const newHist = p.history.filter((c) => c.created).map((c) => this.historyCells(id, c.set, true));
    if (newHist.length) ops.push({ op: 'append', tab: 'History', rows: newHist });
    for (const c of p.history.filter((x) => !x.created)) ops.push({ op: 'update', tab: 'History', key: 'id', id: c.id, set: this.historyCells(id, c.set, false) });
    await this.batch(ops);
  }
}
