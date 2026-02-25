/**
 * Settings state actions — centralized mutations for user preferences.
 */

import { state } from '../../state.js';
import { batch } from '../batch.js';

/**
 * Update team names.
 */
export function setTeamNames(red: string, blue: string): void {
    batch(() => {
        state.teamNames.red = red;
        state.teamNames.blue = blue;
    });
}

/**
 * Set active word list and mode.
 */
export function setActiveWords(words: string[], mode: string): void {
    batch(() => {
        state.activeWords = words;
        state.wordListMode = mode;
    });
}

/**
 * Set the word source.
 */
export function setWordSource(source: string): void {
    state.wordSource = source;
}
