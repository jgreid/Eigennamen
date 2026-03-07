// Bull Fascinator — main entry point
import { Renderer } from './renderer.js';
import { TextOverlay } from './textOverlay.js';
import { Settings } from './settings.js';
import { Storage } from './storage.js';
import { Presets, BUILT_IN_PRESETS } from './presets.js';
import { AudioEngine } from './audio.js';

const canvas = document.getElementById('canvas');
const renderer = new Renderer(canvas);
const storage = new Storage();
const settings = new Settings(storage);
const presets = new Presets(storage, settings);
const audio = new AudioEngine(settings);
const textOverlay = new TextOverlay(renderer, settings);

let running = true;
let bathMode = false;
let bathStart = 0;
let autoHideTimer = null;

// --- Animation loop ---
function frame(t) {
    if (!running) { requestAnimationFrame(frame); return; }

    const bathElapsed = bathMode ? (t - bathStart) / 1000 : 0;
    renderer.render(t, bathElapsed);
    textOverlay.update(t, renderer.throb, bathElapsed);
    audio.update(t);

    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Control bar ---
const controlBar = document.getElementById('control-bar');
const btnPlay = document.getElementById('btn-play');
const btnPreset = document.getElementById('btn-preset');
const presetMenu = document.getElementById('preset-menu');
const btnBath = document.getElementById('btn-bath');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnSettings = document.getElementById('btn-settings');
const sliderFeedback = document.getElementById('slider-feedback');

function resetAutoHide() {
    controlBar.classList.remove('autohide');
    clearTimeout(autoHideTimer);
    autoHideTimer = setTimeout(() => {
        if (!presetMenu.classList.contains('hidden')) return;
        controlBar.classList.add('autohide');
    }, 4000);
}
document.addEventListener('pointermove', resetAutoHide);
document.addEventListener('pointerdown', resetAutoHide);
resetAutoHide();

btnPlay.addEventListener('click', () => {
    running = !running;
    btnPlay.innerHTML = running ? '&#9646;&#9646;' : '&#9654;';
    btnPlay.classList.toggle('active', running);
});
btnPlay.classList.add('active');
btnPlay.innerHTML = '&#9646;&#9646;';

btnPreset.addEventListener('click', (e) => {
    e.stopPropagation();
    presetMenu.classList.toggle('hidden');
});
document.addEventListener('click', () => presetMenu.classList.add('hidden'));

presetMenu.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
        const name = btn.dataset.preset;
        const preset = BUILT_IN_PRESETS[name];
        if (preset) {
            presets.apply(preset);
            renderer.setPreset(preset);
            audio.setPreset(preset);
            textOverlay.onPresetChange();
        }
        presetMenu.classList.add('hidden');
    });
});

document.getElementById('btn-save-preset').addEventListener('click', () => {
    document.getElementById('save-preset-overlay').classList.remove('hidden');
    document.getElementById('input-preset-name').focus();
});
document.getElementById('btn-cancel-save').addEventListener('click', () => {
    document.getElementById('save-preset-overlay').classList.add('hidden');
});
document.getElementById('btn-confirm-save').addEventListener('click', async () => {
    const name = document.getElementById('input-preset-name').value.trim();
    if (name) {
        await presets.saveCustom(name, renderer, settings);
        document.getElementById('save-preset-overlay').classList.add('hidden');
        document.getElementById('input-preset-name').value = '';
    }
});

btnBath.addEventListener('click', () => {
    bathMode = !bathMode;
    btnBath.classList.toggle('active', bathMode);
    if (bathMode) bathStart = performance.now();
});

sliderFeedback.addEventListener('input', () => {
    renderer.feedbackIntensity = sliderFeedback.value / 100;
    settings.set('feedbackIntensity', sliderFeedback.value / 100);
});

// Sync feedback slider in settings with control bar
const sliderFeedbackSettings = document.getElementById('slider-feedback-settings');
sliderFeedback.addEventListener('input', () => {
    sliderFeedbackSettings.value = sliderFeedback.value;
});
sliderFeedbackSettings.addEventListener('input', () => {
    sliderFeedback.value = sliderFeedbackSettings.value;
    renderer.feedbackIntensity = sliderFeedbackSettings.value / 100;
    settings.set('feedbackIntensity', sliderFeedbackSettings.value / 100);
});

btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen();
    }
});

btnSettings.addEventListener('click', () => {
    document.getElementById('settings-overlay').classList.remove('hidden');
});
document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-overlay').classList.add('hidden');
});
document.getElementById('settings-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById('settings-overlay').classList.add('hidden');
    }
});

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); btnPlay.click(); }
    if (e.key === 'f') btnFullscreen.click();
    if (e.key === 'b') btnBath.click();
    if (e.key === 's') btnSettings.click();
    if (e.key === 'Escape') {
        document.getElementById('settings-overlay').classList.add('hidden');
        document.getElementById('save-preset-overlay').classList.add('hidden');
    }
});

// --- Settings wiring ---
settings.on('feedbackIntensity', (v) => {
    renderer.feedbackIntensity = v;
    sliderFeedback.value = Math.round(v * 100);
    sliderFeedbackSettings.value = Math.round(v * 100);
});
settings.on('performanceMode', (v) => { renderer.performanceMode = v; });

// Audio settings
document.getElementById('toggle-binaural').addEventListener('change', (e) => {
    document.getElementById('binaural-options').classList.toggle('hidden', !e.target.checked);
    settings.set('binauralEnabled', e.target.checked);
});
document.getElementById('toggle-audio-reactive').addEventListener('change', (e) => {
    document.getElementById('audio-reactive-options').classList.toggle('hidden', !e.target.checked);
    settings.set('audioReactive', e.target.checked);
});
document.getElementById('slider-drone-vol').addEventListener('input', (e) => {
    settings.set('droneVolume', e.target.value / 100);
});
document.getElementById('select-binaural-band').addEventListener('change', (e) => {
    settings.set('binauralBand', e.target.value);
});
document.getElementById('slider-binaural-vol').addEventListener('input', (e) => {
    settings.set('binauralVolume', e.target.value / 100);
});
document.getElementById('slider-audio-sensitivity').addEventListener('input', (e) => {
    settings.set('audioSensitivity', e.target.value / 100);
});
document.getElementById('toggle-perf').addEventListener('change', (e) => {
    settings.set('performanceMode', e.target.checked);
});

// --- Init ---
(async () => {
    await storage.init();
    await settings.load();
    textOverlay.onPresetChange();

    // Restore UI from settings
    sliderFeedback.value = Math.round((settings.get('feedbackIntensity') ?? 0.5) * 100);
    sliderFeedbackSettings.value = sliderFeedback.value;
    renderer.feedbackIntensity = settings.get('feedbackIntensity') ?? 0.5;
})();

// Canvas resize
function resize() {
    const dpr = settings.get('performanceMode') ? 1 : Math.min(window.devicePixelRatio, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    renderer.resize(canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();
