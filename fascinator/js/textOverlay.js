// Bull Fascinator — Text overlay system
// Renders phrases into the WebGL visual field via canvas-to-texture

import { PHRASE_GROUPS } from './phrases.js';

// Phase states for text animation
const PHASE_IDLE = 0;
const PHASE_FADE_IN = 1;
const PHASE_HOLD = 2;
const PHASE_FADE_OUT = 3;

// Frequency presets: [minGap, maxGap] in seconds
const FREQUENCY_GAPS = {
    rare:     [35, 60],
    normal:   [15, 45],
    frequent: [8, 20],
};

// Size presets: fraction of viewport height
const SIZE_MAP = { small: 0.03, medium: 0.055, large: 0.08 };

// Opacity presets: peak alpha
const OPACITY_MAP = { subtle: 0.4, normal: 0.65, bold: 0.85 };

// Timing (seconds)
const FADE_IN_DURATION = 2.5;
const HOLD_DURATION = 4.0;
const FADE_OUT_DURATION = 3.5;

export class TextOverlay {
    constructor(renderer, settings) {
        this.renderer = renderer;
        this.settings = settings;

        // 2D canvas for text rendering
        this.canvas2d = document.createElement('canvas');
        this.ctx = this.canvas2d.getContext('2d');

        // State
        this.phase = PHASE_IDLE;
        this.phaseStart = 0;
        this.currentPhrase = '';
        this.lastPhrase = '';
        this.nextShowTime = 0; // timestamp when next phrase should start
        this.alpha = 0;

        // Noise mask for reveal/dissolve
        this.noiseCanvas = document.createElement('canvas');
        this.noiseCtx = this.noiseCanvas.getContext('2d');
        this._generateNoiseMask();
    }

    _generateNoiseMask() {
        // Generate a static noise texture for masking text reveal
        const size = 256;
        this.noiseCanvas.width = size;
        this.noiseCanvas.height = size;
        const ctx = this.noiseCtx;
        const img = ctx.createImageData(size, size);
        for (let i = 0; i < img.data.length; i += 4) {
            const v = Math.random() * 255;
            img.data[i] = v;
            img.data[i+1] = v;
            img.data[i+2] = v;
            img.data[i+3] = 255;
        }
        ctx.putImageData(img, 0, 0);
    }

    _getEnabledPhrases() {
        const phrases = [];
        const enabledGroups = this.settings.get('activeGroups') || PHRASE_GROUPS.map(g => g.id);

        for (const group of PHRASE_GROUPS) {
            if (enabledGroups.includes(group.id)) {
                phrases.push(...group.phrases);
            }
        }

        // Add custom phrases
        const custom = this.settings.get('customPhrases') || [];
        phrases.push(...custom);

        return phrases;
    }

    _pickPhrase() {
        const phrases = this._getEnabledPhrases();
        if (phrases.length === 0) return '';
        if (phrases.length === 1) return phrases[0];

        let pick;
        let attempts = 0;
        do {
            pick = phrases[Math.floor(Math.random() * phrases.length)];
            attempts++;
        } while (pick === this.lastPhrase && attempts < 10);

        return pick;
    }

    _getGapRange(bathElapsed) {
        const freqSetting = this.settings.get('textFrequency') || 'normal';
        let [minGap, maxGap] = FREQUENCY_GAPS[freqSetting] || FREQUENCY_GAPS.normal;

        // Bath mode deepening: shrink gaps over time (over ~5 minutes)
        if (bathElapsed > 0) {
            const depth = Math.min(bathElapsed / 300, 1.0);
            const shrink = depth * 0.5; // up to 50% reduction
            minGap *= (1 - shrink);
            maxGap *= (1 - shrink);
            minGap = Math.max(minGap, 5);
            maxGap = Math.max(maxGap, minGap + 3);
        }

        return [minGap, maxGap];
    }

    _scheduleNext(now, bathElapsed) {
        const [minGap, maxGap] = this._getGapRange(bathElapsed);
        const gap = minGap + Math.random() * (maxGap - minGap);
        this.nextShowTime = now + gap * 1000;
    }

    _getPaletteTextColor() {
        // Use the brightest/lightest color from the current palette
        const palette = this.renderer.palette;
        let brightest = palette[0];
        let maxLum = 0;
        for (const c of palette) {
            const lum = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
            if (lum > maxLum) {
                maxLum = lum;
                brightest = c;
            }
        }
        // Boost it toward white for readability
        const r = Math.min(255, Math.round((brightest[0] * 0.5 + 0.5) * 255));
        const g = Math.min(255, Math.round((brightest[1] * 0.5 + 0.5) * 255));
        const b = Math.min(255, Math.round((brightest[2] * 0.5 + 0.5) * 255));
        return `${r},${g},${b}`;
    }

    _renderText(alpha, throb) {
        const w = this.renderer.width;
        const h = this.renderer.height;

        if (this.canvas2d.width !== w || this.canvas2d.height !== h) {
            this.canvas2d.width = w;
            this.canvas2d.height = h;
        }

        const ctx = this.ctx;
        ctx.clearRect(0, 0, w, h);

        if (alpha <= 0 || !this.currentPhrase) return;

        // Text settings
        const sizeSetting = this.settings.get('textSize') || 'medium';
        const sizeRatio = SIZE_MAP[sizeSetting] || SIZE_MAP.medium;
        const fontSize = Math.round(h * sizeRatio);

        const opacitySetting = this.settings.get('textOpacity') || 'normal';
        const peakAlpha = OPACITY_MAP[opacitySetting] || OPACITY_MAP.normal;

        // Throb modulates opacity slightly
        const throbMod = 1.0 + (throb - 0.5) * 0.08;
        const finalAlpha = Math.min(1, alpha * peakAlpha * throbMod);

        const color = this._getPaletteTextColor();

        ctx.save();
        ctx.font = `300 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Noise-based mask for reveal/dissolve effect
        if (alpha < 1.0) {
            this._drawWithNoiseMask(ctx, w, h, fontSize, color, finalAlpha, alpha);
        } else {
            ctx.fillStyle = `rgba(${color}, ${finalAlpha})`;
            ctx.fillText(this.currentPhrase, w / 2, h / 2);
        }

        ctx.restore();

        // Upload to WebGL
        this.renderer.uploadTextTexture(this.canvas2d);
    }

    _drawWithNoiseMask(ctx, w, h, fontSize, color, finalAlpha, progress) {
        // Draw text to a temporary canvas, then mask with noise threshold
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = w;
        tempCanvas.height = h;
        const tctx = tempCanvas.getContext('2d');

        tctx.font = ctx.font;
        tctx.textAlign = 'center';
        tctx.textBaseline = 'middle';
        tctx.fillStyle = `rgba(${color}, ${finalAlpha})`;
        tctx.fillText(this.currentPhrase, w / 2, h / 2);

        // Get text pixels
        const textBounds = this._getTextBounds(w, h, fontSize);
        if (textBounds.w <= 0 || textBounds.h <= 0) return;

        const textData = tctx.getImageData(textBounds.x, textBounds.y, textBounds.w, textBounds.h);

        // Use noise to threshold — pixels only show where noise < progress
        // This creates a crystallize-from-noise effect
        const noiseScale = 256 / Math.max(textBounds.w, textBounds.h);
        for (let y = 0; y < textBounds.h; y++) {
            for (let x = 0; x < textBounds.w; x++) {
                const ni = ((y * noiseScale | 0) % 256) * 256 + ((x * noiseScale | 0) % 256);
                const noiseVal = this._sampleNoise(x * noiseScale, y * noiseScale);
                const threshold = progress;
                const i = (y * textBounds.w + x) * 4;
                if (noiseVal > threshold) {
                    textData.data[i + 3] = 0; // hide this pixel
                } else {
                    // Soften edges near threshold
                    const edge = Math.min(1, (threshold - noiseVal) * 8);
                    textData.data[i + 3] = Math.round(textData.data[i + 3] * edge);
                }
            }
        }

        tctx.putImageData(textData, textBounds.x, textBounds.y);
        ctx.drawImage(tempCanvas, 0, 0);
    }

    _sampleNoise(x, y) {
        // Simple hash-based noise (faster than reading canvas pixels)
        const ix = (x | 0) & 255;
        const iy = (y | 0) & 255;
        const n = Math.sin(ix * 12.9898 + iy * 78.233) * 43758.5453;
        return n - Math.floor(n);
    }

    _getTextBounds(w, h, fontSize) {
        const textW = Math.min(w, this.currentPhrase.length * fontSize * 0.7);
        const bw = Math.round(textW + fontSize);
        const bh = Math.round(fontSize * 2);
        const bx = Math.round(w / 2 - bw / 2);
        const by = Math.round(h / 2 - bh / 2);
        return { x: Math.max(0, bx), y: Math.max(0, by), w: Math.min(bw, w), h: Math.min(bh, h) };
    }

    onPresetChange() {
        // Reset timing when preset changes
        this.phase = PHASE_IDLE;
        this.nextShowTime = performance.now() + 3000; // short initial delay
    }

    update(time, throb, bathElapsed) {
        const enabled = this.settings.get('textEnabled') !== false;
        if (!enabled) {
            if (this.alpha > 0) {
                this.alpha = 0;
                this._renderText(0, throb);
            }
            return;
        }

        const elapsed = (time - this.phaseStart) / 1000;

        switch (this.phase) {
            case PHASE_IDLE:
                if (time >= this.nextShowTime) {
                    const phrase = this._pickPhrase();
                    if (!phrase) {
                        this._scheduleNext(time, bathElapsed);
                        return;
                    }
                    this.currentPhrase = phrase;
                    this.lastPhrase = phrase;
                    this.phase = PHASE_FADE_IN;
                    this.phaseStart = time;
                }
                return;

            case PHASE_FADE_IN:
                this.alpha = Math.min(1, elapsed / FADE_IN_DURATION);
                if (elapsed >= FADE_IN_DURATION) {
                    this.alpha = 1;
                    this.phase = PHASE_HOLD;
                    this.phaseStart = time;
                }
                break;

            case PHASE_HOLD:
                this.alpha = 1;
                if (elapsed >= HOLD_DURATION) {
                    this.phase = PHASE_FADE_OUT;
                    this.phaseStart = time;
                }
                break;

            case PHASE_FADE_OUT:
                this.alpha = Math.max(0, 1 - elapsed / FADE_OUT_DURATION);
                if (elapsed >= FADE_OUT_DURATION) {
                    this.alpha = 0;
                    this.phase = PHASE_IDLE;
                    this._scheduleNext(time, bathElapsed);
                }
                break;
        }

        this._renderText(this.alpha, throb);
    }
}
