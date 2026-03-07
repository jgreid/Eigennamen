// Bull Fascinator — Preset system

import { PHRASE_GROUPS } from './phrases.js';

const ALL_GROUPS = PHRASE_GROUPS.map(g => g.id);

export const BUILT_IN_PRESETS = {
    drift: {
        name: 'drift',
        palette: 'drift',
        throbSpeed: 0.001,
        feedbackIntensity: 0.6,
        textEnabled: true,
        activeGroups: [...ALL_GROUPS],
        textFrequency: 'rare',
        textSize: 'medium',
        textOpacity: 'subtle',
    },
    trance: {
        name: 'trance',
        palette: 'trance',
        throbSpeed: 0.0018,
        feedbackIntensity: 0.55,
        textEnabled: true,
        activeGroups: [...ALL_GROUPS],
        textFrequency: 'normal',
        textSize: 'medium',
        textOpacity: 'normal',
    },
    deep: {
        name: 'deep',
        palette: 'deep',
        throbSpeed: 0.001,
        feedbackIntensity: 0.7,
        textEnabled: true,
        activeGroups: [...ALL_GROUPS],
        textFrequency: 'normal', // increases with Bath Mode deepening
        textSize: 'medium',
        textOpacity: 'normal',
    },
    surge: {
        name: 'surge',
        palette: 'surge',
        throbSpeed: 0.004,
        feedbackIntensity: 0.4,
        textEnabled: false,
        activeGroups: [...ALL_GROUPS],
        textFrequency: 'normal',
        textSize: 'medium',
        textOpacity: 'normal',
    },
    flesh: {
        name: 'flesh',
        palette: 'flesh',
        throbSpeed: 0.0015,
        feedbackIntensity: 0.5,
        textEnabled: true,
        activeGroups: ['intimate', 'body', 'warm'],
        textFrequency: 'normal',
        textSize: 'medium',
        textOpacity: 'normal',
    },
    sleep: {
        name: 'sleep',
        palette: 'sleep',
        throbSpeed: 0.0008,
        feedbackIntensity: 0.75,
        textEnabled: true,
        activeGroups: ['warm', 'surrender'],
        textFrequency: 'rare',
        textSize: 'medium',
        textOpacity: 'subtle',
    },
    worship: {
        name: 'worship',
        palette: 'worship',
        throbSpeed: 0.0012,
        feedbackIntensity: 0.6,
        textEnabled: true,
        activeGroups: [...ALL_GROUPS],
        textFrequency: 'normal',
        textSize: 'medium',
        textOpacity: 'normal',
    },
};

export class Presets {
    constructor(storage, settings) {
        this.storage = storage;
        this.settings = settings;
    }

    apply(preset) {
        // Apply visual settings
        if (preset.feedbackIntensity !== undefined) {
            this.settings.set('feedbackIntensity', preset.feedbackIntensity);
        }
        // Apply text settings
        this.settings.applyTextSettings(preset);
    }

    async saveCustom(name, renderer, settings) {
        const preset = {
            name,
            custom: true,
            palette: null, // custom presets store the current state
            throbSpeed: renderer.throbSpeed,
            feedbackIntensity: renderer.feedbackIntensity,
            ...settings.getTextSettings(),
            savedAt: Date.now(),
        };

        const customs = (await this.storage.get('customPresets')) || [];
        // Replace if same name exists
        const idx = customs.findIndex(p => p.name === name);
        if (idx >= 0) {
            customs[idx] = preset;
        } else {
            customs.push(preset);
        }
        await this.storage.set('customPresets', customs);
    }

    async loadCustom(name) {
        const customs = (await this.storage.get('customPresets')) || [];
        return customs.find(p => p.name === name) || null;
    }

    async getCustomList() {
        const customs = (await this.storage.get('customPresets')) || [];
        return customs.map(p => p.name);
    }
}
