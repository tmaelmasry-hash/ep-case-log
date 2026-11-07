// The app's configuration (dictionary + case layout + site rules), built from the raw config/ files.
// Pure: Node reads the files from disk (server/dictionary.ts); the Cloudflare Worker imports them bundled.
import { buildDictionary, type CaseLayout, type CoreSpec, type Dictionary, type RawEntity } from '../shared/dictionary.ts';
import type { Amendments } from '../shared/amendments.ts';
import type { RulesConfig } from '../shared/rules.ts';
import type { MrnConfig } from '../shared/mrn.ts';
import { checkDashConfig, type DashConfig } from './domain/dashboard.ts';
import { checkFollowupConfig, type FollowupRule } from './domain/followups.ts';

export interface Site {
  timezone: string;
  mrn: MrnConfig;
  registry_basis_default: string;
  dashboard: DashConfig;
  ai: AiConfig;
  followup_due?: FollowupRule;
}

export interface AiProviderConfig {
  /** null: no key (Workers AI uses the Worker's binding). */
  api_key_env: string | null;
  model: string;
  price_usd_per_mtok: { input: number; output: number } | null;
  /** 2 = one request to pick the sections, one to extract (a provider with a small limit). */
  passes?: 1 | 2;
  /** The provider's per-minute token limit (Groq free plan: 8,000). A whole note larger than this is sent in parts, paced to fit. */
  tokens_per_minute?: number;
  /** Characters a token, to estimate a request before it is sent (measured on Groq, 5 Nov: about 2.7). */
  chars_per_token?: number;
}
export interface AiConfig {
  provider: string;
  passes?: 1 | 2;
  workers_ai: AiProviderConfig;
  groq: AiProviderConfig;
  anthropic: AiProviderConfig;
  gemini: AiProviderConfig;
  openai: AiProviderConfig;
  max_note_chars?: number;
  timeout_seconds?: number;
  monthly_cost_cap_usd?: number;
}

/** Synthetic sample notes (EP Workspace fixtures/notes): the Test AI answers these only. */
export interface AiFixture {
  id: string;
  title: string;
  identifiers: { mrn: string; name?: string; phone?: string };
  text: string[];
  expected: [string, string, unknown, string][];
  conflicts?: [string, string, string[], string[]][];
  additional_info?: string[];
  must_not?: unknown[];
}

export interface RawConfig {
  entities: Record<string, RawEntity>;
  extension: Record<string, unknown>;
  labels: { fields: Record<string, string>; codes: Record<string, string> };
  layout: CaseLayout;
  core: CoreSpec;
  site: Site;
  aiFixtures: { notes: AiFixture[] };
  amendments?: Amendments;
  localAmendments?: Amendments;
  rules?: RulesConfig;
}

export interface AppConfig {
  dict: Dictionary;
  site: Site;
  aiFixtures: AiFixture[];
}

export function buildAppConfig(raw: RawConfig): AppConfig {
  const dict = buildDictionary(raw);
  const site = raw.site;
  if (!dict.entities.PATIENTS.fields.find((f) => f.name === 'registry_basis')?.codes?.some((c) => c.code === site.registry_basis_default)) {
    throw new Error('config/site.json registry_basis_default is not a dictionary code');
  }
  checkDashConfig(dict, site.dashboard);
  checkFollowupConfig(dict, site.followup_due);
  return { dict, site, aiFixtures: raw.aiFixtures?.notes ?? [] };
}

/** Site-local calendar date (YYYY-MM-DD) — never UTC truncation. */
export function siteLocalDate(tz: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
