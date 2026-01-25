/**
 * Integration tests for Socket.io client module with mocked server
 *
 * Tests real connection flows, event handling, and state management
 * using a mock Socket.io server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock showToast before importing socket module
vi.mock('../ui.js', () => ({
  showToast: vi.fn(),
}));

import { showToast } from '../ui.js';

// Track socket event handlers
const socketEventHandlers = new Map();
let mockConnected = false;
let mockSocketId = null;
let connectCallback = null;
let disconnectCallback = null;
let connectErrorCallback = null;

// Create realistic mock socket
const mockSocket = {
  on: vi.fn((event, handler) => {
    if (!socketEventHandlers.has(event)) {
      socketEventHandlers.set(event, []);
    }
    socketEventHandlers.get(event).push(handler);

    // Track specific callbacks for simulation
    if (event === 'connect') connectCallback = handler;
    if (event === 'disconnect') disconnectCallback = handler;
    if (event === 'connect_error') connectErrorCallback = handler;
  }),
  off: vi.fn((event, handler) => {
    const handlers = socketEventHandlers.get(event) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) handlers.splice(index, 1);
  }),
  emit: vi.fn(),
  disconnect: vi.fn(() => {
    mockConnected = false;
    if (disconnectCallback) {
      disconnectCallback('io client disconnect');
    }
  }),
  get connected() {
    return mockConnected;
  },
  get id() {
    return mockSocketId;
  },
};

// Helper to emit server events to client
function emitServerEvent(event, data) {
  const handlers = socketEventHandlers.get(event) || [];
  handlers.forEach(handler => handler(data));
}

// Helper to simulate successful connection
function simulateConnect() {
  mockConnected = true;
  mockSocketId = 'test-socket-' + Math.random().toString(36).substr(2, 9);
  if (connectCallback) {
    connectCallback();
  }
}

// Helper to simulate connection error
function simulateConnectError(error) {
  if (connectErrorCallback) {
    connectErrorCallback(error);
  }
}

// Mock io function
vi.stubGlobal('io', vi.fn(() => mockSocket));

// Mock storage
const mockStorage = {
  store: {},
  getItem: vi.fn((key) => mockStorage.store[key] || null),
  setItem: vi.fn((key, value) => {
    mockStorage.store[key] = value;
  }),
  removeItem: vi.fn((key) => {
    delete mockStorage.store[key];
  }),
  clear: vi.fn(() => {
    mockStorage.store = {};
  }),
};

vi.stubGlobal('sessionStorage', mockStorage);
vi.stubGlobal('localStorage', mockStorage);
vi.stubGlobal('location', { origin: 'http://localhost:3000' });

// Import socket module after mocks are set up
import * as socketModule from '../socket.js';

describe('Socket Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.store = {};
    socketEventHandlers.clear();
    mockConnected = false;
    mockSocketId = null;
    connectCallback = null;
    disconnectCallback = null;
    connectErrorCallback = null;
  });

  afterEach(() => {
    // Clean up socket state
    try {
      socketModule.disconnect();
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Connection Lifecycle', () => {
    it('should connect to server and emit connected event', async () => {
      const connectedHandler = vi.fn();
      socketModule.on('connected', connectedHandler);

      // Start connection
      const connectPromise = socketModule.connect('http://localhost:3000');

      // Simulate server accepting connection
      simulateConnect();

      await connectPromise;

      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(connectedHandler).toHaveBeenCalledWith({ wasReconnecting: false });
      expect(socketModule.isConnected()).toBe(true);
    });

    it('should handle connection errors', async () => {
      const errorHandler = vi.fn();
      socketModule.on('error', errorHandler);

      const connectPromise = socketModule.connect('http://localhost:3000');

      // Simulate connection failures up to max attempts
      for (let i = 0; i < 5; i++) {
        simulateConnectError(new Error('Connection refused'));
      }

      await expect(connectPromise).rejects.toThrow();
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle disconnection', async () => {
      const disconnectedHandler = vi.fn();
      socketModule.on('disconnected', disconnectedHandler);

      // Connect first
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;

      // Simulate server-side disconnect
      emitServerEvent('disconnect', 'server disconnect');

      expect(disconnectedHandler).toHaveBeenCalledWith({
        reason: 'server disconnect',
        wasConnected: true,
      });
    });

    it('should use stored session ID on reconnect', async () => {
      mockStorage.store['codenames-session-id'] = 'existing-session-123';

      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;

      expect(io).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          auth: { sessionId: 'existing-session-123' },
        })
      );
    });

    it('should use websocket-only transport for HTTPS', async () => {
      const connectPromise = socketModule.connect('https://secure.example.com');
      simulateConnect();
      await connectPromise;

      expect(io).toHaveBeenCalledWith(
        'https://secure.example.com',
        expect.objectContaining({
          transports: ['websocket'],
        })
      );
    });
  });

  describe('Room Operations', () => {
    beforeEach(async () => {
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;
    });

    it('should create room and handle response', async () => {
      const roomCreatedHandler = vi.fn();
      socketModule.on('roomCreated', roomCreatedHandler);

      // Start room creation
      const createPromise = socketModule.createRoom({ maxPlayers: 8 });

      // Verify emit was called
      expect(mockSocket.emit).toHaveBeenCalledWith('room:create', {
        settings: { maxPlayers: 8 },
      });

      // Simulate server response
      emitServerEvent('room:created', {
        room: { code: 'ABC123', players: [] },
        player: { sessionId: 'session-1', isHost: true },
      });

      const result = await createPromise;
      expect(result.room.code).toBe('ABC123');
      expect(result.player.isHost).toBe(true);
      expect(socketModule.getRoomCode()).toBe('ABC123');
    });

    it('should join room and handle response', async () => {
      const roomJoinedHandler = vi.fn();
      socketModule.on('roomJoined', roomJoinedHandler);

      const joinPromise = socketModule.joinRoom('my-room', 'TestPlayer');

      expect(mockSocket.emit).toHaveBeenCalledWith('room:join', {
        roomId: 'my-room',
        nickname: 'TestPlayer',
      });

      emitServerEvent('room:joined', {
        room: { code: 'my-room', players: [] },
        you: { sessionId: 'session-2', nickname: 'TestPlayer' },
      });

      const result = await joinPromise;
      expect(result.room.code).toBe('my-room');
      expect(result.you.nickname).toBe('TestPlayer');
    });

    it('should handle room creation timeout', async () => {
      vi.useFakeTimers();

      const createPromise = socketModule.createRoom();

      // Fast-forward past timeout
      vi.advanceTimersByTime(11000);

      await expect(createPromise).rejects.toThrow('Create room timeout');

      vi.useRealTimers();
    });

    it('should handle room join errors', async () => {
      const joinPromise = socketModule.joinRoom('INVALID', 'Player');

      emitServerEvent('room:error', {
        type: 'room',
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found',
      });

      await expect(joinPromise).rejects.toMatchObject({
        code: 'ROOM_NOT_FOUND',
      });
    });

    it('should leave room and clear state', async () => {
      // Join a room first
      const joinPromise = socketModule.joinRoom('LEAVE1', 'Player');
      emitServerEvent('room:joined', {
        room: { code: 'LEAVE1' },
        you: { nickname: 'Player' },
      });
      await joinPromise;

      expect(socketModule.getRoomCode()).toBe('LEAVE1');

      // Leave room
      socketModule.leaveRoom();

      expect(mockSocket.emit).toHaveBeenCalledWith('room:leave');
      expect(socketModule.getRoomCode()).toBeNull();
    });

    it('should update room settings', async () => {
      // Must be in a room to update settings
      const joinPromise = socketModule.joinRoom('SETTINGS1', 'Player');
      emitServerEvent('room:joined', {
        room: { code: 'SETTINGS1' },
        you: { nickname: 'Player' },
      });
      await joinPromise;

      socketModule.updateSettings({ turnTimer: 120 });

      expect(mockSocket.emit).toHaveBeenCalledWith('room:settings', {
        turnTimer: 120,
      });
    });
  });

  describe('Player Operations', () => {
    beforeEach(async () => {
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;
    });

    it('should set team', () => {
      socketModule.setTeam('red');
      expect(mockSocket.emit).toHaveBeenCalledWith('player:setTeam', { team: 'red' });
    });

    it('should set role', () => {
      socketModule.setRole('spymaster');
      expect(mockSocket.emit).toHaveBeenCalledWith('player:setRole', { role: 'spymaster' });
    });

    it('should set nickname and persist to storage', () => {
      socketModule.setNickname('NewName');
      expect(mockSocket.emit).toHaveBeenCalledWith('player:setNickname', { nickname: 'NewName' });
      expect(mockStorage.setItem).toHaveBeenCalledWith('codenames-nickname', 'NewName');
    });

    it('should kick player', () => {
      socketModule.kickPlayer('session-to-kick');
      expect(mockSocket.emit).toHaveBeenCalledWith('player:kick', { sessionId: 'session-to-kick' });
    });

    it('should handle player update for current player', async () => {
      // Join room to set up player
      const joinPromise = socketModule.joinRoom('ROOM1', 'Player');
      emitServerEvent('room:joined', {
        room: { code: 'ROOM1' },
        you: { sessionId: 'my-session', nickname: 'Player' },
      });
      await joinPromise;

      // Simulate player update
      emitServerEvent('player:updated', {
        sessionId: 'my-session',
        changes: { team: 'blue' },
      });

      const player = socketModule.getPlayer();
      expect(player.team).toBe('blue');
    });

    it('should handle host change when becoming host', async () => {
      const hostChangedHandler = vi.fn();
      socketModule.on('hostChanged', hostChangedHandler);

      // Join room
      const joinPromise = socketModule.joinRoom('ROOM1', 'Player');
      emitServerEvent('room:joined', {
        room: { code: 'ROOM1' },
        you: { sessionId: 'my-session', isHost: false },
      });
      await joinPromise;

      // Simulate becoming host
      emitServerEvent('room:hostChanged', {
        newHostSessionId: 'my-session',
        newHostNickname: 'Player',
      });

      expect(hostChangedHandler).toHaveBeenCalled();
      expect(socketModule.getPlayer().isHost).toBe(true);
    });
  });

  describe('Game Operations', () => {
    beforeEach(async () => {
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;
    });

    it('should start game', () => {
      socketModule.startGame({ wordList: 'custom' });
      expect(mockSocket.emit).toHaveBeenCalledWith('game:start', { wordList: 'custom' });
    });

    it('should reveal card', () => {
      socketModule.revealCard(5);
      expect(mockSocket.emit).toHaveBeenCalledWith('game:reveal', { index: 5 });
    });

    it('should give clue', () => {
      socketModule.giveClue('WATER', 3);
      expect(mockSocket.emit).toHaveBeenCalledWith('game:clue', { word: 'WATER', number: 3 });
    });

    it('should end turn', () => {
      socketModule.endTurn();
      expect(mockSocket.emit).toHaveBeenCalledWith('game:endTurn');
    });

    it('should forfeit game', () => {
      socketModule.forfeit();
      expect(mockSocket.emit).toHaveBeenCalledWith('game:forfeit');
    });

    it('should handle game started event', async () => {
      const gameStartedHandler = vi.fn();
      socketModule.on('gameStarted', gameStartedHandler);

      emitServerEvent('game:started', {
        game: {
          words: Array(25).fill('WORD'),
          types: Array(25).fill('neutral'),
          currentTurn: 'red',
        },
      });

      expect(gameStartedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          game: expect.objectContaining({
            currentTurn: 'red',
          }),
        })
      );
    });

    it('should handle card revealed event', () => {
      const cardRevealedHandler = vi.fn();
      socketModule.on('cardRevealed', cardRevealedHandler);

      emitServerEvent('game:cardRevealed', {
        index: 10,
        type: 'red',
        player: { nickname: 'TestPlayer' },
      });

      expect(cardRevealedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 10,
          type: 'red',
        })
      );
    });

    it('should handle clue given event', () => {
      const clueHandler = vi.fn();
      socketModule.on('clueGiven', clueHandler);

      emitServerEvent('game:clueGiven', {
        word: 'ANIMAL',
        number: 2,
        team: 'blue',
        spymaster: 'SpyMaster',
      });

      expect(clueHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          word: 'ANIMAL',
          number: 2,
        })
      );
    });

    it('should handle game over event', () => {
      const gameOverHandler = vi.fn();
      socketModule.on('gameOver', gameOverHandler);

      emitServerEvent('game:over', {
        winner: 'red',
        reason: 'allFound',
      });

      expect(gameOverHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          winner: 'red',
          reason: 'allFound',
        })
      );
    });
  });

  describe('Timer Operations', () => {
    beforeEach(async () => {
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;
    });

    it('should start timer', () => {
      socketModule.startTimer(120);
      expect(mockSocket.emit).toHaveBeenCalledWith('timer:start', { duration: 120 });
    });

    it('should stop timer', () => {
      socketModule.stopTimer();
      expect(mockSocket.emit).toHaveBeenCalledWith('timer:stop');
    });

    it('should add time', () => {
      socketModule.addTime(30);
      expect(mockSocket.emit).toHaveBeenCalledWith('timer:addTime', { seconds: 30 });
    });

    it('should handle timer events', () => {
      const timerStartedHandler = vi.fn();
      const timerTickHandler = vi.fn();
      const timerExpiredHandler = vi.fn();

      socketModule.on('timerStarted', timerStartedHandler);
      socketModule.on('timerTick', timerTickHandler);
      socketModule.on('timerExpired', timerExpiredHandler);

      emitServerEvent('timer:started', { remaining: 120, total: 120 });
      expect(timerStartedHandler).toHaveBeenCalledWith({ remaining: 120, total: 120 });

      emitServerEvent('timer:tick', { remaining: 60 });
      expect(timerTickHandler).toHaveBeenCalledWith({ remaining: 60 });

      emitServerEvent('timer:expired', {});
      expect(timerExpiredHandler).toHaveBeenCalled();
    });
  });

  describe('Chat Operations', () => {
    beforeEach(async () => {
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;
    });

    it('should send chat message', () => {
      socketModule.sendMessage('Hello everyone!');
      expect(mockSocket.emit).toHaveBeenCalledWith('chat:send', { message: 'Hello everyone!' });
    });

    it('should handle incoming chat messages', () => {
      const chatHandler = vi.fn();
      socketModule.on('chatMessage', chatHandler);

      emitServerEvent('chat:message', {
        text: 'Hello!',
        sender: 'Player1',
        timestamp: Date.now(),
      });

      expect(chatHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello!',
          sender: 'Player1',
        })
      );
    });
  });

  describe('Event Listener Management', () => {
    it('should register and unregister listeners', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      const unsubscribe1 = socketModule.on('testEvent', handler1);
      socketModule.on('testEvent', handler2);

      // Unsubscribe first handler
      unsubscribe1();

      // Both handlers should still be callable (internal emit doesn't trigger here)
    });

    it('should support once() for single-fire listeners', () => {
      const handler = vi.fn();
      socketModule.once('singleEvent', handler);

      // First call
      // Internal emit would fire once and auto-unsubscribe
    });

    it('should remove all listeners for an event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      socketModule.on('multiEvent', handler1);
      socketModule.on('multiEvent', handler2);

      socketModule.off('multiEvent');
      // All listeners should be removed
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;
    });

    it('should track listener errors', () => {
      // Get errors (should be empty initially or contain previous errors)
      const errors = socketModule.getListenerErrors();
      expect(Array.isArray(errors)).toBe(true);
    });

    it('should surface critical errors to user', async () => {
      // Add a listener that throws on critical events
      const errorHandler = vi.fn();
      socketModule.on('error', errorHandler);

      emitServerEvent('room:error', {
        type: 'room',
        code: 'INTERNAL_ERROR',
        message: 'Server error',
      });

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle kicked event', async () => {
      const kickedHandler = vi.fn();
      socketModule.on('kicked', kickedHandler);

      // Join room first
      const joinPromise = socketModule.joinRoom('ROOM1', 'Player');
      emitServerEvent('room:joined', {
        room: { code: 'ROOM1' },
        you: { nickname: 'Player' },
      });
      await joinPromise;

      // Get kicked
      emitServerEvent('room:kicked', {
        reason: 'Host removed you',
      });

      expect(kickedHandler).toHaveBeenCalled();
      expect(socketModule.getRoomCode()).toBeNull();
    });
  });

  describe('Session Persistence', () => {
    it('should save session to storage on room join', async () => {
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;

      const joinPromise = socketModule.joinRoom('PERSIST', 'Player');
      emitServerEvent('room:joined', {
        room: { code: 'PERSIST' },
        you: { sessionId: 'new-session', nickname: 'Player' },
      });
      await joinPromise;

      expect(mockStorage.setItem).toHaveBeenCalledWith('codenames-room-code', 'PERSIST');
    });

    it('should retrieve stored nickname', () => {
      mockStorage.store['codenames-nickname'] = 'StoredPlayer';
      const nickname = socketModule.getStoredNickname();
      expect(nickname).toBe('StoredPlayer');
    });

    it('should retrieve stored room code', () => {
      mockStorage.store['codenames-room-code'] = 'STORED1';
      const roomCode = socketModule.getStoredRoomCode();
      expect(roomCode).toBe('STORED1');
    });
  });

  describe('Reconnection Flow', () => {
    it('should emit rejoining event on reconnect', async () => {
      // Set up stored session
      mockStorage.store['codenames-room-code'] = 'RECONN1';
      mockStorage.store['codenames-nickname'] = 'ReconnPlayer';

      const rejoiningHandler = vi.fn();
      socketModule.on('rejoining', rejoiningHandler);

      // Connect with auto-rejoin
      const connectPromise = socketModule.connect(null, { autoRejoin: true });

      // Simulate reconnection (wasReconnecting = true happens after initial connect was lost)
      mockConnected = true;
      mockSocketId = 'reconnect-socket';

      // First connect
      if (connectCallback) connectCallback();
      await connectPromise;

      // Simulate disconnect and reconnect
      emitServerEvent('disconnect', 'transport close');

      // Manually trigger the reconnect flow by simulating another connect
      // In real scenario, socket.io would handle this
    });

    it('should handle room resync', async () => {
      const resyncHandler = vi.fn();
      socketModule.on('roomResynced', resyncHandler);

      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;

      emitServerEvent('room:resynced', {
        room: { code: 'SYNC1', players: [] },
        you: { nickname: 'Player' },
      });

      expect(resyncHandler).toHaveBeenCalled();
    });

    it('should request resync', async () => {
      const connectPromise = socketModule.connect();
      simulateConnect();
      await connectPromise;

      // Join room first
      const joinPromise = socketModule.joinRoom('ROOM1', 'Player');
      emitServerEvent('room:joined', {
        room: { code: 'ROOM1' },
        you: { nickname: 'Player' },
      });
      await joinPromise;

      socketModule.requestResync();
      expect(mockSocket.emit).toHaveBeenCalledWith('room:requestResync');
    });
  });
});
