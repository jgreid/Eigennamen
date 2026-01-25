/**
 * Multiplayer Module
 *
 * Orchestrates multiplayer game functionality by connecting
 * the socket module with state management.
 *
 * @module multiplayer
 */

import * as socket from './socket.js';
import {
  getGameState,
  getPlayerState,
  getTeamNames,
  getMultiplayerState,
  setMultiplayerMode,
  setConnected,
  setRoomInfo,
  clearRoomInfo,
  setPlayers,
  updatePlayer,
  addPlayer,
  removePlayer,
  setMultiplayerHost,
  setCurrentClue,
  incrementGuessesUsed,
  setTimer,
  updateRoomSettings,
  resetGameState,
  resetPlayerRoles,
  setIsHost,
  setSpymasterTeam,
  setClickerTeam,
  setPlayerTeam,
  setCardRevealed,
  setCurrentTurn,
  initGameWithWords,
  subscribe,
} from './state.js';
import { showToast, announceToScreenReader } from './ui.js';
import { BOARD_SIZE } from './constants.js';

// ============ State ============

let initialized = false;
let eventHandlers = {};

// ============ Initialization ============

/**
 * Initialize multiplayer functionality
 * @param {Object} handlers - Event handler callbacks
 */
export function initMultiplayer(handlers = {}) {
  if (initialized) return;

  eventHandlers = handlers;
  setupSocketHandlers();
  initialized = true;
}

/**
 * Setup socket event handlers
 */
function setupSocketHandlers() {
  // Connection events
  socket.on('connected', handleConnected);
  socket.on('disconnected', handleDisconnected);
  socket.on('error', handleError);
  socket.on('rejoining', handleRejoining);
  socket.on('rejoined', handleRejoined);
  socket.on('rejoinFailed', handleRejoinFailed);

  // Room events
  socket.on('roomCreated', handleRoomCreated);
  socket.on('roomJoined', handleRoomJoined);
  socket.on('roomResynced', handleRoomResynced);
  socket.on('roomReconnected', handleRoomReconnected);
  socket.on('playerJoined', handlePlayerJoined);
  socket.on('playerLeft', handlePlayerLeft);
  socket.on('hostChanged', handleHostChanged);
  socket.on('kicked', handleKicked);
  socket.on('playerKicked', handlePlayerKicked);
  socket.on('settingsUpdated', handleSettingsUpdated);

  // Player events
  socket.on('playerUpdated', handlePlayerUpdated);
  socket.on('playerDisconnected', handlePlayerDisconnected);
  socket.on('playerReconnected', handlePlayerReconnected);

  // Game events
  socket.on('gameStarted', handleGameStarted);
  socket.on('cardRevealed', handleCardRevealed);
  socket.on('clueGiven', handleClueGiven);
  socket.on('turnEnded', handleTurnEnded);
  socket.on('gameOver', handleGameOver);
  socket.on('spymasterView', handleSpymasterView);

  // Timer events
  socket.on('timerStarted', handleTimerStarted);
  socket.on('timerStopped', handleTimerStopped);
  socket.on('timerTick', handleTimerTick);
  socket.on('timerExpired', handleTimerExpired);
  socket.on('timerStatus', handleTimerStatus);

  // Chat events
  socket.on('chatMessage', handleChatMessage);
}

// ============ Connection Handlers ============

function handleConnected({ wasReconnecting }) {
  setConnected(true);
  if (wasReconnecting) {
    showToast('Reconnected to server', 'success', 2000);
  }
  eventHandlers.onConnected?.({ wasReconnecting });
}

function handleDisconnected({ reason }) {
  setConnected(false);
  if (reason !== 'io client disconnect') {
    showToast('Disconnected from server', 'warning');
  }
  eventHandlers.onDisconnected?.({ reason });
}

function handleError(error) {
  console.error('Socket error:', error);
  const message = error.message || error.error?.message || 'An error occurred';
  showToast(message, 'error');
  eventHandlers.onError?.(error);
}

function handleRejoining({ roomCode, nickname }) {
  showToast(`Reconnecting to room ${roomCode}...`, 'info', 2000);
}

function handleRejoined(data) {
  handleRoomJoined(data);
  showToast('Reconnected to room!', 'success', 2000);
}

function handleRejoinFailed({ roomCode, error }) {
  showToast('Could not rejoin room - it may have expired', 'warning');
  clearRoomInfo();
  setMultiplayerMode('standalone');
  eventHandlers.onRejoinFailed?.({ roomCode, error });
}

// ============ Room Handlers ============

function handleRoomCreated(data) {
  const { room, player } = data;

  setMultiplayerMode('multiplayer');
  setRoomInfo(room.code);
  setPlayers(room.players || [player]);
  setMultiplayerHost(player.isHost);
  setIsHost(player.isHost);

  if (room.settings) {
    updateRoomSettings(room.settings);
  }

  // Set player state from server
  if (player.team) setPlayerTeam(player.team);
  if (player.role === 'spymaster') setSpymasterTeam(player.team);
  if (player.role === 'clicker') setClickerTeam(player.team);

  showToast(`Room ${room.code} created!`, 'success', 3000);
  eventHandlers.onRoomCreated?.(data);
}

function handleRoomJoined(data) {
  const { room, you, game } = data;

  setMultiplayerMode('multiplayer');
  setRoomInfo(room.code);
  setPlayers(room.players || []);
  setMultiplayerHost(you.isHost);
  setIsHost(you.isHost);

  if (room.settings) {
    updateRoomSettings(room.settings);
  }

  // Set player state from server
  if (you.team) setPlayerTeam(you.team);
  if (you.role === 'spymaster') setSpymasterTeam(you.team);
  else if (you.role === 'clicker') setClickerTeam(you.team);
  else {
    setSpymasterTeam(null);
    setClickerTeam(null);
  }

  // If game is in progress, sync state
  if (game) {
    syncGameState(game);
  }

  showToast(`Joined room ${room.code}`, 'success', 2000);
  eventHandlers.onRoomJoined?.(data);
}

function handleRoomResynced(data) {
  const { room, you, game } = data;

  setPlayers(room.players || []);
  setMultiplayerHost(you.isHost);

  if (room.settings) {
    updateRoomSettings(room.settings);
  }

  if (you.team) setPlayerTeam(you.team);
  if (you.role === 'spymaster') setSpymasterTeam(you.team);
  else if (you.role === 'clicker') setClickerTeam(you.team);

  if (game) {
    syncGameState(game);
  }

  eventHandlers.onRoomResynced?.(data);
}

function handleRoomReconnected(data) {
  handleRoomJoined(data);
  showToast('Reconnected to room!', 'success', 2000);
}

function handlePlayerJoined(data) {
  const { player } = data;
  addPlayer(player);
  showToast(`${player.nickname} joined`, 'info', 2000);
  announceToScreenReader(`${player.nickname} joined the room`);
  eventHandlers.onPlayerJoined?.(data);
}

function handlePlayerLeft(data) {
  const { sessionId, nickname } = data;
  removePlayer(sessionId);
  if (nickname) {
    showToast(`${nickname} left`, 'info', 2000);
    announceToScreenReader(`${nickname} left the room`);
  }
  eventHandlers.onPlayerLeft?.(data);
}

function handleHostChanged(data) {
  const { newHostSessionId, newHostNickname } = data;
  const currentPlayer = socket.getPlayer();

  if (currentPlayer?.sessionId === newHostSessionId) {
    setMultiplayerHost(true);
    setIsHost(true);
    showToast('You are now the host!', 'success');
  } else {
    showToast(`${newHostNickname} is now the host`, 'info', 2000);
  }

  eventHandlers.onHostChanged?.(data);
}

function handleKicked(data) {
  const { reason } = data;
  clearRoomInfo();
  setMultiplayerMode('standalone');
  resetPlayerRoles();
  showToast(reason || 'You were kicked from the room', 'error');
  eventHandlers.onKicked?.(data);
}

function handlePlayerKicked(data) {
  const { sessionId, nickname } = data;
  removePlayer(sessionId);
  showToast(`${nickname} was kicked`, 'info', 2000);
  eventHandlers.onPlayerKicked?.(data);
}

function handleSettingsUpdated(data) {
  const { settings, teamNames: names } = data;

  if (settings) {
    updateRoomSettings(settings);
  }

  if (names) {
    // Team names are handled via state
    eventHandlers.onTeamNamesUpdated?.(names);
  }

  eventHandlers.onSettingsUpdated?.(data);
}

// ============ Player Handlers ============

function handlePlayerUpdated(data) {
  const { sessionId, changes } = data;
  updatePlayer(sessionId, changes);

  // If it's us, update our local state
  const currentPlayer = socket.getPlayer();
  if (currentPlayer?.sessionId === sessionId) {
    if (changes.team !== undefined) {
      setPlayerTeam(changes.team);
    }
    if (changes.role !== undefined) {
      if (changes.role === 'spymaster') {
        setSpymasterTeam(changes.team || getPlayerState().playerTeam);
      } else if (changes.role === 'clicker') {
        setClickerTeam(changes.team || getPlayerState().playerTeam);
      } else {
        setSpymasterTeam(null);
        setClickerTeam(null);
      }
    }
  }

  eventHandlers.onPlayerUpdated?.(data);
}

function handlePlayerDisconnected(data) {
  const { sessionId, nickname } = data;
  updatePlayer(sessionId, { connected: false });
  showToast(`${nickname} disconnected`, 'warning', 2000);
  eventHandlers.onPlayerDisconnected?.(data);
}

function handlePlayerReconnected(data) {
  const { sessionId, nickname } = data;
  updatePlayer(sessionId, { connected: true });
  showToast(`${nickname} reconnected`, 'success', 2000);
  eventHandlers.onPlayerReconnected?.(data);
}

// ============ Game Handlers ============

function handleGameStarted(data) {
  const { game } = data;
  syncGameState(game);
  resetPlayerRoles();
  setCurrentClue(null);

  const teamNames = getTeamNames();
  const startingTeam = game.currentTurn === 'red' ? teamNames.red : teamNames.blue;
  announceToScreenReader(`Game started! ${startingTeam} goes first.`);
  showToast('Game started!', 'success', 2000);

  eventHandlers.onGameStarted?.(data);
}

function handleCardRevealed(data) {
  const { index, type, player: revealingPlayer, gameOver, winner, turnEnded, currentTurn } = data;

  // Update local state
  setCardRevealed(index, true);
  incrementGuessesUsed();

  if (turnEnded && !gameOver) {
    setCurrentTurn(currentTurn);
    setCurrentClue(null);
  }

  const gameState = getGameState();
  const word = gameState.words[index];
  const teamNames = getTeamNames();

  announceToScreenReader(`${revealingPlayer?.nickname || 'Someone'} revealed ${word}: ${type}`);

  if (gameOver) {
    const winnerName = winner === 'red' ? teamNames.red : teamNames.blue;
    announceToScreenReader(`Game over! ${winnerName} wins!`);
  }

  eventHandlers.onCardRevealed?.(data);
}

function handleClueGiven(data) {
  const { word, number, team, spymaster, guessesAllowed } = data;

  setCurrentClue({ word, number, team, spymaster, guessesAllowed });

  const teamNames = getTeamNames();
  const teamName = team === 'red' ? teamNames.red : teamNames.blue;

  showToast(`${spymaster} gives clue: ${word} (${number})`, 'info', 4000);
  announceToScreenReader(`${teamName} clue: ${word}, ${number}`);

  eventHandlers.onClueGiven?.(data);
}

function handleTurnEnded(data) {
  const { currentTurn, previousTurn } = data;

  setCurrentTurn(currentTurn);
  setCurrentClue(null);

  const teamNames = getTeamNames();
  const newTurnName = currentTurn === 'red' ? teamNames.red : teamNames.blue;

  announceToScreenReader(`Turn ended. ${newTurnName}'s turn.`);

  eventHandlers.onTurnEnded?.(data);
}

function handleGameOver(data) {
  const { winner, reason } = data;

  const gameState = getGameState();
  // Force game over state
  gameState.gameOver = true;
  gameState.winner = winner;

  const teamNames = getTeamNames();
  const winnerName = winner === 'red' ? teamNames.red : teamNames.blue;

  let message = `${winnerName} wins!`;
  if (reason === 'assassin') {
    message = `${winnerName} wins! Assassin revealed!`;
  } else if (reason === 'forfeit') {
    message = `${winnerName} wins by forfeit!`;
  }

  showToast(message, 'success', 5000);
  announceToScreenReader(message);

  eventHandlers.onGameOver?.(data);
}

function handleSpymasterView(data) {
  const { types } = data;
  // This is received when becoming spymaster
  // The types are already in game state from game start
  eventHandlers.onSpymasterView?.(data);
}

// ============ Timer Handlers ============

function handleTimerStarted(data) {
  const { remaining, total } = data;
  setTimer({ remaining, total, running: true });
  eventHandlers.onTimerStarted?.(data);
}

function handleTimerStopped(data) {
  setTimer(null);
  eventHandlers.onTimerStopped?.(data);
}

function handleTimerTick(data) {
  const { remaining } = data;
  const current = getMultiplayerState().timer;
  if (current) {
    setTimer({ ...current, remaining });
  }
  eventHandlers.onTimerTick?.(data);
}

function handleTimerExpired(data) {
  setTimer(null);
  showToast('Time expired!', 'warning');
  announceToScreenReader('Time expired!');
  eventHandlers.onTimerExpired?.(data);
}

function handleTimerStatus(data) {
  const { remaining, total, running } = data;
  if (running) {
    setTimer({ remaining, total, running });
  } else {
    setTimer(null);
  }
  eventHandlers.onTimerStatus?.(data);
}

// ============ Chat Handler ============

function handleChatMessage(data) {
  eventHandlers.onChatMessage?.(data);
}

// ============ State Sync ============

/**
 * Sync game state from server
 */
function syncGameState(game) {
  if (!game) return;

  const { seed, words, types, revealed, currentTurn, redScore, blueScore, gameOver, winner, currentClue } = game;

  // Initialize game with server data
  if (words && words.length === BOARD_SIZE) {
    initGameWithWords(seed, words);
  }

  // Sync revealed cards
  if (revealed) {
    for (let i = 0; i < revealed.length && i < BOARD_SIZE; i++) {
      setCardRevealed(i, revealed[i]);
    }
  }

  // Sync turn
  if (currentTurn) {
    setCurrentTurn(currentTurn);
  }

  // Sync clue
  if (currentClue) {
    setCurrentClue(currentClue);
  } else {
    setCurrentClue(null);
  }
}

// ============ Public API ============

/**
 * Connect to multiplayer server
 */
export async function connectToServer(serverUrl = null) {
  try {
    await socket.connect(serverUrl);
    return true;
  } catch (error) {
    console.error('Failed to connect:', error);
    showToast('Failed to connect to server', 'error');
    return false;
  }
}

/**
 * Disconnect from server
 */
export function disconnectFromServer() {
  socket.disconnect();
  clearRoomInfo();
  setMultiplayerMode('standalone');
  setConnected(false);
}

/**
 * Create a new multiplayer room
 * @param {string} nickname - Host nickname
 * @param {Object} options - Room creation options
 * @param {string} options.roomId - Room ID chosen by the host
 * @param {Object} [options.settings] - Additional room settings
 */
export async function createMultiplayerRoom(nickname, { roomId, ...settings } = {}) {
  try {
    const data = await socket.createRoom({ roomId, nickname, ...settings });
    return data;
  } catch (error) {
    console.error('Failed to create room:', error);
    const message = error.message || 'Failed to create room';
    showToast(message, 'error');
    throw error;
  }
}

/**
 * Join an existing multiplayer room
 * @param {string} roomId - Room ID to join
 * @param {string} nickname - Player nickname
 */
export async function joinMultiplayerRoom(roomId, nickname) {
  try {
    const data = await socket.joinRoom(roomId, nickname);
    return data;
  } catch (error) {
    console.error('Failed to join room:', error);
    const message = error.message || 'Failed to join room';
    showToast(message, 'error');
    throw error;
  }
}

/**
 * Leave the current room
 */
export function leaveMultiplayerRoom() {
  socket.leaveRoom();
  clearRoomInfo();
  setMultiplayerMode('standalone');
  resetPlayerRoles();
  resetGameState();
  showToast('Left room', 'info', 2000);
}

/**
 * Start a new game (host only)
 */
export function startMultiplayerGame(options = {}) {
  const mpState = getMultiplayerState();
  if (!mpState.isHost) {
    showToast('Only the host can start the game', 'warning');
    return;
  }
  socket.startGame(options);
}

/**
 * Reveal a card in multiplayer
 */
export function revealMultiplayerCard(index) {
  socket.revealCard(index);
}

/**
 * Give a clue (spymaster only)
 */
export function giveMultiplayerClue(word, number) {
  const playerState = getPlayerState();
  if (!playerState.spymasterTeam) {
    showToast('Only spymasters can give clues', 'warning');
    return;
  }
  socket.giveClue(word, number);
}

/**
 * End turn in multiplayer
 */
export function endMultiplayerTurn() {
  socket.endTurn();
}

/**
 * Set team in multiplayer
 */
export function setMultiplayerTeam(team) {
  socket.setTeam(team);
}

/**
 * Set role in multiplayer
 */
export function setMultiplayerRole(role) {
  socket.setRole(role);
}

/**
 * Kick a player (host only)
 */
export function kickMultiplayerPlayer(sessionId) {
  const mpState = getMultiplayerState();
  if (!mpState.isHost) {
    showToast('Only the host can kick players', 'warning');
    return;
  }
  socket.kickPlayer(sessionId);
}

/**
 * Forfeit the game
 */
export function forfeitMultiplayerGame() {
  socket.forfeit();
}

/**
 * Request state resync from server
 */
export function requestResync() {
  socket.requestResync();
}

// Re-export socket utilities
export const isConnected = socket.isConnected;
export const getRoomCode = socket.getRoomCode;
export const getPlayer = socket.getPlayer;
export const getStoredNickname = socket.getStoredNickname;
export const getStoredRoomCode = socket.getStoredRoomCode;

// Default export
export default {
  initMultiplayer,
  connectToServer,
  disconnectFromServer,
  createMultiplayerRoom,
  joinMultiplayerRoom,
  leaveMultiplayerRoom,
  startMultiplayerGame,
  revealMultiplayerCard,
  giveMultiplayerClue,
  endMultiplayerTurn,
  setMultiplayerTeam,
  setMultiplayerRole,
  kickMultiplayerPlayer,
  forfeitMultiplayerGame,
  requestResync,
  isConnected,
  getRoomCode,
  getPlayer,
  getStoredNickname,
  getStoredRoomCode,
};
