# modalsynth

Browser-based Faust playground for the [SoundEngineVR](https://github.com/MofeiL1/SoundEngineVR) parametric modal-resonator DSP. Tweak 7 material parameters in real time, audition the dual-bank pair voice with cross-damping coupling, save presets locally.

**Live at https://modalsynth.mofei.me/**

## What it is

The DSP is a Faust source file ([`dsp/modal-resonator.dsp`](dsp/modal-resonator.dsp), ~300 lines) that compiles to:

- **Native libraries** for Windows / macOS / Android (Unity / Quest 3 deployment in [SoundEngineVR](https://github.com/MofeiL1/SoundEngineVR))
- **WebAssembly** via the Faust WASM runtime (this site)

Same source, three targets. Both Web and VR demos hear the exact same algorithm.

## Develop

```bash
npm install
npm run dev   # opens http://localhost:5173
```

Faust WASM libraries are auto-copied from `node_modules` into `public/faustwasm/` via [`scripts/copy-faust-libs.js`](scripts/copy-faust-libs.js).

## Deploy (Cloudflare Pages)

- Connect this repo to Cloudflare Pages
- Build command: `npm run build`
- Build output: `dist`
- Custom domain: `modalsynth.mofei.me`

[`public/_headers`](public/_headers) configures COOP / COEP for SharedArrayBuffer, which the Faust WASM runtime requires. Vite copies it from `public/` into `dist/` during build.

## DSP source sync

[`dsp/modal-resonator.dsp`](dsp/modal-resonator.dsp) is a vendored copy of `core/modal-resonator.dsp` from upstream SoundEngineVR. To re-sync when the upstream DSP changes:

```bash
cp ../SoundEngineVR/core/modal-resonator.dsp dsp/modal-resonator.dsp
```

(Manual; no automated sync. Snapshot is fine for showcase deployment.)

## Preset persistence

User presets are stored in `localStorage` under key `modalsynth.presets`. The bundled [`public/presets/defaults.json`](public/presets/defaults.json) is merged into the in-memory store on every load, with user-saved entries winning on name collision. Deleting a default and reloading makes it reappear — that's intentional for a public showcase.
