// AI provider adapters (phase 11; copied from EP Workspace server/ai/providers.ts): fixture | anthropic | gemini | openai. Each turns (instructions, note,
// JSON schema) into JSON + token counts. The pipeline (extract.ts) owns the prompts, the checks and the draft;
// adapters own only the provider's request shape. Workers-safe: fetch, and the Anthropic SDK (fetch-based).
// Keys come only from Cloudflare environment variables; they never reach the browser or the Sheet.
import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../appconfig.ts';
import type { Env } from '../config.ts';

export type ProviderId = 'fixture' | 'anthropic' | 'gemini' | 'openai' | 'off';

export interface JsonCall { name: string; system: string; cacheable: string; user: string; schema: Record<string, unknown> }
export interface JsonResult { json: any; inputTokens: number; outputTokens: number }

export interface LlmProvider { id: Exclude<ProviderId, 'fixture' | 'off'>; model: string; label: string; json(call: JsonCall): Promise<JsonResult> }

export class AiError extends Error {
  code: string; status: number;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

const LABEL: Record<ProviderId, string> = { fixture: 'Test AI (fixture)', anthropic: 'Claude', gemini: 'Gemini', openai: 'OpenAI', off: 'Off' };

export interface AiChoice { provider: ProviderId; model: string | null; label: string; configured: boolean; reason: string | null }

/** Which provider runs: Settings (Admin) over config/site.json; a live provider needs its key in the environment. */
export function choose(cfg: AppConfig, env: Env, setting: { provider?: string; model?: string } | null): AiChoice {
  const ai = cfg.site.ai;
  const provider = (setting?.provider ?? ai.provider) as ProviderId;
  if (!(provider in LABEL)) return { provider: 'off', model: null, label: LABEL.off, configured: false, reason: 'Unknown AI provider in Settings.' };
  if (provider === 'off') return { provider, model: null, label: LABEL.off, configured: false, reason: 'The AI Assistant is switched off in Settings.' };
  if (provider === 'fixture') return { provider, model: null, label: LABEL.fixture, configured: true, reason: null };
  const model = setting?.model || ai[provider]?.model || null;
  const key = keyOf(env, provider);
  return {
    provider, model, label: `${LABEL[provider]} (${model})`, configured: !!key,
    reason: key ? null : `${LABEL[provider]} has no API key yet. The owner adds ${ai[provider]?.api_key_env ?? 'the key'} as a secret of the ep-case-log Worker (npx wrangler secret put ${ai[provider]?.api_key_env ?? 'NAME'}), or in .env when running on this computer.`,
  };
}

function keyOf(env: Env, p: ProviderId): string | undefined {
  return p === 'anthropic' ? env.anthropicKey : p === 'gemini' ? env.geminiKey : p === 'openai' ? env.openaiKey : undefined;
}

export function llm(cfg: AppConfig, env: Env, choice: AiChoice, fetchFn: typeof fetch = fetch): LlmProvider {
  const key = keyOf(env, choice.provider);
  if (!key || !choice.model) throw new AiError(503, 'AI_NOT_CONFIGURED', choice.reason ?? 'AI is not configured.');
  const timeout = (cfg.site.ai.timeout_seconds ?? 120) * 1000;
  const model = choice.model;
  const base = { model, label: choice.label };
  if (choice.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key, timeout, maxRetries: 1, fetch: fetchFn });
    return { ...base, id: 'anthropic', json: (c) => anthropicJson(client, model, c) };
  }
  if (choice.provider === 'gemini') return { ...base, id: 'gemini', json: (c) => geminiJson(fetchFn, key, model, timeout, c) };
  return { ...base, id: 'openai', json: (c) => openaiJson(fetchFn, key, model, timeout, c) };
}

function parse(text: string, who: string): any {
  try { return JSON.parse(text); } catch { throw new AiError(502, 'AI_BAD_ANSWER', `${who} answered something that is not the expected data. Try again.`); }
}

// ── Claude (Messages API, structured output) ──
async function anthropicJson(client: Anthropic, model: string, c: JsonCall): Promise<JsonResult> {
  try {
    const res = await client.beta.messages.create({
      model, max_tokens: 16000,
      // If a safety classifier declines, the API retries on a fallback model inside the same call.
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      system: [{ type: 'text', text: c.system }, { type: 'text', text: c.cacheable, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: c.user }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: c.schema } },
    });
    if (res.stop_reason === 'refusal') throw new AiError(502, 'AI_REFUSED', 'Claude declined this note. Nothing was filled.');
    if (res.stop_reason === 'max_tokens') throw new AiError(502, 'AI_TOO_LONG', 'The answer was cut off. Try a shorter note.');
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { json: parse(text, 'Claude'), inputTokens: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0), outputTokens: res.usage.output_tokens };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError(503, 'AI_KEY_REJECTED', 'Claude rejected the API key. The owner checks ANTHROPIC_API_KEY in Cloudflare.');
    if (e instanceof Anthropic.RateLimitError) throw new AiError(429, 'AI_BUSY', 'Claude is busy (rate limit). Try again in a minute.');
    if (e instanceof Anthropic.NotFoundError) throw new AiError(502, 'AI_MODEL_NOT_FOUND', 'Claude does not know this model id. The Admin checks the model in Settings → AI Assistant.');
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError(504, 'AI_TIMEOUT', 'Claude took too long. Try again, or a shorter note.');
    if (e instanceof Anthropic.APIError) throw new AiError(502, 'AI_ERROR', `Claude could not process the note (${e.status ?? 'no answer'}). Try again.`);
    throw e;
  }
}

// ── Gemini (generateContent, JSON output) ──
/** Gemini's responseSchema is an OpenAPI subset: no additionalProperties, upper-case types. */
function geminiSchema(s: any): any {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== 'object') return s;
  const out: any = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties') continue;
    out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : geminiSchema(v);
  }
  return out;
}

async function geminiJson(f: typeof fetch, key: string, model: string, timeout: number, c: JsonCall): Promise<JsonResult> {
  const res = await http(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, timeout, 'Gemini',
    { 'x-goog-api-key': key }, {
      systemInstruction: { parts: [{ text: `${c.system}\n\n${c.cacheable}` }] },
      contents: [{ role: 'user', parts: [{ text: c.user }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema(c.schema) },
    });
  const cand = res.candidates?.[0];
  if (!cand || (cand.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(cand.finishReason))) {
    throw new AiError(502, 'AI_REFUSED', `Gemini did not finish (${cand?.finishReason ?? 'no answer'}). Nothing was filled.`);
  }
  const text = (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  return { json: parse(text, 'Gemini'), inputTokens: res.usageMetadata?.promptTokenCount ?? 0, outputTokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0) };
}

// ── OpenAI (Responses API, strict JSON schema) ──
async function openaiJson(f: typeof fetch, key: string, model: string, timeout: number, c: JsonCall): Promise<JsonResult> {
  const res = await http(f, 'https://api.openai.com/v1/responses', timeout, 'OpenAI', { Authorization: `Bearer ${key}` }, {
    model, input: [{ role: 'system', content: `${c.system}\n\n${c.cacheable}` }, { role: 'user', content: c.user }],
    text: { format: { type: 'json_schema', name: c.name, schema: c.schema, strict: true } },
  });
  if (res.status === 'incomplete') throw new AiError(502, 'AI_TOO_LONG', 'The answer was cut off. Try a shorter note.');
  const parts = (res.output ?? []).filter((o: any) => o.type === 'message').flatMap((o: any) => o.content ?? []);
  if (parts.some((p: any) => p.type === 'refusal')) throw new AiError(502, 'AI_REFUSED', 'OpenAI declined this note. Nothing was filled.');
  const text = parts.filter((p: any) => p.type === 'output_text').map((p: any) => p.text).join('');
  return { json: parse(text, 'OpenAI'), inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
}

/** Waits between retries when the provider says it is overloaded (503) — common on free tiers. Tests set 0. */
export const RETRY_DELAYS_MS = [3000, 8000];

async function http(f: typeof fetch, url: string, timeout: number, who: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      if ((e as Error)?.name === 'TimeoutError') throw new AiError(504, 'AI_TIMEOUT', `${who} took too long. Try again, or a shorter note.`);
      throw new AiError(502, 'AI_UNREACHABLE', `${who} could not be reached. Try again.`);
    }
    // 503 = the provider is overloaded for a moment: wait and ask again (the same request; nothing was saved).
    if (res.status !== 503 || attempt >= RETRY_DELAYS_MS.length) break;
    await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
  }
  if (res.status === 401 || res.status === 403) throw new AiError(503, 'AI_KEY_REJECTED', `${who} rejected the API key. The owner checks it in Cloudflare.`);
  if (res.status === 429 || res.status === 503) {
    // The provider's own reason (e.g. per-minute vs per-day quota) helps the owner decide; no note text is in it.
    let why = '';
    try { why = String((await res.json())?.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 240); } catch { /* no body */ }
    const daily = /per ?day|PerDay|daily/i.test(why);
    throw new AiError(429, daily ? 'AI_QUOTA_DAY' : 'AI_BUSY', res.status === 503
      ? `${who} is overloaded right now (503). Try again in a minute.`
      : daily ? `${who}'s daily free quota is used up. It resets at midnight Pacific time (10:00 Riyadh). ${why}`.trim()
        : `${who} is busy (rate limit or free quota). Try again in a minute. ${why}`.trim());
  }
  if (res.status === 404) throw new AiError(502, 'AI_MODEL_NOT_FOUND', `${who} does not know this model id. The Admin checks the model in Settings → AI Assistant.`);
  if (!res.ok) throw new AiError(502, 'AI_ERROR', `${who} could not process the note (${res.status}). Try again.`);
  return res.json();
}
