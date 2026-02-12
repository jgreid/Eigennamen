// ========== HISTORY MODULE ==========
// Game history and replay

import { state } from './state.js';
import { escapeHTML, formatGameTimestamp, formatDuration, copyToClipboard } from './utils.js';
import { openModal, closeModal, showToast } from './ui.js';
import type { GameHistoryEntry, ReplayData, ReplayEvent } from './multiplayerTypes.js';

// PHASE 4: Replay speed options (in milliseconds between moves)
const REPLAY_SPEEDS: Record<string, number> = {
    '0.5x': 3000,  // Slow
    '1x': 1500,    // Normal (default)
    '2x': 750,     // Fast
    '4x': 375      // Very fast
};
let currentReplaySpeed = '1x';

export function openGameHistory(): void {
    if (!state.isMultiplayerMode || !CodenamesClient.isConnected()) {
        showToast('Game history is only available in multiplayer mode', 'info');
        return;
    }

    // Show loading state
    const loadingEl = document.getElementById('history-loading');
    const emptyEl = document.getElementById('history-empty');
    const listEl = document.getElementById('history-list');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.style.display = 'none';

    openModal('history-modal');

    // Request game history from server
    CodenamesClient.getGameHistory(10);
}

export function closeGameHistory(): void {
    closeModal('history-modal');
}

export function renderGameHistory(games: GameHistoryEntry[]): void {
    const loadingEl = document.getElementById('history-loading');
    const emptyEl = document.getElementById('history-empty');
    const listEl = document.getElementById('history-list');

    if (loadingEl) loadingEl.style.display = 'none';

    if (!games || games.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        if (listEl) listEl.style.display = 'none';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.style.display = 'flex';

    if (!listEl) return;
    listEl.innerHTML = '';
    for (const game of games) {
        const dateStr = formatGameTimestamp(game.timestamp || 0);
        const winner = game.winner || '';
        const winnerName = (game.teamNames && winner ? game.teamNames[winner] : undefined) || (winner === 'red' ? 'Red' : 'Blue');

        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.gameId = game.id;

        const info = document.createElement('div');
        info.className = 'history-item-info';
        const winnerDiv = document.createElement('div');
        const winnerClass = game.winner === 'red' ? 'red' : 'blue';
        winnerDiv.className = `history-item-winner ${winnerClass}`;
        winnerDiv.textContent = `${winnerName} Team Wins!`;
        info.appendChild(winnerDiv);
        const dateDiv = document.createElement('div');
        dateDiv.className = 'history-item-date';
        dateDiv.textContent = dateStr;
        info.appendChild(dateDiv);

        const stats = document.createElement('div');
        stats.className = 'history-item-stats';
        const scoreDiv = document.createElement('div');
        scoreDiv.className = 'history-item-score';
        const redSpan = document.createElement('span');
        redSpan.className = 'red-score';
        redSpan.textContent = String(game.redScore || 0);
        const blueSpan = document.createElement('span');
        blueSpan.className = 'blue-score';
        blueSpan.textContent = String(game.blueScore || 0);
        scoreDiv.appendChild(redSpan);
        scoreDiv.append(' - ');
        scoreDiv.appendChild(blueSpan);
        stats.appendChild(scoreDiv);
        const movesDiv = document.createElement('div');
        movesDiv.className = 'history-item-moves';
        movesDiv.textContent = `${game.moveCount || 0} moves, ${game.clueCount || 0} clues`;
        stats.appendChild(movesDiv);

        item.appendChild(info);
        item.appendChild(stats);
        listEl.appendChild(item);
    }

    // Event delegation is set up once via setupHistoryEventDelegation()
    // No need to add listeners per item - prevents memory leaks
}

// Use event delegation for history items to prevent memory leaks
// Only set up once during initialization
export function setupHistoryEventDelegation(): void {
    if (state.historyDelegationSetup) return;
    state.historyDelegationSetup = true;

    const listEl = document.getElementById('history-list');
    if (listEl) {
        listEl.addEventListener('click', (event: MouseEvent) => {
            // Find the closest history-item ancestor
            const historyItem = (event.target as HTMLElement).closest('.history-item') as HTMLElement | null;
            if (historyItem && historyItem.dataset.gameId) {
                openReplay(historyItem.dataset.gameId);
            }
        });
    }
}

export function openReplay(gameId: string): void {
    closeGameHistory();

    // Show loading in replay modal
    const replayInfoEl = document.getElementById('replay-info');
    const replayBoardEl = document.getElementById('replay-board');
    const replayEventLogEl = document.getElementById('replay-event-log');
    const replayProgressEl = document.getElementById('replay-progress');
    if (replayInfoEl) replayInfoEl.innerHTML = '<p>Loading replay...</p>';
    if (replayBoardEl) replayBoardEl.innerHTML = '';
    if (replayEventLogEl) replayEventLogEl.innerHTML = '';
    if (replayProgressEl) replayProgressEl.textContent = 'Loading...';

    openModal('replay-modal');

    // Request replay data
    CodenamesClient.getReplay(gameId);
}

export function closeReplay(): void {
    // Stop any playing replay
    if (state.replayInterval) {
        clearInterval(state.replayInterval);
        state.replayInterval = null;
    }
    state.replayPlaying = false;
    state.currentReplayData = null;
    state.currentReplayIndex = -1;
    closeModal('replay-modal');
}

export function renderReplayData(data: ReplayData): void {
    state.currentReplayData = data;
    state.currentReplayIndex = -1;
    state.replayPlaying = false;

    if (!data) {
        const infoEl = document.getElementById('replay-info');
        if (infoEl) infoEl.innerHTML = '<p>Could not load replay data.</p>';
        return;
    }

    // Render replay info using DOM APIs to prevent XSS
    const replayInfo = document.getElementById('replay-info');
    if (replayInfo) {
        replayInfo.innerHTML = '';
        const winnerBadge = document.createElement('span');
        const replayWinnerClass = data.finalState?.winner === 'red' ? 'red' : (data.finalState?.winner === 'blue' ? 'blue' : '');
        winnerBadge.className = `winner-badge ${replayWinnerClass}`;
        const finalWinner = data.finalState?.winner || '';
        winnerBadge.textContent = `${(data.teamNames && finalWinner ? data.teamNames[finalWinner] : undefined) || finalWinner || 'Unknown'} Team Wins!`;
        replayInfo.appendChild(winnerBadge);
        const durationSpan = document.createElement('span');
        durationSpan.textContent = `Duration: ${formatDuration(data.duration || 0)} | ${data.totalMoves || 0} moves`;
        replayInfo.appendChild(durationSpan);
    }

    // Initialize board with words (all hidden)
    renderReplayBoard();

    // Render event log
    renderReplayEventLog();

    // Update controls
    updateReplayControls();

    // Set up control buttons
    setupReplayControls();
}

export function renderReplayBoard(): void {
    const board = document.getElementById('replay-board');
    if (!board) return;
    const words = state.currentReplayData?.initialBoard?.words || [];

    board.innerHTML = '';
    board.setAttribute('role', 'grid');
    board.setAttribute('aria-label', 'Replay game board');

    words.forEach((word: string, index: number) => {
        const card = document.createElement('div');
        card.className = 'replay-card';
        card.dataset.index = String(index);
        card.textContent = word;
        card.setAttribute('role', 'gridcell');
        card.setAttribute('tabindex', index === 0 ? '0' : '-1');
        card.setAttribute('aria-label', `Card ${index + 1}: ${word}`);
        board.appendChild(card);
    });

    // Arrow-key navigation within replay board
    board.addEventListener('keydown', (e: KeyboardEvent) => {
        const focused = document.activeElement as HTMLElement | null;
        if (!focused || !focused.classList.contains('replay-card')) return;
        const idx = Number(focused.dataset.index);
        const cols = 5; // 5x5 board
        let next = -1;
        switch (e.key) {
            case 'ArrowRight': next = idx + 1; break;
            case 'ArrowLeft':  next = idx - 1; break;
            case 'ArrowDown':  next = idx + cols; break;
            case 'ArrowUp':    next = idx - cols; break;
            default: return;
        }
        const target = board.querySelector(`[data-index="${next}"]`) as HTMLElement | null;
        if (target) {
            e.preventDefault();
            target.setAttribute('tabindex', '0');
            focused.setAttribute('tabindex', '-1');
            target.focus();
        }
    });

    // Apply revealed state up to current index
    applyReplayState();
}

export function applyReplayState(): void {
    if (!state.currentReplayData) return;

    const types = state.currentReplayData.initialBoard?.types || [];
    const events = state.currentReplayData.events || [];
    const cards = document.querySelectorAll('.replay-card');

    // Reset all cards
    cards.forEach((card, index) => {
        card.className = 'replay-card';
    });

    // Apply reveals up to current index
    for (let i = 0; i <= state.currentReplayIndex; i++) {
        const event = events[i];
        if (event && event.type === 'reveal') {
            const cardIndex = event.data?.index;
            const cardType = event.data?.type;
            if (cardIndex !== undefined && cards[cardIndex]) {
                cards[cardIndex].classList.add('revealed', cardType || '');
                // Highlight current move
                if (i === state.currentReplayIndex) {
                    cards[cardIndex].classList.add('current-move');
                }
            }
        }
    }
}

export function renderReplayEventLog(): void {
    const logEl = document.getElementById('replay-event-log');
    if (!logEl) return;
    const events = state.currentReplayData?.events || [];

    if (events.length === 0) {
        logEl.innerHTML = '<p style="opacity: 0.5;">No events recorded.</p>';
        return;
    }

    logEl.innerHTML = '';
    events.forEach((event: ReplayEvent, index: number) => {
        let actionText = '';
        let detailText = '';
        const team = event.data?.team || '';

        switch (event.type) {
            case 'clue':
                actionText = 'gave clue';
                detailText = `"${event.data?.word || ''}" for ${event.data?.number ?? ''}`;
                break;
            case 'reveal':
                actionText = 'revealed';
                detailText = `${event.data?.word || ''} (${event.data?.type || ''})`;
                break;
            case 'endTurn':
                actionText = 'ended turn';
                break;
            case 'forfeit':
                actionText = 'forfeited';
                detailText = `${event.data?.winner || ''} wins`;
                break;
            default:
                actionText = event.type || '';
        }

        const row = document.createElement('div');
        row.className = `replay-event${index === state.currentReplayIndex ? ' current' : ''}`;
        row.dataset.eventIndex = String(index);

        const teamSpan = document.createElement('span');
        const eventTeamClass = team === 'red' ? 'red' : (team === 'blue' ? 'blue' : '');
        teamSpan.className = `event-team ${eventTeamClass}`;
        teamSpan.textContent = team.toUpperCase();
        row.appendChild(teamSpan);

        const actionSpan = document.createElement('span');
        actionSpan.className = 'event-action';
        actionSpan.textContent = actionText;
        row.appendChild(actionSpan);

        if (detailText) {
            const detailSpan = document.createElement('span');
            detailSpan.className = 'event-detail';
            detailSpan.textContent = detailText;
            row.appendChild(detailSpan);
        }

        logEl.appendChild(row);
    });
}

export function updateReplayControls(): void {
    const events = state.currentReplayData?.events || [];
    const prevBtn = document.getElementById('replay-prev') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('replay-next') as HTMLButtonElement | null;
    const playBtn = document.getElementById('replay-play');
    const progressEl = document.getElementById('replay-progress');

    if (prevBtn) prevBtn.disabled = state.currentReplayIndex < 0;
    if (nextBtn) nextBtn.disabled = state.currentReplayIndex >= events.length - 1;
    if (playBtn) playBtn.innerHTML = state.replayPlaying ? '&#10074;&#10074;' : '&#9654;';
    if (progressEl) progressEl.textContent = `Move ${state.currentReplayIndex + 1} / ${events.length}`;
}

// Use event delegation on the replay controls to avoid listener accumulation.
// Set up once; each render just updates button state via updateReplayControls().
let replayControlsDelegated = false;

export function setupReplayControls(): void {
    if (replayControlsDelegated) return;
    replayControlsDelegated = true;

    const controls = document.querySelector('.replay-controls');
    if (!controls) return;

    controls.addEventListener('click', (e: Event) => {
        const target = (e.target as HTMLElement).closest('button');
        if (!target) return;

        switch (target.id) {
            case 'replay-prev':
                if (state.currentReplayIndex >= 0) {
                    state.currentReplayIndex--;
                    applyReplayState();
                    renderReplayEventLog();
                    updateReplayControls();
                    scrollToCurrentEvent();
                }
                break;
            case 'replay-next': {
                const events = state.currentReplayData?.events || [];
                if (state.currentReplayIndex < events.length - 1) {
                    state.currentReplayIndex++;
                    applyReplayState();
                    renderReplayEventLog();
                    updateReplayControls();
                    scrollToCurrentEvent();
                }
                break;
            }
            case 'replay-play':
                toggleReplayPlayback();
                break;
            case 'replay-speed':
                cycleReplaySpeed();
                break;
            case 'replay-share':
                copyReplayLink();
                break;
        }
    });

    // Initialize speed button text
    const speedBtn = document.getElementById('replay-speed');
    if (speedBtn) speedBtn.textContent = currentReplaySpeed;
}

/**
 * Start (or restart) the replay interval at the given speed.
 * Clears any existing interval first.
 */
function startReplayInterval(): void {
    if (state.replayInterval) {
        clearInterval(state.replayInterval);
        state.replayInterval = null;
    }
    const speedMs = REPLAY_SPEEDS[currentReplaySpeed] || 1500;
    state.replayInterval = setInterval(() => {
        const events = state.currentReplayData?.events || [];
        if (state.currentReplayIndex < events.length - 1) {
            state.currentReplayIndex++;
            applyReplayState();
            renderReplayEventLog();
            updateReplayControls();
            scrollToCurrentEvent();
        } else {
            state.replayPlaying = false;
            clearInterval(state.replayInterval ?? undefined);
            state.replayInterval = null;
            updateReplayControls();
        }
    }, speedMs);
}

export function toggleReplayPlayback(): void {
    state.replayPlaying = !state.replayPlaying;

    if (state.replayPlaying) {
        startReplayInterval();
    } else {
        if (state.replayInterval) {
            clearInterval(state.replayInterval);
            state.replayInterval = null;
        }
    }

    updateReplayControls();
}

export function cycleReplaySpeed(): void {
    const speedKeys = Object.keys(REPLAY_SPEEDS);
    const currentIndex = speedKeys.indexOf(currentReplaySpeed);
    const nextIndex = (currentIndex + 1) % speedKeys.length;
    currentReplaySpeed = speedKeys[nextIndex];

    const speedBtn = document.getElementById('replay-speed');
    if (speedBtn) {
        speedBtn.textContent = currentReplaySpeed;
    }

    // If currently playing, restart with new speed
    if (state.replayPlaying) {
        startReplayInterval();
    }

    showToast(`Playback speed: ${currentReplaySpeed}`, 'info');
}

// PHASE 4: Copy shareable replay link to clipboard
export async function copyReplayLink(): Promise<void> {
    if (!state.currentReplayData?.id) {
        showToast('No replay data available', 'error');
        return;
    }

    const roomCode = CodenamesClient?.getRoomCode() || state.currentRoomId;
    const gameId = state.currentReplayData.id;

    // Create shareable URL with replay parameters
    const url = new URL(window.location.href);
    url.searchParams.set('replay', gameId);
    if (roomCode) {
        url.searchParams.set('room', roomCode);
    }

    // Copy to clipboard using shared utility
    const copied = await copyToClipboard(url.toString());
    if (copied) {
        showToast('Replay link copied to clipboard!', 'success');
    } else {
        showToast('Could not copy link', 'error');
    }
}

export function scrollToCurrentEvent(): void {
    const logEl = document.getElementById('replay-event-log');
    if (!logEl) return;
    const currentEventEl = logEl.querySelector('.replay-event.current');
    if (currentEventEl) {
        currentEventEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Check URL for replay parameters and auto-load the replay.
 * Fetches replay data via REST API (no room membership required).
 * URL format: ?replay=<gameId>&room=<roomCode>
 */
export async function checkURLForReplayLoad(): Promise<boolean> {
    const params = new URLSearchParams(window.location.search);
    const replayId = params.get('replay');
    const roomCode = params.get('room');

    if (!replayId || !roomCode) {
        return false;
    }

    try {
        const response = await fetch(`/api/replays/${encodeURIComponent(roomCode)}/${encodeURIComponent(replayId)}`);
        if (!response.ok) {
            if (response.status === 404) {
                showToast('Replay not found or expired', 'error');
            } else {
                showToast('Failed to load replay', 'error');
            }
            return false;
        }

        const data = await response.json();
        if (data.replay) {
            renderReplayData(data);
            showToast('Replay loaded from shared link', 'success');

            // Clean replay params from URL to prevent re-loading on refresh
            const url = new URL(window.location.href);
            url.searchParams.delete('replay');
            url.searchParams.delete('room');
            window.history.replaceState({}, '', url.toString());

            return true;
        }
    } catch (error) {
        console.error('Failed to load shared replay:', error);
        showToast('Failed to load shared replay', 'error');
    }
    return false;
}
