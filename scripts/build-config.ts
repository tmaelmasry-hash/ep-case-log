// Bundles config/ into server/generated/raw-config.json for the Cloudflare Worker (it cannot read files).
// Run by `npm run deploy` and `npm run worker:check`; the file is generated, never edited.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAppConfig } from '../server/appconfig.ts';
import { readRawConfig } from '../server/dictionary.ts';

const raw = readRawConfig();
buildAppConfig(raw); // fails here, not on Cloudflare, if the config is inconsistent
const dir = resolve(import.meta.dirname, '..', 'server', 'generated');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'raw-config.json'), JSON.stringify(raw));
console.log(`server/generated/raw-config.json: ${Object.keys(raw.entities).length} entities`);
