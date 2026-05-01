// Contact-event controls for the editor.
//   - Impact button + force/vel sliders → triggers SE_TriggerImpact equivalent
//   - Gate toggle → opens/closes friction sustain
//   - Slip / Normal force / Friction-coeff sliders → live friction params
//
// The DSP receives these as raw slider values (no smoothing on the C# side
// since there's no Unity here). All values are in normalized DSP-side units:
//   slip ∈ [0,1]      (was tangent_vel)
//   normal_force ∈ [0,1]
//   friction_coeff ∈ [0,1]
//   impact_force ∈ [0, 10000] (Newtons, raw)
//   impact_vel ∈ [0, 100]     (m/s, raw)

const CONTROLS = [
  { name: 'impact_force', label: 'Impact force',  unit: 'N',   min: 1,    max: 5000, step: 1,    log: true,  default: 100 },
  { name: 'impact_vel',   label: 'Impact vel',    unit: 'm/s', min: 0.1,  max: 30,   step: 0.1,  log: true,  default: 3.0 },
  { name: 'tangent_vel',  label: 'Slip',          unit: '',    min: 0,    max: 1,    step: 0.001, log: false, default: 0.3 },
  { name: 'normal_force', label: 'Normal force',  unit: '',    min: 0,    max: 1,    step: 0.001, log: false, default: 0.3 },
  { name: 'friction_coeff', label: 'μ',           unit: '',    min: 0,    max: 1,    step: 0.001, log: false, default: 0.6 },
];

class ContactControls {
  constructor(container, faustEngine) {
    this.container = container;
    this.faustEngine = faustEngine;
    this.values = {};
    this.gateOpen = false;
    this._build();
  }

  _build() {
    // Top row: impact button + gate toggle
    const topRow = document.createElement('div');
    topRow.className = 'contact-row';

    const impactBtn = document.createElement('button');
    impactBtn.textContent = 'Impact';
    impactBtn.className = 'btn btn-primary';
    impactBtn.addEventListener('click', async () => {
      await this.faustEngine?.resume();
      const f = this.values.impact_force ?? 100;
      const v = this.values.impact_vel ?? 3;
      this.faustEngine?.triggerImpact(f, v);
    });

    const gateLabel = document.createElement('label');
    gateLabel.className = 'gate-toggle';
    const gateCheckbox = document.createElement('input');
    gateCheckbox.type = 'checkbox';
    gateCheckbox.addEventListener('change', async () => {
      await this.faustEngine?.resume();
      this.gateOpen = gateCheckbox.checked;
      this.faustEngine?.setGate(this.gateOpen);
    });
    const gateText = document.createElement('span');
    gateText.textContent = 'Gate (sustain friction)';
    gateLabel.append(gateCheckbox, gateText);

    topRow.append(impactBtn, gateLabel);
    this.container.appendChild(topRow);

    const sep = document.createElement('div');
    sep.className = 'section-divider';
    this.container.appendChild(sep);

    // Slider rows
    for (const c of CONTROLS) {
      this.values[c.name] = c.default;

      const group = document.createElement('div');
      group.className = 'param-group';

      const labelRow = document.createElement('div');
      labelRow.className = 'param-label-row';
      const label = document.createElement('label');
      label.textContent = c.label;
      const valSpan = document.createElement('span');
      valSpan.className = 'param-value';
      valSpan.textContent = this._fmt(c, c.default);
      labelRow.append(label, valSpan);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'param-slider';
      if (c.log) {
        slider.min = '0';
        slider.max = '1000';
        slider.step = '1';
        slider.value = String(this._valueToPos(c, c.default));
      } else {
        slider.min = String(c.min);
        slider.max = String(c.max);
        slider.step = String(c.step);
        slider.value = String(c.default);
      }

      slider.addEventListener('input', () => {
        const v = c.log
          ? this._posToValue(c, parseFloat(slider.value))
          : parseFloat(slider.value);
        this.values[c.name] = v;
        valSpan.textContent = this._fmt(c, v);
        // Friction params apply live; impact params consumed on button click.
        if (c.name !== 'impact_force' && c.name !== 'impact_vel') {
          this.faustEngine?.setParam(c.name, v);
        }
      });

      // Push initial values to DSP (so unset friction sliders aren't 0 noise).
      if (c.name !== 'impact_force' && c.name !== 'impact_vel') {
        this.faustEngine?.setParam(c.name, c.default);
      }

      group.append(labelRow, slider);
      this.container.appendChild(group);
    }
  }

  _fmt(c, v) {
    let s;
    if (Math.abs(v) >= 100) s = v.toFixed(0);
    else if (Math.abs(v) >= 10) s = v.toFixed(1);
    else if (Math.abs(v) >= 1) s = v.toFixed(2);
    else s = v.toFixed(3);
    return c.unit ? `${s} ${c.unit}` : s;
  }

  _valueToPos(c, v) {
    const lo = Math.max(c.min, 1e-6);
    const hi = c.max;
    const cv = Math.max(lo, Math.min(hi, v));
    const ratio = (Math.log(cv) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    return ratio * 1000;
  }
  _posToValue(c, pos) {
    const lo = Math.max(c.min, 1e-6);
    const hi = c.max;
    const ratio = pos / 1000;
    return lo * Math.pow(hi / lo, ratio);
  }
}

class AlphaControl {
  /**
   * Single slider for cd_alpha (cross-damping coupling strength).
   * Default 0.15 (calibrated 2026-04-29). log range [0.001, 1] so low values
   * (independent) and high values (matched coupling) both have resolution.
   */
  constructor(container, faustEngine) {
    this.container = container;
    this.faustEngine = faustEngine;
    this.value = 0.15;
    this._build();
  }

  _build() {
    const group = document.createElement('div');
    group.className = 'param-group';

    const labelRow = document.createElement('div');
    labelRow.className = 'param-label-row';
    const label = document.createElement('label');
    label.textContent = 'α (coupling strength)';
    const valSpan = document.createElement('span');
    valSpan.className = 'param-value';
    valSpan.textContent = this.value.toFixed(3);
    labelRow.append(label, valSpan);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'param-slider';
    slider.min = '0';
    slider.max = '1000';
    slider.step = '1';
    slider.value = String(this._valueToPos(this.value));

    slider.addEventListener('input', () => {
      const v = this._posToValue(parseFloat(slider.value));
      this.value = v;
      valSpan.textContent = v.toFixed(3);
      this.faustEngine?.setCrossDampingAlpha(v);
    });

    // Initial push
    this.faustEngine?.setCrossDampingAlpha(this.value);

    const hint = document.createElement('div');
    hint.style.fontSize = '11px';
    hint.style.color = 'var(--text-secondary)';
    hint.style.marginTop = '4px';
    hint.textContent = '0 = independent · 0.3 = typical contact · 1 = rigid coupling';

    group.append(labelRow, slider, hint);
    this.container.appendChild(group);
  }

  _valueToPos(v) {
    const lo = 0.001, hi = 1.0;
    const cv = Math.max(lo, Math.min(hi, v));
    const ratio = (Math.log(cv) - Math.log(lo)) / (Math.log(hi) - Math.log(lo));
    return ratio * 1000;
  }
  _posToValue(pos) {
    const lo = 0.001, hi = 1.0;
    const ratio = pos / 1000;
    return lo * Math.pow(hi / lo, ratio);
  }
}

export { ContactControls, AlphaControl };
