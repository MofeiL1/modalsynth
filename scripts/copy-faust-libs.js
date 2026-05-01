// Copy Faust WASM runtime libraries from npm package to public/ so Vite serves
// them statically. Run automatically by `npm run dev`.
import { cpSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'node_modules', '@grame', 'faustwasm', 'libfaust-wasm');
const dest = join(root, 'public', 'faustwasm');

if (!existsSync(src)) {
  console.log('faustwasm not installed yet, skipping copy.');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('Faust libraries copied to public/faustwasm/');
