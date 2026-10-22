// Try-it demo (npm run build:demo): builds the app + in-page registry server, then packs it into one HTML page
// (dist-demo/ep-case-log-demo.html) that can be shared as a private preview. Made-up data only.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
execSync('node scripts/build-config.ts && npx vite build -c vite.demo.config.ts', { cwd: root, stdio: 'inherit' });
const out = join(root, 'dist-demo');
const assets = readdirSync(join(out, 'assets'));
const js = readFileSync(join(out, 'assets', assets.find((f) => f.endsWith('.js'))!), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(out, 'assets', assets.find((f) => f.endsWith('.css'))!), 'utf8').replace(/<\/style/gi, '<\\/style');
// The preview host adds the <!doctype>, <head> and <body>; the page brings its title, styles and script.
const page = `<title>EP Case Log Demo</title>
<style>${css}</style>
<div id="root"></div>
<div id="print-root"></div>
<script type="module">${js}</script>
`;
writeFileSync(join(out, 'ep-case-log-demo.html'), page);
console.log(`dist-demo/ep-case-log-demo.html: ${(page.length / 1024).toFixed(0)} KB`);
