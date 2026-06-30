/**
 * Live game log: a running, in-order list of the current game's clues and guessed
 * words, shown in a collapsible right-side column. Clues only occur in multiplayer
 * (the spymaster clue form is multiplayer-only); guesses occur in both modes. Words
 * are rendered via textContent (never innerHTML), and the list is DOM-capped like
 * chat to bound growth. The log is cleared on every new game.
 */
import { state } from './state.js';
import { t } from './i18n.js';
import { UI } from './constants.js';

let initialized = false;
let logOpen = true;

/** Localized team label, falling back to the raw value for non-team strings. */
function teamLabel(team: string): string {
    if (team === 'red') return state.teamNames.red;
    if (team === 'blue') return state.teamNames.blue;
    return team;
}

function entriesEl(): HTMLElement | null {
    return document.getElementById('gamelog-entries');
}

/** Toggle the "no moves yet" placeholder based on whether the list has entries. */
function refreshEmpty(): void {
    const empty = document.getElementById('gamelog-empty');
    const list = entriesEl();
    if (empty && list) empty.hidden = list.children.length > 0;
}

function append(entry: HTMLElement): void {
    const list = entriesEl();
    if (!list) return;
    const body = document.getElementById('gamelog-body');
    const nearBottom = body ? body.scrollHeight - body.scrollTop - body.clientHeight < 80 : true;

    list.appendChild(entry);
    // Bound DOM growth (a game has far fewer moves than this, but stay safe).
    while (list.children.length > UI.MAX_GAME_LOG_ENTRIES) {
        list.removeChild(list.firstChild!);
    }
    refreshEmpty();
    if (body && nearBottom) body.scrollTop = body.scrollHeight;
}

/** Append a clue entry (multiplayer only). */
export function logClue(team: string, word: string, count: number): void {
    if (!word) return;
    const li = document.createElement('li');
    li.className = `gamelog-entry gamelog-clue ${team === 'red' || team === 'blue' ? team : ''}`.trim();

    const label = document.createElement('span');
    label.className = 'gamelog-label';
    label.textContent = t('gameLog.clue', { team: teamLabel(team) });

    const wordEl = document.createElement('span');
    wordEl.className = 'gamelog-word';
    wordEl.textContent = word; // textContent — safe against injection

    li.append(label, document.createTextNode(' '), wordEl);

    if (typeof count === 'number' && count > 0) {
        const numEl = document.createElement('span');
        numEl.className = 'gamelog-number';
        numEl.textContent = `(${count})`;
        li.append(document.createTextNode(' '), numEl);
    }
    append(li);
}

/** Append a guess entry (both modes). `type` is the revealed card's color/type. */
export function logGuess(team: string, word: string, type: string): void {
    if (!word) return;
    const correct = type === team;
    const result = type === 'assassin' ? 'assassin' : type === 'neutral' ? 'neutral' : correct ? 'correct' : 'wrong';

    const li = document.createElement('li');
    li.className = `gamelog-entry gamelog-guess ${team === 'red' || team === 'blue' ? team : ''} ${result}`.trim();

    const icon = document.createElement('span');
    icon.className = 'gamelog-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = type === 'assassin' ? '💀' : type === 'neutral' ? '⬜' : correct ? '✓' : '✗';

    const wordEl = document.createElement('span');
    wordEl.className = 'gamelog-word';
    wordEl.textContent = word;

    // Spoken result for screen readers (the icon/color is visual-only).
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = ` — ${t(`gameLog.result.${result}`, { team: teamLabel(team) })}`;

    li.append(icon, document.createTextNode(' '), wordEl, sr);
    append(li);
}

/** Clear all entries (called on every new game). */
export function clearGameLog(): void {
    const list = entriesEl();
    if (list) list.replaceChildren();
    refreshEmpty();
}

function toggle(): void {
    const body = document.getElementById('gamelog-body');
    const btn = document.getElementById('gamelog-toggle');
    if (!body || !btn) return;
    logOpen = !logOpen;
    body.hidden = !logOpen;
    btn.setAttribute('aria-expanded', String(logOpen));
    if (logOpen) body.scrollTop = body.scrollHeight;
}

/** Wire the collapse toggle (idempotent). */
export function initGameLog(): void {
    if (initialized) return;
    initialized = true;
    document.getElementById('gamelog-toggle')?.addEventListener('click', toggle);
    refreshEmpty();
}
