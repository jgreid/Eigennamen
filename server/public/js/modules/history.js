// ========== HISTORY MODULE ==========
// Game history and replay

import { state } from './state.js';
import { escapeHTML, formatGameTimestamp, formatDuration } from './utils.js';
import { openModal, closeModal, showToast } from './ui.js';

// PHASE 4: Replay speed options (in milliseconds between moves)
const REPLAY_SPEEDS = {
    '0.5x': 3000,  // Slow
    '1x': 1500,    // Normal (default)
    '2x': 750,     // Fast
    '4x': 375      // Very fast
};
let currentReplaySpeed = '1x';

export function openGameHistory() {
    if (!state.isMultiplayerMode || !CodenamesClient.isConnected()) {
        showToast('Game history is only available in multiplayer mode', 'info');
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

    listEl.innerHTML = '';
    for (const game of games) {
        const dateStr = formatGameTimestamp(game.timestamp);
        const winnerName = game.teamNames?.[game.winner] || (game.winner === 'red' ? 'Red' : 'Blue');

        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.gameId = game.id;

        const info = document.createElement('div');
        info.className = 'history-item-info';
        const winnerDiv = document.createElement('div');
        winnerDiv.className = `history-item-winner ${escapeHTML(game.winner)}`;
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

    // Render replay info using DOM APIs to prevent XSS
    const replayInfo = document.getElementById('replay-info');
    replayInfo.innerHTML = '';
    const winnerBadge = document.createElement('span');
    winnerBadge.className = `winner-badge ${escapeHTML(data.finalState?.winner || '')}`;
    winnerBadge.textContent = `${data.teamNames?.[data.finalState?.winner] || data.finalState?.winner || 'Unknown'} Team Wins!`;
    replayInfo.appendChild(winnerBadge);
    const durationSpan = document.createElement('span');
    durationSpan.textContent = `Duration: ${formatDuration(data.duration || 0)} | ${data.totalMoves || 0} moves`;
    replayInfo.appendChild(durationSpan);

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

    board.innerHTML = '';
    words.forEach((word, index) => {
        const card = document.createElement('div');
        card.className = 'replay-card';
        card.dataset.index = String(index);
        card.textContent = word;
        board.appendChild(card);
    });

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

    logEl.innerHTML = '';
    events.forEach((event, index) => {
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
        teamSpan.className = `event-team ${escapeHTML(team)}`;
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
    const speedBtn = document.getElementById('replay-speed');
    const shareBtn = document.getElementById('replay-share');

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

    // PHASE 4: Speed control
    if (speedBtn) {
        const newSpeedBtn = speedBtn.cloneNode(true);
        speedBtn.parentNode.replaceChild(newSpeedBtn, speedBtn);
        newSpeedBtn.addEventListener('click', cycleReplaySpeed);
        newSpeedBtn.textContent = currentReplaySpeed;
    }

    // PHASE 4: Share/export replay link
    if (shareBtn) {
        const newShareBtn = shareBtn.cloneNode(true);
        shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);
        newShareBtn.addEventListener('click', copyReplayLink);
    }
}

export function toggleReplayPlayback() {
    state.replayPlaying = !state.replayPlaying;

    if (state.replayPlaying) {
        // PHASE 4: Use selected replay speed
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
                // Reached the end
                state.replayPlaying = false;
                clearInterval(state.replayInterval);
                state.replayInterval = null;
                updateReplayControls();
            }
        }, speedMs);
    } else {
        if (state.replayInterval) {
            clearInterval(state.replayInterval);
            state.replayInterval = null;
        }
    }

    updateReplayControls();
}

// PHASE 4: Cycle through replay speed options
export function cycleReplaySpeed() {
    const speedKeys = Object.keys(REPLAY_SPEEDS);
    const currentIndex = speedKeys.indexOf(currentReplaySpeed);
    const nextIndex = (currentIndex + 1) % speedKeys.length;
    currentReplaySpeed = speedKeys[nextIndex];

    // Update button text
    const speedBtn = document.getElementById('replay-speed');
    if (speedBtn) {
        speedBtn.textContent = currentReplaySpeed;
    }

    // If currently playing, restart with new speed
    if (state.replayPlaying) {
        clearInterval(state.replayInterval);
        const speedMs = REPLAY_SPEEDS[currentReplaySpeed];
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
                clearInterval(state.replayInterval);
                state.replayInterval = null;
                updateReplayControls();
            }
        }, speedMs);
    }

    showToast(`Playback speed: ${currentReplaySpeed}`, 'info');
}

// PHASE 4: Copy shareable replay link to clipboard
export function copyReplayLink() {
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

    // Copy to clipboard
    navigator.clipboard.writeText(url.toString())
        .then(() => {
            showToast('Replay link copied to clipboard!', 'success');
        })
        .catch(() => {
            // Fallback for browsers without clipboard API
            const textArea = document.createElement('textarea');
            textArea.value = url.toString();
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                showToast('Replay link copied!', 'success');
            } catch (err) {
                showToast('Could not copy link', 'error');
            }
            document.body.removeChild(textArea);
        });
}

// PHASE 4: Get current replay speed (for display)
export function getCurrentReplaySpeed() {
    return currentReplaySpeed;
}

// PHASE 4: Set replay speed programmatically
export function setReplaySpeed(speed) {
    if (REPLAY_SPEEDS[speed]) {
        currentReplaySpeed = speed;
        const speedBtn = document.getElementById('replay-speed');
        if (speedBtn) {
            speedBtn.textContent = currentReplaySpeed;
        }
    }
}

export function scrollToCurrentEvent() {
    const logEl = document.getElementById('replay-event-log');
    const currentEventEl = logEl.querySelector('.replay-event.current');
    if (currentEventEl) {
        currentEventEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
