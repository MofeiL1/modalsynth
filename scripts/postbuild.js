// Postbuild — write _headers at the dist/ root.
//
// Cloudflare Pages reads _headers from the configured build output root.
// Our Vite outDir is dist/modalsynth/ (so URL paths line up with the file
// system), so we can't put _headers in public/ — Vite would copy it to
// dist/modalsynth/_headers, which Cloudflare ignores.
//
// COOP/COEP are required by SharedArrayBuffer, which Faust WASM uses.

import { writeFileSync } from 'fs';
import { mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

const headers = `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
`;

writeFileSync('dist/_headers', headers);
console.log('postbuild: wrote dist/_headers');
