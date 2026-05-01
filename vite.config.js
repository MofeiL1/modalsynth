// Vite config for modalsynth — public deployment.
// - base: '/modalsynth/' on `vite build` so HTML/asset URLs match the live
//   URL prefix at mofei.me/modalsynth/. Default '/' on `vite dev` because
//   Faust WASM worklets use absolute paths internally that don't survive
//   a non-root base in the dev server.
// - outDir: 'dist/modalsynth' so the file system layout matches the URL
//   prefix — Cloudflare Pages serves dist/ as web root, and
//   mofei.me/modalsynth/* resolves to dist/modalsynth/* directly.
// - COOP/COEP headers required by SharedArrayBuffer (Faust WASM).
//   Production: written to dist/_headers by scripts/postbuild.js.

import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Production base is '/modalsynth/' for both `vite build` and `vite preview`
  // (mode='production' in both). Dev (`vite dev`, mode='development') stays
  // at '/' because Faust WASM has trouble with non-root base in the dev
  // server's module-graph rewriting.
  base: mode === 'production' ? '/modalsynth/' : '/',
  build: {
    outDir: 'dist/modalsynth',
    emptyOutDir: true,
    // Faust generates the AudioWorklet processor source by calling
    // `.toString()` on a class in the main bundle, then loads it as a Blob
    // URL inside the worklet's globalScope. Vite's default minify (esbuild)
    // renames top-level identifiers in the main bundle, but the renamed
    // names aren't visible inside the worklet's isolated context — the
    // processor script throws "<name> is not defined" before registering.
    // Disabling minify keeps the closure-friendly names intact. The bundle
    // is a few hundred KB larger but well under any meaningful budget.
    minify: false,
  },
  // COOP/COEP needed for both dev (vite serve) and local production preview
  // (vite preview). Vite has separate config sections for each.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}));
