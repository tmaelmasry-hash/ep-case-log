// Picks the store for local Node runs from .env: file (default), memory, or sheets (the Google Sheet through
// the Apps Script gateway: APPS_SCRIPT_URL + GATEWAY_SECRET; SHEETS_TARGET=test for the TEST Sheet).
import type { AppConfig } from '../appconfig.ts';
import { FileStore } from './file.ts';
import { MemoryStore } from './memory.ts';
import { AppsScriptGateway, SheetsStore } from './sheets.ts';
import type { RegistryStore } from './types.ts';

export function storeFromEnv(config: AppConfig, env: NodeJS.ProcessEnv = process.env): RegistryStore {
  if (env.STORE === 'memory') return new MemoryStore();
  if (env.STORE === 'sheets') return sheetsFromEnv(config, env);
  return new FileStore(env.DATA_DIR || 'data');
}

export function sheetsFromEnv(config: AppConfig, env: NodeJS.ProcessEnv = process.env): SheetsStore {
  if (!env.APPS_SCRIPT_URL || !env.GATEWAY_SECRET) throw new Error('APPS_SCRIPT_URL and GATEWAY_SECRET must be set in .env');
  return new SheetsStore(config, new AppsScriptGateway(env.APPS_SCRIPT_URL, env.GATEWAY_SECRET, env.SHEETS_TARGET === 'test' ? 'test' : 'main'));
}
