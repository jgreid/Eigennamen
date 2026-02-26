/**
 * Replay state actions — centralized mutations for game history replay.
 */
import { state } from '../../state.js';
import { batch } from '../batch.js';
/**
 * Open a replay with the given data.
 */
export function openReplay(data) {
    batch(() => {
        state.currentReplayData = data;
        state.currentReplayIndex = -1;
        state.replayPlaying = false;
    });
}
/**
 * Step the replay forward.
 */
export function stepReplay() {
    state.currentReplayIndex++;
}
/**
 * Set replay playing state.
 */
export function setReplayPlaying(playing) {
    state.replayPlaying = playing;
}
/**
 * Set the replay interval.
 */
export function setReplayInterval(interval) {
    state.replayInterval = interval;
}
/**
 * Clear all replay state.
 */
export function clearReplay() {
    batch(() => {
        if (state.replayInterval) {
            clearInterval(state.replayInterval);
        }
        state.currentReplayData = null;
        state.currentReplayIndex = -1;
        state.replayPlaying = false;
        state.replayInterval = null;
    });
}
//# sourceMappingURL=replayActions.js.map