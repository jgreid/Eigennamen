/**
 * Integration tests for Multiplayer module
 *
 * Tests the orchestration layer that connects socket module
 * with state management. Note: The multiplayer module has initialization
 * guards that prevent handler re-registration, so we focus on testing
 * the public API and state management functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock UI module
vi.mock('../ui.js', () => ({
  showToast: vi.fn(),
  announceToScreenReader: vi.fn(),
}));

import { showToast, announceToScreenReader } from '../ui.js';

// Mock socket module with proper vi.mock pattern
vi.mock('../socket.js', () => ({
  connect: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(),
  on: vi.fn(() => () => {}),
  off: vi.fn(),
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  startGame: vi.fn(),
  revealCard: vi.fn(),
  giveClue: vi.fn(),
  endTurn: vi.fn(),
  forfeit: vi.fn(),
  setTeam: vi.fn(),
  setRole: vi.fn(),
  setNickname: vi.fn(),
  kickPlayer: vi.fn(),
  requestResync: vi.fn(),
  isConnected: vi.fn(() => true),
  getRoomCode: vi.fn(() => 'TEST01'),
  getPlayer: vi.fn(() => ({ sessionId: 'test-session', nickname: 'TestPlayer' })),
  getStoredNickname: vi.fn(() => 'StoredPlayer'),
  getStoredRoomCode: vi.fn(() => null),
  default: {
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(),
    on: vi.fn(() => () => {}),
    off: vi.fn(),
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    startGame: vi.fn(),
    revealCard: vi.fn(),
    giveClue: vi.fn(),
    endTurn: vi.fn(),
    forfeit: vi.fn(),
    setTeam: vi.fn(),
    setRole: vi.fn(),
    setNickname: vi.fn(),
    kickPlayer: vi.fn(),
    requestResync: vi.fn(),
    isConnected: vi.fn(() => true),
    getRoomCode: vi.fn(() => 'TEST01'),
    getPlayer: vi.fn(() => ({ sessionId: 'test-session', nickname: 'TestPlayer' })),
    getStoredNickname: vi.fn(() => 'StoredPlayer'),
    getStoredRoomCode: vi.fn(() => null),
  },
}));

import * as state from '../state.js';
import * as multiplayer from '../multiplayer.js';
import * as socket from '../socket.js';

describe('Multiplayer Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset state
    state.resetMultiplayerState();
    state.resetGameState();
    state.resetPlayerRoles();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Module Exports', () => {
    it('should export initMultiplayer function', () => {
      // Verify the init function is exported
      expect(typeof multiplayer.initMultiplayer).toBe('function');
    });

    it('should export all expected API functions', () => {
      // Verify all public API functions are exported
      expect(typeof multiplayer.connectToServer).toBe('function');
      expect(typeof multiplayer.disconnectFromServer).toBe('function');
      expect(typeof multiplayer.createMultiplayerRoom).toBe('function');
      expect(typeof multiplayer.joinMultiplayerRoom).toBe('function');
      expect(typeof multiplayer.leaveMultiplayerRoom).toBe('function');
      expect(typeof multiplayer.startMultiplayerGame).toBe('function');
      expect(typeof multiplayer.revealMultiplayerCard).toBe('function');
      expect(typeof multiplayer.giveMultiplayerClue).toBe('function');
      expect(typeof multiplayer.endMultiplayerTurn).toBe('function');
      expect(typeof multiplayer.setMultiplayerTeam).toBe('function');
      expect(typeof multiplayer.setMultiplayerRole).toBe('function');
      expect(typeof multiplayer.kickMultiplayerPlayer).toBe('function');
      expect(typeof multiplayer.forfeitMultiplayerGame).toBe('function');
      expect(typeof multiplayer.requestResync).toBe('function');
    });
  });

  describe('State Management Integration', () => {
    it('should correctly manage multiplayer mode transitions', () => {
      // Start in standalone mode
      expect(state.getMultiplayerState().mode).toBe('standalone');

      // Transition to multiplayer
      state.setMultiplayerMode('multiplayer');
      state.setRoomInfo('TEST01');
      state.setConnected(true);

      expect(state.getMultiplayerState().mode).toBe('multiplayer');
      expect(state.getMultiplayerState().roomCode).toBe('TEST01');
      expect(state.getMultiplayerState().connected).toBe(true);

      // Transition back to standalone
      state.clearRoomInfo();
      state.setMultiplayerMode('standalone');
      state.setConnected(false);

      expect(state.getMultiplayerState().mode).toBe('standalone');
      expect(state.getMultiplayerState().roomCode).toBeNull();
    });

    it('should track players correctly', () => {
      // Add players
      state.addPlayer({ sessionId: 'p1', nickname: 'Player1', team: 'red' });
      state.addPlayer({ sessionId: 'p2', nickname: 'Player2', team: 'blue' });

      expect(state.getMultiplayerState().players).toHaveLength(2);

      // Update a player
      state.updatePlayer('p1', { role: 'spymaster' });

      const p1 = state.getMultiplayerState().players.find(p => p.sessionId === 'p1');
      expect(p1.role).toBe('spymaster');

      // Remove a player
      state.removePlayer('p2');
      expect(state.getMultiplayerState().players).toHaveLength(1);
    });

    it('should manage host status', () => {
      expect(state.getMultiplayerState().isHost).toBe(false);

      state.setMultiplayerHost(true);
      expect(state.getMultiplayerState().isHost).toBe(true);
      expect(state.getPlayerState().isHost).toBe(true);
    });

    it('should manage timer state', () => {
      state.setTimer({ remaining: 60, total: 120, running: true });

      const timer = state.getMultiplayerState().timer;
      expect(timer.remaining).toBe(60);
      expect(timer.total).toBe(120);
      expect(timer.running).toBe(true);

      state.setTimer(null);
      expect(state.getMultiplayerState().timer).toBeNull();
    });

    it('should manage clue state', () => {
      state.setCurrentClue({ word: 'ANIMAL', number: 3, team: 'red', spymaster: 'Player1' });

      const clue = state.getMultiplayerState().currentClue;
      expect(clue.word).toBe('ANIMAL');
      expect(clue.number).toBe(3);
      expect(state.getMultiplayerState().guessesAllowed).toBe(4); // number + 1

      state.incrementGuessesUsed();
      expect(state.getMultiplayerState().guessesUsed).toBe(1);

      state.setCurrentClue(null);
      expect(state.getMultiplayerState().currentClue).toBeNull();
      expect(state.getMultiplayerState().guessesAllowed).toBe(0);
    });

    it('should manage room settings', () => {
      state.updateRoomSettings({ turnTimeLimit: 90, strictSpymaster: true });

      const settings = state.getMultiplayerState().settings;
      expect(settings.turnTimeLimit).toBe(90);
      expect(settings.strictSpymaster).toBe(true);
    });
  });

  describe('Public API', () => {
    it('should connect to server', async () => {
      socket.connect.mockResolvedValue();

      const result = await multiplayer.connectToServer('http://test.com');

      expect(socket.connect).toHaveBeenCalledWith('http://test.com');
      expect(result).toBe(true);
    });

    it('should handle connection failure', async () => {
      socket.connect.mockRejectedValue(new Error('Connection failed'));

      const result = await multiplayer.connectToServer();

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Failed to connect to server', 'error');
    });

    it('should disconnect from server', () => {
      state.setMultiplayerMode('multiplayer');
      state.setRoomInfo('ROOM01');
      state.setConnected(true);

      multiplayer.disconnectFromServer();

      expect(socket.disconnect).toHaveBeenCalled();
      expect(state.getMultiplayerState().mode).toBe('standalone');
      expect(state.getMultiplayerState().connected).toBe(false);
    });

    it('should create multiplayer room', async () => {
      socket.createRoom.mockResolvedValue({
        room: { code: 'NEW01' },
        player: { isHost: true },
      });

      const result = await multiplayer.createMultiplayerRoom('HostPlayer', { maxPlayers: 10 });

      expect(socket.setNickname).toHaveBeenCalledWith('HostPlayer');
      expect(socket.createRoom).toHaveBeenCalledWith({ maxPlayers: 10 });
      expect(result.room.code).toBe('NEW01');
    });

    it('should handle room creation failure', async () => {
      socket.createRoom.mockRejectedValue(new Error('Rate limited'));

      await expect(
        multiplayer.createMultiplayerRoom('Player')
      ).rejects.toThrow('Rate limited');

      expect(showToast).toHaveBeenCalledWith('Rate limited', 'error');
    });

    it('should join multiplayer room', async () => {
      socket.joinRoom.mockResolvedValue({
        room: { code: 'JOIN01' },
        you: { nickname: 'Joiner' },
      });

      const result = await multiplayer.joinMultiplayerRoom('JOIN01', 'Joiner', 'password');

      expect(socket.joinRoom).toHaveBeenCalledWith('JOIN01', 'Joiner', 'password');
      expect(result.room.code).toBe('JOIN01');
    });

    it('should leave multiplayer room', () => {
      state.setMultiplayerMode('multiplayer');
      state.setRoomInfo('ROOM01');

      multiplayer.leaveMultiplayerRoom();

      expect(socket.leaveRoom).toHaveBeenCalled();
      expect(state.getMultiplayerState().mode).toBe('standalone');
      expect(showToast).toHaveBeenCalledWith('Left room', 'info', 2000);
    });

    it('should start multiplayer game as host', () => {
      state.setMultiplayerHost(true);

      multiplayer.startMultiplayerGame({ customWords: true });

      expect(socket.startGame).toHaveBeenCalledWith({ customWords: true });
    });

    it('should not start game if not host', () => {
      state.setMultiplayerHost(false);

      multiplayer.startMultiplayerGame();

      expect(socket.startGame).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('Only the host can start the game', 'warning');
    });

    it('should reveal multiplayer card', () => {
      multiplayer.revealMultiplayerCard(10);
      expect(socket.revealCard).toHaveBeenCalledWith(10);
    });

    it('should give multiplayer clue as spymaster', () => {
      state.setSpymasterTeam('red');

      multiplayer.giveMultiplayerClue('WATER', 3);

      expect(socket.giveClue).toHaveBeenCalledWith('WATER', 3);
    });

    it('should not give clue if not spymaster', () => {
      state.setSpymasterTeam(null);

      multiplayer.giveMultiplayerClue('WATER', 3);

      expect(socket.giveClue).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('Only spymasters can give clues', 'warning');
    });

    it('should end multiplayer turn', () => {
      multiplayer.endMultiplayerTurn();
      expect(socket.endTurn).toHaveBeenCalled();
    });

    it('should set multiplayer team', () => {
      multiplayer.setMultiplayerTeam('blue');
      expect(socket.setTeam).toHaveBeenCalledWith('blue');
    });

    it('should set multiplayer role', () => {
      multiplayer.setMultiplayerRole('clicker');
      expect(socket.setRole).toHaveBeenCalledWith('clicker');
    });

    it('should kick multiplayer player as host', () => {
      state.setMultiplayerHost(true);

      multiplayer.kickMultiplayerPlayer('session-to-kick');

      expect(socket.kickPlayer).toHaveBeenCalledWith('session-to-kick');
    });

    it('should not kick player if not host', () => {
      state.setMultiplayerHost(false);

      multiplayer.kickMultiplayerPlayer('session-to-kick');

      expect(socket.kickPlayer).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith('Only the host can kick players', 'warning');
    });

    it('should forfeit multiplayer game', () => {
      multiplayer.forfeitMultiplayerGame();
      expect(socket.forfeit).toHaveBeenCalled();
    });

    it('should request resync', () => {
      multiplayer.requestResync();
      expect(socket.requestResync).toHaveBeenCalled();
    });
  });

  describe('Re-exported Utilities', () => {
    it('should re-export isConnected', () => {
      expect(multiplayer.isConnected).toBe(socket.isConnected);
    });

    it('should re-export getRoomCode', () => {
      expect(multiplayer.getRoomCode).toBe(socket.getRoomCode);
    });

    it('should re-export getPlayer', () => {
      expect(multiplayer.getPlayer).toBe(socket.getPlayer);
    });

    it('should re-export getStoredNickname', () => {
      expect(multiplayer.getStoredNickname).toBe(socket.getStoredNickname);
    });

    it('should re-export getStoredRoomCode', () => {
      expect(multiplayer.getStoredRoomCode).toBe(socket.getStoredRoomCode);
    });
  });

  describe('Game State Synchronization', () => {
    it('should sync game state from server data', () => {
      const gameData = {
        seed: 'test-seed',
        words: Array(25).fill('WORD'),
        types: Array(25).fill('neutral'),
        revealed: Array(25).fill(false),
        currentTurn: 'red',
      };

      // Initialize local game with server data
      state.initGameWithWords(gameData.seed, gameData.words);
      state.setCurrentTurn(gameData.currentTurn);

      expect(state.getGameState().currentTurn).toBe('red');
      expect(state.getGameState().words).toHaveLength(25);
    });

    it('should track revealed cards', () => {
      state.initGame('test-seed');

      // Reveal some cards as would happen from server
      state.setCardRevealed(0, true);
      state.setCardRevealed(5, true);
      state.setCardRevealed(10, true);

      const gameState = state.getGameState();
      expect(gameState.revealed[0]).toBe(true);
      expect(gameState.revealed[5]).toBe(true);
      expect(gameState.revealed[10]).toBe(true);
      expect(gameState.revealed[1]).toBe(false);
    });
  });

  describe('Player Role Management', () => {
    it('should set spymaster role correctly', () => {
      state.setSpymasterTeam('red');

      expect(state.getPlayerState().spymasterTeam).toBe('red');
      expect(state.getPlayerState().clickerTeam).toBeNull();
      expect(state.getPlayerState().playerTeam).toBe('red');
    });

    it('should set clicker role correctly', () => {
      state.setClickerTeam('blue');

      expect(state.getPlayerState().clickerTeam).toBe('blue');
      expect(state.getPlayerState().spymasterTeam).toBeNull();
      expect(state.getPlayerState().playerTeam).toBe('blue');
    });

    it('should reset roles correctly', () => {
      state.setSpymasterTeam('red');
      state.resetPlayerRoles();

      expect(state.getPlayerState().spymasterTeam).toBeNull();
      expect(state.getPlayerState().clickerTeam).toBeNull();
    });
  });
});
