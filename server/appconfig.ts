// The app's configuration (dictionary + case layout + site rules), built from the raw config/ files.
// Pure: Node reads the files from disk (server/dictionary.ts); the Cloudflare Worker imports them bundled.
import { buildDictionary, type CaseLayout, type CoreSpec, type Dictionary, type RawEntity } from '../shared/dictionary.ts';
import type { MrnConfig } from '../shared/mrn.ts';
import { checkDashConfig, type DashConfig } from './domain/dashboard.ts';

export interface Site {
  timezone: string;
  mrn: MrnConfig;
  registry_basis_default: string;
  dashboard: DashConfig;
}

export interface RawConfig {
  entities: Record<string, RawEntity>;
  extension: Record<string, unknown>;
  labels: { fields: Record<string, string>; codes: Record<string, string> };
  layout: CaseLayout;
  core: CoreSpec;
  site: Site;
}

export interface AppConfig {
  dict: Dictionary;
  site: Site;
}

export function buildAppConfig(raw: RawConfig): AppConfig {
  const dict = buildDictionary(raw);
  const site = raw.site;
  if (!dict.entities.PATIENTS.fields.find((f) => f.name === 'registry_basis')?.codes?.some((c) => c.code === site.registry_basis_default)) {
    throw new Error('config/site.json registry_basis_default is not a dictionary code');
  }
  checkDashConfig(dict, site.dashboard);
  return { dict, site };
}

/** Site-local calendar date (YYYY-MM-DD) — never UTC truncation. */
export function siteLocalDate(tz: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
