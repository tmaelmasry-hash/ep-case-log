import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Injects every built file into the service worker's precache list so the app works offline after the first visit. */
function precache(): Plugin {
  let outDir = 'dist';
  return {
    name: 'precache-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (f !== 'sw.js') files.push('/' + relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const swPath = join(outDir, 'sw.js');
      const version = Date.now().toString(36);
      const sw = readFileSync(swPath, 'utf8')
        .replace(/const SHELL = \[[^\]]*\];/, `const SHELL = ${JSON.stringify(['/', ...files])};`)
        .replace(/const CACHE = '[^']*';/, `const CACHE = 'ep-caselog-${version}';`);
      writeFileSync(swPath, sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), precache()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: {
    environment: 'node',
    // Server tests run twice: in-memory store, and the Google Sheet store over the real apps-script/Code.js (fake sheet).
    workspace: [
      { extends: true, test: { name: 'memory', include: ['tests/unit/**/*.test.ts', 'tests/server/**/*.test.ts'] } },
      { extends: true, test: { name: 'sheets', include: ['tests/server/**/*.test.ts'], env: { TEST_STORE: 'sheets' } } },
    ],
  },
} as never);
