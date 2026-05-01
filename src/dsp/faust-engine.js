// Faust WASM runtime — single-voice editor harness.
//
// Unlike the production C++ side which manages a 64-voice pool, the editor
// runs a SINGLE FaustMonoDspGenerator instance. We only need to audition
// one pair (A material × B material) at a time — multiple voices would
// just stack on top of themselves with the same params.
//
// Slider names mirror modal-resonator.dsp:
//   freq_A, decay_A, hf_damping_A, inharmonicity_A, tonality_A, hardness_A, roughness_A
//   freq_B, decay_B, hf_damping_B, inharmonicity_B, tonality_B, hardness_B, roughness_B
//   cd_alpha
//   trig (button)  impact_force  impact_vel
//   gate  tangent_vel  normal_force  friction_coeff

import {
  instantiateFaustModuleFromFile,
  LibFaust,
  FaustCompiler,
  FaustMonoDspGenerator,
} from '@grame/faustwasm';

const DSP_NAME = 'ModalResonator';
const TRIG_DURATION_MS = 60;

class FaustEngine {
  constructor() {
    this.audioContext = null;
    this.node = null;
    this.analyser = null;
    this.params = new Set();
  }

  async init(dspCode) {
    this.audioContext = new AudioContext({ sampleRate: 48000 });

    // BASE_URL is '/' in dev, '/modalsynth/' in prod (see vite.config.js).
    const faustModule = await instantiateFaustModuleFromFile(
      `${import.meta.env.BASE_URL}faustwasm/libfaust-wasm.js`
    );
    const libFaust = new LibFaust(faustModule);
    const compiler = new FaustCompiler(libFaust);

    const generator = new FaustMonoDspGenerator();
    await generator.compile(compiler, DSP_NAME, dspCode, '-I libraries/');

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.audioContext.destination);

    this.node = await generator.createNode(this.audioContext);
    this.node.connect(this.analyser);

    // Cache available param paths so setParam() can validate.
    const declaredParams = this.node.getParams?.() ?? [];
    declaredParams.forEach((p) => this.params.add(p));
    console.log(`[FaustEngine] ${declaredParams.length} params loaded`);
  }

  /** Set a slider by short name (e.g. "freq_A"). */
  setParam(name, value) {
    if (!this.node) return;
    this.node.setParamValue(`/${DSP_NAME}/${name}`, value);
  }

  getParam(name) {
    if (!this.node) return 0;
    return this.node.getParamValue(`/${DSP_NAME}/${name}`);
  }

  /** Bulk set, ignoring unknown keys silently (useful for preset → DSP slot maps). */
  setMany(prefix, paramObj) {
    for (const [k, v] of Object.entries(paramObj)) {
      const slider = `${k}_${prefix}`;
      this.setParam(slider, v);
    }
  }

  /** Pulse the trig button: 0 → 1 → 0. */
  triggerImpact(forceN = 100, velMs = 3) {
    if (!this.node) return;
    this.setParam('impact_force', forceN);
    this.setParam('impact_vel', velMs);
    this.setParam('trig', 1);
    setTimeout(() => this.setParam('trig', 0), TRIG_DURATION_MS);
  }

  setGate(open) {
    this.setParam('gate', open ? 1 : 0);
  }

  setContact(slip, normalForce, friction) {
    this.setParam('tangent_vel', slip);
    this.setParam('normal_force', normalForce);
    this.setParam('friction_coeff', friction);
  }

  setCrossDampingAlpha(alpha) {
    this.setParam('cd_alpha', alpha);
  }

  /** Returns RMS dB of last analyzer block. */
  getAudioLevelDb() {
    if (!this.analyser) return -120;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    return 20 * Math.log10(Math.max(rms, 1e-10));
  }

  async resume() {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
  }
}

export default FaustEngine;
