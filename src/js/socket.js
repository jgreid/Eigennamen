/**
 * Socket.io Client Module
 *
 * Handles real-time multiplayer communication with the server.
 * Wraps Socket.io client with a clean interface for the modular frontend.
 *
 * @module socket
 */

import { showToast } from './ui.js';

// ============ State ============

let socket = null;
let sessionId = null;
let roomCode = null;
let player = null;
let connected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let autoRejoin = true;
let storedNickname = null;

// Event listeners
const listeners = {};

// Track socket listeners for cleanup
const socketListeners = [];

// Track listener errors for debugging
const listenerErrors = [];

// ============ Storage Helpers ============

/**
 * Safely get item from storage
 */
function safeGetStorage(storage, key) {
  try {
    return storage.getItem(key);
  } catch (e) {
    console.warn(`Storage access error for ${key}:`, e);
    return null;
  }
}

/**
 * Safely set item in storage
 */
function safeSetStorage(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      console.warn(`Storage quota exceeded for ${key}`);
    }
    return false;
  }
}

/**
 * Safely remove item from storage
 */
function safeRemoveStorage(storage, key) {
  try {
    storage.removeItem(key);
  } catch (e) {
    console.warn(`Storage removal error for ${key}:`, e);
  }
}

// ============ Internal Helpers ============

/**
 * Register a socket listener with tracking for cleanup
 */
function registerSocketListener(event, handler) {
  socket.on(event, handler);
  socketListeners.push({ event, handler });
}

/**
 * Cleanup all socket listeners
 */
function cleanupSocketListeners() {
  if (socket && socketListeners.length > 0) {
    socketListeners.forEach(({ event, handler }) => {
      socket.off(event, handler);
    });
  }
  socketListeners.length = 0;
}

/**
 * Emit event to local listeners
 * Errors are caught, logged, and tracked for debugging
 */
function emit(event, data) {
  const callbacks = listeners[event] || [];
  callbacks.forEach(cb => {
    try {
      cb(data);
    } catch (err) {
      // Log error with context
      console.error(`Error in ${event} listener:`, err);

      // Track error for debugging
      listenerErrors.push({
        event,
        error: err.message,
        stack: err.stack,
        timestamp: Date.now(),
      });

      // Keep only last 10 errors to prevent memory growth
      if (listenerErrors.length > 10) {
        listenerErrors.shift();
      }

      // Surface critical errors to user
      if (event === 'gameStarted' || event === 'cardRevealed' || event === 'roomJoined') {
        showToast('An error occurred. Try refreshing the page.', 'error');
      }
    }
  });
}

/**
 * Get recent listener errors (for debugging)
 * @returns {Array} Recent errors
 */
export function getListenerErrors() {
  return [...listenerErrors];
}

/**
 * Save session to storage
 */
function saveSession() {
  if (sessionId) {
    safeSetStorage(sessionStorage, 'codenames-session-id', sessionId);
  }
  if (roomCode) {
    safeSetStorage(sessionStorage, 'codenames-room-code', roomCode);
  }
  if (player?.nickname) {
    safeSetStorage(localStorage, 'codenames-nickname', player.nickname);
    storedNickname = player.nickname;
  }
}

/**
 * Get stored room code
 */
export function getStoredRoomCode() {
  return safeGetStorage(sessionStorage, 'codenames-room-code');
}

/**
 * Get stored nickname
 */
export function getStoredNickname() {
  return safeGetStorage(localStorage, 'codenames-nickname');
}

// ============ Setup Event Listeners ============

function setupEventListeners() {
  cleanupSocketListeners();

  // Room events
  registerSocketListener('room:created', (data) => {
    roomCode = data.room.code;
    player = data.player;
    saveSession();
    emit('roomCreated', data);
  });

  registerSocketListener('room:joined', (data) => {
    roomCode = data.room.code;
    player = data.you;
    saveSession();
    emit('roomJoined', data);
  });

  registerSocketListener('room:playerJoined', (data) => {
    emit('playerJoined', data);
  });

  registerSocketListener('room:playerLeft', (data) => {
    emit('playerLeft', data);
  });

  registerSocketListener('room:settingsUpdated', (data) => {
    emit('settingsUpdated', data);
  });

  registerSocketListener('room:hostChanged', (data) => {
    if (player && data.newHostSessionId === player.sessionId) {
      player.isHost = true;
    }
    emit('hostChanged', data);
  });

  registerSocketListener('room:kicked', (data) => {
    roomCode = null;
    player = null;
    safeRemoveStorage(sessionStorage, 'codenames-room-code');
    emit('kicked', data);
  });

  registerSocketListener('player:kicked', (data) => {
    emit('playerKicked', data);
  });

  registerSocketListener('room:error', (error) => {
    emit('error', { type: 'room', ...error });
  });

  registerSocketListener('room:resynced', (data) => {
    roomCode = data.room.code;
    player = data.you;
    emit('roomResynced', data);
  });

  registerSocketListener('room:reconnected', (data) => {
    roomCode = data.room.code;
    player = data.you;
    saveSession();
    emit('roomReconnected', data);
  });

  // Player events
  registerSocketListener('player:updated', (data) => {
    if (data.sessionId === player?.sessionId) {
      player = { ...player, ...data.changes };
    }
    emit('playerUpdated', data);
  });

  registerSocketListener('player:disconnected', (data) => {
    emit('playerDisconnected', data);
  });

  registerSocketListener('player:reconnected', (data) => {
    emit('playerReconnected', data);
  });

  registerSocketListener('room:playerReconnected', (data) => {
    emit('playerReconnected', data);
  });

  registerSocketListener('player:error', (error) => {
    emit('error', { type: 'player', ...error });
  });

  // Game events
  registerSocketListener('game:started', (data) => {
    emit('gameStarted', data);
  });

  registerSocketListener('game:cardRevealed', (data) => {
    emit('cardRevealed', data);
  });

  registerSocketListener('game:clueGiven', (data) => {
    emit('clueGiven', data);
  });

  registerSocketListener('game:turnEnded', (data) => {
    emit('turnEnded', data);
  });

  registerSocketListener('game:over', (data) => {
    emit('gameOver', data);
  });

  registerSocketListener('game:spymasterView', (data) => {
    emit('spymasterView', data);
  });

  registerSocketListener('game:error', (error) => {
    emit('error', { type: 'game', ...error });
  });

  // Timer events
  registerSocketListener('timer:started', (data) => {
    emit('timerStarted', data);
  });

  registerSocketListener('timer:stopped', (data) => {
    emit('timerStopped', data);
  });

  registerSocketListener('timer:tick', (data) => {
    emit('timerTick', data);
  });

  registerSocketListener('timer:expired', (data) => {
    emit('timerExpired', data);
  });

  registerSocketListener('timer:status', (data) => {
    emit('timerStatus', data);
  });

  // Chat events
  registerSocketListener('chat:message', (data) => {
    emit('chatMessage', data);
  });
}

// ============ Public API ============

/**
 * Connect to the server
 * @param {string} [serverUrl] - Server URL (defaults to current origin)
 * @param {Object} [options] - Connection options
 * @returns {Promise}
 */
export function connect(serverUrl = null, options = {}) {
  return new Promise((resolve, reject) => {
    // Load stored values
    sessionId = safeGetStorage(sessionStorage, 'codenames-session-id');
    storedNickname = safeGetStorage(localStorage, 'codenames-nickname');
    autoRejoin = options.autoRejoin !== false;

    const url = serverUrl || window.location.origin;

    // Use websocket only for HTTPS (better for production)
    const isSecure = url.startsWith('https://');
    const transports = isSecure ? ['websocket'] : ['polling', 'websocket'];

    // Check if Socket.io is available
    if (typeof io === 'undefined') {
      reject(new Error('Socket.io client not loaded'));
      return;
    }

    socket = io(url, {
      auth: { sessionId },
      transports,
      reconnection: true,
      reconnectionAttempts: maxReconnectAttempts,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      ...options.socketOptions
    });

    socket.on('connect', () => {
      connected = true;
      const wasReconnecting = reconnectAttempts > 0;
      reconnectAttempts = 0;
      console.log('Connected to server:', socket.id);
      emit('connected', { wasReconnecting });

      if (wasReconnecting && autoRejoin) {
        attemptRejoin().catch(err => {
          console.error('Auto-rejoin failed:', err);
        });
      }

      resolve(socket);
    });

    socket.on('disconnect', (reason) => {
      connected = false;
      console.log('Disconnected:', reason);
      emit('disconnected', { reason, wasConnected: true });
    });

    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      reconnectAttempts++;

      if (reconnectAttempts >= maxReconnectAttempts) {
        reject(error);
      }

      emit('error', { type: 'connection', error, attempt: reconnectAttempts });
    });

    setupEventListeners();
  });
}

/**
 * Attempt to rejoin the previous room
 */
async function attemptRejoin() {
  const storedRoom = getStoredRoomCode();
  const nickname = storedNickname || player?.nickname;

  if (!storedRoom || !nickname) {
    console.log('Cannot auto-rejoin: missing room code or nickname');
    return;
  }

  console.log(`Attempting to rejoin room ${storedRoom} as ${nickname}`);
  emit('rejoining', { roomCode: storedRoom, nickname });

  try {
    const result = await joinRoom(storedRoom, nickname);
    console.log('Successfully rejoined room:', storedRoom);
    emit('rejoined', result);
  } catch (error) {
    console.error('Failed to rejoin room:', error);
    safeRemoveStorage(sessionStorage, 'codenames-room-code');
    emit('rejoinFailed', { roomCode: storedRoom, error });
  }
}

/**
 * Disconnect from the server
 */
export function disconnect() {
  cleanupSocketListeners();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  connected = false;
  roomCode = null;
  player = null;
}

/**
 * Register event listener
 */
export function on(event, callback) {
  if (!listeners[event]) {
    listeners[event] = [];
  }
  listeners[event].push(callback);
  return () => off(event, callback);
}

/**
 * Remove event listener
 */
export function off(event, callback) {
  if (!callback) {
    delete listeners[event];
  } else if (listeners[event]) {
    listeners[event] = listeners[event].filter(cb => cb !== callback);
  }
}

/**
 * Register one-time event listener
 */
export function once(event, callback) {
  const wrapper = (data) => {
    off(event, wrapper);
    callback(data);
  };
  return on(event, wrapper);
}

// ============ Room Actions ============

/**
 * Create a new room
 */
export function createRoom(settings = {}) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      off('roomCreated', onCreated);
      off('error', onError);
    };

    const onCreated = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    const onError = (error) => {
      if (settled) return;
      if (error.type === 'room' || error.type === 'connection') {
        settled = true;
        cleanup();
        reject(error);
      }
    };

    on('roomCreated', onCreated);
    on('error', onError);

    socket.emit('room:create', { settings });

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Create room timeout'));
    }, 10000);
  });
}

/**
 * Join an existing room
 */
export function joinRoom(code, nickname, password = null) {
  return new Promise((resolve, reject) => {
    let timeoutId = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      off('roomJoined', onJoined);
      off('error', onError);
    };

    const onJoined = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    const onError = (error) => {
      if (settled) return;
      if (error.type === 'room' || error.type === 'connection') {
        settled = true;
        cleanup();
        reject(error);
      }
    };

    on('roomJoined', onJoined);
    on('error', onError);

    const payload = { code: code.toUpperCase(), nickname };
    if (password) payload.password = password;
    socket.emit('room:join', payload);

    timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Join room timeout'));
    }, 10000);
  });
}

/**
 * Leave the current room
 */
export function leaveRoom() {
  if (!socket || !roomCode) return;
  socket.emit('room:leave');
  roomCode = null;
  player = null;
  safeRemoveStorage(sessionStorage, 'codenames-room-code');
}

/**
 * Update room settings
 */
export function updateSettings(settings) {
  if (!socket || !roomCode) return;
  socket.emit('room:settings', settings);
}

/**
 * Request room resync
 */
export function requestResync() {
  if (!socket || !roomCode) return;
  socket.emit('room:requestResync');
}

// ============ Player Actions ============

/**
 * Set player's team
 */
export function setTeam(team) {
  if (!socket) return;
  socket.emit('player:setTeam', { team });
}

/**
 * Set player's role
 */
export function setRole(role) {
  if (!socket) return;
  socket.emit('player:setRole', { role });
}

/**
 * Update nickname
 */
export function setNickname(nickname) {
  if (!socket) return;
  socket.emit('player:setNickname', { nickname });
  storedNickname = nickname;
  safeSetStorage(localStorage, 'codenames-nickname', nickname);
}

/**
 * Kick a player (host only)
 */
export function kickPlayer(sessionId) {
  if (!socket) return;
  socket.emit('player:kick', { sessionId });
}

// ============ Game Actions ============

/**
 * Start a new game
 */
export function startGame(options = {}) {
  if (!socket) return;
  socket.emit('game:start', options);
}

/**
 * Reveal a card
 */
export function revealCard(index) {
  if (!socket) return;
  socket.emit('game:reveal', { index });
}

/**
 * Give a clue (spymaster only)
 */
export function giveClue(word, number) {
  if (!socket) return;
  socket.emit('game:clue', { word, number });
}

/**
 * End the current turn
 */
export function endTurn() {
  if (!socket) return;
  socket.emit('game:endTurn');
}

/**
 * Forfeit the game
 */
export function forfeit() {
  if (!socket) return;
  socket.emit('game:forfeit');
}

// ============ Timer Actions ============

/**
 * Start the turn timer
 */
export function startTimer(duration) {
  if (!socket) return;
  socket.emit('timer:start', { duration });
}

/**
 * Stop the turn timer
 */
export function stopTimer() {
  if (!socket) return;
  socket.emit('timer:stop');
}

/**
 * Add time to the timer
 */
export function addTime(seconds) {
  if (!socket) return;
  socket.emit('timer:addTime', { seconds });
}

// ============ Chat Actions ============

/**
 * Send a chat message
 */
export function sendMessage(message) {
  if (!socket) return;
  socket.emit('chat:send', { message });
}

// ============ State Getters ============

export function isConnected() {
  return connected;
}

export function getSocket() {
  return socket;
}

export function getSessionId() {
  return sessionId;
}

export function getRoomCode() {
  return roomCode;
}

export function getPlayer() {
  return player ? { ...player } : null;
}

// ============ Default Export ============

export default {
  connect,
  disconnect,
  on,
  off,
  once,
  createRoom,
  joinRoom,
  leaveRoom,
  updateSettings,
  requestResync,
  setTeam,
  setRole,
  setNickname,
  kickPlayer,
  startGame,
  revealCard,
  giveClue,
  endTurn,
  forfeit,
  startTimer,
  stopTimer,
  addTime,
  sendMessage,
  isConnected,
  getSocket,
  getSessionId,
  getRoomCode,
  getPlayer,
  getStoredRoomCode,
  getStoredNickname,
  getListenerErrors,
};
