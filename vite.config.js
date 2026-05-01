// Vite config for modalsynth — public deployment.
// - base: '/modalsynth/' so the bundle works under mofei.me/modalsynth/
// - COOP/COEP headers required by SharedArrayBuffer (used by Faust WASM).
//   In production these are set via public/_headers (Cloudflare Pages format).

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/modalsynth/',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
