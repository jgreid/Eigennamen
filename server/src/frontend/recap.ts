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

/** How efficiently a clue converted: 'clean' met its number with all-correct
 *  guesses; 'partial' landed some but stopped short or wasted a neutral; 'leak'
 *  gave the opponent a card; 'assassin' hit the assassin. */
type ClueRating = 'clean' | 'partial' | 'leak' | 'assassin';

interface ClueEfficiency {
    landed: number; // own cards correctly found under this clue
    promised: number; // the clue number
    wrong: number; // opponent cards revealed
    neutral: number; // neutral cards revealed
    assassin: number; // assassin revealed (0 or 1)
    rating: ClueRating;
    /** Ranking score — higher is better (used to pick best/worst clue). */
    score: number;
}

function computeClueEfficiency(block: RecapClueBlock): ClueEfficiency {
    let landed = 0;
    let wrong = 0;
    let neutral = 0;
    let assassin = 0;
    for (const g of block.guesses) {
        if (g.result === 'correct') landed++;
        else if (g.result === 'wrong') wrong++;
        else if (g.result === 'neutral') neutral++;
        else if (g.result === 'assassin') assassin++;
    }
    const promised = block.number;
    let rating: ClueRating;
    if (assassin > 0) rating = 'assassin';
    else if (wrong > 0) rating = 'leak';
    else if (neutral > 0 || landed < promised) rating = 'partial';
    else rating = 'clean';
    // Reward cards landed, punish leaks/neutrals, punish the assassin heavily.
    const score = landed * 2 - wrong * 3 - neutral - assassin * 10;
    return { landed, promised, wrong, neutral, assassin, rating, score };
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

    // Provenance: which saved word list this game was played with, if any.
    if (replay.wordListName) {
        container.appendChild(el('div', 'recap-wordlist', t('recap.playedWith', { name: replay.wordListName })));
    }
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

        // Efficiency badge: cards landed / promised, colored by outcome.
        const eff = computeClueEfficiency(block);
        const badge = el('span', `recap-clue-eff recap-clue-eff-${eff.rating}`, `${eff.landed}/${eff.promised}`);
        badge.title = t(`recap.rating.${eff.rating}`);
        badge.setAttribute('aria-label', t(`recap.rating.${eff.rating}`));
        header.appendChild(badge);
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

/** Short reason a clue was the worst of the game, for the highlight label. */
function worstReason(eff: ClueEfficiency): string {
    if (eff.assassin > 0) return t('recap.hitAssassin');
    if (eff.wrong > 0) return t('recap.leaked');
    if (eff.landed === 0) return t('recap.whiffed');
    return t('recap.fellShort');
}

/**
 * Best/worst clue of the game, by conversion efficiency. Only shown when there
 * are at least two clues to compare and the two picks actually differ.
 */
function renderHighlights(replay: ReplayData): void {
    const container = document.getElementById('recap-highlights');
    if (!container) return;
    container.replaceChildren();

    const blocks = groupClueBlocks(replay.events || []);
    if (blocks.length < 2) return;

    const [first, ...rest] = blocks.map((block) => ({ block, eff: computeClueEfficiency(block) }));
    if (!first) return;
    let best = first;
    let worst = first;
    for (const s of rest) {
        if (s.eff.score > best.eff.score) best = s;
        if (s.eff.score < worst.eff.score) worst = s;
    }
    // Nothing meaningful to contrast if every clue scored the same.
    if (best.eff.score === worst.eff.score) return;

    const card = (cls: string, icon: string, label: string, block: RecapClueBlock, detail: string): HTMLElement => {
        const item = el('div', `recap-highlight ${cls}`);
        const head = el('div', 'recap-highlight-head');
        const iconEl = el('span', 'recap-highlight-icon', icon);
        iconEl.setAttribute('aria-hidden', 'true');
        head.appendChild(iconEl);
        head.appendChild(el('span', 'recap-highlight-label', label));
        item.appendChild(head);
        const body = el('div', 'recap-highlight-body');
        body.appendChild(el('span', `recap-highlight-clue ${block.team}`, `${block.word} (${block.number})`));
        body.appendChild(el('span', 'recap-highlight-detail', detail));
        item.appendChild(body);
        return item;
    };

    container.appendChild(
        card('best', '🎯', t('recap.bestClue'), best.block, t('recap.cardsLanded', { count: best.eff.landed }))
    );
    container.appendChild(card('worst', '💥', t('recap.worstClue'), worst.block, worstReason(worst.eff)));
}

/**
 * Match mode only: round-by-round score progression. Reads from the live
 * `state.gameState` (the replay is a single round and carries no match history)
 * — at game-over the round/match handlers have already accumulated roundHistory
 * and the cumulative match scores there.
 */
function renderMatchProgression(replay: ReplayData): void {
    const container = document.getElementById('recap-rounds');
    if (!container) return;
    container.replaceChildren();

    const g = state.gameState;
    // gameMode lives on the root AppState, not on gameState.
    if (!g || state.gameMode !== 'match') return;
    const rounds = g.roundHistory ?? [];
    if (rounds.length === 0) return;

    container.appendChild(el('h3', 'recap-rounds-title', t('recap.matchProgression')));

    const scoreRow = (label: string, red: number, blue: number, extra?: Node): HTMLElement => {
        const row = el('div', 'recap-round-row');
        row.appendChild(el('span', 'recap-round-label', label));
        row.appendChild(el('span', 'recap-round-score red', String(red)));
        row.appendChild(el('span', 'recap-round-sep', '–'));
        row.appendChild(el('span', 'recap-round-score blue', String(blue)));
        if (extra) row.appendChild(extra);
        return row;
    };

    // Column header naming the two teams (color-coded).
    const header = el('div', 'recap-round-row recap-round-head');
    header.appendChild(el('span', 'recap-round-label', ''));
    header.appendChild(el('span', 'recap-round-score red', teamName('red', replay)));
    header.appendChild(el('span', 'recap-round-sep', ''));
    header.appendChild(el('span', 'recap-round-score blue', teamName('blue', replay)));
    container.appendChild(header);

    for (const r of rounds) {
        const badges = el('span', 'recap-round-badges');
        if (r.roundWinner === 'red' || r.roundWinner === 'blue') {
            const w = el('span', `recap-round-winner ${r.roundWinner}`, '🏆');
            w.setAttribute('aria-label', t('game.winner', { team: teamName(r.roundWinner, replay) }));
            w.title = teamName(r.roundWinner, replay);
            badges.appendChild(w);
        }
        if (r.redBonusAwarded || r.blueBonusAwarded) {
            const star = el('span', 'recap-round-bonus', '⭐');
            star.title = t('recap.roundBonus');
            star.setAttribute('aria-label', t('recap.roundBonus'));
            badges.appendChild(star);
        }
        container.appendChild(
            scoreRow(t('recap.round', { n: r.roundNumber }), r.redRoundScore, r.blueRoundScore, badges)
        );
    }

    const total = scoreRow(t('recap.matchTotal'), g.redMatchScore ?? 0, g.blueMatchScore ?? 0);
    total.classList.add('recap-round-total');
    container.appendChild(total);

    if (g.matchOver && (g.matchWinner === 'red' || g.matchWinner === 'blue')) {
        const banner = el(
            'div',
            `recap-match-winner ${g.matchWinner}`,
            t('game.winner', {
                team: teamName(g.matchWinner, replay),
            })
        );
        container.appendChild(banner);
    }
}

function renderRecap(replay: ReplayData): void {
    // Populate state.currentReplayData so the share-link + full-replay reuse works.
    state.currentReplayData = replay;
    renderResult(replay);
    renderStats(replay);
    renderMatchProgression(replay);
    renderHighlights(replay);
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
