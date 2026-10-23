// AI Assistant (phase 11; ported from EP Workspace routes/ai.ts): status, extract & autofill inside one case only,
// review, and the Admin's provider choice. The note travels only in the request body, is never stored or logged,
// and only its de-identified text is sent to the provider.
import { aiRunSummary, applyExtraction, fixtureExtract, llmExtract, pendingKeys, reviewAi, type RawExtraction, type ReviewAction } from '../ai/extract.ts';
import { AiError, choose, llm, type ProviderId } from '../ai/providers.ts';
import { mrnsInNote, redact } from '../ai/redact.ts';
import { addNewRow, liveRows, toDetail, type Actor } from '../domain/cases.ts';
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

const PROVIDERS: ProviderId[] = ['fixture', 'anthropic', 'gemini', 'openai', 'off'];

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
      providers: PROVIDERS.map((p) => ({ id: p, model: p === 'fixture' || p === 'off' ? null : (ai[p]?.model ?? null), key_set: p === 'fixture' || p === 'off' ? null : choose(config, env, { provider: p }).configured })),
      sample_notes: choice.provider === 'fixture' ? config.aiFixtures.map((f) => ({ id: f.id, title: f.title })) : [],
    };
  });

  /** One synthetic sample note's text (Test AI only), so the Assistant can be tried without real notes. */
  app.get('/api/ai/sample/:id', async (req) => {
    requireCap(req, 'ai.extract');
    const fx = config.aiFixtures.find((f) => f.id === req.params.id);
    if (!fx) throw notFound('Unknown sample note.');
    return { id: fx.id, title: fx.title, mrn: fx.identifiers.mrn, text: fx.text.join('\n') };
  });

  app.post('/api/cases/:id/ai/extract', async (req) => {
    const u = requireCap(req, 'ai.extract');
    const b = req.body ?? {};
    const note = String(b.note ?? '');
    if (!note.trim()) throw badRequest('Paste a clinical note first.', { field: 'note' });
    const max = ai.max_note_chars ?? 20000;
    if (note.length > max) throw badRequest(`The note is too long (${note.length.toLocaleString()} characters; at most ${max.toLocaleString()}). Split it.`, { field: 'note' });
    const [{ choice, usage }, rec] = await Promise.all([state(), requireOpenCase(req)]);
    if (!choice.configured) throw new HttpError(503, 'AI_NOT_CONFIGURED', choice.reason ?? 'AI is not configured.');
    const cap = Number(ai.monthly_cost_cap_usd ?? 0);
    if (choice.provider !== 'fixture' && cap > 0 && usage.cost_usd >= cap) throw new HttpError(429, 'AI_CAP', `This month's AI budget (US$ ${cap}) is used up. The Admin can raise it in config/site.json, or wait for next month.`);
    // A note that names another MRN stops here — nothing is sent to the provider, nothing is filled.
    const other = mrnsInNote(note).filter((m) => m !== rec.meta.mrn);
    if (other.length) throw new HttpError(409, 'MRN_MISMATCH', `This note names MRN ${other[0]}, but this case is MRN ${rec.meta.mrn}. Nothing was sent or filled. Open the right patient's case.`, { found: other });
    // Which procedure the note describes: one of the case's procedures, a new one, or none (case data only).
    const procs = liveRows(rec, 'EP_PROCEDURES').map((p) => p._id);
    const target = b.procedure_id === 'new' ? 'new' : b.procedure_id ? String(b.procedure_id) : null;
    if (target && target !== 'new' && !procs.includes(target)) throw badRequest('Choose one of this case\'s procedures.', { field: 'procedure_id' });

    const fullName = (liveRows(rec, 'PATIENT_IDENTIFIERS')[0]?.full_name as string | undefined) ?? null;
    const red = redact(note, { mrn: rec.meta.mrn, fullName });
    let raw: RawExtraction;
    let tokens = { input: 0, output: 0 };
    let recognised = true;
    if (choice.provider === 'fixture') {
      const fx = fixtureExtract(config, red.text);
      recognised = !!fx;
      raw = fx?.raw ?? { proposals: [], conflicts: [], additional_info: [] };
    } else {
      try {
        const r = await llmExtract(config, llm(config, env, choice), red.text);
        raw = r.raw;
        tokens = { input: r.inputTokens, output: r.outputTokens };
      } catch (e) {
        if (e instanceof AiError) throw new HttpError(e.status, e.code, e.message);
        throw e;
      }
    }

    const base = structuredClone(rec);
    const a: Actor = { userId: u.userId, now: ctx.now().toISOString() };
    const procedureId = target === 'new' ? addNewRow(config.dict, rec, 'EP_PROCEDURES', null, a)._id : target;
    const items = applyExtraction(config.dict, rec, raw, red.text, procedureId, a);
    const s = aiRunSummary(items);
    if (s.filled || s.conflicts || s.additional || target === 'new') {
      Object.assign(rec.meta, { updated_at: a.now, updated_by: a.userId, row_version: rec.meta.row_version + 1 });
      rec.meta.collector_user_id ??= a.userId;
      await store.putCase(rec, base);
    }
    // Counts only: never the note or its text.
    await store.appendActivity([{ actor: u.userId, action: 'ai.extract', detail: { case_id: rec.meta.case_id, provider: choice.provider, model: choice.model, ...s, removed: red.removed, note_chars: note.length, tokens } }]);
    if (choice.provider !== 'fixture') {
      const price = ai[choice.provider as 'anthropic' | 'gemini' | 'openai']?.price_usd_per_mtok;
      const cost = price ? (tokens.input * price.input + tokens.output * price.output) / 1e6 : 0;
      await store.setSetting(
        'ai_usage',
        { month: usage.month, runs: usage.runs + 1, input_tokens: usage.input_tokens + tokens.input, output_tokens: usage.output_tokens + tokens.output, cost_usd: Math.round((usage.cost_usd + cost) * 10000) / 10000 },
        u.userId,
      );
    }
    return { provider: choice.label, recognised, summary: s, items, removed: red.removed, procedure_id: procedureId, case: await detail(rec) };
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

  /** Admin: which provider and model run (keys stay in the Worker's secrets / .env). */
  app.post('/api/settings/ai', async (req) => {
    const u = requireCap(req, 'settings.manage');
    const b = req.body ?? {};
    if (!PROVIDERS.includes(b.provider)) throw badRequest(`provider must be one of ${PROVIDERS.join(', ')}`);
    if (b.model !== undefined && b.model !== null && b.model !== '' && !/^[A-Za-z0-9._:\-/]{3,80}$/.test(String(b.model))) throw badRequest('Model id looks wrong.');
    const value: AiSetting = { provider: b.provider, ...(b.model ? { model: String(b.model) } : {}) };
    await store.setSetting('ai', value, u.userId);
    await store.appendActivity([{ actor: u.userId, action: 'settings.ai', detail: value }]);
    const c = choose(config, env, value);
    return { provider: c.provider, label: c.label, configured: c.configured, reason: c.reason };
  });
}
