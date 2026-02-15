// ========== MULTIPLAYER SYNC ==========
// State synchronization, cleanup, and URL management for multiplayer mode

import { state } from './state.js';
import { renderBoard, detachResizeListener } from './board.js';
import { updateScoreboard, updateTurnIndicator } from './game.js';
import { updateRoleBanner, updateControls, clearRoleChange } from './roles.js';
import { handleTimerStopped } from './timer.js';
import { setTabNotification } from './notifications.js';
import { logger } from './logger.js';
import {
    updateMpIndicator, updateForfeitButton, updateRoomSettingsNavVisibility,
    hideReconnectionOverlay, updateDuetUI
} from './multiplayerUI.js';
import {
    setPlayerRole, clearPlayerRole, resetGameState,
    validateTurn, validateWinner, validateGameMode, validateArrayLength
} from './stateMutations.js';
import type { ServerPlayerData, ServerGameData, ReconnectionData, DOMListenerEntry } from './multiplayerTypes.js';

// List of multiplayer event names for cleanup
export const multiplayerEventNames: string[] = [
    'gameStarted', 'cardRevealed', 'turnEnded', 'gameOver',
    'playerJoined', 'playerLeft', 'playerDisconnected', 'playerReconnected',
    'playerUpdated', 'spymasterView',
    'timerStatus', 'timerStarted', 'timerStopped', 'timerExpired', 'roomResynced',
    'roomReconnected', 'disconnected', 'rejoining', 'rejoined', 'rejoinFailed', 'error',
    'kicked', 'playerKicked', 'settingsUpdated',
    'hostChanged', 'roomWarning',
    'historyResult', 'replayData',
    'statsUpdated', 'spectatorChatMessage'
];

// Track DOM listeners for cleanup to prevent memory leaks
export const domListenerCleanup: DOMListenerEntry[] = [];

/**
 * Remove all tracked DOM event listeners
 */
export function cleanupDOMListeners(): void {
    domListenerCleanup.forEach(({ element, event, handler, options }) => {
        try {
            element.removeEventListener(event, handler, options);
        } catch {
            // Element may have been removed from DOM
        }
    });
    domListenerCleanup.length = 0; // Clear array
}

export function cleanupMultiplayerListeners(): void {
    // Remove all multiplayer event listeners from CodenamesClient
    multiplayerEventNames.forEach(eventName => {
        if (CodenamesClient && typeof CodenamesClient.off === 'function') {
            CodenamesClient.off(eventName);
        }
    });

    // Clean up any tracked DOM listeners
    cleanupDOMListeners();

    state.multiplayerListenersSetup = false;
}

/**
 * Sync local player state variables from server player data.
 * Routes through setPlayerRole() for atomic, validated updates.
 */
export function syncLocalPlayerState(player: ServerPlayerData): void {
    if (!player) return;
    setPlayerRole(player.role, player.team);
}

/**
 * Reset all multiplayer-related state (team, role, clicker flags, game state).
 * Called on room change and disconnect to prevent stale data.
 */
export function resetMultiplayerState(): void {
    clearPlayerRole();
    state.isHost = false;
    clearRoleChange();
    // Clear pending reveal timeouts to prevent memory leaks
    state.revealTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    state.revealTimeouts.clear();
    state.revealingCards.clear();
    state.isRevealingCard = false;
    state.multiplayerPlayers = [];
    document.querySelectorAll('.card.revealing').forEach(c => c.classList.remove('revealing'));
}

export function leaveMultiplayerMode(): void {
    // Clean up listeners
    cleanupMultiplayerListeners();

    // Stop timer display
    handleTimerStopped();

    // Reset tab notification
    setTabNotification(false);

    // Hide reconnection overlay and forfeit button
    hideReconnectionOverlay();
    updateForfeitButton();

    // Leave room and disconnect
    if (CodenamesClient && CodenamesClient.isConnected()) {
        CodenamesClient.leaveRoom();
    }

    // Reset all multiplayer state (team, role, clicker flags, etc.)
    resetMultiplayerState();
    state.isMultiplayerMode = false;
    state.currentRoomId = null;

    // Reset stale game state to prevent old boards from persisting across rooms
    resetGameState();
    state.boardInitialized = false;

    // Clear replay state to prevent stale data leaking across rooms
    state.currentReplayData = null;
    state.currentReplayIndex = -1;
    state.replayPlaying = false;
    if (state.replayInterval) {
        clearInterval(state.replayInterval);
        state.replayInterval = null;
    }

    // Clean up resize listener to prevent accumulation across room switches
    detachResizeListener();

    // Clear room code from URL
    clearRoomCodeFromURL();

    // Update UI
    updateMpIndicator(null, []);
    // Hide room settings nav item
    updateRoomSettingsNavVisibility();
}

/**
 * Full game state sync from server (used when joining a room)
 */
export function syncGameStateFromServer(serverGame: ServerGameData): void {
    if (!serverGame) return;

    // Bounds validation: reject obviously corrupted server data
    const MAX_BOARD_SIZE = 100; // Generous upper bound (standard is 25)
    if (serverGame.words && Array.isArray(serverGame.words) && serverGame.words.length > MAX_BOARD_SIZE) {
        logger.error(`syncGameStateFromServer: rejected oversized words array (${serverGame.words.length})`);
        return;
    }

    // Server sends arrays: words, types, revealed (not a board object)
    if (serverGame.words && Array.isArray(serverGame.words)) {
        const wordCount = serverGame.words.length;

        // Check if words have changed - if so, force full board re-render
        const wordsChanged = !state.gameState.words ||
            state.gameState.words.length !== wordCount ||
            state.gameState.words.some((w: string, i: number) => w !== serverGame.words![i]);

        if (wordsChanged) {
            // Force full board re-render when words change (new game started)
            state.boardInitialized = false;
        }

        state.gameState.words = serverGame.words;

        // Validate parallel arrays match word count
        const types = serverGame.types || [];
        const revealed = serverGame.revealed || [];
        if (types.length > 0) {
            validateArrayLength('types', types, wordCount);
        }
        if (revealed.length > 0) {
            validateArrayLength('revealed', revealed, wordCount);
        }
        state.gameState.types = types;
        state.gameState.revealed = revealed;

        // Use server-provided scores if available, with range validation
        if (typeof serverGame.redScore === 'number' && serverGame.redScore >= 0 && serverGame.redScore <= MAX_BOARD_SIZE) {
            state.gameState.redScore = serverGame.redScore;
        }
        if (typeof serverGame.blueScore === 'number' && serverGame.blueScore >= 0 && serverGame.blueScore <= MAX_BOARD_SIZE) {
            state.gameState.blueScore = serverGame.blueScore;
        }
        if (typeof serverGame.redTotal === 'number' && serverGame.redTotal >= 0 && serverGame.redTotal <= MAX_BOARD_SIZE) {
            state.gameState.redTotal = serverGame.redTotal;
        }
        if (typeof serverGame.blueTotal === 'number' && serverGame.blueTotal >= 0 && serverGame.blueTotal <= MAX_BOARD_SIZE) {
            state.gameState.blueTotal = serverGame.blueTotal;
        }
    }

    // Validate currentTurn is a known team
    if (serverGame.currentTurn) {
        state.gameState.currentTurn = validateTurn(serverGame.currentTurn, state.gameState.currentTurn);
    }

    // Sync game over state with validated winner
    if (serverGame.gameOver || serverGame.winner) {
        state.gameState.gameOver = true;
        state.gameState.winner = validateWinner(serverGame.winner);
    } else {
        state.gameState.gameOver = false;
        state.gameState.winner = null;
    }

    // Sync seed if available
    if (serverGame.seed) {
        state.gameState.seed = serverGame.seed;
    }

    // Sync clue state (explicitly handle null to clear old clue)
    if (serverGame.currentClue !== undefined) {
        state.gameState.currentClue = serverGame.currentClue || null;
    }

    // Sync guess tracking state
    if (typeof serverGame.guessesUsed === 'number') {
        state.gameState.guessesUsed = serverGame.guessesUsed;
    }
    if (typeof serverGame.guessesAllowed === 'number') {
        state.gameState.guessesAllowed = serverGame.guessesAllowed;
    }

    // Sync Duet mode fields
    if (serverGame.duetTypes) {
        state.gameState.duetTypes = serverGame.duetTypes;
    }
    if (typeof serverGame.timerTokens === 'number') {
        state.gameState.timerTokens = serverGame.timerTokens;
    }
    if (typeof serverGame.greenFound === 'number') {
        state.gameState.greenFound = serverGame.greenFound;
    }
    if (typeof serverGame.greenTotal === 'number') {
        state.gameState.greenTotal = serverGame.greenTotal;
    }
    if (serverGame.gameMode) {
        state.gameMode = validateGameMode(serverGame.gameMode);
    }

    // Update all UI components
    renderBoard();
    updateScoreboard();
    updateTurnIndicator();
    updateControls();
    updateRoleBanner();
    updateForfeitButton();
    updateDuetUI(serverGame);

    // Update tab notification based on current turn
    const isYourTurn = Boolean(state.clickerTeam && state.clickerTeam === state.gameState.currentTurn && !state.gameState.gameOver);
    setTabNotification(isYourTurn);
}

// ========== URL MANAGEMENT ==========

/**
 * Parse room code from URL query parameters
 */
export function getRoomCodeFromURL(): string | null {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || params.get('join') || null;
}

/**
 * Update URL with room code after joining (for shareable links)
 */
export function updateURLWithRoomCode(roomCode: string): void {
    if (!roomCode) return;
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomCode);
    // Remove standalone game parameters when in multiplayer
    url.searchParams.delete('game');
    url.searchParams.delete('r');
    url.searchParams.delete('t');
    url.searchParams.delete('w');
    window.history.replaceState({}, '', url.toString());
}

/**
 * Clear room code from URL when leaving multiplayer
 */
export function clearRoomCodeFromURL(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('join');
    window.history.replaceState({}, '', url.toString());
}

// ========== OFFLINE CHANGE DETECTION ==========

/**
 * Detect significant state changes that occurred while the player was offline.
 * Compares server state with local state before syncing.
 * @param data - Reconnection data from server
 * @returns Array of change summary strings
 */
export function detectOfflineChanges(data: ReconnectionData): string[] {
    const changes: string[] = [];

    if (!data) return changes;

    const serverGame = data.game;
    const localGame = state.gameState;

    // Game started while offline
    if (serverGame && serverGame.words && serverGame.words.length > 0 && (!localGame.words || localGame.words.length === 0)) {
        changes.push('A game was started');
    }

    // Game ended while offline
    if (serverGame && serverGame.gameOver && !localGame.gameOver) {
        const winner = serverGame.winner;
        if (winner) {
            const teamName = winner === 'red' ? (state.teamNames?.red || 'Red') : (state.teamNames?.blue || 'Blue');
            changes.push(`Game over \u2014 ${teamName} won`);
        } else {
            changes.push('Game over');
        }
    }

    // Turn changed while offline
    if (serverGame && serverGame.currentTurn && localGame.currentTurn &&
        serverGame.currentTurn !== localGame.currentTurn && !serverGame.gameOver) {
        const teamName = serverGame.currentTurn === 'red' ? (state.teamNames?.red || 'Red') : (state.teamNames?.blue || 'Blue');
        changes.push(`Now ${teamName}'s turn`);
    }

    // Player count changed
    if (data.players && state.multiplayerPlayers.length > 0) {
        const diff = data.players.length - state.multiplayerPlayers.length;
        if (diff > 0) {
            changes.push(`${diff} player${diff > 1 ? 's' : ''} joined`);
        } else if (diff < 0) {
            changes.push(`${Math.abs(diff)} player${Math.abs(diff) > 1 ? 's' : ''} left`);
        }
    }

    return changes;
}
