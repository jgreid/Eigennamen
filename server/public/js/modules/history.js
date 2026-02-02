// ========== HISTORY MODULE ==========
// Game history and replay

import { state } from './state.js';
import { escapeHTML, formatGameTimestamp, formatDuration } from './utils.js';
import { openModal, closeModal, showToast } from './ui.js';

export function openGameHistory() {
    if (!CodenamesClient || !CodenamesClient.isConnected()) {
        showToast('Not connected to server - join or create a room first', 'error');
        return;
    }

    // Show loading state
    document.getElementById('history-loading').style.display = 'flex';
    document.getElementById('history-empty').style.display = 'none';
    document.getElementById('history-list').style.display = 'none';

    openModal('history-modal');

    // Request game history from server
    CodenamesClient.getGameHistory(10);
}

export function closeGameHistory() {
    closeModal('history-modal');
}

export function renderGameHistory(games) {
    const loadingEl = document.getElementById('history-loading');
    const emptyEl = document.getElementById('history-empty');
    const listEl = document.getElementById('history-list');

    loadingEl.style.display = 'none';

    if (!games || games.length === 0) {
        emptyEl.style.display = 'block';
        listEl.style.display = 'none';
        return;
    }

    emptyEl.style.display = 'none';
    listEl.style.display = 'flex';

    listEl.innerHTML = games.map(game => {
        const dateStr = formatGameTimestamp(game.timestamp);
        const winnerName = escapeHTML(game.teamNames?.[game.winner] || (game.winner === 'red' ? 'Red' : 'Blue'));

        return `
            <div class="history-item" data-game-id="${escapeHTML(game.id)}">
                <div class="history-item-info">
                    <div class="history-item-winner ${escapeHTML(game.winner)}">${winnerName} Team Wins!</div>
                    <div class="history-item-date">${dateStr}</div>
                </div>
                <div class="history-item-stats">
                    <div class="history-item-score">
                        <span class="red-score">${game.redScore || 0}</span> - <span class="blue-score">${game.blueScore || 0}</span>
                    </div>
                    <div class="history-item-moves">${game.moveCount || 0} moves, ${game.clueCount || 0} clues</div>
                </div>
            </div>
        `;
    }).join('');

    // Event delegation is set up once via setupHistoryEventDelegation()
    // No need to add listeners per item - prevents memory leaks
}

// Use event delegation for history items to prevent memory leaks
// Only set up once during initialization
export function setupHistoryEventDelegation() {
    if (state.historyDelegationSetup) return;
    state.historyDelegationSetup = true;

    const listEl = document.getElementById('history-list');
    if (listEl) {
        listEl.addEventListener('click', (event) => {
            // Find the closest history-item ancestor
            const historyItem = event.target.closest('.history-item');
            if (historyItem && historyItem.dataset.gameId) {
                openReplay(historyItem.dataset.gameId);
            }
        });
    }
}

export function openReplay(gameId) {
    closeGameHistory();

    // Show loading in replay modal
    document.getElementById('replay-info').innerHTML = '<p>Loading replay...</p>';
    document.getElementById('replay-board').innerHTML = '';
    document.getElementById('replay-event-log').innerHTML = '';
    document.getElementById('replay-progress').textContent = 'Loading...';

    openModal('replay-modal');

    // Request replay data
    CodenamesClient.getReplay(gameId);
}

export function closeReplay() {
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

export function renderReplayData(data) {
    state.currentReplayData = data;
    state.currentReplayIndex = -1;
    state.replayPlaying = false;

    if (!data) {
        document.getElementById('replay-info').innerHTML = '<p>Could not load replay data.</p>';
        return;
    }

    // Render replay info
    const winnerName = escapeHTML(data.teamNames?.[data.finalState?.winner] || data.finalState?.winner || 'Unknown');
    const winnerClass = escapeHTML(data.finalState?.winner || '');
    const durationStr = formatDuration(data.duration || 0);
    document.getElementById('replay-info').innerHTML = `
        <span class="winner-badge ${winnerClass}">${winnerName} Team Wins!</span>
        <span>Duration: ${durationStr} | ${data.totalMoves || 0} moves</span>
    `;

    // Initialize board with words (all hidden)
    renderReplayBoard();

    // Render event log
    renderReplayEventLog();

    // Update controls
    updateReplayControls();

    // Set up control buttons
    setupReplayControls();
}

export function renderReplayBoard() {
    const board = document.getElementById('replay-board');
    const words = state.currentReplayData?.initialBoard?.words || [];
    const types = state.currentReplayData?.initialBoard?.types || [];

    board.innerHTML = words.map((word, index) => {
        return `<div class="replay-card" data-index="${index}">${escapeHTML(word)}</div>`;
    }).join('');

    // Apply revealed state up to current index
    applyReplayState();
}

export function applyReplayState() {
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
                cards[cardIndex].classList.add('revealed', cardType);
                // Highlight current move
                if (i === state.currentReplayIndex) {
                    cards[cardIndex].classList.add('current-move');
                }
            }
        }
    }
}

export function renderReplayEventLog() {
    const logEl = document.getElementById('replay-event-log');
    const events = state.currentReplayData?.events || [];

    if (events.length === 0) {
        logEl.innerHTML = '<p style="opacity: 0.5;">No events recorded.</p>';
        return;
    }

    logEl.innerHTML = events.map((event, index) => {
        let actionText = '';
        let detailText = '';
        const team = escapeHTML(event.data?.team || '');

        switch (event.type) {
            case 'clue':
                actionText = 'gave clue';
                detailText = `"${escapeHTML(event.data?.word || '')}" for ${escapeHTML(String(event.data?.number ?? ''))}`;
                break;
            case 'reveal':
                actionText = 'revealed';
                detailText = `${escapeHTML(event.data?.word || '')} (${escapeHTML(event.data?.type || '')})`;
                break;
            case 'endTurn':
                actionText = 'ended turn';
                detailText = '';
                break;
            case 'forfeit':
                actionText = 'forfeited';
                detailText = `${escapeHTML(event.data?.winner || '')} wins`;
                break;
            default:
                actionText = escapeHTML(event.type || '');
                detailText = '';
        }

        return `
            <div class="replay-event ${index === state.currentReplayIndex ? 'current' : ''}" data-event-index="${index}">
                <span class="event-team ${team}">${team.toUpperCase()}</span>
                <span class="event-action">${actionText}</span>
                <span class="event-detail">${detailText}</span>
            </div>
        `;
    }).join('');
}

export function updateReplayControls() {
    const events = state.currentReplayData?.events || [];
    const prevBtn = document.getElementById('replay-prev');
    const nextBtn = document.getElementById('replay-next');
    const playBtn = document.getElementById('replay-play');
    const progressEl = document.getElementById('replay-progress');

    prevBtn.disabled = state.currentReplayIndex < 0;
    nextBtn.disabled = state.currentReplayIndex >= events.length - 1;
    playBtn.innerHTML = state.replayPlaying ? '&#10074;&#10074;' : '&#9654;';
    progressEl.textContent = `Move ${state.currentReplayIndex + 1} / ${events.length}`;
}

export function setupReplayControls() {
    const prevBtn = document.getElementById('replay-prev');
    const nextBtn = document.getElementById('replay-next');
    const playBtn = document.getElementById('replay-play');

    // Remove old listeners by cloning
    const newPrevBtn = prevBtn.cloneNode(true);
    const newNextBtn = nextBtn.cloneNode(true);
    const newPlayBtn = playBtn.cloneNode(true);

    prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
    nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
    playBtn.parentNode.replaceChild(newPlayBtn, playBtn);

    newPrevBtn.addEventListener('click', () => {
        if (state.currentReplayIndex >= 0) {
            state.currentReplayIndex--;
            applyReplayState();
            renderReplayEventLog();
            updateReplayControls();
            scrollToCurrentEvent();
        }
    });

    newNextBtn.addEventListener('click', () => {
        const events = state.currentReplayData?.events || [];
        if (state.currentReplayIndex < events.length - 1) {
            state.currentReplayIndex++;
            applyReplayState();
            renderReplayEventLog();
            updateReplayControls();
            scrollToCurrentEvent();
        }
    });

    newPlayBtn.addEventListener('click', () => {
        toggleReplayPlayback();
    });
}

export function toggleReplayPlayback() {
    state.replayPlaying = !state.replayPlaying;

    if (state.replayPlaying) {
        state.replayInterval = setInterval(() => {
            const events = state.currentReplayData?.events || [];
            if (state.currentReplayIndex < events.length - 1) {
                state.currentReplayIndex++;
                applyReplayState();
                renderReplayEventLog();
                updateReplayControls();
                scrollToCurrentEvent();
            } else {
                // Reached the end
                state.replayPlaying = false;
                clearInterval(state.replayInterval);
                state.replayInterval = null;
                updateReplayControls();
            }
        }, 1500); // 1.5 seconds between moves
    } else {
        if (state.replayInterval) {
            clearInterval(state.replayInterval);
            state.replayInterval = null;
        }
    }

    updateReplayControls();
}

export function scrollToCurrentEvent() {
    const logEl = document.getElementById('replay-event-log');
    const currentEventEl = logEl.querySelector('.replay-event.current');
    if (currentEventEl) {
        currentEventEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
