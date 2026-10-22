// Try-it demo build (npm run build:demo): the app plus the registry server in one page, made-up data only.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'demo',
  base: './',
  plugins: [react()],
  // VITE_DEMO = the browser-storage key of the demo registry (demo/backend.ts).
  define: { 'import.meta.env.VITE_DEMO': JSON.stringify('ep-case-log-demo-v1'), 'import.meta.env.VITE_DEMO_PASSWORD': JSON.stringify('demo-pass-2026') },
  build: { outDir: '../dist-demo', emptyOutDir: true, modulePreload: false, rollupOptions: { output: { inlineDynamicImports: true } } },
});
