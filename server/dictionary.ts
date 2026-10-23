// Loads config/ from disk (Node only). The Cloudflare Worker uses the bundled copy (scripts/build-config.ts).
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RawEntity } from '../shared/dictionary.ts';
import { buildAppConfig, type AppConfig, type RawConfig } from './appconfig.ts';

export { siteLocalDate, type Site } from './appconfig.ts';

const CONFIG = resolve(import.meta.dirname, '..', 'config');
const read = (p: string) => JSON.parse(readFileSync(join(CONFIG, p), 'utf8'));

export function readRawConfig(): RawConfig {
  const entities: Record<string, RawEntity> = {};
  for (const f of readdirSync(join(CONFIG, 'dictionary', 'entities')).sort()) if (f.endsWith('.json')) entities[f.slice(0, -5)] = read(`dictionary/entities/${f}`);
  return {
    entities,
    extension: read('dictionary/extension_entities.json'),
    labels: read('dictionary/labels.json'),
    layout: read('case_layout.json'),
    core: read('dictionary/core_dataset.json'),
    site: read('site.json'),
    aiFixtures: read('ai_fixtures.json'),
    amendments: read('dictionary/amendments.json'),
    rules: read('rules.json'),
  };
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  return (cached ??= buildAppConfig(readRawConfig()));
}
