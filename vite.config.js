// Vite config for modalsynth — public deployment.
// Deployed at https://modalsynth.mofei.me/ — apex of its own subdomain,
// so default base ('/') and default outDir ('dist') just work.
// COOP/COEP headers required by SharedArrayBuffer (Faust WASM).
// Production headers come from public/_headers (Cloudflare Pages format).

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
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
  // COOP/COEP for dev (vite serve) and local production preview (vite preview).
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
});
