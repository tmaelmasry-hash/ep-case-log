// AI Assistant (phase 11; ported from EP Workspace routes/ai.ts): status, the "what will be sent" preview, extract &
// autofill inside one case only, review, and the Admin's provider choice. The note travels only in the request body, is never stored or logged,
// and only its de-identified text is sent to the provider.
import { aiSections } from '../ai/catalogue.ts';
import { aiRunSummary, applyAccepted, applyExtraction, applyToNewProcedure, fixtureExtract, flagCancelled, llmExtract, onlySections, pendingKeys, reviewAi, type RawExtraction, type RawProposal, type ReviewAction } from '../ai/extract.ts';
import { AiError, choose, llm, type ProviderId } from '../ai/providers.ts';
import { mrnsInNote, redact } from '../ai/redact.ts';
import { liveRows, toDetail, type Actor } from '../domain/cases.ts';
import { HttpError, badRequest, groupIdsFor, notFound, requireCap, type Req, type Router } from '../http.ts';
import type { CaseRecord } from '../../shared/caseTypes.ts';

interface AiSetting {
  provider?: ProviderId;
  model?: string;
}
interface AiUsage {
  month: string;
  runs: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

const PROVIDERS: ProviderId[] = ['workers_ai', 'groq', 'fixture', 'anthropic', 'gemini', 'openai', 'off'];
/** Providers with no key to set. */
const NO_KEY: ProviderId[] = ['workers_ai', 'fixture', 'off'];

export function aiRoutes(app: Router) {
  const { ctx } = app;
  const { store, config, env } = ctx;
  const ai = config.site.ai;
  const month = () => ctx.now().toISOString().slice(0, 7);
  const usageNow = (u: AiUsage | null): AiUsage => (u && u.month === month() ? u : { month: month(), runs: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 });
  const state = async () => {
    const [setting, usage] = await Promise.all([store.getSetting<AiSetting | null>('ai', null), store.getSetting<AiUsage | null>('ai_usage', null)]);
    return { choice: choose(config, env, setting), usage: usageNow(usage) };
  };

  async function requireOpenCase(req: Req): Promise<CaseRecord> {
    const rec = await store.getCase(req.params.id);
    if (!rec || rec.meta.is_deleted || !(await groupIdsFor(ctx, req.user!)).includes(rec.meta.group_id)) throw notFound('Case not found.');
    if (rec.meta.collection_status === 'COMPLETED') throw new HttpError(409, 'CASE_COMPLETED', 'This case is completed. Reopen it to make changes.');
    return rec;
  }

  async function detail(rec: CaseRecord) {
    const [groups, users] = await Promise.all([store.listGroups(), store.listUsers()]);
    const names = new Map(users.map((u) => [u.user_id, u.display_name]));
    return toDetail(
      config.dict,
      rec,
      groups.find((g) => g.group_id === rec.meta.group_id)?.name ?? '',
      users.filter((u) => u.status === 'ACTIVE').map((u) => ({ id: u.user_id, name: u.display_name })),
      (id) => names.get(id) ?? 'Unknown',
    );
  }

  app.get('/api/ai/status', async (req) => {
    requireCap(req, 'case.read');
    const { choice, usage } = await state();
    return {
      provider: choice.provider,
      label: choice.label,
      model: choice.model,
      configured: choice.configured,
      reason: choice.reason,
      max_note_chars: ai.max_note_chars ?? 20000,
      usage,
      monthly_cost_cap_usd: ai.monthly_cost_cap_usd ?? null,
      providers: PROVIDERS.map((p) => ({ id: p, model: p === 'fixture' || p === 'off' ? null : (ai[p]?.model ?? null), key_set: NO_KEY.includes(p) ? null : choose(config, env, { provider: p }).configured })),
    };
  });

  function checkLength(text: string, field: string) {
    const max = ai.max_note_chars ?? 20000;
    if (text.length > max) throw badRequest(`The note is too long (${text.length.toLocaleString()} characters; at most ${max.toLocaleString()}). Split it.`, { field });
  }

  /** A note that names another MRN stops here — nothing is sent to the provider, nothing is filled. */
  function checkMrn(text: string, rec: CaseRecord) {
    const other = mrnsInNote(text).filter((m) => m !== rec.meta.mrn);
    if (other.length) throw new HttpError(409, 'MRN_MISMATCH', `This note names MRN ${other[0]}, but this case is MRN ${rec.meta.mrn}. Nothing was sent or filled. Open the right patient's case.`, { found: other });
  }

  const savedName = (rec: CaseRecord) => (liveRows(rec, 'PATIENT_IDENTIFIERS')[0]?.full_name as string | undefined) ?? null;

  /** "This is what will be sent": the de-identified text and counts. No provider is called; nothing is stored or logged. */
  app.post('/api/cases/:id/ai/preview', async (req) => {
    requireCap(req, 'ai.extract');
    const note = String(req.body?.note ?? '');
    if (!note.trim()) throw badRequest('Paste a clinical note first.', { field: 'note' });
    checkLength(note, 'note');
    const [{ choice }, rec] = await Promise.all([state(), requireOpenCase(req)]);
    if (!choice.configured) throw new HttpError(503, 'AI_NOT_CONFIGURED', choice.reason ?? 'AI is not configured.');
    checkMrn(note, rec);
    const red = redact(note, { mrn: rec.meta.mrn, fullName: savedName(rec) });
    return { text: red.text, removed: red.removed };
  });

  /** note = what the person pasted (for the MRN check). sent_text = the text they read and edited; without it, the note itself. */
  app.post('/api/cases/:id/ai/extract', async (req) => {
    const u = requireCap(req, 'ai.extract');
    const b = req.body ?? {};
    const note = String(b.note ?? '');
    if (!note.trim()) throw badRequest('Paste a clinical note first.', { field: 'note' });
    checkLength(note, 'note');
    const sentText = b.sent_text === undefined ? note : String(b.sent_text);
    if (!sentText.trim()) throw badRequest('The text to send is empty.', { field: 'sent_text' });
    checkLength(sentText, 'sent_text');
    const [{ choice, usage }, rec] = await Promise.all([state(), requireOpenCase(req)]);
    if (!choice.configured) throw new HttpError(503, 'AI_NOT_CONFIGURED', choice.reason ?? 'AI is not configured.');
    const cap = Number(ai.monthly_cost_cap_usd ?? 0);
    if (choice.provider !== 'fixture' && cap > 0 && usage.cost_usd >= cap) throw new HttpError(429, 'AI_CAP', `This month's AI budget (US$ ${cap}) is used up. The Admin can raise it in config/site.json, or wait for next month.`);
    checkMrn(note, rec);
    checkMrn(sentText, rec); // someone may have typed another MRN while editing
    // Which procedure the note describes: one of the case's procedures, a new one, or none (case data only).
    const procs = liveRows(rec, 'EP_PROCEDURES').map((p) => p._id);
    const target = b.procedure_id === 'new' ? 'new' : b.procedure_id ? String(b.procedure_id) : null;
    if (target && target !== 'new' && !procs.includes(target)) throw badRequest('Choose one of this case\'s procedures.', { field: 'procedure_id' });
    // Opened from one section: only that section's fields are asked for and kept.
    const known = aiSections(config.dict).map((s) => s.id);
    const only = Array.isArray(b.sections) ? (b.sections as unknown[]).map(String) : [];
    if (only.some((s) => !known.includes(s))) throw badRequest('Unknown section.', { field: 'sections' });
    // Which procedure tables to ask about: the screen's choice, else the procedure's own components, else the type planned in Bulk Add. None known: all of them.
    const typeCodes = (config.dict.entities.PROCEDURE_COMPONENTS.fields.find((f) => f.name === 'component_type')?.codes ?? []).map((c) => c.code);
    const chosen = Array.isArray(b.component_types) ? (b.component_types as unknown[]).map(String) : [];
    if (chosen.some((t) => !typeCodes.includes(t))) throw badRequest('Unknown procedure type.', { field: 'component_types' });
    const own = target && target !== 'new' ? liveRows(rec, 'PROCEDURE_COMPONENTS').filter((c) => c.procedure_id === target).map((c) => String(c.component_type)) : [];
    const planned = target === 'new' && rec.meta.planned_type ? [rec.meta.planned_type] : [];
    const types = chosen.length ? chosen : own.length ? own : planned;

    // De-identified again here, whatever came back from the browser: this text is what the provider sees and what the quotes are checked against.
    const red = redact(sentText, { mrn: rec.meta.mrn, fullName: savedName(rec) });
    let raw: RawExtraction;
    let tokens = { input: 0, output: 0 };
    let recognised = true;
    if (choice.provider === 'fixture') {
      const fx = fixtureExtract(config, red.text);
      recognised = !!fx;
      raw = fx?.raw ?? { proposals: [], conflicts: [], additional_info: [] };
      if (only.length) raw = onlySections(config, raw, only, types);
    } else {
      try {
        const r = await llmExtract(config, llm(config, env, choice), red.text, only, types);
        raw = r.raw;
        tokens = { input: r.inputTokens, output: r.outputTokens };
      } catch (e) {
        if (e instanceof AiError) throw new HttpError(e.status, e.code, e.message);
        throw e;
      }
    }

    // Tried on a copy: nothing reaches the Sheet until a person accepts it (owner, 4 Nov).
    const copy = structuredClone(rec);
    const a: Actor = { userId: u.userId, now: ctx.now().toISOString() };
    const tried = target === 'new' ? applyToNewProcedure(config.dict, copy, raw, red.text, a).items : applyExtraction(config.dict, copy, raw, red.text, target, a);
    const items = flagCancelled(config.dict, rec, target, tried);
    const s = aiRunSummary(items);
    // Counts only: never the note or its text.
    await store.appendActivity([{ actor: u.userId, action: 'ai.extract', detail: { case_id: rec.meta.case_id, provider: choice.provider, model: choice.model, ...s, removed: red.removed, note_chars: note.length, tokens } }]);
    if (choice.provider !== 'fixture') {
      const price = ai[choice.provider as 'workers_ai' | 'groq' | 'anthropic' | 'gemini' | 'openai']?.price_usd_per_mtok;
      const cost = price ? (tokens.input * price.input + tokens.output * price.output) / 1e6 : 0;
      await store.setSetting(
        'ai_usage',
        { month: usage.month, runs: usage.runs + 1, input_tokens: usage.input_tokens + tokens.input, output_tokens: usage.output_tokens + tokens.output, cost_usd: Math.round((usage.cost_usd + cost) * 10000) / 10000 },
        u.userId,
      );
    }
    return { provider: choice.label, recognised, summary: s, items, removed: red.removed, target };
  });

  /** Saves what a person accepted from a note, in one save. row_ids keeps rows made by an earlier batch from the same note. */
  app.post('/api/cases/:id/ai/apply', async (req) => {
    const u = requireCap(req, 'case.edit');
    const b = req.body ?? {};
    const values: RawProposal[] = Array.isArray(b.values) ? b.values : [];
    const additional: { text: string; evidence: string }[] = Array.isArray(b.additional) ? b.additional : [];
    if (values.length + additional.length < 1 || values.length + additional.length > 500) throw badRequest('values must be a list of 1–500 items.');
    for (const v of values) if (typeof v?.entity !== 'string' || typeof v?.field !== 'string') throw badRequest('Each value needs an entity and a field.');
    const rec = await requireOpenCase(req);
    const procs = liveRows(rec, 'EP_PROCEDURES').map((p) => p._id);
    const target = b.procedure_id === 'new' ? 'new' : b.procedure_id ? String(b.procedure_id) : null;
    if (target && target !== 'new' && !procs.includes(target)) throw badRequest('This procedure is no longer in the case.', { field: 'procedure_id' });
    const rowIds = new Map<string, string>(Object.entries(b.row_ids ?? {}).map(([k, v]) => [k, String(v)]));
    const base = structuredClone(rec);
    const a: Actor = { userId: u.userId, now: ctx.now().toISOString() };
    const raw: RawExtraction = { proposals: values.map((v) => ({ entity: v.entity, field: v.field, value: v.value, row: String(v.row ?? ''), evidence: String(v.evidence ?? ''), overwrite: v.overwrite === true })), conflicts: [], additional_info: additional };
    const { rec: done, procedureId, items } = applyAccepted(config.dict, rec, target, raw, rowIds, a);
    const s = aiRunSummary(items);
    if (s.filled || s.additional) {
      Object.assign(done.meta, { updated_at: a.now, updated_by: a.userId, row_version: done.meta.row_version + 1 });
      done.meta.collector_user_id ??= a.userId;
      await store.putCase(done, base, [{ actor: u.userId, action: 'ai.review', detail: { case_id: done.meta.case_id, done: s.filled + s.additional } }]);
    }
    return { procedure_id: procedureId, row_ids: Object.fromEntries(rowIds), summary: s, items, case: await detail(done) };
  });

  /** Accept / reject AI values, or choose for a conflict. accept_all = accept every value still waiting. */
  app.post('/api/cases/:id/ai/review', async (req) => {
    const u = requireCap(req, 'case.edit');
    const b = req.body ?? {};
    const list: ReviewAction[] | null = Array.isArray(b.actions) ? b.actions : null;
    if (!b.accept_all && (!list || !list.length || list.length > 500)) throw badRequest('actions must be a list of 1–500 items');
    for (const x of list ?? []) if (typeof x?.key !== 'string' || !['accept', 'reject', 'keep', 'use'].includes(x.action)) throw badRequest('Each action needs a key and accept, reject, keep or use.');
    const rec = await requireOpenCase(req);
    const base = structuredClone(rec);
    const a: Actor = { userId: u.userId, now: ctx.now().toISOString() };
    const actions = b.accept_all ? pendingKeys(rec).map((key) => ({ key, action: 'accept' as const })) : list!;
    const r = reviewAi(config.dict, rec, actions, a);
    if (r.done) {
      Object.assign(rec.meta, { updated_at: a.now, updated_by: a.userId, row_version: rec.meta.row_version + 1 });
      await store.putCase(rec, base, [{ actor: u.userId, action: 'ai.review', detail: { case_id: rec.meta.case_id, done: r.done } }]);
    }
    return { ...r, case: await detail(rec) };
  });

  /** Admin: show or hide the AI Assistant in every case (owner step 6). */
  app.post('/api/settings/ui', async (req) => {
    const u = requireCap(req, 'settings.manage');
    const b = req.body ?? {};
    if (typeof b.ai_visible !== 'boolean') throw badRequest('ai_visible must be true or false.');
    const value = { ...(await store.getSetting<Record<string, unknown> | null>('ui', null)), ai_visible: b.ai_visible };
    await store.setSetting('ui', value, u.userId);
    await store.appendActivity([{ actor: u.userId, action: 'settings.ui', detail: { ai_visible: b.ai_visible } }]);
    return { ok: true, ai_visible: b.ai_visible };
  });

  /** Admin: which provider and model run (keys stay in the Worker's secrets / .env). */
  app.post('/api/settings/ai', async (req) => {
    const u = requireCap(req, 'settings.manage');
    const b = req.body ?? {};
    if (!PROVIDERS.includes(b.provider)) throw badRequest(`provider must be one of ${PROVIDERS.join(', ')}`);
    if (b.model !== undefined && b.model !== null && b.model !== '' && !/^[A-Za-z0-9._:@\-/]{3,80}$/.test(String(b.model))) throw badRequest('Model id looks wrong.');
    const value: AiSetting = { provider: b.provider, ...(b.model ? { model: String(b.model) } : {}) };
    await store.setSetting('ai', value, u.userId);
    await store.appendActivity([{ actor: u.userId, action: 'settings.ai', detail: value }]);
    const c = choose(config, env, value);
    return { provider: c.provider, label: c.label, configured: c.configured, reason: c.reason };
  });
}
