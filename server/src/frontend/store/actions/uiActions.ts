/**
 * UI state actions — centralized mutations for UI/board state.
 */

import { state } from '../../state.js';
import { batch } from '../batch.js';

/**
 * Set board initialization flag.
 */
export function setBoardInitialized(value: boolean): void {
    state.boardInitialized = value;
}

/**
 * Set color blind mode.
 */
export function setColorBlindMode(enabled: boolean): void {
    state.colorBlindMode = enabled;
}

/**
 * Set the active modal and save previously focused element.
 */
export function setActiveModal(modal: HTMLElement | null, previousFocus?: HTMLElement | null): void {
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
export function setLanguage(lang: string): void {
    state.language = lang;
}

/**
 * Set the game mode.
 */
export function setGameMode(mode: string): void {
    state.gameMode = mode;
}
