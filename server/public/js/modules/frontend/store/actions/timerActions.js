/**
 * Timer state actions — centralized mutations for timer lifecycle.
 */
import { state } from '../../state.js';
import { batch } from '../batch.js';
/**
 * Start the timer with server-provided data.
 */
export function startTimer(data) {
    batch(() => {
        state.timerState.active = true;
        state.timerState.endTime = data.endTime;
        state.timerState.duration = data.duration;
        state.timerState.serverRemainingSeconds = data.serverRemainingSeconds;
        state.timerState.remainingSeconds = data.serverRemainingSeconds;
    });
}
/**
 * Stop the timer and clear all timer state.
 */
export function stopTimer() {
    batch(() => {
        if (state.timerState.intervalId) {
            clearInterval(state.timerState.intervalId);
        }
        state.timerState.active = false;
        state.timerState.endTime = null;
        state.timerState.remainingSeconds = null;
        state.timerState.serverRemainingSeconds = null;
        state.timerState.countdownStartTime = null;
        state.timerState.intervalId = null;
    });
}
/**
 * Update the countdown display tick.
 */
export function tickTimer(remainingSeconds) {
    state.timerState.remainingSeconds = remainingSeconds;
}
/**
 * Set the interval ID for the countdown.
 */
export function setTimerInterval(intervalId) {
    state.timerState.intervalId = intervalId;
}
/**
 * Set the countdown start time for monotonic clock calculations.
 */
export function setCountdownStartTime(time) {
    state.timerState.countdownStartTime = time;
}
//# sourceMappingURL=timerActions.js.map