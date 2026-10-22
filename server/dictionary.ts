// Loads the dictionary-generated forms and the case layout from config/ (server side).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildDictionary, type Dictionary, type RawEntity } from '../shared/dictionary.ts';
import type { MrnConfig } from '../shared/mrn.ts';

const CONFIG = resolve(import.meta.dirname, '..', 'config');
const read = (p: string) => JSON.parse(readFileSync(join(CONFIG, p), 'utf8'));

export interface Site {
  timezone: string;
  mrn: MrnConfig;
  registry_basis_default: string;
}

let cached: { dict: Dictionary; site: Site } | null = null;

export function loadConfig(): { dict: Dictionary; site: Site } {
  if (cached) return cached;
  const entities: Record<string, RawEntity> = {};
  for (const f of readdirSync(join(CONFIG, 'dictionary', 'entities'))) if (f.endsWith('.json')) entities[f.slice(0, -5)] = read(`dictionary/entities/${f}`);
  const dict = buildDictionary({
    entities,
    extension: read('dictionary/extension_entities.json'),
    labels: read('dictionary/labels.json'),
    layout: read('case_layout.json'),
    core: read('dictionary/core_dataset.json'),
  });
  const site = read('site.json') as Site;
  if (!dict.entities.PATIENTS.fields.find((f) => f.name === 'registry_basis')?.codes?.some((c) => c.code === site.registry_basis_default)) {
    throw new Error('config/site.json registry_basis_default is not a dictionary code');
  }
  cached = { dict, site };
  return cached;
}

/** Site-local calendar date (YYYY-MM-DD) — never UTC truncation. */
export function siteLocalDate(tz: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
