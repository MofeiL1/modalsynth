// Preset manager for ONE side (A or B). The two PresetManager instances
// share the same store (static defaults.json + localStorage user state) but
// display independently — saving a preset on either side updates both lists
// instantly via the broadcast channel exposed in main.js.
//
// Persistence:
//   - Read: fetch static defaults.json, then layer in localStorage user state
//     (user-saved/edited presets win over defaults of the same name).
//   - Write: store the merged dict to localStorage. Defaults remain read-only
//     on the server; deleting a default makes it reappear on next reload,
//     which is acceptable for a public showcase.

const DEFAULTS_PATH = `${import.meta.env.BASE_URL}presets/defaults.json`;
const STORAGE_KEY = 'modalsynth.presets';

class PresetManager {
  /**
   * @param {HTMLElement} container
   * @param {ParamPanel} paramPanel
   * @param {string} sideLabel  — 'A' or 'B' (UI labeling only)
   * @param {Function} broadcastReload — call to ask sibling instance to reload presets
   */
  constructor(container, paramPanel, sideLabel, broadcastReload) {
    this.container = container;
    this.paramPanel = paramPanel;
    this.sideLabel = sideLabel;
    this.broadcastReload = broadcastReload;
    this.presets = {};
    this.currentName = '';
    this._savedSnapshot = null;
    this._dirty = false;
    this._build();
  }

  async loadDefaults() {
    let defaults = {};
    try {
      const resp = await fetch(DEFAULTS_PATH);
      defaults = await resp.json();
    } catch (e) {
      console.warn('[PresetManager] Failed to load static defaults:', e);
    }
    let userPresets = {};
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) userPresets = JSON.parse(stored);
    } catch (e) {
      /* localStorage disabled or corrupt — fall through with defaults only */
    }
    this.presets = { ...defaults, ...userPresets };
    this._refreshSelect();
  }

  async _saveToBackend() {
    // Persist the merged dict to localStorage. Defaults are re-merged on next
    // load, so user state survives reloads but doesn't overwrite the bundled
    // defaults file.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.presets));
    } catch (e) {
      throw new Error('localStorage 写入失败: ' + e.message);
    }
  }

  _build() {
    const titleRow = document.createElement('div');
    titleRow.className = 'preset-title-row';
    this.dirtyBadge = document.createElement('span');
    this.dirtyBadge.className = 'preset-dirty-badge';
    this.dirtyBadge.textContent = '● 未保存';
    this.dirtyBadge.style.display = 'none';
    titleRow.append(this.dirtyBadge);
    this.container.appendChild(titleRow);

    // Select row
    const selRow = document.createElement('div');
    selRow.className = 'preset-row';
    this.select = document.createElement('select');
    this.select.className = 'preset-select';
    this.select.addEventListener('change', () => this._onSelect());
    selRow.appendChild(this.select);
    this.container.appendChild(selRow);

    // Save row
    const saveRow = document.createElement('div');
    saveRow.className = 'preset-row';
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.placeholder = '预设名称…';
    this.nameInput.className = 'preset-name-input';
    this._saveBtn = document.createElement('button');
    this._saveBtn.textContent = '保存';
    this._saveBtn.className = 'btn btn-primary';
    this._savePending = false;
    this._savePendingTimer = null;
    this._saveBtn.addEventListener('click', () => this._onSaveClick());
    saveRow.append(this.nameInput, this._saveBtn);
    this.container.appendChild(saveRow);

    // Delete + IO row
    const ioRow = document.createElement('div');
    ioRow.className = 'preset-row';
    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.className = 'btn btn-warn';
    delBtn.addEventListener('click', () => this._onDelete());
    const expBtn = document.createElement('button');
    expBtn.textContent = '导出';
    expBtn.className = 'btn';
    expBtn.addEventListener('click', () => this._onExport());
    const impBtn = document.createElement('button');
    impBtn.textContent = '导入';
    impBtn.className = 'btn';
    impBtn.addEventListener('click', () => this._fileInput.click());
    this._fileInput = document.createElement('input');
    this._fileInput.type = 'file';
    this._fileInput.accept = '.json';
    this._fileInput.style.display = 'none';
    this._fileInput.addEventListener('change', (e) => this._onFile(e));
    ioRow.append(delBtn, expBtn, impBtn, this._fileInput);
    this.container.appendChild(ioRow);

    this._refreshSelect();
    this.paramPanel.onChange(() => this._checkDirty());
  }

  _refreshSelect() {
    const prev = this.select.value;
    this.select.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = `-- 选择 ${this.sideLabel} 预设 --`;
    this.select.appendChild(def);
    for (const name of Object.keys(this.presets)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === this.currentName) opt.selected = true;
      this.select.appendChild(opt);
    }
    if (prev && this.presets[prev]) this.select.value = prev;
  }

  _onSelect() {
    const name = this.select.value;
    if (!name || !this.presets[name]) return;
    this.currentName = name;
    this.nameInput.value = name;
    this.paramPanel.setValues(this.presets[name]);
    this._takeSnapshot();
    this._setDirty(false);
  }

  _onSaveClick() {
    if (!this._savePending) {
      const name = this.nameInput.value.trim();
      if (!name) { alert('请输入预设名称'); return; }
      this._savePending = true;
      this._saveBtn.textContent = '确认保存？';
      this._saveBtn.className = 'btn btn-save-confirm';
      this._savePendingTimer = setTimeout(() => this._resetSaveBtn(), 3000);
    } else {
      this._resetSaveBtn();
      this._onSave();
    }
  }

  _resetSaveBtn() {
    clearTimeout(this._savePendingTimer);
    this._savePending = false;
    this._saveBtn.textContent = '保存';
    this._saveBtn.className = 'btn btn-primary';
  }

  async _onSave() {
    const name = this.nameInput.value.trim();
    if (!name) return;
    this.presets[name] = this.paramPanel.getValues();
    this.currentName = name;
    try {
      await this._saveToBackend();
    } catch (e) {
      alert('保存失败: ' + e.message);
      return;
    }
    this._takeSnapshot();
    this._setDirty(false);
    this._refreshSelect();
    this.broadcastReload?.();
  }

  async _onDelete() {
    const name = this.select.value;
    if (!name) return;
    if (!confirm(`删除预设 "${name}"?`)) return;
    delete this.presets[name];
    this.currentName = '';
    this._savedSnapshot = null;
    try {
      await this._saveToBackend();
    } catch (e) {
      alert('删除失败: ' + e.message);
      return;
    }
    this._setDirty(false);
    this._refreshSelect();
    this.broadcastReload?.();
  }

  _onExport() {
    const blob = new Blob([JSON.stringify(this.presets, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'soundengine-presets.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async _onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        Object.assign(this.presets, data);
        await this._saveToBackend();
        this._refreshSelect();
        this.broadcastReload?.();
      } catch (err) {
        alert('JSON 解析失败: ' + err.message);
      }
    };
    reader.readAsText(file);
    this._fileInput.value = '';
  }

  _takeSnapshot() {
    this._savedSnapshot = this.paramPanel.getValues();
  }

  _checkDirty() {
    if (!this.currentName || !this._savedSnapshot) {
      this._setDirty(false);
      return;
    }
    const cur = this.paramPanel.getValues();
    const dirty = Object.keys(this._savedSnapshot).some((k) => {
      const before = this._savedSnapshot[k];
      const after = cur[k];
      // Tolerance scales with magnitude — for freq=8000 a 0.1 Hz wobble shouldn't flag dirty.
      const tol = Math.max(Math.abs(before), Math.abs(after), 1) * 1e-4;
      return Math.abs((after ?? 0) - (before ?? 0)) > tol;
    });
    this._setDirty(dirty);
  }

  _setDirty(dirty) {
    this._dirty = dirty;
    this.dirtyBadge.style.display = dirty ? '' : 'none';
  }

  /** Called externally when sibling PresetManager updates the backend. */
  async reload() {
    await this.loadDefaults();
  }
}

export default PresetManager;
