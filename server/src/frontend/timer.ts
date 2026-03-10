import { state } from './state.js';
// Import timer constants for warning thresholds
import { TIMER } from './constants.js';
import { t } from './i18n.js';

// Timer thresholds (in seconds) at which screen readers are notified
const ANNOUNCE_THRESHOLDS = [30, 10, 1] as const;
// Track last announced threshold to avoid repeating
let lastAnnouncedThreshold: number | null = null;

/**
 * Announce timer urgency to screen readers at key thresholds.
 * Only announces once per threshold crossing per countdown.
 */
function announceTimerThreshold(remaining: number): void {
    for (const threshold of ANNOUNCE_THRESHOLDS) {
        if (remaining === threshold && lastAnnouncedThreshold !== threshold) {
            lastAnnouncedThreshold = threshold;
            const el = document.getElementById('sr-announcements');
            if (!el) return;
            const label =
                threshold === 1
                    ? t('timer.secondRemaining')
                    : t('timer.secondsRemaining', { count: String(threshold) });
            el.textContent = '';
            requestAnimationFrame(() => {
                el.textContent = label;
            });
            return;
        }
    }
}

// Format seconds as MM:SS
export function formatTimerValue(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || seconds < 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update timer display UI
export function updateTimerDisplay(): void {
    const display = state.cachedElements.timerDisplay || document.getElementById('timer-display');
    const value = state.cachedElements.timerValue || document.getElementById('timer-value');
    if (!display || !value) return;

    if (!state.timerState.active || state.timerState.remainingSeconds === null) {
        display.classList.remove('active', 'warning', 'critical');
        value.textContent = '--:--';
        return;
    }

    display.classList.add('active');
    value.textContent = formatTimerValue(state.timerState.remainingSeconds);

    // Use constants for warning thresholds
    display.classList.remove('warning', 'critical');
    if (state.timerState.remainingSeconds <= TIMER.CRITICAL_THRESHOLD_SECONDS) {
        display.classList.add('critical');
    } else if (state.timerState.remainingSeconds <= TIMER.WARNING_THRESHOLD_SECONDS) {
        display.classList.add('warning');
    }
}

// Start local countdown interval
// Uses server-authoritative timing to avoid clock skew issues
export function startTimerCountdown(): void {
    stopTimerCountdown(); // Clear any existing interval
    lastAnnouncedThreshold = null; // Reset announcement tracker for new countdown

    if (!state.timerState.active || state.timerState.serverRemainingSeconds === null) return;

    // Record when we started the local countdown using monotonic clock
    state.timerState.countdownStartTime = performance.now();

    state.timerState.intervalId = setInterval(() => {
        // Calculate elapsed time since countdown started (monotonic, no clock skew)
        if (state.timerState.countdownStartTime === null) return;
        const elapsedMs = performance.now() - state.timerState.countdownStartTime;
        const elapsedSeconds = elapsedMs / 1000;

        // Remaining = server's remaining - elapsed since we received it
        if (state.timerState.serverRemainingSeconds === null) return;
        const remaining = Math.max(0, Math.ceil(state.timerState.serverRemainingSeconds - elapsedSeconds));
        state.timerState.remainingSeconds = remaining;
        updateTimerDisplay();

        // Announce key thresholds to screen readers
        announceTimerThreshold(remaining);

        if (remaining <= 0) {
            stopTimerCountdown();
        }
    }, 250); // Update 4x per second for smooth display
}

// Stop local countdown interval
export function stopTimerCountdown(): void {
    if (state.timerState.intervalId) {
        clearInterval(state.timerState.intervalId);
        state.timerState.intervalId = null;
    }
}

// Handle timer started event
export function handleTimerStarted(data: {
    endTime?: number;
    duration?: number;
    durationSeconds?: number;
    remainingSeconds?: number;
}): void {
    state.timerState.active = true;
    state.timerState.endTime = data.endTime ?? null;
    state.timerState.duration = data.duration ?? data.durationSeconds ?? null;
    // Use server's remaining seconds as authoritative source
    state.timerState.serverRemainingSeconds = data.remainingSeconds || state.timerState.duration;
    state.timerState.remainingSeconds = state.timerState.serverRemainingSeconds;
    updateTimerDisplay();
    startTimerCountdown();
}

// Handle timer stopped/expired event
export function handleTimerStopped(): void {
    state.timerState.active = false;
    state.timerState.endTime = null;
    state.timerState.remainingSeconds = null;
    state.timerState.serverRemainingSeconds = null;
    state.timerState.countdownStartTime = null;
    stopTimerCountdown();
    updateTimerDisplay();
}

// Handle timer status on join/reconnect
// Uses server's remaining seconds to avoid clock skew issues
export function handleTimerStatus(data: {
    active?: boolean;
    remainingSeconds?: number;
    remaining?: number;
    endTime?: number;
    duration?: number;
}): void {
    if (data && (data.active || (data.remainingSeconds ?? 0) > 0)) {
        state.timerState.active = true;
        state.timerState.endTime = data.endTime ?? null;
        state.timerState.duration = data.duration ?? null;
        // Use server's remaining seconds as authoritative source
        state.timerState.serverRemainingSeconds = data.remainingSeconds ?? data.remaining ?? null;
        state.timerState.remainingSeconds = state.timerState.serverRemainingSeconds;
        updateTimerDisplay();
        startTimerCountdown();
    } else {
        handleTimerStopped();
    }
}
