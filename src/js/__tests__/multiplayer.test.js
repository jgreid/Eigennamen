/**
 * Unit tests for Multiplayer module
 *
 * Tests individual functions and handlers in isolation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock UI module - must be before imports
vi.mock('../ui.js', () => ({
  showToast: vi.fn(),
  announceToScreenReader: vi.fn(),
}));

// Mock socket module with factory function - vi.mock is hoisted
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
import { showToast } from '../ui.js';
import * as socket from '../socket.js';

describe('Multiplayer Module Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.resetMultiplayerState();
    state.resetGameState();
    state.resetPlayerRoles();
  });

  describe('connectToServer', () => {
    it('should call socket.connect with provided URL', async () => {
      socket.connect.mockResolvedValue();
      await multiplayer.connectToServer('http://custom.server.com');
      expect(socket.connect).toHaveBeenCalledWith('http://custom.server.com');
    });

    it('should call socket.connect with null for default URL', async () => {
      socket.connect.mockResolvedValue();
      await multiplayer.connectToServer();
      expect(socket.connect).toHaveBeenCalledWith(null);
    });

    it('should return true on successful connection', async () => {
      socket.connect.mockResolvedValue();
      const result = await multiplayer.connectToServer();
      expect(result).toBe(true);
    });

    it('should return false and show toast on connection failure', async () => {
      socket.connect.mockRejectedValue(new Error('Network error'));
      const result = await multiplayer.connectToServer();
      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Failed to connect to server', 'error');
    });
  });

  describe('disconnectFromServer', () => {
    it('should call socket.disconnect', () => {
      multiplayer.disconnectFromServer();
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('should clear room info', () => {
      state.setRoomInfo('ROOM01');
      multiplayer.disconnectFromServer();
      expect(state.getMultiplayerState().roomCode).toBeNull();
    });

    it('should set mode to standalone', () => {
      state.setMultiplayerMode('multiplayer');
      multiplayer.disconnectFromServer();
      expect(state.getMultiplayerState().mode).toBe('standalone');
    });

    it('should set connected to false', () => {
      state.setConnected(true);
      multiplayer.disconnectFromServer();
      expect(state.getMultiplayerState().connected).toBe(false);
    });
  });

  describe('createMultiplayerRoom', () => {
    it('should set nickname before creating room', async () => {
      socket.createRoom.mockResolvedValue({
        room: { code: 'NEW01' },
        player: { isHost: true },
      });

      await multiplayer.createMultiplayerRoom('MyNickname', {});
      expect(socket.setNickname).toHaveBeenCalledWith('MyNickname');
    });

    it('should pass settings to createRoom', async () => {
      socket.createRoom.mockResolvedValue({
        room: { code: 'NEW01' },
        player: { isHost: true },
      });

      await multiplayer.createMultiplayerRoom('Player', { maxPlayers: 10, password: 'secret' });
      expect(socket.createRoom).toHaveBeenCalledWith({ maxPlayers: 10, password: 'secret' });
    });

    it('should throw and show toast on error', async () => {
      socket.createRoom.mockRejectedValue(new Error('Failed'));

      await expect(multiplayer.createMultiplayerRoom('Player')).rejects.toThrow('Failed');
      expect(showToast).toHaveBeenCalledWith('Failed', 'error');
    });

    it('should use default message for errors without message', async () => {
      socket.createRoom.mockRejectedValue({});

      await expect(multiplayer.createMultiplayerRoom('Player')).rejects.toBeDefined();
      expect(showToast).toHaveBeenCalledWith('Failed to create room', 'error');
    });
  });

  describe('joinMultiplayerRoom', () => {
    it('should call socket.joinRoom with correct parameters', async () => {
      socket.joinRoom.mockResolvedValue({
        room: { code: 'JOIN01' },
        you: { nickname: 'Player' },
      });

      await multiplayer.joinMultiplayerRoom('JOIN01', 'Player', 'password123');
      expect(socket.joinRoom).toHaveBeenCalledWith('JOIN01', 'Player', 'password123');
    });

    it('should call without password when not provided', async () => {
      socket.joinRoom.mockResolvedValue({
        room: { code: 'JOIN01' },
        you: { nickname: 'Player' },
      });

      await multiplayer.joinMultiplayerRoom('JOIN01', 'Player');
      expect(socket.joinRoom).toHaveBeenCalledWith('JOIN01', 'Player', null);
    });

    it('should throw and show toast on error', async () => {
      socket.joinRoom.mockRejectedValue(new Error('Room not found'));

      await expect(multiplayer.joinMultiplayerRoom('INVALID', 'Player')).rejects.toThrow();
      expect(showToast).toHaveBeenCalledWith('Room not found', 'error');
    });
  });

  describe('leaveMultiplayerRoom', () => {
    it('should call socket.leaveRoom', () => {
      multiplayer.leaveMultiplayerRoom();
      expect(socket.leaveRoom).toHaveBeenCalled();
    });

    it('should clear room info and reset state', () => {
      state.setMultiplayerMode('multiplayer');
      state.setRoomInfo('ROOM01');
      state.setSpymasterTeam('red');

      multiplayer.leaveMultiplayerRoom();

      expect(state.getMultiplayerState().mode).toBe('standalone');
      expect(state.getMultiplayerState().roomCode).toBeNull();
      expect(state.getPlayerState().spymasterTeam).toBeNull();
    });

    it('should show toast', () => {
      multiplayer.leaveMultiplayerRoom();
      expect(showToast).toHaveBeenCalledWith('Left room', 'info', 2000);
    });
  });

  describe('startMultiplayerGame', () => {
    it('should start game when host', () => {
      state.setMultiplayerHost(true);
      multiplayer.startMultiplayerGame({ seed: 'custom-seed' });
      expect(socket.startGame).toHaveBeenCalledWith({ seed: 'custom-seed' });
    });

    it('should not start game when not host', () => {
      state.setMultiplayerHost(false);
      multiplayer.startMultiplayerGame();
      expect(socket.startGame).not.toHaveBeenCalled();
    });

    it('should show warning when not host', () => {
      state.setMultiplayerHost(false);
      multiplayer.startMultiplayerGame();
      expect(showToast).toHaveBeenCalledWith('Only the host can start the game', 'warning');
    });
  });

  describe('revealMultiplayerCard', () => {
    it('should call socket.revealCard with index', () => {
      multiplayer.revealMultiplayerCard(15);
      expect(socket.revealCard).toHaveBeenCalledWith(15);
    });
  });

  describe('giveMultiplayerClue', () => {
    it('should give clue when spymaster', () => {
      state.setSpymasterTeam('blue');
      multiplayer.giveMultiplayerClue('WATER', 3);
      expect(socket.giveClue).toHaveBeenCalledWith('WATER', 3);
    });

    it('should not give clue when not spymaster', () => {
      state.setSpymasterTeam(null);
      multiplayer.giveMultiplayerClue('WATER', 3);
      expect(socket.giveClue).not.toHaveBeenCalled();
    });

    it('should show warning when not spymaster', () => {
      state.setSpymasterTeam(null);
      multiplayer.giveMultiplayerClue('WATER', 3);
      expect(showToast).toHaveBeenCalledWith('Only spymasters can give clues', 'warning');
    });
  });

  describe('endMultiplayerTurn', () => {
    it('should call socket.endTurn', () => {
      multiplayer.endMultiplayerTurn();
      expect(socket.endTurn).toHaveBeenCalled();
    });
  });

  describe('setMultiplayerTeam', () => {
    it('should call socket.setTeam', () => {
      multiplayer.setMultiplayerTeam('red');
      expect(socket.setTeam).toHaveBeenCalledWith('red');
    });
  });

  describe('setMultiplayerRole', () => {
    it('should call socket.setRole', () => {
      multiplayer.setMultiplayerRole('spymaster');
      expect(socket.setRole).toHaveBeenCalledWith('spymaster');
    });
  });

  describe('kickMultiplayerPlayer', () => {
    it('should kick player when host', () => {
      state.setMultiplayerHost(true);
      multiplayer.kickMultiplayerPlayer('session-123');
      expect(socket.kickPlayer).toHaveBeenCalledWith('session-123');
    });

    it('should not kick player when not host', () => {
      state.setMultiplayerHost(false);
      multiplayer.kickMultiplayerPlayer('session-123');
      expect(socket.kickPlayer).not.toHaveBeenCalled();
    });

    it('should show warning when not host', () => {
      state.setMultiplayerHost(false);
      multiplayer.kickMultiplayerPlayer('session-123');
      expect(showToast).toHaveBeenCalledWith('Only the host can kick players', 'warning');
    });
  });

  describe('forfeitMultiplayerGame', () => {
    it('should call socket.forfeit', () => {
      multiplayer.forfeitMultiplayerGame();
      expect(socket.forfeit).toHaveBeenCalled();
    });
  });

  describe('requestResync', () => {
    it('should call socket.requestResync', () => {
      multiplayer.requestResync();
      expect(socket.requestResync).toHaveBeenCalled();
    });
  });

  describe('re-exports', () => {
    it('should export isConnected from socket', () => {
      expect(multiplayer.isConnected).toBe(socket.isConnected);
    });

    it('should export getRoomCode from socket', () => {
      expect(multiplayer.getRoomCode).toBe(socket.getRoomCode);
    });

    it('should export getPlayer from socket', () => {
      expect(multiplayer.getPlayer).toBe(socket.getPlayer);
    });

    it('should export getStoredNickname from socket', () => {
      expect(multiplayer.getStoredNickname).toBe(socket.getStoredNickname);
    });

    it('should export getStoredRoomCode from socket', () => {
      expect(multiplayer.getStoredRoomCode).toBe(socket.getStoredRoomCode);
    });
  });

  describe('default export', () => {
    it('should include all public functions', () => {
      const defaultExport = multiplayer.default;

      expect(defaultExport).toHaveProperty('initMultiplayer');
      expect(defaultExport).toHaveProperty('connectToServer');
      expect(defaultExport).toHaveProperty('disconnectFromServer');
      expect(defaultExport).toHaveProperty('createMultiplayerRoom');
      expect(defaultExport).toHaveProperty('joinMultiplayerRoom');
      expect(defaultExport).toHaveProperty('leaveMultiplayerRoom');
      expect(defaultExport).toHaveProperty('startMultiplayerGame');
      expect(defaultExport).toHaveProperty('revealMultiplayerCard');
      expect(defaultExport).toHaveProperty('giveMultiplayerClue');
      expect(defaultExport).toHaveProperty('endMultiplayerTurn');
      expect(defaultExport).toHaveProperty('setMultiplayerTeam');
      expect(defaultExport).toHaveProperty('setMultiplayerRole');
      expect(defaultExport).toHaveProperty('kickMultiplayerPlayer');
      expect(defaultExport).toHaveProperty('forfeitMultiplayerGame');
      expect(defaultExport).toHaveProperty('requestResync');
      expect(defaultExport).toHaveProperty('isConnected');
      expect(defaultExport).toHaveProperty('getRoomCode');
      expect(defaultExport).toHaveProperty('getPlayer');
      expect(defaultExport).toHaveProperty('getStoredNickname');
      expect(defaultExport).toHaveProperty('getStoredRoomCode');
    });
  });
});
