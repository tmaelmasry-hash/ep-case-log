// The store the server tests run against: in memory, or (TEST_STORE=sheets) the Google Sheet store talking to the
// real apps-script/Code.js on a fake spreadsheet. Both runs use the same tests (see vite.config.ts workspace).
import { loadConfig } from '../../server/dictionary.ts';
import { MemoryStore } from '../../server/store/memory.ts';
import { SheetsStore } from '../../server/store/sheets.ts';
import type { RegistryStore } from '../../server/store/types.ts';
import { FakeAppsScript } from './fakeGoogle.ts';

export async function makeTestStore(): Promise<RegistryStore> {
  if (process.env.TEST_STORE !== 'sheets') return new MemoryStore();
  const google = new FakeAppsScript();
  await google.call('init');
  const store = new SheetsStore(loadConfig(), google);
  await store.setup();
  return store;
}
