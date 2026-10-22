// EP Case Log — thin data layer over the Google Sheet (phase 4; copied from EP Workspace apps-script/Code.js).
// No business rules here: the app server (Cloudflare Worker) decides everything; this script reads and writes
// cells, numbers under a lock, makes the daily backup copy, and exports the Sheet as .xlsx. Every call must carry
// the gateway secret. Deployed as a web app (execute as the registry account, access: anyone).

var PROPS = PropertiesService.getScriptProperties();
var TZ = 'Asia/Riyadh';
/** Daily backup hour (Riyadh). Google runs an hourly-slot trigger at some minute within that hour (10:00–10:59). */
var BACKUP_HOUR = 10;

// ── entry ───────────────────────────────────────────────────────────────────────────────────────

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var secret = PROPS.getProperty('GATEWAY_SECRET');
    if (req.action === 'init') out = init_(req, secret);
    else {
      if (!secret || req.secret !== secret) throw new Error('FORBIDDEN');
      var t0 = Date.now();
      out = { ok: true, result: route_(req) };
      out.ms = Date.now() - t0;
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** First call only: stores the gateway secret (trust on first use; the /exec address is private). */
function init_(req, existing) {
  if (existing) return { ok: existing === req.secret, result: { already: true } };
  if (!req.secret || String(req.secret).length < 32) throw new Error('secret too short');
  PROPS.setProperty('GATEWAY_SECRET', String(req.secret));
  return { ok: true, result: { stored: true } };
}

function route_(req) {
  var ss = book_(req.target);
  switch (req.action) {
    case 'ping': return { time: new Date().toISOString(), name: ss.getName() };
    case 'setup': return withLock_(function () { return setup_(ss, req); });
    case 'reset':
      if (req.target !== 'test') throw new Error('reset is only allowed on the test sheet');
      return withLock_(function () { return reset_(ss); });
    case 'batch':
      var writes = req.ops.some(function (o) { return o.op !== 'read'; });
      return writes ? withLock_(function () { return batch_(ss, req.ops); }) : batch_(ss, req.ops);
    case 'export': return export_(ss, req);
    case 'backup_schedule': return scheduleBackup_();
    default: throw new Error('unknown action ' + req.action);
  }
}

function book_(target) {
  var id = PROPS.getProperty(target === 'test' ? 'TEST_ID' : 'MAIN_ID');
  if (!id) throw new Error('Run setupSheets() once in the editor first');
  return SpreadsheetApp.openById(id);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(90000);
  try { var r = fn(); SpreadsheetApp.flush(); return r; } finally { lock.releaseLock(); }
}

// ── one-time setup (run from the editor: authorises the script, finds the Sheet, makes the test Sheet) ──

function setupSheets() {
  var main = SpreadsheetApp.getActiveSpreadsheet();
  PROPS.setProperty('MAIN_ID', main.getId());
  main.setSpreadsheetTimeZone(TZ);
  if (!PROPS.getProperty('TEST_ID')) {
    var test = SpreadsheetApp.create('EP Case Log — TEST (synthetic data only)');
    test.setSpreadsheetTimeZone(TZ);
    PROPS.setProperty('TEST_ID', test.getId());
  }
  scheduleBackup_();
  Logger.log('Main: ' + main.getUrl());
  Logger.log('Test: ' + SpreadsheetApp.openById(PROPS.getProperty('TEST_ID')).getUrl());
}

/** (Re)creates the one daily backup trigger at BACKUP_HOUR. Safe to repeat: old backup triggers are removed first.
 *  Called by setupSheets(), by `npm run sheets -- backup-time`, or run scheduleBackup() from the editor. */
function scheduleBackup_() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyBackup') { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger('nightlyBackup').timeBased().everyDays(1).atHour(BACKUP_HOUR).inTimezone(TZ).create();
  var now = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'nightlyBackup'; }).length;
  return { backup_hour: BACKUP_HOUR, timezone: TZ, removed: removed, triggers: now };
}
function scheduleBackup() { Logger.log(JSON.stringify(scheduleBackup_())); }

/** Daily copy of the registry Sheet into "EP Case Log Backups" at BACKUP_HOUR; keeps the newest 30. */
function nightlyBackup() {
  var src = DriveApp.getFileById(PROPS.getProperty('MAIN_ID'));
  var it = DriveApp.getFoldersByName('EP Case Log Backups');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('EP Case Log Backups');
  src.makeCopy('EP Case Log backup ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm'), folder);
  var files = [];
  var fi = folder.getFiles();
  while (fi.hasNext()) files.push(fi.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  for (var i = 30; i < files.length; i++) files[i].setTrashed(true);
}

/** Creates missing tabs and appends missing columns. Never removes or reorders anything. */
function setup_(ss, req) {
  var added = [];
  req.tabs.forEach(function (t) {
    var sh = ss.getSheetByName(t.name);
    if (!sh) { sh = ss.insertSheet(t.name); added.push(t.name); }
    var have = headers_(sh);
    var missing = t.headers.filter(function (h) { return have.indexOf(h) < 0; });
    if (missing.length) {
      var need = have.length + missing.length;
      if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
      sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      added.push(t.name + ': ' + missing.length + ' columns');
    }
    if (sh.getFrozenRows() !== 1) sh.setFrozenRows(1);
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
  if (req.lookups) {
    var lk = ss.getSheetByName('Lookups');
    if (lk.getLastRow() > 1) lk.getRange(2, 1, lk.getLastRow() - 1, lk.getLastColumn()).clearContent();
    if (req.lookups.length) {
      // A new tab has 1000 rows; the dictionary has more codes than that.
      var needRows = req.lookups.length + 1;
      if (lk.getMaxRows() < needRows) lk.insertRowsAfter(lk.getMaxRows(), needRows - lk.getMaxRows());
      lk.getRange(2, 1, req.lookups.length, req.lookups[0].length).setValues(req.lookups.map(function (r) { return r.map(cell_); }));
    }
  }
  return { added: added };
}

function reset_(ss) {
  ss.getSheets().forEach(function (sh) {
    var last = sh.getLastRow();
    if (last > 2) sh.deleteRows(3, last - 2); // a sheet must keep one row below the frozen header
    if (last > 1) sh.getRange(2, 1, 1, sh.getMaxColumns()).clearContent();
  });
  return { reset: true };
}

// ── Excel export (used from phase 10) ──────────────────────────────────────────────────────────────
// The registry Sheet itself as .xlsx. A temporary copy is made in "EP Case Log Exports (temporary)", trimmed as the
// app asks (keepTabs: drop the other tabs; dropColumns: e.g. password hashes; caseIds: keep only these cases' rows
// in every tab with a case_id column), exported through the Drive export address, and moved to the bin.
// The original Sheet is never changed. Text cells stay text (MRN leading zeros; = + - @ are not formulas).

function export_(ss, req) {
  var it = DriveApp.getFoldersByName('EP Case Log Exports (temporary)');
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder('EP Case Log Exports (temporary)');
  var file = DriveApp.getFileById(ss.getId()).makeCopy(String(req.fileName || 'EP export').replace(/\.xlsx$/, ''), folder);
  try {
    var cp = SpreadsheetApp.openById(file.getId());
    if (req.keepTabs) cp.getSheets().forEach(function (sh) { if (req.keepTabs.indexOf(sh.getName()) < 0) cp.deleteSheet(sh); });
    Object.keys(req.dropColumns || {}).forEach(function (tab) {
      var sh = cp.getSheetByName(tab);
      if (!sh) return;
      var head = headers_(sh);
      req.dropColumns[tab].map(function (c) { return head.indexOf(c); }).filter(function (i) { return i >= 0; })
        .sort(function (a, b) { return b - a; }).forEach(function (i) { sh.deleteColumn(i + 1); });
    });
    if (req.caseIds) {
      var want = {};
      req.caseIds.forEach(function (id) { want[String(id)] = true; });
      cp.getSheets().forEach(function (sh) {
        var head = headers_(sh);
        var c = head.indexOf('case_id');
        var last = sh.getLastRow();
        if (c < 0 || last < 2) return;
        var range = sh.getRange(2, 1, last - 1, head.length);
        var keep = range.getValues().filter(function (r) { return want[String(r[c])]; }).map(function (r) { return r.map(keep_); });
        range.clearContent();
        if (keep.length) sh.getRange(2, 1, keep.length, head.length).setValues(keep);
      });
    }
    SpreadsheetApp.flush();
    var cases = cp.getSheetByName('Cases');
    var n = 0;
    if (cases && cases.getLastRow() > 1) n = cases.getRange(2, 1, cases.getLastRow() - 1, 1).getValues().filter(function (r) { return r[0] !== ''; }).length;
    var resp = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + file.getId() + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('Excel export failed (Google answered ' + resp.getResponseCode() + ')');
    var bytes = resp.getContent();
    return { file_name: req.fileName, base64: Utilities.base64Encode(bytes), bytes: bytes.length, tabs: cp.getSheets().map(function (s) { return s.getName(); }), cases: n };
  } finally {
    file.setTrashed(true);
  }
}

/** Run once from the editor before the first Excel export: Google asks to allow "connect to an external service"
 *  (the Drive export address). Nothing is changed. */
function authorizeExport() {
  UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  Logger.log('Export allowed.');
}

// ── table operations ─────────────────────────────────────────────────────────────────────────────
// One call = one batch. Within a batch every tab and its header row are looked up once (`T_`), rows are
// read in blocks, and a row update is one read + one write of that row (all under the script lock).

var T_ = {};

function headers_(sh) {
  var n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(String) : [];
}

function tab_(ss, name) {
  if (T_[name]) return T_[name];
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('No tab ' + name + ' (run setup)');
  T_[name] = { sh: sh, head: headers_(sh) };
  return T_[name];
}

/** Cell value going in: every text is written with a leading apostrophe, so the Sheet keeps it as text
 *  (MRN leading zeros, dates as text, and = + - @ never become formulas). */
function cell_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string') return "'" + v;
  return v;
}

/** Cell value coming out: dates typed by hand become text (date, or date + time). */
function out_(v) {
  if (v instanceof Date) {
    var hm = Utilities.formatDate(v, TZ, 'HH:mm');
    return Utilities.formatDate(v, TZ, hm === '00:00' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm");
  }
  return v;
}

/** Re-writes a value read from the Sheet so it stays what it was (text stays text). */
function keep_(v) {
  return typeof v === 'string' && v !== '' ? "'" + v : v;
}

/** Data row numbers whose column `col` matches one of `values`. */
function rowsWhere_(t, col, values) {
  var last = t.sh.getLastRow();
  if (last < 2) return [];
  var c = t.head.indexOf(col);
  if (c < 0) throw new Error('No column ' + col + ' in ' + t.sh.getName());
  var want = {};
  values.forEach(function (v) { want[String(v)] = true; });
  var vals = t.sh.getRange(2, c + 1, last - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) if (want[String(vals[i][0])]) out.push(i + 2);
  return out;
}

function toObj_(head, v, width, keep) {
  var obj = {};
  for (var k = 0; k < width; k++) if (head[k] && (!keep || keep[head[k]])) obj[head[k]] = out_(v[k]);
  return obj;
}

/** Reads rows: all, or those whose column matches (small tabs are read whole in one go).
 *  o.only: answer with these columns only (the dashboard reads a few of the Cases tab's columns). */
function read_(ss, o) {
  var t = tab_(ss, o.tab);
  var head = t.head;
  var keep = null;
  if (o.only) { keep = {}; o.only.forEach(function (h) { keep[h] = true; }); }
  var last = t.sh.getLastRow();
  if (last < 2) return { rows: [] };
  var width = head.length;
  if (o.cols) width = Math.max.apply(null, o.cols.map(function (h) { var i = head.indexOf(h); return i < 0 ? 0 : i + 1; }).concat([1]));
  if (!o.where || (last - 1) * width <= 40000) {
    var c = o.where ? head.indexOf(o.where.col) : -1;
    if (o.where && c < 0) throw new Error('No column ' + o.where.col + ' in ' + o.tab);
    var want = {};
    if (o.where) o.where['in'].forEach(function (v) { want[String(v)] = true; });
    var all = t.sh.getRange(2, 1, last - 1, width).getValues();
    return { rows: all.filter(function (v) { return !o.where || want[String(v[c])]; }).map(function (v) { return toObj_(head, v, width, keep); }) };
  }
  var rows = rowsWhere_(t, o.where.col, o.where['in']);
  var out = [];
  var i = 0;
  while (i < rows.length) {
    var j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    t.sh.getRange(rows[i], 1, j - i + 1, width).getValues().forEach(function (v) { out.push(toObj_(head, v, width, keep)); });
    i = j + 1;
  }
  return { rows: out };
}

function checkCols_(t, obj) {
  Object.keys(obj).forEach(function (k) { if (t.head.indexOf(k) < 0) throw new Error('No column ' + k + ' in ' + t.sh.getName() + ' (run setup)'); });
}

/** Appends rows; with idCol, numbers them 1, 2, 3… in sheet order. */
function append_(ss, o) {
  if (!o.rows.length) return { ids: [] };
  var t = tab_(ss, o.tab);
  var start = Math.max(t.sh.getLastRow(), 1) + 1;
  var ids = [];
  var values = o.rows.map(function (r, i) {
    checkCols_(t, r);
    if (o.idCol) { r[o.idCol] = start - 1 + i; ids.push(start - 1 + i); }
    return t.head.map(function (h) { return Object.prototype.hasOwnProperty.call(r, h) ? cell_(r[h]) : ''; });
  });
  if (t.sh.getMaxRows() < start + values.length - 1) t.sh.insertRowsAfter(t.sh.getMaxRows(), start + values.length - 1 - t.sh.getMaxRows());
  t.sh.getRange(start, 1, values.length, t.head.length).setValues(values);
  return { ids: ids };
}

/** Appends one row unless a row with the same key exists. */
function appendIfAbsent_(ss, o) {
  var t = tab_(ss, o.tab);
  if (rowsWhere_(t, o.key, [o.row[o.key]]).length) return { inserted: false };
  append_(ss, { tab: o.tab, rows: [o.row] });
  return { inserted: true };
}

function splitList_(v) {
  return String(v || '').split(',').map(function (x) { return x.trim(); }).filter(String);
}

/** Updates the given cells of the row whose `key` column equals `id`. Also: merge keys into a JSON object
 *  cell, and add/remove items of a comma-list cell. The row is read and written once, under the lock, so two
 *  saves of different fields both survive and the latest save of the same field wins. */
function update_(ss, o) {
  var t = tab_(ss, o.tab);
  var rows = rowsWhere_(t, o.key, [o.id]);
  if (!rows.length) return { found: false };
  var range = t.sh.getRange(rows[0], 1, 1, t.head.length);
  var raw = range.getValues()[0];
  var row = raw.map(keep_);
  var at = function (c) {
    var i = t.head.indexOf(c);
    if (i < 0) throw new Error('No column ' + c + ' in ' + o.tab + ' (run setup)');
    return i;
  };
  var set = o.set || {};
  Object.keys(set).forEach(function (c) { raw[at(c)] = set[c]; row[at(c)] = cell_(set[c]); });
  Object.keys(o.merge || {}).forEach(function (c) {
    var i = at(c);
    var cur = {};
    try { cur = JSON.parse(raw[i] || '{}'); } catch (e) { cur = {}; }
    var m = o.merge[c];
    Object.keys(m.set || {}).forEach(function (k) { cur[k] = m.set[k]; });
    Object.keys(m.patch || {}).forEach(function (k) { cur[k] = Object.assign({}, cur[k] || {}, m.patch[k]); });
    (m.unset || []).forEach(function (k) { delete cur[k]; });
    row[i] = Object.keys(cur).length ? cell_(JSON.stringify(cur)) : '';
  });
  ['listAdd', 'listRemove'].forEach(function (kind) {
    Object.keys(o[kind] || {}).forEach(function (c) {
      var i = at(c);
      var cur = splitList_(raw[i]);
      o[kind][c].forEach(function (x) {
        var p = cur.indexOf(x);
        if (kind === 'listAdd' && p < 0) cur.push(x);
        if (kind === 'listRemove' && p >= 0) cur.splice(p, 1);
      });
      raw[i] = cur.join(',');
      row[i] = cell_(raw[i]);
    });
  });
  range.setValues([row]);
  return o.returnRow ? { found: true, row: toObj_(t.head, raw, t.head.length) } : { found: true };
}

/** Stops the whole batch (nothing written) unless the row's column still holds the expected number. */
function expect_(ss, o) {
  var t = tab_(ss, o.tab);
  var rows = rowsWhere_(t, o.key, [o.id]);
  if (!rows.length) throw new Error('NOT_FOUND');
  var v = t.sh.getRange(rows[0], t.head.indexOf(o.col) + 1).getValue();
  if (Number(v) !== Number(o.equals)) throw new Error('STALE');
  return { ok: true };
}

/** Sets cells on every row matching all `match` columns ('' matches an empty cell). */
function updateMatching_(ss, o) {
  var t = tab_(ss, o.tab);
  var last = t.sh.getLastRow();
  if (last < 2) return { updated: 0 };
  var data = t.sh.getRange(2, 1, last - 1, t.head.length).getValues();
  var n = 0;
  data.forEach(function (row, i) {
    var ok = Object.keys(o.match).every(function (c) { return String(row[t.head.indexOf(c)]) === String(o.match[c]); });
    if (!ok) return;
    Object.keys(o.set).forEach(function (c) { t.sh.getRange(i + 2, t.head.indexOf(c) + 1).setValue(cell_(o.set[c])); });
    n++;
  });
  return { updated: n };
}

/** Adds `by` to a numeric cell and returns the value before (group numbering). */
function increment_(ss, o) {
  var t = tab_(ss, o.tab);
  var rows = rowsWhere_(t, o.key, [o.id]);
  if (!rows.length) throw new Error('Unknown ' + o.key + ' ' + o.id);
  var cell = t.sh.getRange(rows[0], t.head.indexOf(o.col) + 1);
  var before = Number(cell.getValue()) || 1;
  cell.setValue(before + (o.by || 1));
  return { value: before };
}

/** `{{ref:N+K}}` in a string = (number returned by op N) + K. A cell that is only the token becomes a number. */
function resolve_(v, results) {
  if (typeof v !== 'string' || v.indexOf('{{ref:') < 0) return v;
  var whole = /^\{\{ref:(\d+)\+(\d+)\}\}$/.exec(v);
  var num = function (n, k) { return Number(results[n].value) + Number(k); };
  if (whole) return num(whole[1], whole[2]);
  return v.replace(/\{\{ref:(\d+)\+(\d+)\}\}/g, function (_, n, k) { return String(num(n, k)); });
}

function resolveObj_(o, results) {
  if (Array.isArray(o)) return o.map(function (x) { return resolveObj_(x, results); });
  if (o && typeof o === 'object') {
    var r = {};
    Object.keys(o).forEach(function (k) { r[k] = resolveObj_(o[k], results); });
    return r;
  }
  return resolve_(o, results);
}

function batch_(ss, ops) {
  T_ = {};
  var results = [];
  ops.forEach(function (raw) {
    var o = resolveObj_(raw, results);
    var fn = { read: read_, append: append_, appendIfAbsent: appendIfAbsent_, update: update_, updateMatching: updateMatching_, increment: increment_, expect: expect_ }[o.op];
    if (!fn) throw new Error('unknown op ' + o.op);
    results.push(fn(ss, o));
  });
  return results;
}
