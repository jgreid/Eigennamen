// Bull Fascinator — Audio engine (drone + binaural beats)

export class AudioEngine {
    constructor(settings) {
        this.settings = settings;
        this.ctx = null;
        this.started = false;

        // Drone
        this.droneOsc = null;
        this.droneGain = null;

        // Binaural
        this.binLeft = null;
        this.binRight = null;
        this.binGain = null;

        // Band frequencies (base frequency for left ear)
        this.bandFreqs = {
            theta: { base: 200, beat: 6 },    // 6 Hz theta
            delta: { base: 200, beat: 2 },    // 2 Hz delta
            alpha: { base: 200, beat: 10 },   // 10 Hz alpha
        };

        // Start on first user interaction
        const start = () => {
            if (!this.started) this._init();
            document.removeEventListener('click', start);
            document.removeEventListener('touchstart', start);
        };
        document.addEventListener('click', start);
        document.addEventListener('touchstart', start);

        // Listen for settings changes
        settings.on('droneVolume', (v) => this._setDroneVolume(v));
        settings.on('binauralEnabled', (v) => this._setBinaural(v));
        settings.on('binauralBand', (v) => this._setBinauralBand(v));
        settings.on('binauralVolume', (v) => this._setBinauralVolume(v));
    }

    _init() {
        this.started = true;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('AudioContext not available:', e);
            return;
        }

        // Drone: low filtered noise-like oscillator
        this.droneOsc = this.ctx.createOscillator();
        this.droneOsc.type = 'sine';
        this.droneOsc.frequency.value = 55; // low A

        const droneOsc2 = this.ctx.createOscillator();
        droneOsc2.type = 'sine';
        droneOsc2.frequency.value = 55.3; // slight detune for warmth

        this.droneGain = this.ctx.createGain();
        this.droneGain.gain.value = this.settings.get('droneVolume') ?? 0.3;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 200;

        this.droneOsc.connect(filter);
        droneOsc2.connect(filter);
        filter.connect(this.droneGain);
        this.droneGain.connect(this.ctx.destination);

        this.droneOsc.start();
        droneOsc2.start();

        // Binaural setup
        this._setupBinaural();
    }

    _setupBinaural() {
        if (!this.ctx) return;

        const merger = this.ctx.createChannelMerger(2);
        this.binGain = this.ctx.createGain();
        this.binGain.gain.value = this.settings.get('binauralEnabled')
            ? (this.settings.get('binauralVolume') ?? 0.2)
            : 0;

        this.binLeft = this.ctx.createOscillator();
        this.binRight = this.ctx.createOscillator();
        this.binLeft.type = 'sine';
        this.binRight.type = 'sine';

        const band = this.settings.get('binauralBand') || 'theta';
        const freq = this.bandFreqs[band];
        this.binLeft.frequency.value = freq.base;
        this.binRight.frequency.value = freq.base + freq.beat;

        const gainL = this.ctx.createGain();
        const gainR = this.ctx.createGain();
        gainL.gain.value = 1;
        gainR.gain.value = 1;

        this.binLeft.connect(gainL);
        this.binRight.connect(gainR);
        gainL.connect(merger, 0, 0);
        gainR.connect(merger, 0, 1);
        merger.connect(this.binGain);
        this.binGain.connect(this.ctx.destination);

        this.binLeft.start();
        this.binRight.start();
    }

    _setDroneVolume(v) {
        if (this.droneGain) {
            this.droneGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
        }
    }

    _setBinaural(enabled) {
        if (this.binGain) {
            const vol = enabled ? (this.settings.get('binauralVolume') ?? 0.2) : 0;
            this.binGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.1);
        }
    }

    _setBinauralBand(band) {
        const freq = this.bandFreqs[band];
        if (!freq || !this.binLeft) return;
        this.binLeft.frequency.setTargetAtTime(freq.base, this.ctx.currentTime, 0.1);
        this.binRight.frequency.setTargetAtTime(freq.base + freq.beat, this.ctx.currentTime, 0.1);
    }

    _setBinauralVolume(v) {
        if (this.binGain && this.settings.get('binauralEnabled')) {
            this.binGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
        }
    }

    setPreset(preset) {
        // Presets don't currently change audio settings, but could in the future
    }

    update(time) {
        // Future: audio-reactive features, throb-synced volume modulation
    }
}
