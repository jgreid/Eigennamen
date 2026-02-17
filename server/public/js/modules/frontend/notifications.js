// ========== NOTIFICATIONS MODULE ==========
// Sound and tab notifications
import { state } from './state.js';
import { safeGetItem, safeSetItem } from './utils.js';
import { t } from './i18n.js';
import { logger } from './logger.js';
// Load notification preferences from localStorage
export function loadNotificationPrefs() {
    state.notificationPrefs.soundEnabled = safeGetItem('eigennamen-pref-sound') === 'true';
    state.notificationPrefs.tabNotificationEnabled = safeGetItem('eigennamen-pref-tab-notification') === 'true';
    // Update checkboxes if they exist
    const soundCheckbox = document.getElementById('pref-sound-notifications');
    const tabCheckbox = document.getElementById('pref-tab-notification');
    if (soundCheckbox)
        soundCheckbox.checked = state.notificationPrefs.soundEnabled;
    if (tabCheckbox)
        tabCheckbox.checked = state.notificationPrefs.tabNotificationEnabled;
}
// Save notification preferences to localStorage
export function saveNotificationPrefs() {
    safeSetItem('eigennamen-pref-sound', state.notificationPrefs.soundEnabled.toString());
    safeSetItem('eigennamen-pref-tab-notification', state.notificationPrefs.tabNotificationEnabled.toString());
}
// Initialize Audio Context (must be triggered by user gesture)
export function initAudioContext() {
    if (!state.audioContext) {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browsers require user gesture)
    if (state.audioContext.state === 'suspended') {
        state.audioContext.resume();
    }
    return state.audioContext;
}
// Play a notification sound using Web Audio API
// soundType: 'turn' (default), 'reveal', 'gameOver', 'join', 'error'
export function playNotificationSound(soundType = 'turn') {
    if (!state.notificationPrefs.soundEnabled)
        return;
    try {
        const ctx = initAudioContext();
        if (!ctx)
            return;
        const now = ctx.currentTime;
        switch (soundType) {
            case 'reveal':
                // Short click/pop sound for card reveal
                playTone(ctx, now, 440, 0.1, 0.15, 'sine');
                break;
            case 'gameOver':
                // Triumphant three-tone fanfare
                playTone(ctx, now, 523.25, 0.15, 0.25, 'sine'); // C5
                playTone(ctx, now + 0.15, 659.25, 0.15, 0.25, 'sine'); // E5
                playTone(ctx, now + 0.3, 783.99, 0.2, 0.4, 'sine'); // G5
                break;
            case 'join':
                // Soft ascending tone for player join
                playTone(ctx, now, 392, 0.1, 0.15, 'sine'); // G4
                playTone(ctx, now + 0.1, 523.25, 0.1, 0.15, 'sine'); // C5
                break;
            case 'error':
                // Descending tone for errors
                playTone(ctx, now, 440, 0.15, 0.2, 'sawtooth'); // A4
                playTone(ctx, now + 0.15, 349.23, 0.15, 0.2, 'sawtooth'); // F4
                break;
            case 'turn':
            default:
                // Pleasant two-tone notification for turn change
                playTone(ctx, now, 587.33, 0.2, 0.3, 'sine'); // D5
                playTone(ctx, now + 0.1, 880, 0.2, 0.3, 'sine'); // A5
                break;
        }
    }
    catch (e) {
        logger.warn('Could not play notification sound:', e);
    }
}
// Helper function to play a single tone
export function playTone(ctx, startTime, frequency, duration, volume, waveType) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveType;
    osc.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration);
}
// Update browser tab title with notification
export function setTabNotification(isYourTurn) {
    if (isYourTurn && state.notificationPrefs.tabNotificationEnabled) {
        document.title = '🔴 ' + t('notifications.yourTurn');
    }
    else {
        document.title = state.originalDocumentTitle;
    }
}
// Check and notify if it's the player's turn
export function checkAndNotifyTurn(newTurn, previousTurn) {
    // Check if it became our turn
    const isYourTurn = !!(state.clickerTeam && state.clickerTeam === newTurn);
    const wasYourTurn = !!(state.clickerTeam && state.clickerTeam === previousTurn);
    if (isYourTurn && !wasYourTurn) {
        // It just became our turn
        playNotificationSound();
    }
    // Update tab notification
    setTabNotification(isYourTurn);
}
// Initialize notification preferences UI handlers
export function initNotificationPrefsUI() {
    const soundCheckbox = document.getElementById('pref-sound-notifications');
    const tabCheckbox = document.getElementById('pref-tab-notification');
    const testSoundBtn = document.getElementById('btn-test-sound');
    if (soundCheckbox) {
        soundCheckbox.addEventListener('change', (e) => {
            state.notificationPrefs.soundEnabled = e.target.checked;
            saveNotificationPrefs();
            // Initialize audio context on user interaction
            if (e.target.checked)
                initAudioContext();
        });
    }
    if (tabCheckbox) {
        tabCheckbox.addEventListener('change', (e) => {
            state.notificationPrefs.tabNotificationEnabled = e.target.checked;
            saveNotificationPrefs();
        });
    }
    if (testSoundBtn) {
        testSoundBtn.addEventListener('click', () => {
            // Temporarily enable sound for test
            const wasEnabled = state.notificationPrefs.soundEnabled;
            state.notificationPrefs.soundEnabled = true;
            initAudioContext();
            playNotificationSound();
            state.notificationPrefs.soundEnabled = wasEnabled;
        });
    }
}
//# sourceMappingURL=notifications.js.map