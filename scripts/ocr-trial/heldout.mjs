// Held-out OCR trial: new made-up sheets the recipe was never tuned on, in simulated phone photos. Every value is invented; MRNs 9990xxx.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKGS = process.env.OCR_PKGS;
const OUT = process.env.OCR_OUT;
const IMG = path.join(OUT, 'img');
fs.mkdirSync(IMG, { recursive: true });
const { chromium, webkit } = createRequire('E:/EP_REGISTRY_REBUILD/EP LOG/package.json')('playwright-core');

const table = (rows, cls = '') => `<table class="${cls}">${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table>`;
const css = (font, size, extra = '') => `*{box-sizing:border-box} html,body{margin:0;background:#fff;color:#141414}
 .page{width:794px;height:1123px;padding:48px 54px;font:${size}pt/1.38 ${font};overflow:hidden}
 h1{font-size:1.4em;margin:0 0 3px} h2{font-size:1.05em;margin:12px 0 3px} p{margin:3px 0}
 table{border-collapse:collapse;width:100%;margin:4px 0} td,th{border:1px solid #777;padding:2px 6px;text-align:left} th{background:#e4e4e4} ${extra}`;

const SHEETS = [
  { id: 'holter', font: "Georgia,serif", size: 11, body: `<h1>24-Hour Holter Report</h1><p>Sample Heart Centre. Made-up record for testing.</p><p>Patient: Hana Notreal MRN: 9990801 DOB: 19/06/1968 Recorded: 05/10/2026</p>
    <h2>Summary</h2><p>Total beats 104,382. Mean heart rate 74 bpm, minimum 48 bpm at 03:42, maximum 131 bpm at 17:15. Analysed time 23 h 41 min.</p>
    ${table([['Ventricular', 'Count', 'Burden'], ['Isolated PVC', '6,214', '5.9%'], ['Couplets', '38', '0.1%'], ['NSVT runs', '2', 'longest 7 beats at 162 bpm']])}
    ${table([['Supraventricular', 'Count', 'Burden'], ['Isolated PAC', '412', '0.4%'], ['SVT runs', '5', 'longest 11 beats at 148 bpm'], ['AF episodes', '1', '42 min']])}
    <h2>Pauses</h2><p>Longest pause 2.4 s at 04:10. No pauses over 3.0 s. PR interval 172 ms, QTc 447 ms at mean rate.</p>
    <h2>Conclusion</h2><p>Sinus rhythm with PVC burden 5.9% and one episode of atrial fibrillation lasting 42 min. Review on 12/11/2026.</p>` },
  { id: 'labs', font: "'Courier New',monospace", size: 9.5, body: `<h1>Laboratory Results</h1><p>Sample Hospital Laboratory. Made-up record for testing.</p><p>Patient: Sami Pretend MRN: 9990802 Collected: 28/09/2026 07:35</p>
    ${table([['Test', 'Result', 'Unit', 'Reference'], ['Haemoglobin', '13.6', 'g/dL', '13.0 - 17.0'], ['WBC', '7.84', '10^9/L', '4.00 - 11.00'], ['Platelets', '241', '10^9/L', '150 - 400'], ['Sodium', '138', 'mmol/L', '135 - 145'], ['Potassium', '4.3', 'mmol/L', '3.5 - 5.1'], ['Creatinine', '96', 'umol/L', '62 - 106'], ['eGFR', '71', 'mL/min', '60 - 120'], ['INR', '2.45', 'ratio', '2.00 - 3.00'], ['aPTT', '34.2', 's', '25.0 - 36.0'], ['TSH', '1.82', 'mIU/L', '0.27 - 4.20'], ['Free T4', '16.1', 'pmol/L', '12.0 - 22.0'], ['HbA1c', '6.7', '%', '4.0 - 5.6'], ['NT-proBNP', '812', 'pg/mL', '0 - 125'], ['Troponin T', '0.014', 'ng/mL', '0.000 - 0.014'], ['Magnesium', '0.86', 'mmol/L', '0.66 - 1.07']])}
    <p>Authorised 28/09/2026 09:12. Critical values: none.</p>` },
  { id: 'echo', font: "Verdana,sans-serif", size: 9.5, body: `<h1>Transthoracic Echocardiogram</h1><p>Sample Imaging Unit. Made-up record for testing.</p><p>Patient: Mona Invented MRN: 9990803 Date: 14/08/2026 BSA 1.82 m2 HR 68 bpm BP 126/78 mmHg</p>
    ${table([['Measure', 'Value', 'Normal'], ['LVEDD', '5.4 cm', '4.2 - 5.8'], ['LVESD', '3.9 cm', '2.5 - 4.0'], ['IVSd', '1.1 cm', '0.6 - 1.0'], ['PWd', '1.0 cm', '0.6 - 1.0'], ['LVEF (biplane)', '48 %', '52 - 72'], ['LA volume index', '39 mL/m2', '16 - 34'], ['E/A', '0.8', ''], ['E/e prime', '12.5', 'under 14'], ['TAPSE', '1.9 cm', 'over 1.7'], ['RVSP', '34 mmHg', 'under 35'], ['Aortic root', '3.3 cm', '2.9 - 4.0']])}
    <h2>Findings</h2><p>Mildly reduced left ventricular systolic function, LVEF 48%. Mild left atrial enlargement. Mild mitral regurgitation, vena contracta 0.3 cm. No pericardial effusion.</p>` },
  { id: 'implant', font: "Tahoma,sans-serif", size: 10, body: `<h1>Pacemaker Implant Report</h1><p>Sample EP Service. Made-up record for testing.</p><p>Patient: Tariq Fakename MRN: 9990804 DOB: 02/11/1949 Implant: 21/09/2026</p>
    <h2>Device</h2><p>Dual chamber pacemaker, model DEMO-D310, serial PX7730215, left pectoral pocket. Mode DDD, lower rate 60 bpm, upper rate 130 bpm.</p>
    ${table([['Lead', 'Threshold', 'Pulse', 'Sensing', 'Impedance'], ['RA', '0.7 V', '0.4 ms', '2.6 mV', '512 ohm'], ['RV septal', '0.9 V', '0.4 ms', '10.8 mV', '684 ohm']])}
    <h2>Procedure</h2><p>Fluoroscopy time 11.6 min, dose 214 cGy.cm2, contrast 18 mL. Antibiotic cefazolin 2 g. Blood loss under 20 mL. Discharged 22/09/2026.</p>
    <h2>Follow-up</h2><p>Wound check in 10 days. Device clinic in 3 months on 20/12/2026. Hold apixaban for 48 h, restart 5 mg twice daily.</p>` },
  { id: 'af_note', font: "'Times New Roman',serif", size: 10.5, body: `<h1>AF Ablation Procedure Note</h1><p>Sample EP Laboratory. Made-up record for testing.</p><p>Patient: Reem Unreal MRN: 9990805 DOB: 30/04/1971 Date: 11/10/2026 Operator: Dr. Sample</p>
    <p>Indication: symptomatic persistent AF for 14 months, CHA2DS2-VASc 3, LVEF 52%, LA diameter 4.6 cm. Pre-procedure INR 2.2. TEE 10/10/2026: no thrombus.</p>
    <p>Access: right femoral vein, 2 transseptal punctures. Heparin 12,000 units, ACT 342 s. LA mean pressure 14 mmHg. Pulsed field energy, 8 applications per vein, 32 in total. All 4 veins isolated with entrance and exit block.</p>
    <p>Procedure time 84 min, fluoroscopy 9.3 min, dose 142 cGy.cm2. Cardioversion 200 J, 1 shock, to sinus rhythm 64 bpm. QRS 96 ms, QTc 438 ms.</p>
    <p>Fluid balance plus 650 mL. No complications. Discharged 12/10/2026 on apixaban 5 mg twice daily, bisoprolol 2.5 mg daily, pantoprazole 40 mg daily for 6 weeks.</p>` },
  { id: 'two_col', font: "Arial,sans-serif", size: 9.5, extra: '.cols{display:grid;grid-template-columns:1fr 1fr;gap:22px}', body: `<h1>Clinic Letter</h1><p>Sample Cardiology Clinic. Made-up record for testing.</p><p>Patient: Khaled Sampleton MRN: 9990806 Clinic date: 03/11/2026</p>
    <div class="cols"><div><h2>Observations</h2><p>Weight 88.2 kg, height 174 cm, BMI 29.1. Heart rate 58 bpm, blood pressure 134/82 mmHg, saturation 98%.</p><h2>ECG</h2><p>Sinus bradycardia 54 bpm, PR 186 ms, QRS 104 ms, QTc 442 ms.</p><h2>Medications</h2><p>Metoprolol 25 mg, ramipril 5 mg, atorvastatin 40 mg, aspirin 81 mg.</p></div>
    <div><h2>Device Check</h2><p>Battery 3.01 V, longevity 7.5 years. RV threshold 0.75 V at 0.4 ms, sensing 9.2 mV, impedance 610 ohm. Pacing 8%.</p><h2>Plan</h2><p>Reduce metoprolol to 12.5 mg. Repeat ECG in 4 weeks. Echo before next visit on 05/02/2027.</p></div></div>` },
  // Final exam: written after the recipe was chosen, and never used to choose anything.
  { id: 'exam_icd', exam: true, font: "Calibri,'Segoe UI',sans-serif", size: 10, body: `<h1>ICD Remote Check</h1><p>Sample Device Service. Made-up record for testing.</p><p>Patient: Nora Testperson MRN: 9990807 DOB: 17/02/1959 Check: 19/10/2026</p>
    ${table([['Channel', 'Sensing', 'Threshold', 'Impedance', 'Pacing'], ['RA', '3.2 mV', '0.6 V @ 0.4 ms', '468 ohm', '22%'], ['RV', '8.7 mV', '1.2 V @ 0.4 ms', '592 ohm', '4%'], ['LV', '14.1 mV', '1.4 V @ 0.8 ms', '731 ohm', '97%']])}
    <p>Battery 2.98 V, 5.2 years remaining. HV impedance 67 ohm. Charge time 8.4 s. Last shock 36 J on 02/09/2026. AT/AF burden 1.3%, longest 6.5 h. VT zone 188 bpm, VF zone 222 bpm. 3 episodes treated with ATP.</p>` },
  { id: 'exam_svt', exam: true, font: "'Segoe UI',Arial,sans-serif", size: 10.5, body: `<h1>SVT Ablation Note</h1><p>Sample EP Laboratory. Made-up record for testing.</p><p>Patient: Adel Madeupson MRN: 9990808 DOB: 08/12/1983 Date: 24/10/2026</p>
    <p>Baseline: AH 88 ms, HV 44 ms, PR 152 ms, QRS 86 ms, cycle length 742 ms. Wenckebach 340 ms, AVNERP 300/260 ms. Jump 62 ms at 290 ms.</p>
    <p>Tachycardia cycle length 318 ms, VA 12 ms. Ablation slow pathway 50 W, 60 C, 6 lesions, 4.5 min total. Junctional beats seen. Isoprenaline 2 mcg/min, no inducibility after 30 min.</p>
    <p>Fluoroscopy 3.8 min, dose 21.5 cGy.cm2. Heparin 5,000 units. Discharged 25/10/2026. Stop verapamil 120 mg. Follow-up 06/12/2026.</p>` },
  { id: 'exam_ct', exam: true, font: "Cambria,Georgia,serif", size: 10, body: `<h1>Cardiac CT Before Ablation</h1><p>Sample Radiology. Made-up record for testing.</p><p>Patient: Salma Nonreal MRN: 9990809 Scan: 06/10/2026 Contrast 75 mL, DLP 412 mGy.cm</p>
    ${table([['Structure', 'Measure', 'Value'], ['Left atrium', 'Volume', '118 mL'], ['Left atrium', 'AP diameter', '4.3 cm'], ['LSPV', 'Ostium', '1.8 cm'], ['LIPV', 'Ostium', '1.5 cm'], ['RSPV', 'Ostium', '2.1 cm'], ['RIPV', 'Ostium', '1.7 cm'], ['LAA', 'Ostium', '2.4 cm'], ['LAA', 'Depth', '3.1 cm'], ['Esophagus', 'Distance to LA', '0.3 cm']])}
    <p>No LAA thrombus. Coronary calcium score 56. Heart rate during scan 62 bpm.</p>` },
];
const pageHtml = (s) => `<!doctype html><meta charset="utf-8"><style>${css(s.font, s.size, s.extra)}</style><div class="page">${s.body}</div>`;

// Simulated phone photos: paper on a desk, with what a hurried photo in a clinic gets.
const VARIANTS = [
  { id: 'good', w: 1200, tf: 'perspective(2600px) rotateX(3deg) rotateY(-2deg) rotateZ(0.8deg)', filter: 'brightness(.97)' },
  { id: 'tilted', w: 1150, tf: 'perspective(1700px) rotateX(13deg) rotateY(7deg) rotateZ(-3deg)', filter: 'brightness(.96)' },
  { id: 'shadow', w: 1200, tf: 'perspective(2600px) rotateX(4deg) rotateZ(1.5deg)', filter: 'brightness(.97)', over: 'radial-gradient(ellipse 58% 26% at 34% 28%, rgba(0,0,0,.58), rgba(0,0,0,.3) 60%, rgba(0,0,0,0) 78%)' },
  { id: 'dim', w: 1200, tf: 'perspective(2600px) rotateX(3deg) rotateZ(-1deg)', filter: 'brightness(.5) contrast(.8) sepia(.3)', noise: 0.16 },
  { id: 'glare', w: 1200, tf: 'perspective(2600px) rotateX(3deg) rotateZ(1deg)', filter: 'brightness(.97)', over: 'radial-gradient(ellipse 38% 16% at 62% 26%, rgba(255,255,255,.92), rgba(255,255,255,.55) 50%, rgba(255,255,255,0) 78%)' },
  { id: 'shake', w: 1200, tf: 'perspective(2600px) rotateX(3deg) rotateZ(.6deg)', filter: 'url(#shake) brightness(.97)' },
  { id: 'far', w: 720, tf: 'perspective(2200px) rotateX(5deg) rotateZ(2deg)', filter: 'brightness(.95)' },
  { id: 'worst', w: 1050, tf: 'perspective(1700px) rotateX(11deg) rotateY(-6deg) rotateZ(4deg)', filter: 'url(#soft) brightness(.62) contrast(.85) sepia(.25)', noise: 0.14, over: 'radial-gradient(ellipse 60% 44% at 72% 26%, rgba(0,0,0,.42), rgba(0,0,0,0) 74%)' },
];
const photoHtml = (b64, v) => `<!doctype html><style>html,body{margin:0}#s{position:relative;width:1500px;height:2000px;overflow:hidden;background:linear-gradient(120deg,#6d5a48,#4e4034 60%,#5e4e3f);display:flex;align-items:center;justify-content:center}
 #p{position:relative;width:${v.w}px;transform:${v.tf};box-shadow:0 18px 40px rgba(0,0,0,.45)} #p img{display:block;width:100%;filter:${v.filter}}
 #o{position:absolute;inset:0;background:${v.over ?? 'none'}} canvas{position:absolute;inset:0;mix-blend-mode:overlay;opacity:${v.noise ?? 0}}</style>
 <svg width="0" height="0" style="position:absolute"><filter id="shake"><feGaussianBlur stdDeviation="1.7 0.2"/></filter><filter id="soft"><feGaussianBlur stdDeviation="0.8"/></filter></svg>
 <div id="s"><div id="p"><img src="${b64}"><div id="o"></div></div><canvas id="n" width="1500" height="2000"></canvas></div>
 <script>const c=document.getElementById('n').getContext('2d');const d=c.createImageData(1500,2000);for(let i=0;i<d.data.length;i+=4){const v=Math.random()*255;d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=255}c.putImageData(d,0,0)</script>`;

// Scoring: the same rules as rescore.mjs, and "found" as a bag of numbers, since reading order on a two-column page is its own matter.
const norm = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const nums = (s) => s.match(/\d+(?:[.,:/]\d+)*/g) || [];
const align = (t, o) => { const n = t.length, m = o.length; const D = Array.from({ length: n + 1 }, (_, i) => { const r = new Uint32Array(m + 1); r[0] = i; return r; }); for (let j = 0; j <= m; j++) D[0][j] = j; for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j - 1] + (t[i - 1] === o[j - 1] ? 0 : 1), D[i - 1][j] + 1, D[i][j - 1] + 1); let i = n, j = m, ok = 0, missing = 0, extra = 0; const wrong = []; while (i > 0 || j > 0) { if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (t[i - 1] === o[j - 1] ? 0 : 1)) { if (t[i - 1] === o[j - 1]) ok++; else wrong.push([t[i - 1], o[j - 1]]); i--; j--; } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { missing++; i--; } else { extra++; j--; } } return { total: n, ok, wrong: wrong.reverse(), missing, extra }; };
const bagFound = (t, o) => { const m = new Map(); for (const x of o) m.set(x, (m.get(x) ?? 0) + 1); let f = 0; for (const x of t) if (m.get(x) > 0) { m.set(x, m.get(x) - 1); f++; } return f; };

const RECIPE = process.env.OCR_RECIPE ?? 'new';
const PIPE = RECIPE === 'new'
  ? { pipeline: ['rectify', 'sharpen', 'flatten', 'unline', 'up2'], params: { tessedit_pageseg_mode: '3' } }
  : { pipeline: ['rectify', 'sharpen', 'flatten', 'unline'], params: { tessedit_pageseg_mode: '6' } };
const VENDOR = { '/vendor/tesseract.min.js': 'node_modules/tesseract.js/dist/tesseract.min.js', '/vendor/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js', '/vendor/lang/4.0.0_best_int/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = null;
  if (VENDOR[p]) f = path.join(PKGS, VENDOR[p]);
  else if (p.startsWith('/vendor/core/')) f = path.join(PKGS, 'node_modules/tesseract.js-core', path.basename(p));
  else if (p.startsWith('/web/')) f = path.join(HERE, 'web', path.basename(p));
  else if (p.startsWith('/img/')) f = path.join(IMG, path.basename(p));
  if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const truth = {};
for (const s of SHEETS) {
  const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(pageHtml(s));
  const over = await page.evaluate(() => { const e = document.querySelector('.page'); return e.scrollHeight - e.clientHeight; });
  if (over > 0) throw new Error(`${s.id} overflows by ${over}px`);
  truth[s.id] = await page.evaluate(() => document.querySelector('.page').innerText);
  const shot = path.join(IMG, `${s.id}__clean.png`);
  await page.screenshot({ path: shot });
  await ctx.close();
  const b64 = `data:image/png;base64,${fs.readFileSync(shot).toString('base64')}`;
  const vctx = await browser.newContext({ viewport: { width: 1500, height: 2000 } });
  const vp = await vctx.newPage();
  for (const v of VARIANTS) {
    await vp.setContent(photoHtml(b64, v));
    await vp.waitForFunction(() => document.images[0].complete);
    await (await vp.$('#s')).screenshot({ path: path.join(IMG, `${s.id}__${v.id}.jpg`), type: 'jpeg', quality: 82 });
  }
  await vctx.close();
}
fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify(truth, null, 1));
console.log('images ready');

const engine = process.argv[2] === 'webkit' ? webkit : chromium;
const only = process.argv[3] ? process.argv[3].split(',') : VARIANTS.map((v) => v.id);
const b2 = engine === chromium ? browser : await engine.launch();
const jobs = SHEETS.flatMap((s) => [{ s, v: 'clean', img: `${s.id}__clean.png` }, ...VARIANTS.filter((v) => only.includes(v.id)).map((v) => ({ s, v: v.id, img: `${s.id}__${v.id}.jpg` }))]);
const rows = [];
const work = async () => {
  const ctx = await b2.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/web/harness.html`);
  await page.evaluate(() => {
    const orig = window.Pre.apply;
    window.Pre.apply = (c, step, info) => {
      if (step !== 'up2') return orig.call(window.Pre, c, step, info);
      const n = document.createElement('canvas');
      n.width = c.width * 2; n.height = c.height * 2;
      const x = n.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height);
      return n;
    };
  });
  await page.evaluate(() => window.startWorker({}));
  for (let j = jobs.shift(); j; j = jobs.shift()) {
    const r = await page.evaluate(([u, o]) => window.recognize(u, o), [`/img/${j.img}`, PIPE]);
    const sharp = await page.evaluate((u) => window.sharpnessOf(u), `/img/${j.img}`);
    const t = nums(norm(truth[j.s.id])); const o = nums(norm(r.text)); const a = align(t, o);
    // Two flags: the OCR's own doubt under 90, and a whole number starting with 0 (09 for 0.9), which is never a real reading here.
    const doubt = (w) => w.c < 90 || /(^|[^\d.,:/])0\d/.test(w.t);
    const low = (b) => r.words.some((w) => w.t.includes(b) && doubt(w));
    const wrongFlagged = a.wrong.filter(([, b]) => low(b)).length;
    const row = { sheet: j.s.id, exam: !!j.s.exam, variant: j.v, total: a.total, ok: a.ok, wrong: a.wrong, missing: a.missing, extra: a.extra, found: bagFound(t, o), wrongFlagged, words: r.words.length, flaggedWords: r.words.filter(doubt).length, conf: Math.round(r.confidence), sharp: Math.round(sharp), ms: Math.round(r.preMs + r.ocrMs), text: r.text };
    rows.push(row);
    console.log(`${j.s.id}/${j.v}: ${a.ok}/${a.total} wrong ${a.wrong.length} missing ${a.missing} found ${row.found} conf ${row.conf} ${row.ms}ms`);
    fs.writeFileSync(path.join(OUT, `results-${process.argv[2] ?? 'chromium'}-${RECIPE}.json`), JSON.stringify(rows, null, 1));
  }
  await ctx.close();
};
await Promise.all(Array.from({ length: Number(process.env.OCR_JOBS ?? 3) }, work));
if (b2 !== browser) await b2.close();
await browser.close();
server.close();
console.log('DONE');
process.exit(0);
