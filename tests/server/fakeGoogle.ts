// Test double for Google: runs the real apps-script/Code.js against an in-memory spreadsheet that behaves like
// SpreadsheetApp for the calls Code.js makes (text written with a leading apostrophe is stored as text; numbers
// and booleans stay as they are; empty cells read as ''). Synthetic data only.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Gateway } from '../../server/store/sheets.ts';
import { buildXlsx } from '../../shared/xlsx.ts';

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
  getNumRows() {
    return this.nr;
  }
  getNumColumns() {
    return this.nc;
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
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
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
  locale = 'en_GB';
  getSpreadsheetLocale() {
    return this.locale;
  }
}

/** Stand-in for the Advanced Sheets service call Code.js makes: whole tabs in one request, empty cells at the end of
 *  a row and empty rows at the end left out (like the real API). */
function fakeSheetsApi(book: FakeBook, count: () => void) {
  return {
    Spreadsheets: {
      Values: {
        batchGet(id: string, opt: { ranges: string[] }) {
          count();
          if (id !== book.id) throw new Error('no such sheet');
          return {
            valueRanges: opt.ranges.map((r) => {
              const sh = book.getSheetByName(r.slice(1, -1).replace(/''/g, "'"));
              if (!sh) throw new Error(`Unable to parse range: ${r}`);
              const values = sh.getDataRange().getValues().map((row) => {
                let n = row.length;
                while (n && row[n - 1] === '') n--;
                return row.slice(0, n);
              });
              while (values.length && !values[values.length - 1].length) values.pop();
              return { range: r, values };
            }),
          };
        },
      },
    },
  };
}

/** A fresh fake Google account with one registry Sheet and the real Code.js loaded as its web app. */
export class FakeAppsScript implements Gateway {
  props = new Map<string, string>();
  book = new FakeBook('main-sheet-id', 'EP Case Log (fake)');
  calls = 0;
  /** Requests to the Advanced Sheets service (batchGet). */
  apiCalls = 0;
  private doPost: (e: unknown) => { content: string };
  private secret: string;

  /** `sheetsApi: false` = the Advanced Sheets service is not switched on (Code.js reads tab by tab). */
  constructor(secret = 'fake-gateway-secret-0123456789-abcdefghijkl', opts: { sheetsApi?: boolean } = {}) {
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
      Sheets: opts.sheetsApi === false ? undefined : fakeSheetsApi(book, () => this.apiCalls++),
    };
    const src = readFileSync(resolve(import.meta.dirname, '../../apps-script/Code.js'), 'utf8');
    const make = new Function(...Object.keys(globals), `${src}\nreturn doPost;`);
    this.doPost = make(...Object.values(globals));
  }

  /** A raw web-app request body (as sent over HTTP) → the parsed answer, exactly as Code.js gives it. */
  post(body: string): { ok: boolean; result?: unknown; error?: string } {
    this.calls++;
    const req = JSON.parse(body) as Record<string, unknown>;
    if (req.action === 'export') {
      if (req.secret !== this.secret) return { ok: false, error: 'unauthorised' };
      return { ok: true, result: this.exportBook(req as never) };
    }
    return JSON.parse(this.doPost({ postData: { contents: body } }).content);
  }

  /** Stand-in for Code.js export_ (Drive copy + Google's xlsx export cannot run here): the same trimming
   *  (keepTabs, dropColumns, caseIds) applied to this fake sheet's tabs, written with the app's xlsx writer. */
  private exportBook(req: { fileName: string; keepTabs: string[] | null; dropColumns: Record<string, string[]>; caseIds: string[] | null }) {
    const want = req.caseIds ? new Set(req.caseIds.map(String)) : null;
    const sheets = this.book.sheets
      .filter((sh) => !req.keepTabs || req.keepTabs.includes(sh.name))
      .map((sh) => {
        const all = this.table(sh.name);
        const head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
        const keep = head.filter((h) => !(req.dropColumns[sh.name] ?? []).includes(h));
        const rows = all.filter((r) => !want || !head.includes('case_id') || want.has(String(r.case_id))).map((r) => keep.map((h) => r[h] ?? null));
        return { name: sh.name, rows: [keep, ...rows] };
      });
    const bytes = buildXlsx(sheets);
    return { file_name: req.fileName, base64: Buffer.from(bytes).toString('base64'), bytes: bytes.length, tabs: sheets.map((s) => s.name), cases: sheets.find((s) => s.name === 'Cases')?.rows.length ? sheets.find((s) => s.name === 'Cases')!.rows.length - 1 : 0 };
  }

  /** The same request the Worker sends; the answer parsed the same way. */
  async call(action: string, body: Record<string, unknown> = {}) {
    this.calls++;
    if (action === 'export') return this.exportBook(body as never);
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
