// ========== TIMER MODULE ==========
// Timer display and countdown
import { state } from './state.js';
// PHASE 2 FIX: Import timer constants for warning thresholds
import { TIMER } from './constants.js';
// Format seconds as MM:SS
export function formatTimerValue(seconds) {
    if (seconds === null || seconds === undefined || seconds < 0)
        return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
// Update timer display UI
export function updateTimerDisplay() {
    const display = state.cachedElements.timerDisplay || document.getElementById('timer-display');
    const value = state.cachedElements.timerValue || document.getElementById('timer-value');
    if (!display || !value)
        return;
    if (!state.timerState.active || state.timerState.remainingSeconds === null) {
        display.classList.remove('active', 'warning', 'critical');
        value.textContent = '--:--';
        return;
    }
    display.classList.add('active');
    value.textContent = formatTimerValue(state.timerState.remainingSeconds);
    // PHASE 2 FIX: Use constants for warning thresholds
    display.classList.remove('warning', 'critical');
    if (state.timerState.remainingSeconds <= TIMER.CRITICAL_THRESHOLD_SECONDS) {
        display.classList.add('critical');
    }
    else if (state.timerState.remainingSeconds <= TIMER.WARNING_THRESHOLD_SECONDS) {
        display.classList.add('warning');
    }
}
// Start local countdown interval
// Uses server-authoritative timing to avoid clock skew issues
export function startTimerCountdown() {
    stopTimerCountdown(); // Clear any existing interval
    if (!state.timerState.active || state.timerState.serverRemainingSeconds === null)
        return;
    // Record when we started the local countdown using monotonic clock
    state.timerState.countdownStartTime = performance.now();
    state.timerState.intervalId = setInterval(() => {
        // Calculate elapsed time since countdown started (monotonic, no clock skew)
        if (state.timerState.countdownStartTime === null)
            return;
        const elapsedMs = performance.now() - state.timerState.countdownStartTime;
        const elapsedSeconds = elapsedMs / 1000;
        // Remaining = server's remaining - elapsed since we received it
        if (state.timerState.serverRemainingSeconds === null)
            return;
        const remaining = Math.max(0, Math.ceil(state.timerState.serverRemainingSeconds - elapsedSeconds));
        state.timerState.remainingSeconds = remaining;
        updateTimerDisplay();
        if (remaining <= 0) {
            stopTimerCountdown();
        }
    }, 250); // Update 4x per second for smooth display
}
// Stop local countdown interval
export function stopTimerCountdown() {
    if (state.timerState.intervalId) {
        clearInterval(state.timerState.intervalId);
        state.timerState.intervalId = null;
    }
}
// Handle timer started event
export function handleTimerStarted(data) {
    state.timerState.active = true;
    state.timerState.endTime = data.endTime ?? null;
    state.timerState.duration = data.duration || data.durationSeconds ?? null;
    // Use server's remaining seconds as authoritative source
    state.timerState.serverRemainingSeconds = data.remainingSeconds || state.timerState.duration;
    state.timerState.remainingSeconds = state.timerState.serverRemainingSeconds;
    updateTimerDisplay();
    startTimerCountdown();
}
// Handle timer stopped/expired event
export function handleTimerStopped() {
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
export function handleTimerStatus(data) {
    if (data && (data.active || (data.remainingSeconds ?? 0) > 0)) {
        state.timerState.active = true;
        state.timerState.endTime = data.endTime ?? null;
        state.timerState.duration = data.duration ?? null;
        // Use server's remaining seconds as authoritative source
        state.timerState.serverRemainingSeconds = data.remainingSeconds ?? data.remaining ?? null;
        state.timerState.remainingSeconds = state.timerState.serverRemainingSeconds;
        updateTimerDisplay();
        startTimerCountdown();
    }
    else {
        handleTimerStopped();
    }
}
//# sourceMappingURL=timer.js.map