/**
 * Settings state actions — centralized mutations for user preferences.
 */
import { state } from '../../state.js';
import { batch } from '../batch.js';
/**
 * Update team names.
 */
export function setTeamNames(red, blue) {
    batch(() => {
        state.teamNames.red = red;
        state.teamNames.blue = blue;
    });
}
/**
 * Set active word list and mode.
 */
export function setActiveWords(words, mode) {
    batch(() => {
        state.activeWords = words;
        state.wordListMode = mode;
    });
}
/**
 * Set the word source.
 */
export function setWordSource(source) {
    state.wordSource = source;
}
//# sourceMappingURL=settingsActions.js.map