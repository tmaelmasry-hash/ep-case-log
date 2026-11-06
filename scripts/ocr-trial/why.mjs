// One round: why are decimal points lost, and does any recipe keep them? Made-up sheets from heldout.mjs; images already rendered.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKGS = process.env.OCR_PKGS; const OUT = process.env.OCR_OUT; const IMG = path.join(OUT, 'img');
const { chromium } = createRequire('E:/EP_REGISTRY_REBUILD/EP LOG/package.json')('playwright-core');
const truth = JSON.parse(fs.readFileSync(path.join(OUT, 'truth.json'), 'utf8'));
const norm = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const nums = (s) => s.match(/\d+(?:[.,:/]\d+)*/g) || [];
const align = (t, o) => { const n = t.length, m = o.length; const D = Array.from({ length: n + 1 }, (_, i) => { const r = new Uint32Array(m + 1); r[0] = i; return r; }); for (let j = 0; j <= m; j++) D[0][j] = j; for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + (t[i - 1] === o[j - 1] ? 0 : 1), D[i - 1][j] + 1, D[i][j - 1] + 1); let i = n, j = m, ok = 0, missing = 0; const wrong = []; while (i > 0 || j > 0) { if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (t[i - 1] === o[j - 1] ? 0 : 1)) { if (t[i - 1] === o[j - 1]) ok++; else wrong.push(`${t[i - 1]}->${o[j - 1]}`); i--; j--; } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { missing++; i--; } else j--; } return { total: n, ok, wrong, missing }; };
const VENDOR = { '/vendor/tesseract.min.js': 'node_modules/tesseract.js/dist/tesseract.min.js', '/vendor/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js', '/vendor/lang/4.0.0_best_int/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', '/vendor/lang/4.0.0/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => { const p = decodeURIComponent(new URL(req.url, 'http://x').pathname); let f = null; if (VENDOR[p]) f = path.join(PKGS, VENDOR[p]); else if (p.startsWith('/vendor/core/')) f = path.join(PKGS, 'node_modules/tesseract.js-core', path.basename(p)); else if (p.startsWith('/web/')) f = path.join(HERE, 'web', path.basename(p)); else if (p.startsWith('/img/')) f = path.join(IMG, path.basename(p)); if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const P6 = { tessedit_pageseg_mode: '6' };
const P3 = { tessedit_pageseg_mode: '3' };
const CONFIGS = {
  psm3: { pipeline: ['rectify', 'sharpen', 'flatten', 'unline'], params: P3 },
  up15_before: { pipeline: ['rectify', 'up1.5', 'sharpen', 'flatten', 'unline'], params: P3 },
  up15_after: { pipeline: ['rectify', 'sharpen', 'flatten', 'unline', 'up1.5'], params: P3 },
  up2_after: { pipeline: ['rectify', 'sharpen', 'flatten', 'unline', 'up2'], params: P3 },
  down07: { pipeline: ['rectify', 'sharpen', 'flatten', 'unline', 'up0.7'], params: P3 },
};
const sheets = ['echo', 'implant', 'labs', 'two_col'];
const variants = ['clean', 'good', 'dim'];
const b = await chromium.launch();
const out = {};
const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
for (const [id, cfg] of Object.entries(CONFIGS)) {
  const page = await ctx.newPage();
  await page.goto(`${base}/web/harness.html`);
  await page.evaluate(() => {
    const orig = window.Pre.apply;
    window.Pre.apply = (c, step, info) => {
      if (!String(step).startsWith('up')) return orig.call(window.Pre, c, step, info);
      const k = Number(String(step).slice(2));
      const n = document.createElement('canvas');
      n.width = Math.round(c.width * k); n.height = Math.round(c.height * k);
      const x = n.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height);
      return n;
    };
  });
  await page.evaluate(() => window.startWorker({}));
  const R = { total: 0, ok: 0, wrong: 0, missing: 0, dec: 0 }; const two = { total: 0, ok: 0 };
  const samples = [];
  for (const s of sheets) for (const v of variants) {
    const img = `${s}__${v}.${v === 'clean' ? 'png' : 'jpg'}`;
    const r = await page.evaluate(([u, o]) => window.recognize(u, o), [`/img/${img}`, { pipeline: cfg.pipeline, params: cfg.params }]);
    const a = align(nums(norm(truth[s])), nums(norm(r.text)));
    const t = s === 'two_col' ? two : R;
    t.total += a.total; t.ok += a.ok;
    if (s !== 'two_col') { R.wrong += a.wrong.length; R.missing += a.missing; R.dec += a.wrong.filter((w) => { const [x, y] = w.split('->'); return x.replace('.', '') === y; }).length; if (samples.length < 5 && a.wrong.length) samples.push(`${s}/${v}: ${a.wrong.slice(0, 4).join(' ')}`); }
  }
  await page.evaluate(() => window.stopWorker());
  await page.close();
  out[id] = { 'ok %': +(100 * R.ok / R.total).toFixed(1), wrong: R.wrong, 'lost point': R.dec, missing: R.missing, 'two_col in order %': +(100 * two.ok / two.total).toFixed(1) };
  console.log(id, JSON.stringify(out[id]), samples.join(' | '));
}
console.table(out);
await b.close(); server.close(); process.exit(0);
