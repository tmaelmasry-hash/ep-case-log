// Test double for Google: runs the real apps-script/Code.js against an in-memory spreadsheet that behaves like
// SpreadsheetApp for the calls Code.js makes (text written with a leading apostrophe is stored as text; numbers
// and booleans stay as they are; empty cells read as ''). Synthetic data only.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Gateway } from '../../server/store/sheets.ts';

type V = string | number | boolean;

class FakeRange {
  private sh: FakeSheet;
  private r: number;
  private c: number;
  private nr: number;
  private nc: number;
  constructor(sh: FakeSheet, r: number, c: number, nr: number, nc: number) {
    this.sh = sh;
    this.r = r;
    this.c = c;
    this.nr = nr;
    this.nc = nc;
  }
  getValues(): V[][] {
    return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.sh.get(this.r + i, this.c + j)));
  }
  getValue(): V {
    return this.sh.get(this.r, this.c);
  }
  setValues(vals: V[][]) {
    if (vals.length !== this.nr || vals.some((row) => row.length !== this.nc)) throw new Error('range size mismatch');
    vals.forEach((row, i) => row.forEach((v, j) => this.sh.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v: V) {
    this.sh.set(this.r, this.c, v);
    return this;
  }
  clearContent() {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, '');
    return this;
  }
  setFontWeight() {
    return this;
  }
}

export class FakeSheet {
  cells = new Map<string, V>();
  maxRows = 1000;
  maxCols = 26;
  frozen = 0;
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  get(r: number, c: number): V {
    return this.cells.get(`${r},${c}`) ?? '';
  }
  set(r: number, c: number, v: V) {
    if (r > this.maxRows || c > this.maxCols) throw new Error(`write outside the sheet (${r},${c})`);
    const val = typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v === null || v === undefined ? '' : v;
    if (val === '') this.cells.delete(`${r},${c}`);
    else this.cells.set(`${r},${c}`, val);
  }
  getName() {
    return this.name;
  }
  getLastRow() {
    let n = 0;
    for (const k of this.cells.keys()) n = Math.max(n, Number(k.split(',')[0]));
    return n;
  }
  getLastColumn() {
    let n = 0;
    for (const k of this.cells.keys()) n = Math.max(n, Number(k.split(',')[1]));
    return n;
  }
  getMaxColumns() {
    return this.maxCols;
  }
  getMaxRows() {
    return this.maxRows;
  }
  insertColumnsAfter(_after: number, n: number) {
    this.maxCols += n;
  }
  insertRowsAfter(_after: number, n: number) {
    this.maxRows += n;
  }
  getRange(r: number, c: number, nr = 1, nc = 1) {
    return new FakeRange(this, r, c, nr, nc);
  }
  getFrozenRows() {
    return this.frozen;
  }
  setFrozenRows(n: number) {
    this.frozen = n;
  }
  deleteRows(from: number, n: number) {
    const next = new Map<string, V>();
    for (const [k, v] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      if (r < from) next.set(k, v);
      else if (r >= from + n) next.set(`${r - n},${c}`, v);
    }
    this.cells = next;
  }
  deleteColumn(cn: number) {
    const next = new Map<string, V>();
    for (const [k, v] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      if (c < cn) next.set(k, v);
      else if (c > cn) next.set(`${r},${c - 1}`, v);
    }
    this.cells = next;
  }
}

class FakeBook {
  sheets: FakeSheet[] = [new FakeSheet('Sheet1')];
  id: string;
  name: string;
  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getSheetByName(n: string) {
    return this.sheets.find((s) => s.name === n) ?? null;
  }
  insertSheet(n: string) {
    const s = new FakeSheet(n);
    this.sheets.push(s);
    return s;
  }
  getSheets() {
    return [...this.sheets];
  }
  deleteSheet(s: FakeSheet) {
    this.sheets = this.sheets.filter((x) => x !== s);
  }
  setSpreadsheetTimeZone() {}
}

/** A fresh fake Google account with one registry Sheet and the real Code.js loaded as its web app. */
export class FakeAppsScript implements Gateway {
  props = new Map<string, string>();
  book = new FakeBook('main-sheet-id', 'EP Case Log (fake)');
  calls = 0;
  private doPost: (e: unknown) => { content: string };
  private secret: string;

  constructor(secret = 'fake-gateway-secret-0123456789-abcdefghijkl') {
    this.secret = secret;
    this.props.set('MAIN_ID', this.book.id);
    const props = this.props;
    const book = this.book;
    const globals = {
      PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props.get(k) ?? null, setProperty: (k: string, v: string) => props.set(k, v) }) },
      SpreadsheetApp: { openById: (id: string) => (id === book.id ? book : (() => { throw new Error('no such sheet'); })()), flush: () => {}, getActiveSpreadsheet: () => book },
      LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
      ContentService: { createTextOutput: (content: string) => ({ setMimeType: () => ({ content }) }), MimeType: { JSON: 'json' } },
      Utilities: { formatDate: (d: Date) => d.toISOString() },
      ScriptApp: { getProjectTriggers: () => [] },
      Logger: { log: () => {} },
    };
    const src = readFileSync(resolve(import.meta.dirname, '../../apps-script/Code.js'), 'utf8');
    const make = new Function(...Object.keys(globals), `${src}\nreturn doPost;`);
    this.doPost = make(...Object.values(globals));
  }

  /** The same request the Worker sends; the answer parsed the same way. */
  async call(action: string, body: Record<string, unknown> = {}) {
    this.calls++;
    const out = JSON.parse(this.doPost({ postData: { contents: JSON.stringify({ ...body, action, secret: this.secret, target: 'main' }) } }).content);
    if (!out.ok) throw new Error(`Google Sheet gateway: ${out.error}`);
    return out.result;
  }

  /** The values of a tab as objects (for checks). */
  table(name: string): Record<string, V>[] {
    const sh = this.book.getSheetByName(name);
    if (!sh) return [];
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    return sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), head.length).getValues().map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }
}
