// 7-param panel for one material (side A or B). Slider definitions mirror
// the SoundMaterial fields exactly — the WebUI is the canonical reference
// for tuning before values get baked into Unity SoundMaterial assets.
//
// Each param has a logarithmic option (log:true) — useful for fields that
// span >2 orders of magnitude (freq, decay, hf_damping, inharmonicity).
// Linear sliders work for 0-1 perceptual scalars (tonality, hardness, roughness).

const PARAMS = [
  { name: 'freq',          label: 'Freq',          unit: 'Hz', min: 20,    max: 8000, step: 1,      log: true,  default: 400 },
  { name: 'decay',         label: 'Decay',         unit: 's',  min: 0.01,  max: 5,    step: 0.01,   log: true,  default: 1.0 },
  { name: 'hf_damping',    label: 'HF damping',    unit: '',   min: 0,     max: 1,    step: 0.001,  log: false, default: 0.5 },
  { name: 'inharmonicity', label: 'Inharmonicity', unit: '',   min: 0,     max: 1,    step: 0.001,  log: false, default: 0.1 },
  { name: 'tonality',      label: 'Tonality',      unit: '',   min: 0,     max: 1,    step: 0.001,  log: false, default: 0.8 },
  { name: 'hardness',      label: 'Hardness',      unit: '',   min: 0,     max: 1,    step: 0.001,  log: false, default: 0.8 },
  { name: 'roughness',     label: 'Roughness',     unit: '',   min: 0,     max: 1,    step: 0.001,  log: false, default: 0.5 },
];

class ParamPanel {
  /**
   * @param {HTMLElement} container
   * @param {FaustEngine} faustEngine
   * @param {'A'|'B'} side  — which DSP slider group to drive (freq_A vs freq_B)
   */
  constructor(container, faustEngine, side) {
    this.container = container;
    this.faustEngine = faustEngine;
    this.side = side;
    this.sliders = {};
    this.valueDisplays = {};
    this.values = {};
    this._changeCallbacks = [];
    this._build();
  }

  _build() {
    for (const p of PARAMS) {
      this.values[p.name] = p.default;

      const group = document.createElement('div');
      group.className = 'param-group';

      const labelRow = document.createElement('div');
      labelRow.className = 'param-label-row';

      const label = document.createElement('label');
      label.textContent = p.label;

      const valSpan = document.createElement('span');
      valSpan.className = 'param-value';
      valSpan.textContent = this._formatValue(p, p.default);

      labelRow.append(label, valSpan);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'param-slider';

      // Map between linear slider position [0,1] and actual param value
      // using either linear or log scale.
      if (p.log) {
        slider.min = '0';
        slider.max = '1000';
        slider.step = '1';
        slider.value = String(this._valueToSliderPos(p, p.default));
      } else {
        slider.min = String(p.min);
        slider.max = String(p.max);
        slider.step = String(p.step);
        slider.value = String(p.default);
      }

      slider.addEventListener('input', () => {
        const v = p.log
          ? this._sliderPosToValue(p, parseFloat(slider.value))
          : parseFloat(slider.value);
        this.values[p.name] = v;
        valSpan.textContent = this._formatValue(p, v);
        this.faustEngine?.setParam(`${p.name}_${this.side}`, v);
        this._notify();
      });

      this.sliders[p.name] = slider;
      this.valueDisplays[p.name] = valSpan;

      group.append(labelRow, slider);
      this.container.appendChild(group);
    }
  }

  _formatValue(p, v) {
    let formatted;
    if (Math.abs(v) >= 100) formatted = v.toFixed(0);
    else if (Math.abs(v) >= 10) formatted = v.toFixed(1);
    else if (Math.abs(v) >= 1) formatted = v.toFixed(2);
    else formatted = v.toFixed(4);
    return p.unit ? `${formatted} ${p.unit}` : formatted;
  }

  _valueToSliderPos(p, v) {
    // Log-scale: pos∈[0,1000] ↔ value∈[min, max] geometrically.
    const lo = Math.max(p.min, 1e-6);
    const hi = p.max;
    const cv = Math.max(lo, Math.min(hi, v));
    const ratio = (Math.log(cv) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    return ratio * 1000;
  }

  _sliderPosToValue(p, pos) {
    const lo = Math.max(p.min, 1e-6);
    const hi = p.max;
    const ratio = pos / 1000;
    return lo * Math.pow(hi / lo, ratio);
  }

  /** Returns shallow copy of current values keyed by param short name. */
  getValues() {
    return { ...this.values };
  }

  /** Apply preset values (matches PARAMS keys). Updates DSP and UI. */
  setValues(params) {
    for (const p of PARAMS) {
      if (!(p.name in params)) continue;
      const v = parseFloat(params[p.name]);
      if (Number.isNaN(v)) continue;
      this.values[p.name] = v;
      const slider = this.sliders[p.name];
      slider.value = String(p.log ? this._valueToSliderPos(p, v) : v);
      this.valueDisplays[p.name].textContent = this._formatValue(p, v);
      this.faustEngine?.setParam(`${p.name}_${this.side}`, v);
    }
    this._notify();
  }

  onChange(cb) {
    this._changeCallbacks.push(cb);
  }

  _notify() {
    for (const cb of this._changeCallbacks) cb(this.values);
  }
}

export { ParamPanel, PARAMS };
