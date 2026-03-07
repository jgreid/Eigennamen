// Bull Fascinator — Settings management

import { PHRASE_GROUPS } from './phrases.js';

const DEFAULTS = {
    textEnabled: true,
    activeGroups: PHRASE_GROUPS.map(g => g.id),
    customPhrases: [],
    textFrequency: 'normal',  // rare | normal | frequent
    textSize: 'medium',       // small | medium | large
    textOpacity: 'normal',    // subtle | normal | bold
    droneVolume: 0.3,
    binauralEnabled: false,
    binauralBand: 'theta',
    binauralVolume: 0.2,
    audioReactive: false,
    audioSensitivity: 0.5,
    feedbackIntensity: 0.5,
    performanceMode: false,
};

const FREQ_INDEX = ['rare', 'normal', 'frequent'];
const SIZE_INDEX = ['small', 'medium', 'large'];
const OPACITY_INDEX = ['subtle', 'normal', 'bold'];

export class Settings {
    constructor(storage) {
        this.storage = storage;
        this.values = { ...DEFAULTS };
        this.listeners = {};
        this._initUI();
    }

    _initUI() {
        // Build phrase group toggles
        const container = document.getElementById('phrase-group-toggles');
        if (!container) return;

        for (const group of PHRASE_GROUPS) {
            const row = document.createElement('div');
            row.className = 'setting-row';

            const label = document.createElement('label');
            label.setAttribute('for', `toggle-group-${group.id}`);
            label.textContent = group.name;

            const count = document.createElement('span');
            count.className = 'phrase-count';
            count.textContent = `${group.phrases.length}`;

            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.id = `toggle-group-${group.id}`;
            toggle.checked = true;
            toggle.addEventListener('change', () => {
                const groups = this.get('activeGroups');
                if (toggle.checked) {
                    if (!groups.includes(group.id)) groups.push(group.id);
                } else {
                    const idx = groups.indexOf(group.id);
                    if (idx >= 0) groups.splice(idx, 1);
                }
                this.set('activeGroups', [...groups]);
            });

            row.appendChild(label);
            row.appendChild(count);
            row.appendChild(toggle);
            container.appendChild(row);
        }

        // Text overlay toggle
        document.getElementById('toggle-text')?.addEventListener('change', (e) => {
            this.set('textEnabled', e.target.checked);
        });

        // Frequency slider
        document.getElementById('slider-frequency')?.addEventListener('input', (e) => {
            this.set('textFrequency', FREQ_INDEX[e.target.value] || 'normal');
        });

        // Text size slider
        document.getElementById('slider-text-size')?.addEventListener('input', (e) => {
            this.set('textSize', SIZE_INDEX[e.target.value] || 'medium');
        });

        // Text opacity slider
        document.getElementById('slider-text-opacity')?.addEventListener('input', (e) => {
            this.set('textOpacity', OPACITY_INDEX[e.target.value] || 'normal');
        });

        // Custom phrases
        const addBtn = document.getElementById('btn-add-phrase');
        const input = document.getElementById('input-custom-phrase');
        const addPhrase = () => {
            const text = input.value.trim().toLowerCase();
            if (!text) return;
            const custom = this.get('customPhrases') || [];
            if (!custom.includes(text)) {
                custom.push(text);
                this.set('customPhrases', [...custom]);
                this._renderCustomPhrases();
            }
            input.value = '';
        };
        addBtn?.addEventListener('click', addPhrase);
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') addPhrase();
        });
    }

    _renderCustomPhrases() {
        const list = document.getElementById('custom-phrases-list');
        if (!list) return;
        list.innerHTML = '';

        const custom = this.get('customPhrases') || [];
        for (const phrase of custom) {
            const tag = document.createElement('div');
            tag.className = 'custom-phrase-tag';

            const span = document.createElement('span');
            span.textContent = phrase;
            span.title = phrase;

            const btn = document.createElement('button');
            btn.innerHTML = '&times;';
            btn.addEventListener('click', () => {
                const arr = this.get('customPhrases') || [];
                const idx = arr.indexOf(phrase);
                if (idx >= 0) arr.splice(idx, 1);
                this.set('customPhrases', [...arr]);
                this._renderCustomPhrases();
            });

            tag.appendChild(span);
            tag.appendChild(btn);
            list.appendChild(tag);
        }
    }

    _restoreUI() {
        // Sync UI elements to current values
        const el = (id) => document.getElementById(id);

        const textToggle = el('toggle-text');
        if (textToggle) textToggle.checked = this.values.textEnabled !== false;

        // Group toggles
        const groups = this.values.activeGroups || [];
        for (const group of PHRASE_GROUPS) {
            const toggle = el(`toggle-group-${group.id}`);
            if (toggle) toggle.checked = groups.includes(group.id);
        }

        const freqSlider = el('slider-frequency');
        if (freqSlider) freqSlider.value = FREQ_INDEX.indexOf(this.values.textFrequency);

        const sizeSlider = el('slider-text-size');
        if (sizeSlider) sizeSlider.value = SIZE_INDEX.indexOf(this.values.textSize);

        const opacitySlider = el('slider-text-opacity');
        if (opacitySlider) opacitySlider.value = OPACITY_INDEX.indexOf(this.values.textOpacity);

        const droneSlider = el('slider-drone-vol');
        if (droneSlider) droneSlider.value = Math.round(this.values.droneVolume * 100);

        const binToggle = el('toggle-binaural');
        if (binToggle) binToggle.checked = this.values.binauralEnabled;
        el('binaural-options')?.classList.toggle('hidden', !this.values.binauralEnabled);

        const bandSelect = el('select-binaural-band');
        if (bandSelect) bandSelect.value = this.values.binauralBand;

        const binVolSlider = el('slider-binaural-vol');
        if (binVolSlider) binVolSlider.value = Math.round(this.values.binauralVolume * 100);

        const arToggle = el('toggle-audio-reactive');
        if (arToggle) arToggle.checked = this.values.audioReactive;
        el('audio-reactive-options')?.classList.toggle('hidden', !this.values.audioReactive);

        const senSlider = el('slider-audio-sensitivity');
        if (senSlider) senSlider.value = Math.round(this.values.audioSensitivity * 100);

        const fbSlider = el('slider-feedback-settings');
        if (fbSlider) fbSlider.value = Math.round(this.values.feedbackIntensity * 100);

        const perfToggle = el('toggle-perf');
        if (perfToggle) perfToggle.checked = this.values.performanceMode;

        this._renderCustomPhrases();
    }

    get(key) {
        return this.values[key];
    }

    set(key, value) {
        this.values[key] = value;
        this._emit(key, value);
        this._save();
    }

    setMany(obj) {
        for (const [k, v] of Object.entries(obj)) {
            this.values[k] = v;
        }
        for (const [k, v] of Object.entries(obj)) {
            this._emit(k, v);
        }
        this._save();
    }

    on(key, fn) {
        if (!this.listeners[key]) this.listeners[key] = [];
        this.listeners[key].push(fn);
    }

    _emit(key, value) {
        if (this.listeners[key]) {
            for (const fn of this.listeners[key]) fn(value);
        }
    }

    async load() {
        try {
            const saved = await this.storage.get('settings');
            if (saved) {
                Object.assign(this.values, saved);
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
        this._restoreUI();
    }

    async _save() {
        try {
            await this.storage.set('settings', { ...this.values });
        } catch (e) {
            console.warn('Failed to save settings:', e);
        }
    }

    // Get text-related settings for preset serialization
    getTextSettings() {
        return {
            textEnabled: this.values.textEnabled,
            activeGroups: [...(this.values.activeGroups || [])],
            textFrequency: this.values.textFrequency,
            textSize: this.values.textSize,
            textOpacity: this.values.textOpacity,
        };
    }

    // Apply text settings from a preset
    applyTextSettings(preset) {
        if (preset.textEnabled !== undefined) this.values.textEnabled = preset.textEnabled;
        if (preset.activeGroups) this.values.activeGroups = [...preset.activeGroups];
        if (preset.textFrequency) this.values.textFrequency = preset.textFrequency;
        if (preset.textSize) this.values.textSize = preset.textSize;
        if (preset.textOpacity) this.values.textOpacity = preset.textOpacity;
        this._restoreUI();
        this._save();
    }
}
