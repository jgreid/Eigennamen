/**
 * Spymaster clue UX: a live clue chip shown to everyone, and an input form
 * shown only to the current-turn spymaster who hasn't clued yet. Wires to the
 * game:clue event added in Phase 0.
 */
import { state } from './state.js';
import { t } from './i18n.js';
import { showToast } from './ui.js';
import { isClientConnected } from './clientAccessor.js';
import { isClueLegalForBoard, formatClueNumber, CLUE_NUMBER_UNLIMITED, CLUE_NUMBER_MAX } from '../shared/index.js';

/** True when the local player is the current-turn spymaster and no clue is active. */
function localIsActiveSpymaster(): boolean {
    const gs = state.gameState;
    if (!gs || gs.gameOver) return false;
    const myTeam = state.spymasterTeam;
    if (!myTeam) return false;
    return myTeam === gs.currentTurn && !gs.currentClue;
}

/** Refresh the clue chip (everyone) and the clue form (active spymaster only). */
export function updateClueUI(): void {
    const display = document.getElementById('clue-display');
    const wordEl = document.getElementById('clue-display-word');
    const numEl = document.getElementById('clue-display-number');
    const form = document.getElementById('clue-controls') as HTMLElement | null;

    const gs = state.gameState;
    const clue = gs?.currentClue ?? null;

    if (display && wordEl && numEl) {
        if (clue && clue.word) {
            wordEl.textContent = clue.word;
            // -1 renders as "U" (unlimited); 0 is the anti-clue and shows as 0.
            numEl.textContent = typeof clue.number === 'number' ? `· ${formatClueNumber(clue.number)}` : '';
            display.classList.remove('clue-red', 'clue-blue');
            if (clue.team === 'red' || clue.team === 'blue') display.classList.add(`clue-${clue.team}`);
            display.hidden = false;
        } else {
            display.hidden = true;
        }
    }

    if (form) {
        form.hidden = !(state.isMultiplayerMode && localIsActiveSpymaster());
    }
}

/** Read the form, validate, and emit game:clue. */
export function submitClueFromForm(): void {
    const wordInput = document.getElementById('clue-word-input') as HTMLInputElement | null;
    const numInput = document.getElementById('clue-number-input') as HTMLSelectElement | null;
    if (!wordInput) return;

    const word = wordInput.value.trim();
    // The selector offers U (-1, unlimited), 0 (anti-clue), and 1–9.
    const parsed = numInput ? parseInt(numInput.value, 10) : 1;
    const number = Number.isFinite(parsed) ? Math.max(CLUE_NUMBER_UNLIMITED, Math.min(CLUE_NUMBER_MAX, parsed)) : 1;

    if (!word) {
        showToast(t('clue.errorEmpty'), 'warning');
        return;
    }
    if (/\s/.test(word)) {
        showToast(t('clue.errorSingleWord'), 'warning');
        return;
    }
    // Pre-validate legality against the local board so the spymaster gets an
    // immediate, specific reason (the server also enforces this, but its
    // rejection surfaces only as a generic INVALID_INPUT toast). Board words are
    // the same on client and server for the game's lifetime, so this is reliable.
    const boardWords = state.gameState?.words ?? [];
    if (boardWords.length > 0 && !isClueLegalForBoard(word, boardWords as string[])) {
        showToast(t('clue.errorIllegal'), 'warning');
        return;
    }
    if (!isClientConnected()) return;

    EigennamenClient.submitClue(word, number);
    wordInput.value = '';
    if (numInput) numInput.value = '1';
}

/** Bind the form's submit handler (idempotent). */
export function initClueUI(): void {
    const form = document.getElementById('clue-controls') as HTMLFormElement | null;
    if (form && !form.dataset.bound) {
        form.dataset.bound = '1';
        form.addEventListener('submit', (e: Event) => {
            e.preventDefault();
            submitClueFromForm();
        });
    }
    updateClueUI();
}
