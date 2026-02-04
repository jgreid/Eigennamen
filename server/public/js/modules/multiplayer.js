// ========== MULTIPLAYER MODULE ==========
// All multiplayer functionality

import { state } from './state.js';
import { escapeHTML, safeGetItem, safeSetItem } from './utils.js';
import { showToast, openModal, closeModal, announceToScreenReader } from './ui.js';
import { renderBoard } from './board.js';
import { revealCardFromServer, showGameOver, updateScoreboard, updateTurnIndicator } from './game.js';
import { updateRoleBanner, updateControls } from './roles.js';
import { handleTimerStarted, handleTimerStopped, handleTimerStatus } from './timer.js';
import { playNotificationSound, setTabNotification, checkAndNotifyTurn } from './notifications.js';

export function openMultiplayer() {
    // Pre-fill nickname from storage
    const storedNickname = safeGetItem('codenames-nickname', '');
    document.getElementById('join-nickname').value = storedNickname;
    document.getElementById('create-nickname').value = storedNickname;

    // Reset forms
    document.getElementById('join-room-id').value = '';
    document.getElementById('create-room-id').value = '';
    setMpStatus('', '');
    clearFormErrors();

    // Reset to join mode
    setMpMode('join');

    openModal('multiplayer-modal');
}

export function closeMultiplayer() {
    clearFormErrors();
    closeModal('multiplayer-modal');
}

export function setMpMode(mode) {
    state.currentMpMode = mode;

    // Update mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Show correct form
    document.getElementById('join-form').classList.toggle('active', mode === 'join');
    document.getElementById('create-form').classList.toggle('active', mode === 'create');

    // Update action button text
    const actionBtn = document.getElementById('btn-mp-action');
    actionBtn.textContent = mode === 'join' ? 'Join Game' : 'Create Game';
}

export function setMpStatus(message, type) {
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
export function setFieldError(message, fieldId) {
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
export function clearFormErrors() {
    ['join-error', 'join-nickname-error', 'create-error', 'create-nickname-error'].forEach(id => {
        setFieldError('', id);
    });
}

// Legacy function for backward compatibility
function setMpError(message) {
    setFieldError(message, state.currentMpMode === 'join' ? 'join-error' : 'create-error');
}

export async function handleMpAction() {
    const actionBtn = document.getElementById('btn-mp-action');
    actionBtn.disabled = true;

    try {
        if (state.currentMpMode === 'join') {
            await handleJoinGame();
        } else {
            await handleCreateGame();
        }
    } catch (error) {
        console.error('Multiplayer action failed:', error);
        setMpStatus(error.message || 'Connection failed', 'error');
    } finally {
        actionBtn.disabled = false;
    }
}

async function handleJoinGame() {
    clearFormErrors();

    const nickname = document.getElementById('join-nickname').value.trim();
    const roomIdInput = document.getElementById('join-room-id').value.trim();
    const urlRoomCode = getRoomCodeFromURL();
    const joinBtn = document.getElementById('btn-mp-action');

    // Nickname validation (matches server VALIDATION.NICKNAME_MAX_LENGTH = 30)
    if (!nickname) {
        setFieldError('Please enter your nickname', 'join-nickname-error');
        return;
    }
    if (nickname.length > 30) {
        setFieldError('Nickname must be 30 characters or less', 'join-nickname-error');
        return;
    }
    if (!/^[\p{L}\p{N}\s\-_]+$/u.test(nickname)) {
        setFieldError('Nickname can only contain letters, numbers, spaces, hyphens, and underscores', 'join-nickname-error');
        return;
    }

    // Use user input if provided, otherwise fall back to URL room code
    const roomId = roomIdInput || urlRoomCode;

    if (!roomId) {
        setFieldError('Please enter a Room ID', 'join-error');
        return;
    }

    // Validate room ID format (3-20 chars, alphanumeric + hyphens + underscores)
    if (roomId.length < 3) {
        setFieldError('Room ID must be at least 3 characters', 'join-error');
        return;
    }
    if (roomId.length > 20) {
        setFieldError('Room ID must be 20 characters or less', 'join-error');
        return;
    }
    if (!/^[a-zA-Z0-9\-_]+$/.test(roomId)) {
        setFieldError('Room ID can only contain letters, numbers, hyphens, and underscores', 'join-error');
        return;
    }

    // Disable button to prevent double-click race condition
    if (joinBtn) joinBtn.disabled = true;

    try {
        setMpStatus('Connecting...', 'connecting');

        // Connect to server
        if (!CodenamesClient.isConnected()) {
            await CodenamesClient.connect();
        }

        setMpStatus('Joining game...', 'connecting');
        // Join the room with roomId (no password needed)
        const result = await CodenamesClient.joinRoom(roomId, nickname);

        // Store the actual room code from server (normalized to lowercase)
        state.currentRoomId = result.room?.code || roomId;

        onMultiplayerJoined(result, false); // false = not host

    } catch (error) {
        console.error('Join failed:', error);
        if (error.code === 'ROOM_NOT_FOUND') {
            setMpStatus('Room not found - check the Room ID', 'error');
        } else if (error.code === 'ROOM_FULL') {
            setMpStatus('Room is full', 'error');
        } else if (error.code === 'INVALID_INPUT') {
            setMpStatus('Invalid Room ID format', 'error');
        } else if (error.message?.includes('connect')) {
            setMpStatus('Could not connect to server', 'error');
        } else {
            setMpStatus(error.message || 'Failed to join game', 'error');
        }
    } finally {
        // Re-enable button
        if (joinBtn) joinBtn.disabled = false;
    }
}

async function handleCreateGame() {
    clearFormErrors();

    const nickname = document.getElementById('create-nickname').value.trim();
    const roomId = document.getElementById('create-room-id').value.trim();
    const createBtn = document.getElementById('btn-mp-action');

    // Nickname validation (matches server VALIDATION.NICKNAME_MAX_LENGTH = 30)
    if (!nickname) {
        setFieldError('Please enter your nickname', 'create-nickname-error');
        return;
    }
    if (nickname.length > 30) {
        setFieldError('Nickname must be 30 characters or less', 'create-nickname-error');
        return;
    }
    if (!/^[\p{L}\p{N}\s\-_]+$/u.test(nickname)) {
        setFieldError('Nickname can only contain letters, numbers, spaces, hyphens, and underscores', 'create-nickname-error');
        return;
    }

    // Room ID validation
    if (!roomId) {
        setFieldError('Please enter a Room ID', 'create-error');
        return;
    }
    if (roomId.length < 3) {
        setFieldError('Room ID must be at least 3 characters', 'create-error');
        return;
    }
    if (roomId.length > 20) {
        setFieldError('Room ID must be 20 characters or less', 'create-error');
        return;
    }
    if (!/^[a-zA-Z0-9\-_]+$/.test(roomId)) {
        setFieldError('Room ID can only contain letters, numbers, hyphens, and underscores', 'create-error');
        return;
    }

    // Disable button to prevent double-click race condition
    if (createBtn) createBtn.disabled = true;

    try {
        setMpStatus('Creating game...', 'connecting');

        // Connect to server
        if (!CodenamesClient.isConnected()) {
            await CodenamesClient.connect();
        }

        // Create room with roomId
        const result = await CodenamesClient.createRoom({
            roomId: roomId,
            nickname: nickname
        });

        // Store the actual room code from server (normalized to lowercase)
        state.currentRoomId = result.room?.code || roomId.toLowerCase();

        onMultiplayerJoined(result, true); // true = isHost

    } catch (error) {
        console.error('Create failed:', error);
        if (error.code === 'ROOM_ALREADY_EXISTS') {
            setMpStatus('A room with this ID already exists. Try a different Room ID.', 'error');
        } else if (error.message?.includes('connect')) {
            setMpStatus('Could not connect to server', 'error');
        } else {
            setMpStatus(error.message || 'Failed to create game', 'error');
        }
    } finally {
        // Re-enable button
        if (createBtn) createBtn.disabled = false;
    }
}

export function onMultiplayerJoined(result, isHostParam = false) {
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

    // Close modal after brief delay and show appropriate message
    setTimeout(() => {
        closeMultiplayer();
        if (state.isHost && state.currentRoomId) {
            showToast(`Game created! Share Room ID: ${state.currentRoomId}`, 'success', 8000);
        } else {
            showToast('Connected to multiplayer game!', 'success');
        }
    }, 500);
}

/**
 * Sync local player state variables from server player data
 */
export function syncLocalPlayerState(player) {
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

export function updateMpIndicator(room, players) {
    const indicator = document.getElementById('mp-indicator');
    const codeEl = document.getElementById('mp-room-code');
    const countEl = document.getElementById('mp-player-count');
    const roomIdDisplay = document.getElementById('mp-room-id-display');
    const roomIdText = document.getElementById('mp-room-id-text');
    const playerListEl = document.getElementById('mp-player-list');
    const playersUl = document.getElementById('mp-players-ul');
    const historyBtnRow = document.getElementById('history-btn-row');

    if (room) {
        codeEl.textContent = room.code;
        countEl.textContent = `${players?.length || 1} player${players?.length !== 1 ? 's' : ''}`;
        indicator.classList.add('active');

        // Show game history button in multiplayer mode
        if (historyBtnRow) {
            historyBtnRow.style.display = 'flex';
        }

        // Show Room ID if we're the host
        if (state.currentRoomId && CodenamesClient.player?.isHost) {
            roomIdText.textContent = state.currentRoomId;
            roomIdDisplay.style.display = 'flex';
        } else {
            roomIdDisplay.style.display = 'none';
        }

        // Update player list
        if (playersUl && players) {
            updatePlayerList(playersUl, players);
        }

        // Update share panel for multiplayer mode
        updateSharePanelMode(true, room.code);
    } else {
        indicator.classList.remove('active');
        roomIdDisplay.style.display = 'none';
        if (playerListEl) playerListEl.style.display = 'none';
        // Hide game history button when not in multiplayer mode
        if (historyBtnRow) {
            historyBtnRow.style.display = 'none';
        }

        // Update share panel for standalone mode
        updateSharePanelMode(false);
    }
}

// Toggle share panel between multiplayer (room code) and standalone (URL/QR) modes
export function updateSharePanelMode(isMultiplayer, roomCode = null) {
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
export function copyRoomCode() {
    const roomCode = document.getElementById('share-room-code')?.textContent;
    const feedback = document.getElementById('room-code-copy-feedback');

    if (!roomCode || roomCode === '----') return;

    navigator.clipboard.writeText(roomCode).then(() => {
        if (feedback) {
            feedback.textContent = 'Room code copied!';
            setTimeout(() => { feedback.textContent = ''; }, 2000);
        }
        showToast('Room code copied to clipboard');
    }).catch(() => {
        // Fallback for older browsers
        const tempInput = document.createElement('input');
        tempInput.value = roomCode;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        if (feedback) {
            feedback.textContent = 'Room code copied!';
            setTimeout(() => { feedback.textContent = ''; }, 2000);
        }
        showToast('Room code copied to clipboard');
    });
}

export function copyRoomId() {
    if (state.currentRoomId) {
        navigator.clipboard.writeText(state.currentRoomId).then(() => {
            showToast('Room ID copied!', 'success', 2000);
        }).catch(() => {
            showToast('Failed to copy', 'error', 2000);
        });
    }
}

export function updatePlayerList(ul, players) {
    const mySessionId = CodenamesClient.player?.sessionId;
    const amHost = CodenamesClient.player?.isHost;

    ul.innerHTML = players.map(p => {
        const isMe = p.sessionId === mySessionId;
        const teamClass = p.team ? `player-team-${p.team}` : '';
        const disconnectedClass = p.connected === false ? 'player-disconnected' : '';
        const roleText = p.role ? `(${p.role})` : '';
        const hostBadge = p.isHost ? '<span class="host-badge">Host</span>' : '';
        const kickBtn = amHost && !isMe ?
            `<button class="btn-kick" data-session="${p.sessionId}" title="Kick player">Kick</button>` : '';

        return `<li class="${disconnectedClass}">
            <span class="player-info">
                <span class="player-name ${isMe ? 'you' : ''} ${teamClass}">${escapeHTML(p.nickname)}${isMe ? ' (you)' : ''}</span>
                ${hostBadge}
                <span class="player-role">${roleText}${p.connected === false ? ' - offline' : ''}</span>
            </span>
            ${kickBtn}
        </li>`;
    }).join('');
}

export function initPlayerListUI() {
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

    // Event delegation for kick buttons
    if (playersUl) {
        playersUl.addEventListener('click', (e) => {
            const kickBtn = e.target.closest('.btn-kick');
            if (kickBtn) {
                const sessionId = kickBtn.dataset.session;
                if (sessionId && confirm('Are you sure you want to kick this player?')) {
                    CodenamesClient.kickPlayer(sessionId);
                }
            }
        });
    }
}

export function setupMultiplayerListeners() {
    // Game state updates
    CodenamesClient.on('gameStarted', (data) => {
        // Full sync game state from server for new games
        if (data.game) {
            syncGameStateFromServer(data.game);
            showToast('New game started!', 'success');
        }
    });

    CodenamesClient.on('cardRevealed', (data) => {
        // Clear reveal-in-progress flag
        state.isRevealingCard = false;

        // Remove pending visual state from all cards
        document.querySelectorAll('.card.revealing').forEach(c => c.classList.remove('revealing'));

        if (data.index !== undefined) {
            revealCardFromServer(data.index, data);
            playNotificationSound('reveal');
        }
    });

    CodenamesClient.on('turnEnded', (data) => {
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

    CodenamesClient.on('gameOver', (data) => {
        if (data.winner) {
            showGameOver(data.winner, data.reason);
            // Clear tab notification on game over
            setTabNotification(false);
            // Play game over sound
            playNotificationSound('gameOver');
        }
    });

    // Handle clue given by spymaster
    CodenamesClient.on('clueGiven', (data) => {
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
    CodenamesClient.on('spymasterView', (data) => {
        if (data.types && Array.isArray(data.types)) {
            state.gameState.types = data.types;
            renderBoard();
        }
    });

    // Player updates
    CodenamesClient.on('playerJoined', (data) => {
        if (data.players) {
            state.multiplayerPlayers = data.players;
        } else if (data.player) {
            // Add new player to list if not already present
            const exists = state.multiplayerPlayers.some(p => p.sessionId === data.player.sessionId);
            if (!exists) {
                state.multiplayerPlayers = [...state.multiplayerPlayers, data.player];
            }
        }
        updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
        showToast(`${data.player?.nickname || 'Someone'} joined`, 'success');
        playNotificationSound('join');
    });

    CodenamesClient.on('playerLeft', (data) => {
        if (data.players) {
            state.multiplayerPlayers = data.players;
        } else if (data.sessionId) {
            // Remove player from list
            state.multiplayerPlayers = state.multiplayerPlayers.filter(p => p.sessionId !== data.sessionId);
        }
        updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
        if (data.nickname) {
            showToast(`${data.nickname} left`, 'info');
        }
    });

    // Handle player state updates (role, team, nickname changes)
    CodenamesClient.on('playerUpdated', (data) => {
        if (data.sessionId && data.changes) {
            // Update player in local list
            state.multiplayerPlayers = state.multiplayerPlayers.map(p =>
                p.sessionId === data.sessionId ? { ...p, ...data.changes } : p
            );
            updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);

            // If this is the current player, update local state variables
            if (data.sessionId === CodenamesClient.player?.sessionId) {
                let updatedPlayer = state.multiplayerPlayers.find(p => p.sessionId === data.sessionId);

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
                    console.log('playerUpdated: synced local state, changes:', data.changes, 'pendingRoleChange:', state.pendingRoleChange, 'isChangingRole:', state.isChangingRole);

                    // Check for pending role change after team change completed
                    if (state.pendingRoleChange && data.changes.team) {
                        // Team change completed, now send the queued role change
                        const roleToSet = state.pendingRoleChange;
                        state.pendingRoleChange = null;
                        console.log('playerUpdated: sending pending role change:', roleToSet);

                        // Bug #13 fix: Update revert function to only revert the role part
                        // Team change succeeded, so if role change fails, we should only
                        // revert the role (to spectator), not the team
                        const confirmedTeam = updatedPlayer.team;
                        state.roleChangeRevertFn = () => {
                            // Keep the confirmed team, just revert role to spectator
                            state.playerTeam = confirmedTeam;
                            state.spymasterTeam = null;
                            state.clickerTeam = null;
                            updateRoleBanner();
                            updateControls();
                            renderBoard();
                        };

                        // Don't clear isChangingRole yet - let it clear after role is set
                        CodenamesClient.setRole(roleToSet);
                    } else {
                        // Role change completed or no pending change - clear the flag
                        console.log('playerUpdated: clearing isChangingRole flag');
                        state.isChangingRole = false;
                        state.changingTarget = null;
                        // Bug #1 fix: Clear operation tracking on successful update
                        state.roleChangeOperationId = null;
                        state.roleChangeRevertFn = null;
                    }

                    updateControls();
                    updateRoleBanner();
                    renderBoard();
                } else {
                    // Even if player not found, clear the flag to prevent blocking
                    // This should not normally happen, but handles edge cases
                    console.warn('playerUpdated: current player not found in list, clearing isChangingRole');
                    state.isChangingRole = false;
                    state.changingTarget = null;
                    // Bug #2 fix: Always clear all role change state on edge cases
                    state.pendingRoleChange = null;
                    state.roleChangeOperationId = null;
                    state.roleChangeRevertFn = null;
                }
            }
        }
    });

    // Handle player disconnection (network issues)
    CodenamesClient.on('playerDisconnected', (data) => {
        // Mark player as disconnected in local list
        if (data.sessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map(p =>
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
    CodenamesClient.on('playerReconnected', (data) => {
        // Mark player as connected in local list
        if (data.sessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map(p =>
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
    CodenamesClient.on('hostChanged', (data) => {
        // Update global isHost based on whether we became the new host
        const wasHost = state.isHost;
        state.isHost = data.newHostSessionId === CodenamesClient.player?.sessionId;

        // Update host status in players list
        if (data.newHostSessionId) {
            state.multiplayerPlayers = state.multiplayerPlayers.map(p => ({
                ...p,
                isHost: p.sessionId === data.newHostSessionId
            }));
            updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
        }

        // Update UI elements that depend on host status
        updateRoomSettingsNavVisibility();
        updateRoleBanner();

        if (state.isHost && !wasHost) {
            showToast('You are now the host!', 'info');
        } else if (data.newHostNickname) {
            showToast(`${data.newHostNickname} is now the host`, 'info');
        }
    });

    // Timer events (for turn timers when enabled)
    CodenamesClient.on('timerStatus', (data) => {
        handleTimerStatus(data);
    });

    CodenamesClient.on('timerStarted', (data) => {
        handleTimerStarted(data);
    });

    CodenamesClient.on('timerStopped', (data) => {
        handleTimerStopped();
    });

    CodenamesClient.on('timerExpired', (data) => {
        handleTimerStopped();
        showToast('Turn time expired!', 'warning');
    });

    // Room resync (state recovery)
    CodenamesClient.on('roomResynced', (data) => {
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
        // Bug #7 fix: Reset all role change state on disconnect
        state.isChangingRole = false;
        state.changingTarget = null;
        state.pendingRoleChange = null;
        state.roleChangeOperationId = null;
        state.roleChangeRevertFn = null;
        showToast('Disconnected from server', 'warning');
    });

    CodenamesClient.on('rejoined', (data) => {
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

        showToast('Reconnected!', 'success');
    });

    // Handle token-based reconnection
    CodenamesClient.on('roomReconnected', (data) => {
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

        showToast('Reconnected!', 'success');
    });

    CodenamesClient.on('rejoinFailed', (data) => {
        if (data.error?.code === 'ROOM_NOT_FOUND') {
            showToast('Previous game no longer exists', 'warning');
        } else {
            showToast('Could not rejoin previous game', 'warning');
        }
        // Reset multiplayer state properly
        leaveMultiplayerMode();
    });

    // Handle being kicked from the room
    CodenamesClient.on('kicked', (data) => {
        leaveMultiplayerMode();
        showToast(data.reason || 'You were kicked from the room', 'error', 5000);
    });

    // Handle another player being kicked
    CodenamesClient.on('playerKicked', (data) => {
        // Update player list
        state.multiplayerPlayers = state.multiplayerPlayers.filter(p => p.sessionId !== data.sessionId);
        updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);
        showToast(`${data.nickname} was kicked by the host`, 'info');
    });

    // Game history events
    CodenamesClient.on('historyResult', (data) => {
        // Import dynamically to avoid circular dependency
        import('./history.js').then(({ renderGameHistory }) => {
            renderGameHistory(data.games || []);
        });
    });

    CodenamesClient.on('replayData', (data) => {
        import('./history.js').then(({ renderReplayData }) => {
            renderReplayData(data);
        });
    });

    // Error handling for game actions
    CodenamesClient.on('error', (error) => {
        // Log full error details for debugging
        console.error('Multiplayer error:', JSON.stringify(error, null, 2));

        // Bug #12 fix: Call revert function BEFORE clearing state to undo optimistic updates
        if (state.roleChangeRevertFn) {
            console.log('Multiplayer error: reverting optimistic UI update');
            state.roleChangeRevertFn();
        }

        // Clear any in-progress flags
        state.isRevealingCard = false;
        state.isChangingRole = false;
        state.changingTarget = null;
        // Bug #2 fix: Clear all role change state on error
        state.pendingRoleChange = null;
        state.roleChangeOperationId = null;
        state.roleChangeRevertFn = null;
        document.querySelectorAll('.card.revealing').forEach(c => c.classList.remove('revealing'));

        // Map technical error codes to user-friendly messages
        const userFriendlyMessage = getErrorMessage(error);

        if (error.type === 'game') {
            showToast(userFriendlyMessage, 'error');
        } else if (error.type === 'player') {
            showToast(userFriendlyMessage, 'error');
        } else if (error.type === 'room') {
            showToast(userFriendlyMessage, 'error');
        } else {
            // Generic error
            showToast(userFriendlyMessage, 'error');
        }
    });

    /**
     * Map server error codes to user-friendly messages
     */
    function getErrorMessage(error) {
        const code = error.code || '';
        const message = error.message || '';

        // Common error code mappings
        const errorMessages = {
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
    CodenamesClient.on('settingsUpdated', (data) => {
        if (data.settings) {
            // Update room info display
            updateRoomInfoDisplay();

            // Update multiplayer indicator
            updateMpIndicator({ code: CodenamesClient.getRoomCode() }, state.multiplayerPlayers);

            showToast('Room settings updated', 'info');
        }
    });
}

// List of multiplayer event names for cleanup
const multiplayerEventNames = [
    'gameStarted', 'cardRevealed', 'turnEnded', 'gameOver',
    'playerJoined', 'playerLeft', 'playerDisconnected', 'playerReconnected',
    'playerUpdated', 'clueGiven', 'spymasterView',
    'timerStatus', 'timerStarted', 'timerStopped', 'timerExpired', 'roomResynced',
    'roomReconnected', 'disconnected', 'rejoined', 'rejoinFailed', 'error',
    'kicked', 'playerKicked', 'settingsUpdated',
    'historyResult', 'replayData'
];

export function cleanupMultiplayerListeners() {
    // Remove all multiplayer event listeners
    multiplayerEventNames.forEach(eventName => {
        if (CodenamesClient && typeof CodenamesClient.off === 'function') {
            CodenamesClient.off(eventName);
        }
    });
    state.multiplayerListenersSetup = false;
}

export function leaveMultiplayerMode() {
    // Clean up listeners
    cleanupMultiplayerListeners();

    // Stop timer display
    handleTimerStopped();

    // Reset tab notification
    setTabNotification(false);

    // Leave room and disconnect
    if (CodenamesClient && CodenamesClient.isConnected()) {
        CodenamesClient.leaveRoom();
    }

    // Reset state
    state.isMultiplayerMode = false;
    state.multiplayerPlayers = [];
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
export function syncGameStateFromServer(serverGame) {
    if (!serverGame) return;

    // Server sends arrays: words, types, revealed (not a board object)
    if (serverGame.words && Array.isArray(serverGame.words)) {
        // Check if words have changed - if so, force full board re-render
        const wordsChanged = !state.gameState.words ||
            state.gameState.words.length !== serverGame.words.length ||
            state.gameState.words.some((w, i) => w !== serverGame.words[i]);

        if (wordsChanged) {
            // Force full board re-render when words change (new game started)
            state.boardInitialized = false;
        }

        state.gameState.words = serverGame.words;
        state.gameState.types = serverGame.types || [];
        state.gameState.revealed = serverGame.revealed || [];

        // Use server-provided scores if available
        if (typeof serverGame.redScore === 'number') {
            state.gameState.redScore = serverGame.redScore;
        }
        if (typeof serverGame.blueScore === 'number') {
            state.gameState.blueScore = serverGame.blueScore;
        }
        if (typeof serverGame.redTotal === 'number') {
            state.gameState.redTotal = serverGame.redTotal;
        }
        if (typeof serverGame.blueTotal === 'number') {
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

    // Update all UI components
    renderBoard();
    updateScoreboard();
    updateTurnIndicator();
    updateControls();

    // Update tab notification based on current turn
    const isYourTurn = state.clickerTeam && state.clickerTeam === state.gameState.currentTurn && !state.gameState.gameOver;
    setTabNotification(isYourTurn);
}

/**
 * Parse room code from URL query parameters
 */
export function getRoomCodeFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || params.get('join') || null;
}

/**
 * Update URL with room code after joining (for shareable links)
 */
export function updateURLWithRoomCode(roomCode) {
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
export function clearRoomCodeFromURL() {
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    url.searchParams.delete('join');
    window.history.replaceState({}, '', url.toString());
}

/**
 * Check for room code in URL and auto-open join modal
 */
export function checkURLForRoomJoin() {
    const roomCode = getRoomCodeFromURL();
    // Room IDs are 3-20 characters, alphanumeric with hyphens and underscores
    if (roomCode && roomCode.length >= 3 && roomCode.length <= 20 && /^[a-zA-Z0-9\-_]+$/.test(roomCode)) {
        // Pre-fill nickname from storage
        const storedNickname = safeGetItem('codenames-nickname', '');
        document.getElementById('join-nickname').value = storedNickname;

        // Pre-fill room ID from URL
        document.getElementById('join-room-id').value = roomCode;

        // Show multiplayer modal in join mode
        setMpMode('join');
        openModal('multiplayer-modal');

        // Show message about the room code
        setMpStatus(`Room ID: ${roomCode} - Enter your nickname to join`, 'info');
    }
}

export function initMultiplayerModal() {
    // Mode toggle buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setMpMode(btn.dataset.mode));
    });

    // Action button
    document.getElementById('btn-mp-action').addEventListener('click', handleMpAction);

    // Enter key submits
    ['join-nickname', 'join-room-id', 'create-nickname', 'create-room-id'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('keypress', (e) => {
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
export function updateRoomSettingsNavVisibility() {
    const navItem = document.getElementById('nav-room-settings');
    if (navItem) {
        const isHost = CodenamesClient?.player?.isHost;
        navItem.style.display = (state.isMultiplayerMode && isHost) ? 'flex' : 'none';
    }
}

// Update room info display in settings panel
export function updateRoomInfoDisplay() {
    const codeEl = document.getElementById('room-info-code');
    const playersEl = document.getElementById('room-info-players');
    const statusEl = document.getElementById('room-info-status');

    if (codeEl) codeEl.textContent = state.currentRoomId || CodenamesClient?.getRoomCode() || '----';
    if (playersEl) playersEl.textContent = state.multiplayerPlayers?.length || 0;
    if (statusEl) statusEl.textContent = state.gameState.status === 'ended' ? 'Game Over' : (state.gameState.status === 'playing' ? 'In Progress' : 'Waiting');
}
