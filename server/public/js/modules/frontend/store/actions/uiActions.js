/**
 * UI state actions — centralized mutations for UI/board state.
 */
import { state } from '../../state.js';
import { batch } from '../batch.js';
/**
 * Set board initialization flag.
 */
export function setBoardInitialized(value) {
    state.boardInitialized = value;
}
/**
 * Set color blind mode.
 */
export function setColorBlindMode(enabled) {
    state.colorBlindMode = enabled;
}
/**
 * Set the active modal and save previously focused element.
 */
export function setActiveModal(modal, previousFocus) {
    batch(() => {
        state.activeModal = modal;
        if (previousFocus !== undefined) {
            state.previouslyFocusedElement = previousFocus;
        }
    });
}
/**
 * Set the language.
 */
export function setLanguage(lang) {
    state.language = lang;
}
/**
 * Set the game mode.
 */
export function setGameMode(mode) {
    state.gameMode = mode;
}
//# sourceMappingURL=uiActions.js.map