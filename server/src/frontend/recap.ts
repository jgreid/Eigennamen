// Post-game recap (A2 MVP).
//
// At game over a "View Recap" button appears; opening it fetches the completed
// game's replay (REST, same payload the replay player uses), then renders a
// focused summary: final result, key stats (cards found, assassin), and a
// per-team clue → guesses timeline. Reuses the A9 shareable-replay-link flow.
// Purely a presentation layer over data the server already persists.

import { state } from './state.js';
import { openModal, closeModal, showToast } from './ui.js';
import { t } from './i18n.js';
import { getClient } from './clientAccessor.js';
import { copyReplayLink } from './history-replay.js';
import { openReplay } from './history.js';
import type { ReplayData, ReplayEvent } from './multiplayerTypes.js';

interface RecapGuess {
    word: string;
    result: 'correct' | 'wrong' | 'neutral' | 'assassin';
}

interface RecapClueBlock {
    team: string;
    word: string;
    number: number;
    guesses: RecapGuess[];
}

const RESULT_ICON: Record<RecapGuess['result'], string> = {
    correct: '✓',
    wrong: '✗',
    neutral: '⬜',
    assassin: '💀',
};

function teamName(team: string | undefined, replay: ReplayData): string {
    if (team === 'red') return replay.teamNames?.red || state.teamNames.red;
    if (team === 'blue') return replay.teamNames?.blue || state.teamNames.blue;
    return team || '';
}

// Same derivation the live game log uses (gameLog.logGuess): correctness is not
// stored, it's `card type === guessing team`.
function guessResult(cardType: string | undefined, team: string | undefined): RecapGuess['result'] {
    if (cardType === 'assassin') return 'assassin';
    if (cardType === 'neutral') return 'neutral';
    if (cardType === team) return 'correct';
    return 'wrong';
}

/** Group the flat event stream into per-clue blocks (reveals follow their clue). */
function groupClueBlocks(events: ReplayEvent[]): RecapClueBlock[] {
    const blocks: RecapClueBlock[] = [];
    let current: RecapClueBlock | null = null;
    for (const ev of events) {
        if (ev.type === 'clue') {
            current = {
                team: ev.data?.team || '',
                word: ev.data?.word || '',
                number: typeof ev.data?.number === 'number' ? ev.data.number : 0,
                guesses: [],
            };
            blocks.push(current);
        } else if (ev.type === 'reveal' && current) {
            current.guesses.push({
                word: ev.data?.word || '',
                result: guessResult(ev.data?.type, ev.data?.team),
            });
        }
        // endTurn / forfeit are turn boundaries; the next clue starts a fresh block.
    }
    return blocks;
}

interface RecapStats {
    redCorrect: number;
    blueCorrect: number;
    assassinBy: string | null;
    totalClues: number;
}

function computeStats(events: ReplayEvent[]): RecapStats {
    let redCorrect = 0;
    let blueCorrect = 0;
    let assassinBy: string | null = null;
    let totalClues = 0;
    for (const ev of events) {
        if (ev.type === 'clue') {
            totalClues++;
        } else if (ev.type === 'reveal') {
            const { type, team } = ev.data || {};
            if (type === 'assassin') assassinBy = team || null;
            else if (type === team && type === 'red') redCorrect++;
            else if (type === team && type === 'blue') blueCorrect++;
        }
    }
    return { redCorrect, blueCorrect, assassinBy, totalClues };
}

function el(tag: string, className?: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function renderResult(replay: ReplayData): void {
    const container = document.getElementById('recap-result');
    if (!container) return;
    container.replaceChildren();

    const winner = replay.finalState?.winner ?? null;
    const heading = el('div', 'recap-result-heading');
    if (winner === 'red' || winner === 'blue') {
        heading.classList.add(winner);
        heading.textContent = t('game.winner', { team: teamName(winner, replay) });
    } else {
        heading.textContent = t('recap.noWinner');
    }
    container.appendChild(heading);
}

function renderStats(replay: ReplayData): void {
    const container = document.getElementById('recap-stats');
    if (!container) return;
    container.replaceChildren();

    const stats = computeStats(replay.events || []);

    const addStat = (label: string, value: string, cls?: string) => {
        const item = el('div', cls ? `recap-stat ${cls}` : 'recap-stat');
        item.appendChild(el('span', 'recap-stat-value', value));
        item.appendChild(el('span', 'recap-stat-label', label));
        container.appendChild(item);
    };

    addStat(teamName('red', replay), String(stats.redCorrect), 'red');
    addStat(teamName('blue', replay), String(stats.blueCorrect), 'blue');
    addStat(t('recap.clues'), String(stats.totalClues || replay.totalClues || 0));
    if (typeof replay.duration === 'number' && replay.duration > 0) {
        addStat(t('recap.duration'), formatDuration(replay.duration));
    }
    if (stats.assassinBy) {
        addStat(t('recap.assassin'), `💀 ${teamName(stats.assassinBy, replay)}`, 'assassin');
    }
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function renderTimeline(replay: ReplayData): void {
    const container = document.getElementById('recap-timeline');
    if (!container) return;
    container.replaceChildren();

    const blocks = groupClueBlocks(replay.events || []);
    if (blocks.length === 0) {
        container.appendChild(el('p', 'recap-empty', t('recap.noMoves')));
        return;
    }

    for (const block of blocks) {
        const blockEl = el('div', `recap-clue-block ${block.team}`);

        const header = el('div', 'recap-clue-header');
        header.appendChild(el('span', 'recap-clue-team', teamName(block.team, replay)));
        header.appendChild(el('span', 'recap-clue-word', block.word));
        header.appendChild(el('span', 'recap-clue-number', `(${block.number})`));
        blockEl.appendChild(header);

        if (block.guesses.length > 0) {
            const list = el('ul', 'recap-guess-list');
            for (const guess of block.guesses) {
                const li = el('li', `recap-guess recap-guess-${guess.result}`);
                const icon = el('span', 'recap-guess-icon', RESULT_ICON[guess.result]);
                icon.setAttribute('aria-hidden', 'true');
                li.appendChild(icon);
                li.appendChild(el('span', 'recap-guess-word', guess.word));
                list.appendChild(li);
            }
            blockEl.appendChild(list);
        } else {
            blockEl.appendChild(el('div', 'recap-no-guess', t('recap.noGuesses')));
        }

        container.appendChild(blockEl);
    }
}

function renderRecap(replay: ReplayData): void {
    // Populate state.currentReplayData so the share-link + full-replay reuse works.
    state.currentReplayData = replay;
    renderResult(replay);
    renderStats(replay);
    renderTimeline(replay);
}

/** Fetch the completed game's replay and open the recap modal. */
export async function openRecap(): Promise<void> {
    const gameId = state.gameState.id;
    const roomCode = getClient()?.getRoomCode() || state.currentRoomId;
    if (!gameId || !roomCode) {
        showToast(t('recap.unavailable'), 'warning');
        return;
    }

    try {
        const replay = await fetchReplay(roomCode, gameId);
        if (!replay) {
            showToast(t('recap.unavailable'), 'warning');
            return;
        }
        renderRecap(replay);
        openModal('recap-modal');
    } catch {
        showToast(t('recap.unavailable'), 'error');
    }
}

async function parseReplay(res: Response): Promise<ReplayData | null> {
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.replay ?? data) as ReplayData;
}

// A game's history is saved server-side just after game:over is emitted, so a
// very-early fetch can 404; retry once after a short beat.
async function fetchReplay(roomCode: string, gameId: string): Promise<ReplayData | null> {
    const url = `/api/replays/${encodeURIComponent(roomCode)}/${encodeURIComponent(gameId)}`;
    const opts = { headers: { Accept: 'application/json' } };

    const first = await fetch(url, opts);
    if (first.ok) return parseReplay(first);
    if (first.status !== 404) return null;

    await new Promise((resolve) => setTimeout(resolve, 500));
    return parseReplay(await fetch(url, opts));
}

export function closeRecap(): void {
    closeModal('recap-modal');
}

/** Copy the shareable replay link for the recapped game (A9 flow). */
export function shareRecap(): void {
    void copyReplayLink();
}

/** Open the full step-by-step replay player for the recapped game. */
export function openRecapFullReplay(): void {
    const gameId = state.gameState.id;
    if (!gameId) return;
    closeRecap();
    openReplay(gameId);
}

/**
 * Show/hide the "View Recap" button. Available at game over in a multiplayer
 * room where a replay was persisted (there is no server history in standalone
 * offline mode).
 */
export function updateRecapButton(): void {
    const btn = document.getElementById('btn-view-recap');
    if (!btn) return;
    const show = state.isMultiplayerMode && state.gameState.gameOver && !!state.gameState.id;
    (btn as HTMLElement).hidden = !show;
}
