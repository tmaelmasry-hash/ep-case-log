// Local JSON file store (this PC only, until the Google Sheet store in phase 4). Writes are atomic (temp file + rename).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryStore, emptyData, type StoreData } from './memory.ts';

export class FileStore extends MemoryStore {
  private file: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'registry.json');
    const data: StoreData = existsSync(file) ? { ...emptyData(), ...JSON.parse(readFileSync(file, 'utf8')) } : emptyData();
    super(data);
    this.kind = 'file';
    this.file = file;
  }

  protected override async persist(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    renameSync(tmp, this.file);
  }
}
