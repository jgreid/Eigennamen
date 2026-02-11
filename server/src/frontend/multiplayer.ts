// ========== MULTIPLAYER MODULE ==========
// All multiplayer functionality

import { state } from './state.js';
import { escapeHTML, safeGetItem, safeSetItem, copyToClipboard } from './utils.js';
import { showToast, openModal, closeModal, announceToScreenReader } from './ui.js';
import { renderBoard } from './board.js';
import { revealCardFromServer, showGameOver, updateScoreboard, updateTurnIndicator } from './game.js';
import { updateRoleBanner, updateControls, clearRoleChange, revertAndClearRoleChange } from './roles.js';
import { handleTimerStarted, handleTimerStopped, handleTimerStatus } from './timer.js';
import { playNotificationSound, setTabNotification, checkAndNotifyTurn } from './notifications.js';
// PHASE 2 FIX: Import shared constants for validation
import { VALIDATION, UI, validateNickname, validateRoomCode } from './constants.js';

// PHASE 2 FIX: AbortController for request cancellation
// Allows cancelling in-flight operations when user navigates away
let joinAbortController: AbortController | null = null;
let createAbortController: AbortController | null = null;

// Session ID pending kick confirmation (used by confirm-kick-modal)
let pendingKickSessionId: string | null = null;

/**
 * Cancel any in-progress join operation
 */
export function cancelJoinOperation(): void {
    if (joinAbortController) {
        joinAbortController.abort();
        joinAbortController = null;
    }
}

/**
 * Cancel any in-progress create operation
 */
export function cancelCreateOperation(): void {
    if (createAbortController) {
        createAbortController.abort();
        createAbortController = null;
    }
}

/**
 * Cancel all in-progress multiplayer operations
 */
export function cancelAllOperations(): void {
    cancelJoinOperation();
    cancelCreateOperation();
}

export function openMultiplayer(): void {
    // Pre-fill nickname from storage
    const storedNickname = safeGetItem('codenames-nickname', '');
    (document.getElementById('join-nickname') as HTMLInputElement).value = storedNickname;
    (document.getElementById('create-nickname') as HTMLInputElement).value = storedNickname;

    // Reset forms
    (document.getElementById('join-room-id') as HTMLInputElement).value = '';
    (document.getElementById('create-room-id') as HTMLInputElement).value = '';
    setMpStatus('', '');
    clearFormErrors();

    // Reset to join mode
    setMpMode('join');

    openModal('multiplayer-modal');
}

export function closeMultiplayer(): void {
    // PHASE 2 FIX: Cancel any in-progress operations when modal closes
    cancelAllOperations();
    clearFormErrors();
    closeModal('multiplayer-modal');
}

export function setMpMode(mode: string): void {
    state.currentMpMode = mode;

    // Update mode buttons
    document.querySelectorAll('.mode-btn').forEach((btn: any) => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Show correct form
    document.getElementById('join-form')!.classList.toggle('active', mode === 'join');
    document.getElementById('create-form')!.classList.toggle('active', mode === 'create');

    // Update action button text
    const actionBtn = document.getElementById('btn-mp-action')!;
    actionBtn.textContent = mode === 'join' ? 'Join Game' : 'Create Game';
}

export function setMpStatus(message: string, type: string): void {
    const statusEl = document.getElementById('mp-status');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = 'connection-status';
    if (type) {
        statusEl.classList.add(type);
    }
}

/**
 * Set error message for a specific field or general form error
 */
export function setFieldError(message: string, fieldId: string): void {
    const errorEl = document.getElementById(fieldId);
    if (!errorEl) return;
    const formGroup = errorEl.closest('.form-group');
    errorEl.textContent = message;
    if (formGroup) {
        if (message) {
            formGroup.classList.add('error');
        } else {
            formGroup.classList.remove('error');
        }
    }
}

/**
 * Clear all form errors
 */
export function clearFormErrors(): void {
    ['join-error', 'join-nickname-error', 'create-error', 'create-nickname-error'].forEach(id => {
        setFieldError('', id);
    });
}

// Legacy function for backward compatibility
function setMpError(message: string): void {
    setFieldError(message, state.currentMpMode === 'join' ? 'join-error' : 'create-error');
}

export async function handleMpAction(): Promise<void> {
    const actionBtn = document.getElementById('btn-mp-action') as HTMLButtonElement;
    if (!actionBtn) return;

    const originalText = actionBtn.textContent;
    actionBtn.disabled = true;
    actionBtn.textContent = state.currentMpMode === 'join' ? 'Joining...' : 'Creating...';
    actionBtn.classList.add('loading');

    try {
        if (state.currentMpMode === 'join') {
            await handleJoinGame();
        } else {
            await handleCreateGame();
        }
    } catch (error: any) {
        console.error('Multiplayer action failed:', error);
        setMpStatus(error.message || 'Connection failed', 'error');
    } finally {
        // Always restore button state, even on unexpected errors or early returns
        actionBtn.disabled = false;
        actionBtn.textContent = originalText;
        actionBtn.classList.remove('loading');
    }
}

async function handleJoinGame(): Promise<void> {
    clearFormErrors();

    const nickname = (document.getElementById('join-nickname') as HTMLInputElement).value.trim();
    const roomIdInput = (document.getElementById('join-room-id') as HTMLInputElement).value.trim();
    const urlRoomCode = getRoomCodeFromURL();
    const joinBtn = document.getElementById('btn-mp-action') as HTMLButtonElement;

    // PHASE 2 FIX: Use shared validation functions from constants.js
    const nicknameValidation = validateNickname(nickname);
    if (!nicknameValidation.valid) {
        setFieldError(nicknameValidation.error, 'join-nickname-error');
        return;
    }
    if (!/^[\p{L}\p{N}\s\-_]+$/u.test(nickname)) {
        setFieldError('Nickname can only contain letters, numbers, spaces, hyphens, and underscores', 'join-nickname-error');
        return;
    }

    // Use user input if provided, otherwise fall back to URL room code
    const roomId = roomIdInput || urlRoomCode;

    // PHASE 2 FIX: Use shared validation functions from constants.js
    const roomValidation = validateRoomCode(roomId);
    if (!roomValidation.valid) {
        setFieldError(roomValidation.error, 'join-error');
        return;
    }

    // PHASE 2 FIX: Cancel any previous join operation and create new AbortController
    cancelJoinOperation();
    joinAbortController = new AbortController();
    const signal = joinAbortController.signal;

    // Disable button to prevent double-click race condition
    if (joinBtn) joinBtn.disabled = true;

    try {
        setMpStatus('Connecting...', 'connecting');

        // Connect to server
        if (!CodenamesClient.isConnected()) {
            await CodenamesClient.connect();
        }

        // Check if operation was cancelled during connection
        if (signal.aborted) {
            return;
        }

        setMpStatus('Joining game...', 'connecting');
        // FIX: Normalize room ID to lowercase before sending to server
        // This ensures consistency with server-side normalization and prevents
        // case-mismatch issues between client state and server state
        const normalizedRoomId = roomId!.toLowerCase();
        const result = await CodenamesClient.joinRoom(normalizedRoomId, nickname);

        // Check if operation was cancelled while waiting for join response
        if (signal.aborted) {
            return;
        }

        // Store the actual room code from server (normalized to lowercase)
        // FIX: Use normalizedRoomId as fallback instead of raw roomId to prevent case mismatch
        state.currentRoomId = result.room?.code || normalizedRoomId;

        onMultiplayerJoined(result, false); // false = not host

    } catch (error: any) {
        // Silently ignore AbortError - operation was intentionally cancelled
        if (error.name === 'AbortError' || signal.aborted) {
            return;
        }

        console.error('Join failed for room "' + roomId + '":', error);
        if (error.code === 'ROOM_NOT_FOUND') {
            setMpStatus(`Room "${roomId}" not found - check the Room ID`, 'error');
            // Clear stale URL room code to prevent repeated failures
            clearRoomCodeFromURL();
        } else if (error.code === 'ROOM_FULL') {
            setMpStatus('Room is full', 'error');
        } else if (error.code === 'INVALID_INPUT') {
            // Show actual server validation message (could be room ID or nickname issue)
            setMpStatus(error.message || 'Invalid input - check Room ID and nickname', 'error');
        } else if (error.message?.includes('connect')) {
            setMpStatus('Could not connect to server - check your connection and try again', 'error');
        } else {
            setMpStatus(error.message || 'Failed to join game - please try again', 'error');
        }
    } finally {
        // Re-enable button
        if (joinBtn) joinBtn.disabled = false;
        // Clear the controller reference
        joinAbortController = null;
    }
}

async function handleCreateGame(): Promise<void> {
    clearFormErrors();

    const nickname = (document.getElementById('create-nickname') as HTMLInputElement).value.trim();
    const roomId = (document.getElementById('create-room-id') as HTMLInputElement).value.trim();
    const createBtn = document.getElementById('btn-mp-action') as HTMLButtonElement;

    // PHASE 2 FIX: Use shared validation functions from constants.js
    const nicknameValidation = validateNickname(nickname);
    if (!nicknameValidation.valid) {
        setFieldError(nicknameValidation.error, 'create-nickname-error');
        return;
    }
    if (!/^[\p{L}\p{N}\s\-_]+$/u.test(nickname)) {
        setFieldError('Nickname can only contain letters, numbers, spaces, hyphens, and underscores', 'create-nickname-error');
        return;
    }

    // PHASE 2 FIX: Use shared validation functions from constants.js
    const roomValidation = validateRoomCode(roomId);
    if (!roomValidation.valid) {
        setFieldError(roomValidation.error, 'create-error');
        return;
    }

    // PHASE 2 FIX: Cancel any previous create operation and create new AbortController
    cancelCreateOperation();
    createAbortController = new AbortController();
    const signal = createAbortController.signal;

    // Disable button to prevent double-click race condition
    if (createBtn) createBtn.disabled = true;

    try {
        setMpStatus('Creating game...', 'connecting');

        // Connect to server
        if (!CodenamesClient.isConnected()) {
            await CodenamesClient.connect();
        }

        // Check if operation was cancelled during connection
        if (signal.aborted) {
            return;
        }

        // Create room with normalized roomId (consistent with join flow and server-side normalization)
        const normalizedRoomId = roomId.toLowerCase();
        const result = await CodenamesClient.createRoom({
            roomId: normalizedRoomId,
            nickname: nickname
        });

        // Check if operation was cancelled while waiting for create response
        if (signal.aborted) {
            return;
        }

        // Store the actual room code from server (normalized to lowercase)
        state.currentRoomId = result.room?.code || roomId.toLowerCase();

        onMultiplayerJoined(result, true); // true = isHost

    } catch (error: any) {
        // Silently ignore AbortError - operation was intentionally cancelled
        if (error.name === 'AbortError' || signal.aborted) {
            return;
        }

        console.error('Create failed:', error);
        if (error.code === 'ROOM_ALREADY_EXISTS') {
            setMpStatus('A room with this ID already exists. Try a different Room ID.', 'error');
        } else if (error.message?.includes('connect')) {
            setMpStatus('Could not connect to server - check your connection and try again', 'error');
        } else {
            setMpStatus(error.message || 'Failed to create game - please try again', 'error');
        }
    } finally {
        // Re-enable button
        if (createBtn) createBtn.disabled = false;
        // Clear the controller reference
        createAbortController = null;
    }
}

export function onMultiplayerJoined(result: any, isHostParam: boolean = false): void {
    // Detect room change and reset stale state
    const newRoomCode = result.room?.code;
    if (state.currentRoomId && newRoomCode && state.currentRoomId !== newRoomCode) {
        // Switching rooms - clear stale state from previous room
        resetMultiplayerState();
    }

    state.isMultiplayerMode = true;
    safeSetItem('codenames-nickname', CodenamesClient.player?.nickname || '');

    // CRITICAL: Set up multiplayer event listeners FIRST to avoid race condition
    // where game:started arrives before listeners are ready
    if (!state.multiplayerListenersSetup) {
        setupMultiplayerListeners();
        state.multiplayerListenersSetup = true;
    }

    // Store players list
    state.multiplayerPlayers = result.players || [result.player];

    // Sync current player's team and role from server
    // result.you is set for joinRoom, result.player for createRoom
    const currentPlayer = result.you || result.player || CodenamesClient.player;
    if (currentPlayer) {
        syncLocalPlayerState(currentPlayer);
    }

    // ISSUE FIX: Update global isHost from player data or parameter
    // The parameter isHostParam indicates if this was a room creation
    // Also check CodenamesClient.player.isHost for reconnection cases
    state.isHost = isHostParam || CodenamesClient.player?.isHost || false;

    // Sync game state from server if available
    if (result.game) {
        syncGameStateFromServer(result.game);
    }

    // Update URL with room code for shareable links
    if (result.room?.code) {
        updateURLWithRoomCode(result.room.code);
    }

    // Update UI
    setMpStatus('Connected!', 'success');
    updateMpIndicator(result.room, state.multiplayerPlayers);

    // Show/hide room settings nav item based on host status
    updateRoomSettingsNavVisibility();
    // Update room info in settings panel
    updateRoomInfoDisplay();

    // Update role-specific UI
    updateControls();
    updateRoleBanner();
    updateForfeitButton();

    // Close modal after brief delay and show appropriate message
    setTimeout(() => {
        closeMultiplayer();
        if (state.isHost && state.currentRoomId) {
            showToast(`Game created! Share Room ID: ${state.currentRoomId}`, 'success', 8000);
        } else {
            showToast('Connected to multiplayer game!', 'success');
        }
    }, UI.MP_JOIN_CLOSE_DELAY_MS);
}

/**
 * Sync local player state variables from server player data
 */
export function syncLocalPlayerState(player: any): void {
    if (!player) return;

    // Set team affiliation
    state.playerTeam = player.team || null;

    // Set role-specific variables
    if (player.role === 'spymaster' && player.team) {
        state.spymasterTeam = player.team;
        state.clickerTeam = null;
    } else if (player.role === 'clicker' && player.team) {
        state.clickerTeam = player.team;
        state.spymasterTeam = null;
    } else {
        // Spectator or unassigned
        state.spymasterTeam = null;
        state.clickerTeam = null;
    }
}

export function updateMpIndicator(room: any, players: any[]): void {
    const indicator = document.getElementById('mp-indicator');
    const codeEl = document.getElementById('mp-room-code');
    const countEl = document.getElementById('mp-player-count');
    const playerListEl = document.getElementById('mp-player-list');
    const playersUl = document.getElementById('mp-players-ul') as HTMLUListElement;
    const mpExtraRow = document.getElementById('mp-extra-buttons-row');

    if (room) {
        codeEl!.textContent = room.code;
        countEl!.textContent = `${players?.length || 1} player${players?.length !== 1 ? 's' : ''}`;
        indicator!.classList.add('active');

        // Show multiplayer-only buttons row (history + forfeit)
        if (mpExtraRow) {
            mpExtraRow.style.display = 'flex';
        }

        // Update player list
        if (playersUl && players) {
            updatePlayerList(playersUl, players);
        }

        // Update share panel for multiplayer mode
        updateSharePanelMode(true, room.code);
    } else {
        indicator!.classList.remove('active');
        if (playerListEl) playerListEl.style.display = 'none';
        // Hide multiplayer-only buttons when not in multiplayer mode
        if (mpExtraRow) {
            mpExtraRow.style.display = 'none';
        }

        // Update share panel for standalone mode
        updateSharePanelMode(false);
    }
}

// Toggle share panel between multiplayer (room code) and standalone (URL/QR) modes
export function updateSharePanelMode(isMultiplayer: boolean, roomCode: string | null = null): void {
    const mpShare = document.getElementById('mp-room-code-share');
    const standaloneShare = document.getElementById('standalone-share');
    const shareRoomCode = document.getElementById('share-room-code');
    const shareServerUrl = document.getElementById('share-server-url');
    const qrSection = document.getElementById('qr-section');

    if (isMultiplayer && roomCode) {
        // Multiplayer mode: show room code, hide URL/QR
        if (mpShare) mpShare.style.display = 'block';
        if (standaloneShare) standaloneShare.style.display = 'none';
        if (shareRoomCode) shareRoomCode.textContent = roomCode.toUpperCase();
        if (shareServerUrl) shareServerUrl.textContent = window.location.host;
        // Hide sidebar QR section in multiplayer mode
        if (qrSection) qrSection.style.display = 'none';
    } else {
        // Standalone mode: show URL/QR, hide room code
        if (mpShare) mpShare.style.display = 'none';
        if (standaloneShare) standaloneShare.style.display = 'block';
        // Show sidebar QR section in standalone mode (if library loaded)
        if (qrSection && typeof qrcode === 'function') qrSection.style.display = '';
    }
}

// Copy room code to clipboard
export async function copyRoomCode(): Promise<void> {
    const roomCode = document.getElementById('share-room-code')?.textContent;
    const feedback = document.getElementById('room-code-copy-feedback');

    if (!roomCode || roomCode === '----') return;

    const copied = await copyToClipboard(roomCode);
    if (copied) {
        if (feedback) {
            feedback.textContent = 'Room code copied!';
            setTimeout(() => { feedback.textContent = ''; }, UI.COPY_FEEDBACK_MS);
        }
        showToast('Room code copied to clipboard');
    } else {
        showToast('Failed to copy - please copy manually', 'warning');
    }
}

export async function copyRoomId(): Promise<void> {
    if (state.currentRoomId) {
        const copied = await copyToClipboard(state.currentRoomId);
        if (copied) {
            showToast('Room ID copied!', 'success', 2000);
        } else {
            showToast('Failed to copy', 'error', 2000);
        }
    }
}

export function updatePlayerList(ul: HTMLUListElement, players: any[]): void {
    const mySessionId = CodenamesClient.player?.sessionId;
    const amHost = CodenamesClient.player?.isHost;

    ul.innerHTML = '';
    for (const p of players) {
        const isMe = p.sessionId === mySessionId;
        const li = document.createElement('li');
        if (p.connected === false) li.className = 'player-disconnected';

        const info = document.createElement('span');
        info.className = 'player-info';

        const nameSpan = document.createElement('span');
        nameSpan.className = `player-name${isMe ? ' you' : ''}${p.team ? ` player-team-${escapeHTML(p.team)}` : ''}`;
        nameSpan.textContent = p.nickname + (isMe ? ' (you)' : '');
        info.appendChild(nameSpan);

        if (p.isHost) {
            const badge = document.createElement('span');
            badge.className = 'host-badge';
            badge.textContent = 'Host';
            info.appendChild(badge);
        }

        const roleSpan = document.createElement('span');
        roleSpan.className = 'player-role';
        roleSpan.textContent = (p.role ? `(${p.role})` : '') + (p.connected === false ? ' - offline' : '');
        info.appendChild(roleSpan);

        li.appendChild(info);

        if (amHost && !isMe) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'btn-kick';
            kickBtn.dataset.session = p.sessionId;
            kickBtn.title = 'Kick player';
            kickBtn.textContent = 'Kick';
            li.appendChild(kickBtn);
        }

        ul.appendChild(li);
    }
}

export function initPlayerListUI(): void {
    const playerCountBtn = document.getElementById('mp-player-count-btn');
    const playerListEl = document.getElementById('mp-player-list');
    const playersUl = document.getElementById('mp-players-ul');

    if (playerCountBtn && playerListEl) {
        playerCountBtn.addEventListener('click', () => {
            const isExpanded = playerListEl.style.display !== 'none';
            playerListEl.style.display = isExpanded ? 'none' : 'block';
            playerCountBtn.classList.toggle('expanded', !isExpanded);
        });
    }

    // Event delegation for kick buttons - uses custom modal instead of native confirm()
    if (playersUl) {
        playersUl.addEventListener('click', (e: any) => {
            const kickBtn = e.target.closest('.btn-kick');
            if (kickBtn) {
                const sessionId = kickBtn.dataset.session;
                if (sessionId) {
                    pendingKickSessionId = sessionId;
                    openModal('confirm-kick-modal');
                }
            }
        });
    }
}

export function setupMultiplayerListeners(): void {
    // Game state updates
    CodenamesClient.on('gameStarted', (data: any) => {
        // Clear loading state on new game button
        const newGameBtn = document.getElementById('btn-new-game') as HTMLButtonElement;
        if (newGameBtn) {
            newGameBtn.disabled = false;
            newGameBtn.classList.remove('loading');
        }

        // Full sync game state from server for new games
        if (data.game) {
            syncGameStateFromServer(data.game);
            state.gameMode = data.gameMode || 'classic';
            updateDuetUI(data.game);
            updateForfeitButton();
            const modeLabels: Record<string, string> = { blitz: 'Blitz game started!', duet: 'Duet game started!', classic: 'New game started!' };
            showToast(modeLabels[data.gameMode] || 'New game started!', 'success');
        }
    });

    CodenamesClient.on('cardRevealed', (data: any) => {
        // Clear per-card reveal tracking for the revealed card
        if (data.index !== undefined) {
            state.revealingCards.delete(data.index);
            const revealTimeout = state.revealTimeouts.get(data.index);
            if (revealTimeout) {
                clearTimeout(revealTimeout);
                state.revealTimeouts.delete(data.index);
            }
        }
        state.isRevealingCard = state.revealingCards.size > 0;

        // Remove pending visual state from the revealed card
        if (data.index !== undefined) {
            const card = document.querySelector(`.card[data-index="${data.index}"]`);
            if (card) card.classList.remove('revealing');
        }

        if (data.index !== undefined) {
            revealCardFromServer(data.index, data);
            playNotificationSound('reveal');

            // Announce card reveal to screen readers
            const word = data.word || (state.gameState.words && state.gameState.words[data.index]) || '';
            const type = data.type || '';
            if (word) {
                announceToScreenReader(`Card revealed: ${word}. ${type} card.`);
            }
        }

        // Update Duet info if present
        if (data.timerTokens !== undefined || data.greenFound !== undefined) {
            updateDuetInfoBar(data.greenFound, data.timerTokens);
        }
    });

    CodenamesClient.on('turnEnded', (data: any) => {
        if (data.currentTurn) {
            const previousTurn = state.gameState.currentTurn;
            // Update turn locally
            state.gameState.currentTurn = data.currentTurn;

            // Reset clue and guess state for new turn
            state.gameState.currentClue = null;
            state.gameState.guessesUsed = 0;
            state.gameState.guessesAllowed = 0;

            updateTurnIndicator();
            updateRoleBanner();
            updateControls();

            // Check and send notifications if it's now our turn
            checkAndNotifyTurn(data.currentTurn, previousTurn);

            // Announce turn change
            const newTeamName = data.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            announceToScreenReader(`Turn ended. Now ${newTeamName}'s turn.`);
        }
    });

    CodenamesClient.on('gameOver', (data: any) => {
        // Duet mode can have null winner (cooperative loss)
        if (data.winner || state.gameMode === 'duet') {
            // Sync all card types from server so non-spymasters can see the full board
            if (data.types && Array.isArray(data.types)) {
                state.gameState.types = data.types;
            }
            if (data.duetTypes && Array.isArray(data.duetTypes)) {
                state.gameState.duetTypes = data.duetTypes;
            }
            state.gameState.gameOver = true;
            state.gameState.winner = data.winner;

            if (state.gameMode === 'duet') {
                const duetWin = data.reason === 'completed';
                showGameOver(duetWin ? 'red' : null, data.reason);
            } else {
                showGameOver(data.winner, data.reason);
            }
            setTabNotification(false);
            playNotificationSound('gameOver');
            updateForfeitButton();
        }
    });

    // Handle clue given by spymaster
    CodenamesClient.on('clueGiven', (data: any) => {
        if (data.word && data.number !== undefined) {
            // Store current clue in game state for tracking guesses
            state.gameState.currentClue = {
                word: data.word,
                number: data.number,
                team: data.team,
                spymaster: data.spymaster,
                guessesAllowed: data.guessesAllowed
            };
            state.gameState.guessesUsed = 0;

            // Show clue as toast notification (visible for 5 seconds)
            const teamName = data.team === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(`${teamName} clue: ${data.word} (${data.number})`, 'info', 5000);
            announceToScreenReader(`${teamName} spymaster gives clue: ${data.word}, ${data.number}`);
        }
    });

    // Handle spymaster view (card types for spymasters)
    CodenamesClient.on('spymasterView', (data: any) => {
        if (data.types && Array.isArray(data.types)) {
            state.gameState.types = data.types;
            renderBoard();
        }
    });

    // Player updates
    CodenamesClient.on('playerJoined', (data: any) => {
        if (data.players) {
            state.multiplayerPlayers = data.players;
        } else if (data.player) {
            // Add new player to list if not already present
            const exists = state.multiplayerPlayers.some((p: any) => p.sessionId === data.player.sessionId);
            if (!exists) {
                state.multiplayerPlayers = [...state.multiplayerPlayers, data.player];
            }
        }
        updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
        showToast(`${data.player?.nickname || 'Someone'} joined`, 'success');
        playNotificationSound('join');
    });

    CodenamesClient.on('playerLeft', (data: any) => {
        if (data.players) {
            state.multiplayerPlayers = data.players;
        } else if (data.sessionId) {
            // Remove player from list
            state.multiplayerPlayers = state.multiplayerPlayers.filter((p: any) => p.sessionId !== data.sessionId);
        }
        updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
        if (data.nickname) {
            showToast(`${data.nickname} left`, 'info');
        }
    });

    // Handle player state updates (role, team, nickname changes)
    CodenamesClient.on('playerUpdated', (data: any) => {
        if (data.sessionId && data.changes) {
            // Update player in local list
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: any) =>
                p.sessionId === data.sessionId ? { ...p, ...data.changes } : p
            );
            updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);

            // Announce role/team changes to screen readers
            if (data.changes.role || data.changes.team !== undefined) {
                const changedPlayer = state.multiplayerPlayers.find((p: any) => p.sessionId === data.sessionId);
                const name = changedPlayer?.nickname || 'A player';
                if (data.changes.role) {
                    announceToScreenReader(`${name} is now ${data.changes.role}.`);
                }
                if (data.changes.team !== undefined) {
                    const teamName = data.changes.team
                        ? (data.changes.team === 'red' ? (state.teamNames?.red || 'Red') : (state.teamNames?.blue || 'Blue'))
                        : 'spectators';
                    announceToScreenReader(`${name} joined ${teamName}.`);
                }
            }

            // If this is the current player, update local state variables
            if (data.sessionId === CodenamesClient.player?.sessionId) {
                let updatedPlayer = state.multiplayerPlayers.find((p: any) => p.sessionId === data.sessionId);

                // Bug #8 fix: If player not in list, construct from changes and CodenamesClient.player
                if (!updatedPlayer) {
                    // Player might not be in multiplayerPlayers yet (e.g., just created room)
                    // Merge CodenamesClient.player with server changes for consistency
                    const basePlayer = CodenamesClient.player || {};
                    updatedPlayer = { ...basePlayer, ...data.changes };
                    if (updatedPlayer.sessionId) {
                        // Ensure the player is in the list for future updates
                        state.multiplayerPlayers = [...state.multiplayerPlayers, updatedPlayer];
                        updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
                    }
                }

                if (updatedPlayer) {
                    syncLocalPlayerState(updatedPlayer);

                    // Check for pending role change after team change completed
                    if (state.roleChange.phase === 'team_then_role' && data.changes.team) {
                        // Team change completed, now send the queued role change
                        const roleToSet = state.roleChange.pendingRole;
                        const currentOpId = state.roleChange.operationId;

                        // Narrow revert: team change succeeded, only revert role on failure
                        const confirmedTeam = updatedPlayer.team;
                        state.roleChange = {
                            phase: 'changing_role',
                            target: state.roleChange.target,
                            operationId: currentOpId,
                            revertFn: () => {
                                state.playerTeam = confirmedTeam;
                                state.spymasterTeam = null;
                                state.clickerTeam = null;
                                updateRoleBanner();
                                updateControls();
                                renderBoard();
                            }
                        };

                        CodenamesClient.setRole(roleToSet);
                    } else {
                        clearRoleChange();
                    }

                    updateControls();
                    updateRoleBanner();
                    renderBoard();
                } else {
                    // Even if player not found, clear role change to prevent blocking
                    console.warn('playerUpdated: current player not found in list, clearing role change state');
                    clearRoleChange();
                }
            }
        }
    });

    // Handle player disconnection (network issues)
    CodenamesClient.on('playerDisconnected', (data: any) => {
        // Mark player as disconnected in local list
        if (data.sessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: any) =>
                p.sessionId === data.sessionId ? { ...p, connected: false } : p
            );
            updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
            // Update controls and board - clicker disconnecting enables other team members
            updateControls();
            renderBoard();
        }
        showToast(`${data.nickname || 'A player'} disconnected`, 'warning');
    });

    // Handle player reconnection
    CodenamesClient.on('playerReconnected', (data: any) => {
        // Mark player as connected in local list
        if (data.sessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: any) =>
                p.sessionId === data.sessionId ? { ...p, connected: true } : p
            );
            updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
            // Update controls and board - clicker reconnecting restores normal behavior
            updateControls();
            renderBoard();
        }
        showToast(`${data.nickname || 'A player'} reconnected`, 'success');
    });

    // Handle host change (when previous host disconnects)
    CodenamesClient.on('hostChanged', (data: any) => {
        // Update global isHost based on whether we became the new host
        const wasHost = state.isHost;
        state.isHost = data.newHostSessionId === CodenamesClient.player?.sessionId;

        // Update host status in players list
        if (data.newHostSessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map((p: any) => ({
                ...p,
                isHost: p.sessionId === data.newHostSessionId
            }));
            updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
        }

        // Update UI elements that depend on host status
        updateRoomSettingsNavVisibility();
        updateRoleBanner();
        updateForfeitButton();

        if (state.isHost && !wasHost) {
            showToast('You are now the host!', 'info');
        } else if (data.newHostNickname) {
            showToast(`${data.newHostNickname} is now the host`, 'info');
        }
    });

    // Timer events (for turn timers when enabled)
    CodenamesClient.on('timerStatus', (data: any) => {
        handleTimerStatus(data);
    });

    CodenamesClient.on('timerStarted', (data: any) => {
        handleTimerStarted(data);
    });

    CodenamesClient.on('timerStopped', (data: any) => {
        handleTimerStopped();
    });

    CodenamesClient.on('timerExpired', (data: any) => {
        handleTimerStopped();
        showToast('Turn time expired!', 'warning');
    });

    // Room warnings (non-fatal issues like stale stats)
    CodenamesClient.on('roomWarning', (data: any) => {
        if (data.code === 'STATS_STALE') {
            // Auto-request resync to get fresh data
            CodenamesClient.requestResync().catch(() => {
                // Resync failed, stats may remain stale - not critical
                console.warn('Auto-resync after stale stats warning failed');
            });
        }
    });

    // Room resync (state recovery)
    CodenamesClient.on('roomResynced', (data: any) => {
        // Sync current player's state from server response
        const currentPlayer = data.you || CodenamesClient.player;
        if (currentPlayer) {
            syncLocalPlayerState(currentPlayer);
        }

        if (data.game) {
            syncGameStateFromServer(data.game);
        }
        if (data.players) {
            state.multiplayerPlayers = data.players;
            updateMpIndicator(data.room, state.multiplayerPlayers);
        }

        // Update all UI elements
        updateControls();
        updateRoleBanner();
    });

    // Disconnect handling
    CodenamesClient.on('disconnected', () => {
        clearRoleChange();
        showToast('Disconnected from server', 'warning');
        // Show reconnection overlay if we were in a room
        if (state.isMultiplayerMode) {
            showReconnectionOverlay();
        }
    });

    // Show reconnection overlay when auto-rejoin is being attempted
    CodenamesClient.on('rejoining', () => {
        showReconnectionOverlay();
    });

    CodenamesClient.on('rejoined', (data: any) => {
        // Hide reconnection overlay
        hideReconnectionOverlay();

        // Detect significant state changes during offline
        const changes = detectOfflineChanges(data);

        // Sync current player's state after auto-rejoin
        const currentPlayer = data?.you || CodenamesClient.player;
        if (currentPlayer) {
            syncLocalPlayerState(currentPlayer);
        }

        // Sync game state if available
        if (data?.game) {
            syncGameStateFromServer(data.game);
        }

        // Update player list
        if (data?.players) {
            state.multiplayerPlayers = data.players;
            updateMpIndicator(data?.room, state.multiplayerPlayers);
        }

        // Update UI elements
        updateControls();
        updateRoleBanner();
        updateForfeitButton();

        if (changes.length > 0) {
            showToast('Reconnected! ' + changes.join('. '), 'info', 6000);
        } else {
            showToast('Reconnected!', 'success');
        }
    });

    // Handle token-based reconnection
    CodenamesClient.on('roomReconnected', (data: any) => {
        // Hide reconnection overlay
        hideReconnectionOverlay();

        // Detect significant state changes during offline
        const changes = detectOfflineChanges(data);

        // Sync current player's state after token-based reconnection
        const currentPlayer = data?.you || CodenamesClient.player;
        if (currentPlayer) {
            syncLocalPlayerState(currentPlayer);
        }

        // Sync game state if available
        if (data?.game) {
            syncGameStateFromServer(data.game);
        }

        // Update player list
        if (data?.players) {
            state.multiplayerPlayers = data.players;
            updateMpIndicator(data?.room, state.multiplayerPlayers);
        }

        // Update UI elements
        updateControls();
        updateRoleBanner();
        updateForfeitButton();

        if (changes.length > 0) {
            showToast('Reconnected! ' + changes.join('. '), 'info', 6000);
        } else {
            showToast('Reconnected!', 'success');
        }
    });

    CodenamesClient.on('rejoinFailed', (data: any) => {
        // Hide reconnection overlay
        hideReconnectionOverlay();

        if (data.error?.code === 'ROOM_NOT_FOUND') {
            showToast('Previous game no longer exists', 'warning');
        } else {
            showToast('Could not rejoin previous game', 'warning');
        }
        // Reset multiplayer state properly
        leaveMultiplayerMode();
    });

    // Handle being kicked from the room
    CodenamesClient.on('kicked', (data: any) => {
        leaveMultiplayerMode();
        showToast(data.reason || 'You were kicked from the room', 'error', 5000);
    });

    // Handle another player being kicked
    CodenamesClient.on('playerKicked', (data: any) => {
        // Update player list
        state.multiplayerPlayers = state.multiplayerPlayers.filter((p: any) => p.sessionId !== data.sessionId);
        updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
        showToast(`${data.nickname} was kicked by the host`, 'info');
    });

    // Game history events
    CodenamesClient.on('historyResult', (data: any) => {
        // Import dynamically to avoid circular dependency
        import('./history.js').then(({ renderGameHistory }: any) => {
            renderGameHistory(data.games || []);
        }).catch((err: any) => {
            console.error('Failed to load history module:', err);
            showToast('Could not load game history', 'error');
        });
    });

    CodenamesClient.on('replayData', (data: any) => {
        import('./history.js').then(({ renderReplayData }: any) => {
            renderReplayData(data);
        }).catch((err: any) => {
            console.error('Failed to load history module:', err);
            showToast('Could not load replay data', 'error');
        });
    });

    // Error handling for game actions
    CodenamesClient.on('error', (error: any) => {
        // Log full error details for debugging
        console.error('Multiplayer error:', JSON.stringify(error, null, 2));

        // Revert optimistic UI then clear role change state
        revertAndClearRoleChange();

        // Clear any in-progress card reveal flags
        state.revealingCards.clear();
        state.isRevealingCard = false;
        document.querySelectorAll('.card.revealing').forEach(c => c.classList.remove('revealing'));

        // Map technical error codes to user-friendly messages
        showToast(getErrorMessage(error), 'error');
    });

    /**
     * Map server error codes to user-friendly messages
     */
    function getErrorMessage(error: any): string {
        const code = error.code || '';
        const message = error.message || '';

        // Common error code mappings
        const errorMessages: Record<string, string> = {
            'RATE_LIMITED': 'Please wait a moment before trying again',
            'NOT_YOUR_TURN': "It's not your team's turn",
            'NOT_CLICKER': 'Only the team clicker can reveal cards',
            'NOT_SPYMASTER': 'Only the spymaster can give clues',
            'GAME_NOT_STARTED': 'Wait for the host to start the game',
            'GAME_OVER': 'The game has ended - start a new game',
            'CARD_ALREADY_REVEALED': 'That card has already been revealed',
            'TEAM_WOULD_BE_EMPTY': 'Cannot leave - your team needs at least one player',
            'CANNOT_SWITCH_TEAM_DURING_TURN': 'Cannot switch teams during your active turn',
            'CANNOT_CHANGE_ROLE_DURING_TURN': 'Cannot change roles during your active turn',
            'SPYMASTER_CANNOT_CHANGE_TEAM': 'Spymasters cannot change teams during an active game',
            'MUST_JOIN_TEAM': 'Join a team first before selecting a role',
            'ROLE_TAKEN': 'That role is already taken by another player',
            'ROOM_NOT_FOUND': 'Room not found - it may have been closed',
            'PLAYER_NOT_FOUND': 'Session expired - please rejoin the room',
            'INVALID_INPUT': 'Invalid request - please try again',
            'SERVER_ERROR': 'Server error - please try again'
        };

        // Check for exact code match first
        if (errorMessages[code]) {
            return errorMessages[code];
        }

        // Check for partial matches in message
        if (message.toLowerCase().includes('rate limit')) {
            return errorMessages['RATE_LIMITED'];
        }
        if (message.toLowerCase().includes('not your turn')) {
            return errorMessages['NOT_YOUR_TURN'];
        }
        if (message.toLowerCase().includes('must join a team')) {
            return 'Join a team first before selecting a role';
        }
        if (message.toLowerCase().includes('already has a')) {
            return 'That role is already taken on your team';
        }
        if (message.toLowerCase().includes('another player is becoming')) {
            return 'Someone else is selecting that role - please wait';
        }

        // Return original message if no mapping found
        return message || 'An error occurred - please try again';
    }

    // Handle room settings updates
    CodenamesClient.on('settingsUpdated', (data: any) => {
        if (data.settings) {
            // Update room info display
            updateRoomInfoDisplay();

            // Sync game mode radio buttons
            syncGameModeUI(data.settings.gameMode);

            // Update multiplayer indicator
            updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);

            showToast('Room settings updated', 'info');
        }
    });

    // Game mode radio button change handler — track for cleanup
    const gameModeRadios = document.querySelectorAll('input[name="gameMode"]');
    gameModeRadios.forEach(radio => {
        const handler = (e: any) => {
            if (!CodenamesClient?.player?.isHost) return;
            const gameMode = e.target.value;
            CodenamesClient.updateSettings({ gameMode });
        };
        radio.addEventListener('change', handler);
        domListenerCleanup.push({ element: radio, event: 'change', handler });
    });

    // PHASE 4 FIX: Handle room stats updates (spectator count, team counts)
    CodenamesClient.on('statsUpdated', (data: any) => {
        if (data.stats) {
            updateSpectatorCount(data.stats.spectatorCount || 0);
            updateRoomStats(data.stats);
        }
    });

    // PHASE 4 FIX: Handle spectator chat messages
    CodenamesClient.on('spectatorChatMessage', (data: any) => {
        handleSpectatorChatMessage(data);
    });
}

// List of multiplayer event names for cleanup
const multiplayerEventNames: string[] = [
    'gameStarted', 'cardRevealed', 'turnEnded', 'gameOver',
    'playerJoined', 'playerLeft', 'playerDisconnected', 'playerReconnected',
    'playerUpdated', 'clueGiven', 'spymasterView',
    'timerStatus', 'timerStarted', 'timerStopped', 'timerExpired', 'roomResynced',
    'roomReconnected', 'disconnected', 'rejoining', 'rejoined', 'rejoinFailed', 'error',
    'kicked', 'playerKicked', 'settingsUpdated',
    'hostChanged', 'roomWarning',
    'historyResult', 'replayData',
    // PHASE 4 FIX: Add spectator-related events
    'statsUpdated', 'spectatorChatMessage'
];

// Track DOM listeners for cleanup to prevent memory leaks
const domListenerCleanup: Array<{element: Element; event: string; handler: EventListenerOrEventListenerObject; options?: any}> = [];

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
 * Reset all multiplayer-related state (team, role, clicker flags, game state).
 * Called on room change and disconnect to prevent stale data.
 */
function resetMultiplayerState(): void {
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.isHost = false;
    clearRoleChange();
    state.revealingCards.clear();
    state.isRevealingCard = false;
    state.multiplayerPlayers = [];
    state.gameState.currentClue = null;
    state.gameState.guessesUsed = 0;
    state.gameState.guessesAllowed = 0;
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
export function syncGameStateFromServer(serverGame: any): void {
    if (!serverGame) return;

    // Bounds validation: reject obviously corrupted server data
    const MAX_BOARD_SIZE = 100; // Generous upper bound (standard is 25)
    if (serverGame.words && Array.isArray(serverGame.words) && serverGame.words.length > MAX_BOARD_SIZE) {
        console.error(`syncGameStateFromServer: rejected oversized words array (${serverGame.words.length})`);
        return;
    }

    // Server sends arrays: words, types, revealed (not a board object)
    if (serverGame.words && Array.isArray(serverGame.words)) {
        // Check if words have changed - if so, force full board re-render
        const wordsChanged = !state.gameState.words ||
            state.gameState.words.length !== serverGame.words.length ||
            state.gameState.words.some((w: any, i: number) => w !== serverGame.words[i]);

        if (wordsChanged) {
            // Force full board re-render when words change (new game started)
            state.boardInitialized = false;
        }

        state.gameState.words = serverGame.words;
        state.gameState.types = serverGame.types || [];
        state.gameState.revealed = serverGame.revealed || [];

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

    // Server uses 'currentTurn' not 'currentTeam'
    if (serverGame.currentTurn) {
        state.gameState.currentTurn = serverGame.currentTurn;
    }

    // Sync game over state
    if (serverGame.gameOver || serverGame.winner) {
        state.gameState.gameOver = true;
        state.gameState.winner = serverGame.winner;
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
        state.gameState.currentClue = serverGame.currentClue;
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
        state.gameMode = serverGame.gameMode;
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
    const isYourTurn = state.clickerTeam && state.clickerTeam === state.gameState.currentTurn && !state.gameState.gameOver;
    setTabNotification(isYourTurn);
}

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

/**
 * Check for room code in URL and auto-open join modal
 */
export function checkURLForRoomJoin(): void {
    const roomCode = getRoomCodeFromURL();
    // PHASE 2 FIX: Use shared validation from constants.js
    const roomValidation = validateRoomCode(roomCode);
    if (roomCode && roomValidation.valid) {
        // Pre-fill nickname from storage
        const storedNickname = safeGetItem('codenames-nickname', '');
        (document.getElementById('join-nickname') as HTMLInputElement).value = storedNickname;

        // Pre-fill room ID from URL
        (document.getElementById('join-room-id') as HTMLInputElement).value = roomCode;

        // Show multiplayer modal in join mode
        setMpMode('join');
        openModal('multiplayer-modal');

        // Show message about the room code
        setMpStatus(`Room ID: ${roomCode} - Enter your nickname to join`, 'info');
    }
}

export function initMultiplayerModal(): void {
    // Mode toggle buttons
    document.querySelectorAll('.mode-btn').forEach((btn: any) => {
        btn.addEventListener('click', () => setMpMode(btn.dataset.mode));
    });

    // Action button
    document.getElementById('btn-mp-action')!.addEventListener('click', handleMpAction);

    // Enter key submits
    ['join-nickname', 'join-room-id', 'create-nickname', 'create-room-id'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('keypress', (e: any) => {
                if (e.key === 'Enter') handleMpAction();
            });
        }
    });

    // Copy Room ID button
    const copyBtn = document.getElementById('btn-copy-room-id');
    if (copyBtn) {
        copyBtn.addEventListener('click', copyRoomId);
    }

    // Check for room code in URL after modal is initialized
    setTimeout(checkURLForRoomJoin, 100);
}

// Show/hide room settings nav item based on multiplayer host status
export function updateRoomSettingsNavVisibility(): void {
    const navItem = document.getElementById('nav-room-settings');
    if (navItem) {
        const isHost = CodenamesClient?.player?.isHost;
        navItem.style.display = (state.isMultiplayerMode && isHost) ? 'flex' : 'none';
    }
}

// Update room info display in settings panel
export function updateRoomInfoDisplay(): void {
    const codeEl = document.getElementById('room-info-code');
    const playersEl = document.getElementById('room-info-players');
    const statusEl = document.getElementById('room-info-status');

    if (codeEl) codeEl.textContent = state.currentRoomId || CodenamesClient?.getRoomCode() || '----';
    if (playersEl) playersEl.textContent = String(state.multiplayerPlayers?.length || 0);
    if (statusEl) statusEl.textContent = state.gameState.status === 'ended' ? 'Game Over' : (state.gameState.status === 'playing' ? 'In Progress' : 'Waiting');
}

// Sync game mode UI with server state
export function syncGameModeUI(gameMode: string): void {
    if (!gameMode) return;
    const radio = document.querySelector(`input[name="gameMode"][value="${gameMode}"]`) as HTMLInputElement;
    if (radio) radio.checked = true;
}

// Update Duet mode UI elements
export function updateDuetUI(gameData: any): void {
    const isDuet = state.gameMode === 'duet';
    const mainContent = document.querySelector('.main-content');
    const duetBar = document.getElementById('duet-info-bar');

    if (isDuet) {
        if (mainContent) mainContent.classList.add('duet-mode');
        if (duetBar) {
            duetBar.style.display = 'flex';
            updateDuetInfoBar(gameData?.greenFound || 0, gameData?.timerTokens);
        }
        // Update green total display
        const totalEl = document.getElementById('duet-green-total');
        if (totalEl && gameData?.greenTotal) totalEl.textContent = gameData.greenTotal;
    } else {
        if (mainContent) mainContent.classList.remove('duet-mode');
        if (duetBar) duetBar.style.display = 'none';
    }
}

// Update Duet info bar with current progress
export function updateDuetInfoBar(greenFound: number, timerTokens: number): void {
    const foundEl = document.getElementById('duet-green-found');
    const tokensEl = document.getElementById('duet-timer-tokens');
    if (foundEl && greenFound !== undefined) foundEl.textContent = String(greenFound);
    if (tokensEl && timerTokens !== undefined) tokensEl.textContent = String(timerTokens);
}

// PHASE 4: Update spectator count display
export function updateSpectatorCount(count: number): void {
    // Update inline spectator count in multiplayer indicator
    const mpSpectatorCount = document.getElementById('mp-spectator-count');
    const mpSpectatorInline = document.getElementById('mp-spectator-inline');

    if (mpSpectatorCount) {
        mpSpectatorCount.textContent = String(count);
    }
    if (mpSpectatorInline) {
        mpSpectatorInline.style.display = count > 0 ? 'flex' : 'none';
    }

    // Legacy standalone element (kept for backwards compat)
    const spectatorCountEl = document.getElementById('spectator-count');
    const spectatorSection = document.getElementById('spectator-section');

    if (spectatorCountEl) {
        spectatorCountEl.textContent = String(count);
    }
    if (spectatorSection) {
        spectatorSection.style.display = count > 0 ? 'flex' : 'none';
    }

    // Store in state for other components
    state.spectatorCount = count;
}

// PHASE 4: Update room stats (team counts, spectator count, etc.)
export function updateRoomStats(stats: any): void {
    if (!stats) return;

    // Update spectator count
    if (typeof stats.spectatorCount === 'number') {
        updateSpectatorCount(stats.spectatorCount);
    }

    // Update team stats if displayed
    const redCountEl = document.getElementById('team-red-count');
    const blueCountEl = document.getElementById('team-blue-count');

    if (redCountEl && stats.teams?.red) {
        redCountEl.textContent = stats.teams.red.total || 0;
    }
    if (blueCountEl && stats.teams?.blue) {
        blueCountEl.textContent = stats.teams.blue.total || 0;
    }

    // Store full stats in state
    state.roomStats = stats;
}

// PHASE 4: Handle spectator chat messages
function handleSpectatorChatMessage(data: any): void {
    // Validate message data before rendering into DOM
    if (!data || typeof data.message !== 'string') return;

    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message spectator-message';

    const senderEl = document.createElement('span');
    senderEl.className = 'chat-sender spectator';
    senderEl.textContent = data.sender?.nickname || 'Spectator';

    const contentEl = document.createElement('span');
    contentEl.className = 'chat-content';
    contentEl.textContent = data.message;

    const badgeEl = document.createElement('span');
    badgeEl.className = 'chat-badge spectator-badge';
    badgeEl.textContent = '\uD83D\uDC41';
    badgeEl.title = 'Spectator message';

    messageEl.appendChild(badgeEl);
    messageEl.appendChild(senderEl);
    messageEl.appendChild(document.createTextNode(': '));
    messageEl.appendChild(contentEl);

    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// PHASE 4: Send a spectator chat message
export function sendSpectatorChat(message: string): void {
    if (!message?.trim()) return;
    if (!CodenamesClient?.isConnected()) return;

    // Only spectators can send spectator messages
    const player = CodenamesClient.player;
    if (player?.role !== 'spectator' && player?.team) {
        showToast('Only spectators can use spectator chat', 'error');
        return;
    }

    CodenamesClient.sendSpectatorChat(message.trim());
}

// ========== FORFEIT GAME ==========

/**
 * Show forfeit confirmation modal (host only, during active game)
 */
export function confirmForfeit(): void {
    if (!state.isMultiplayerMode || !CodenamesClient?.isConnected()) {
        showToast('Forfeit is only available in multiplayer mode', 'warning');
        return;
    }
    if (!CodenamesClient.player?.isHost) {
        showToast('Only the host can forfeit the game', 'warning');
        return;
    }
    if (state.gameState.gameOver) {
        showToast('The game is already over', 'info');
        return;
    }
    openModal('confirm-forfeit-modal');
}

/**
 * Close the forfeit confirmation modal
 */
export function closeForfeitConfirm(): void {
    closeModal('confirm-forfeit-modal');
}

/**
 * Close the kick confirmation modal
 */
export function closeKickConfirm(): void {
    closeModal('confirm-kick-modal');
    pendingKickSessionId = null;
}

/**
 * Execute the pending kick action
 */
export function confirmKickPlayer(): void {
    if (pendingKickSessionId && state.isMultiplayerMode && CodenamesClient?.isConnected()) {
        CodenamesClient.kickPlayer(pendingKickSessionId);
    }
    closeKickConfirm();
}

/**
 * Execute the forfeit action
 */
export function forfeitGame(): void {
    if (!state.isMultiplayerMode || !CodenamesClient?.isConnected()) return;
    if (!CodenamesClient.player?.isHost) return;
    if (state.gameState.gameOver) return;

    CodenamesClient.forfeit();
}

/**
 * Update forfeit button visibility based on game state
 * Shows only for host during an active multiplayer game
 */
export function updateForfeitButton(): void {
    const forfeitBtn = document.getElementById('btn-forfeit');
    if (!forfeitBtn) return;

    const shouldShow = state.isMultiplayerMode
        && CodenamesClient?.player?.isHost
        && !state.gameState.gameOver;

    forfeitBtn.style.display = shouldShow ? 'inline-block' : 'none';
}

// ========== NICKNAME EDIT ==========

/**
 * Initialize nickname edit UI event handlers
 */
export function initNicknameEditUI(): void {
    const editBtn = document.getElementById('btn-edit-nickname');
    const saveBtn = document.getElementById('btn-nickname-save');
    const cancelBtn = document.getElementById('btn-nickname-cancel');
    const input = document.getElementById('nickname-edit-input') as HTMLInputElement;

    if (editBtn) {
        editBtn.addEventListener('click', () => {
            const form = document.getElementById('nickname-edit-form');
            if (form) {
                form.style.display = 'flex';
                editBtn.style.display = 'none';
                // Pre-fill with current nickname
                if (input && CodenamesClient?.player?.nickname) {
                    input.value = CodenamesClient.player.nickname;
                    input.focus();
                    input.select();
                }
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveNickname());
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => cancelNicknameEdit());
    }

    if (input) {
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveNickname();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelNicknameEdit();
            }
        });
    }
}

function saveNickname(): void {
    const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
    const nickname = input?.value?.trim();

    if (!nickname || nickname.length < VALIDATION.NICKNAME_MIN_LENGTH || nickname.length > VALIDATION.NICKNAME_MAX_LENGTH) {
        showToast(`Nickname must be ${VALIDATION.NICKNAME_MIN_LENGTH}-${VALIDATION.NICKNAME_MAX_LENGTH} characters`, 'warning');
        return;
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(nickname)) {
        showToast('Only letters, numbers, spaces, hyphens and underscores allowed', 'warning');
        return;
    }

    if (CodenamesClient?.isConnected()) {
        CodenamesClient.setNickname(nickname);
        // Update stored nickname
        try { localStorage.setItem('codenames-nickname', nickname); } catch { /* ignore */ }
        showToast('Nickname updated!', 'success', 2000);
    }

    cancelNicknameEdit();
}

function cancelNicknameEdit(): void {
    const form = document.getElementById('nickname-edit-form');
    const editBtn = document.getElementById('btn-edit-nickname');
    if (form) form.style.display = 'none';
    if (editBtn) editBtn.style.display = '';
}

// ========== OFFLINE CHANGE DETECTION ==========

/**
 * Detect significant state changes that occurred while the player was offline.
 * Compares server state with local state before syncing.
 * @param data - Reconnection data from server
 * @returns Array of change summary strings
 */
function detectOfflineChanges(data: any): string[] {
    const changes: string[] = [];

    if (!data) return changes;

    const serverGame = data.game;
    const localGame = state.gameState;

    // Game started while offline
    if (serverGame && serverGame.words?.length > 0 && (!localGame.words || localGame.words.length === 0)) {
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

    // Clue given while offline
    if (serverGame && serverGame.currentClue && !localGame.currentClue) {
        changes.push(`Clue: ${serverGame.currentClue.word} (${serverGame.currentClue.number})`);
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

// ========== RECONNECTION FEEDBACK ==========

// Reconnection overlay timeout ID for cleanup
let reconnectionTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Show the reconnection overlay banner with a timeout fallback.
 * If reconnection doesn't succeed or explicitly fail within 15 seconds,
 * the overlay is hidden and a failure toast is shown.
 */
export function showReconnectionOverlay(): void {
    const overlay = document.getElementById('reconnection-overlay');
    if (overlay) {
        overlay.style.display = 'block';
    }

    // Clear any existing timeout
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
    }

    // Set a fallback timeout to prevent permanently stuck overlay
    reconnectionTimeoutId = setTimeout(() => {
        reconnectionTimeoutId = null;
        const overlayCheck = document.getElementById('reconnection-overlay');
        if (overlayCheck && overlayCheck.style.display !== 'none') {
            hideReconnectionOverlay();
            showToast('Reconnection failed \u2014 please refresh the page', 'error', 8000);
        }
    }, UI.RECONNECTION_TIMEOUT_MS);
}

/**
 * Hide the reconnection overlay banner and clear the timeout fallback
 */
export function hideReconnectionOverlay(): void {
    const overlay = document.getElementById('reconnection-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    // Clear the fallback timeout since reconnection resolved
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
        reconnectionTimeoutId = null;
    }
}
