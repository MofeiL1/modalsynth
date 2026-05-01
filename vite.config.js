// Vite config for modalsynth — public deployment.
// - base: '/modalsynth/' so HTML references match the live URL prefix.
// - outDir: 'dist/modalsynth' so the file system layout matches the URL
//   prefix too — Cloudflare Pages serves dist/ as web root, and
//   mofei.me/modalsynth/* resolves to dist/modalsynth/* directly.
// - COOP/COEP headers required by SharedArrayBuffer (used by Faust WASM).
//   In production these are set via public/_headers (Cloudflare Pages format).

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/modalsynth/',
  build: {
    outDir: 'dist/modalsynth',
    emptyOutDir: true,
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
