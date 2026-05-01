// Material editor entry point.
// - Loads core/modal-resonator.dsp via Vite ?raw import (single source of
//   truth shared with native build).
// - Initializes Faust WASM with a single voice node.
// - Wires up A-side and B-side ParamPanel + PresetManager pairs, plus the
//   center-pane ContactControls + AlphaControl.
// - Default load: A = first preset (e.g. Steel Plate), B = "Mallet" reference.

import FaustEngine from './dsp/faust-engine.js';
import { ParamPanel } from './ui/param-panel.js';
import PresetManager from './ui/preset-manager.js';
import { ContactControls, AlphaControl } from './ui/contact-controls.js';

// DSP source vendored from upstream SoundEngineVR/core/. See README for sync.
import dspCode from '../dsp/modal-resonator.dsp?raw';

const DEFAULT_A_PRESET = 'Steel Plate';
const DEFAULT_B_PRESET = 'Mallet';

async function main() {
  const statusEl = document.getElementById('status');
  const footerEl = document.getElementById('footer-msg');
  const setStatus = (msg, cls = '') => {
    statusEl.textContent = msg;
    statusEl.className = `status ${cls}`;
  };

  setStatus('Loading Faust compiler (~15 MB, slow on first load)…');

  const faustEngine = new FaustEngine();

  // Build A-side panels
  const paramA = new ParamPanel(document.getElementById('param-A'), faustEngine, 'A');
  const paramB = new ParamPanel(document.getElementById('param-B'), faustEngine, 'B');

  // Cross-instance reload broadcast — when one preset manager saves, sibling refreshes.
  const reloadBus = { listeners: [] };
  const broadcast = () => reloadBus.listeners.forEach((fn) => fn());

  const presetA = new PresetManager(
    document.getElementById('preset-A'), paramA, 'A',
    () => broadcast(),
  );
  const presetB = new PresetManager(
    document.getElementById('preset-B'), paramB, 'B',
    () => broadcast(),
  );
  reloadBus.listeners.push(() => presetA.reload());
  reloadBus.listeners.push(() => presetB.reload());

  // Center pane
  const contact = new ContactControls(
    document.getElementById('contact-controls'), faustEngine,
  );
  const alpha = new AlphaControl(
    document.getElementById('alpha-control'), faustEngine,
  );

  // Load presets from backend, then auto-select defaults
  await Promise.all([presetA.loadDefaults(), presetB.loadDefaults()]);

  // Init Faust (async, doesn't block UI)
  try {
    await faustEngine.init(dspCode);
    setStatus('Ready — click anywhere to enable audio', 'ready');
    footerEl.textContent = `Faust ready · DSP from dsp/modal-resonator.dsp · single-voice test mode`;
  } catch (err) {
    setStatus(`Faust failed to load: ${err.message}`, 'error');
    console.error(err);
    return;
  }

  // Push initial preset values to DSP
  if (presetA.presets[DEFAULT_A_PRESET]) {
    presetA.select.value = DEFAULT_A_PRESET;
    presetA._onSelect();
  }
  if (presetB.presets[DEFAULT_B_PRESET]) {
    presetB.select.value = DEFAULT_B_PRESET;
    presetB._onSelect();
  }

  // Resume AudioContext on first user gesture (browser autoplay policy)
  const resumeAudio = async () => {
    await faustEngine.resume();
    if (faustEngine.audioContext?.state === 'running') {
      setStatus('Ready', 'ready');
    }
  };
  document.addEventListener('click', resumeAudio, { once: true });
  document.addEventListener('keydown', resumeAudio, { once: true });

  // Spacebar shortcut for impact (handy when keyboard focus is on a slider)
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      faustEngine.triggerImpact(
        contact.values.impact_force ?? 100,
        contact.values.impact_vel ?? 3,
      );
    }
  });

  // Lightweight audio meter in footer
  setInterval(() => {
    if (faustEngine.audioContext?.state !== 'running') return;
    const db = faustEngine.getAudioLevelDb();
    const bar = '▮'.repeat(Math.max(0, Math.min(20, Math.floor((db + 60) / 3))));
    footerEl.textContent = `RMS ${db.toFixed(1)} dB ${bar}`;
  }, 100);
}

main().catch((e) => {
  console.error(e);
  document.getElementById('status').textContent = `Startup failed: ${e.message}`;
});
