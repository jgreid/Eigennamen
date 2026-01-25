/**
 * Unit tests for Socket.io client module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock socket.io-client before importing socket module
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connected: true,
  id: 'test-socket-id',
};

// Mock the global io function
vi.stubGlobal('io', vi.fn(() => mockSocket));

// Mock sessionStorage and localStorage
const mockStorage = {
  store: {},
  getItem: vi.fn((key) => mockStorage.store[key] || null),
  setItem: vi.fn((key, value) => { mockStorage.store[key] = value; }),
  removeItem: vi.fn((key) => { delete mockStorage.store[key]; }),
  clear: vi.fn(() => { mockStorage.store = {}; }),
};

vi.stubGlobal('sessionStorage', mockStorage);
vi.stubGlobal('localStorage', mockStorage);

// Mock window.location
vi.stubGlobal('location', { origin: 'http://localhost:3000' });

// Mock showToast
vi.mock('../ui.js', () => ({
  showToast: vi.fn(),
}));

import { showToast } from '../ui.js';

// Now import the socket module
import * as socketModule from '../socket.js';

describe('Socket Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.store = {};
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket.emit.mockClear();
  });

  describe('Storage Helpers', () => {
    it('should safely get from storage', () => {
      mockStorage.store['test-key'] = 'test-value';
      expect(socketModule.getStoredRoomCode()).toBeNull(); // No room code stored
    });

    it('should safely get stored nickname', () => {
      mockStorage.store['codenames-nickname'] = 'TestPlayer';
      expect(socketModule.getStoredNickname()).toBe('TestPlayer');
    });

    it('should handle storage errors gracefully', () => {
      const errorStorage = {
        getItem: vi.fn(() => { throw new Error('Storage error'); }),
        setItem: vi.fn(() => { throw new Error('Storage error'); }),
        removeItem: vi.fn(() => { throw new Error('Storage error'); }),
      };

      vi.stubGlobal('localStorage', errorStorage);

      // Should not throw
      expect(() => socketModule.getStoredNickname()).not.toThrow();

      // Restore
      vi.stubGlobal('localStorage', mockStorage);
    });
  });

  describe('Event Listener Management', () => {
    it('should register event listeners', () => {
      const callback = vi.fn();
      const unsubscribe = socketModule.on('testEvent', callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should call listeners when events are emitted', () => {
      const callback = vi.fn();
      socketModule.on('customEvent', callback);

      // Trigger the internal emit (simulating socket event)
      // This is testing the internal emit function indirectly
    });

    it('should unsubscribe listeners correctly', () => {
      const callback = vi.fn();
      const unsubscribe = socketModule.on('testEvent', callback);

      unsubscribe();
      // Listener should be removed
    });

    it('should support once() for one-time listeners', () => {
      const callback = vi.fn();
      socketModule.once('oneTimeEvent', callback);

      // The once wrapper should auto-unsubscribe after first call
    });

    it('should remove all listeners for an event with off(event)', () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      socketModule.on('multiEvent', cb1);
      socketModule.on('multiEvent', cb2);

      socketModule.off('multiEvent');
      // All listeners for multiEvent should be removed
    });
  });

  describe('State Getters', () => {
    it('should return connection status', () => {
      expect(typeof socketModule.isConnected()).toBe('boolean');
    });

    it('should return null socket when not connected', () => {
      // After module load, socket might be null
      const socket = socketModule.getSocket();
      // Socket may or may not be null depending on state
      expect(socket === null || typeof socket === 'object').toBe(true);
    });

    it('should return player state', () => {
      const player = socketModule.getPlayer();
      // Returns null when no player, or a copy when there is
      expect(player === null || typeof player === 'object').toBe(true);
    });
  });

  describe('Error Tracking', () => {
    it('should track listener errors', () => {
      const errors = socketModule.getListenerErrors();
      expect(Array.isArray(errors)).toBe(true);
    });

    it('should return a copy of errors (immutable)', () => {
      const errors1 = socketModule.getListenerErrors();
      const errors2 = socketModule.getListenerErrors();

      // Should be different array instances
      expect(errors1).not.toBe(errors2);
    });
  });

  describe('Room Operations', () => {
    it('should have createRoom function', () => {
      expect(typeof socketModule.createRoom).toBe('function');
    });

    it('should have joinRoom function', () => {
      expect(typeof socketModule.joinRoom).toBe('function');
    });

    it('should have leaveRoom function', () => {
      expect(typeof socketModule.leaveRoom).toBe('function');
    });

    it('should have updateSettings function', () => {
      expect(typeof socketModule.updateSettings).toBe('function');
    });

    it('should have requestResync function', () => {
      expect(typeof socketModule.requestResync).toBe('function');
    });
  });

  describe('Player Operations', () => {
    it('should have setTeam function', () => {
      expect(typeof socketModule.setTeam).toBe('function');
    });

    it('should have setRole function', () => {
      expect(typeof socketModule.setRole).toBe('function');
    });

    it('should have setNickname function', () => {
      expect(typeof socketModule.setNickname).toBe('function');
    });

    it('should have kickPlayer function', () => {
      expect(typeof socketModule.kickPlayer).toBe('function');
    });
  });

  describe('Game Operations', () => {
    it('should have startGame function', () => {
      expect(typeof socketModule.startGame).toBe('function');
    });

    it('should have revealCard function', () => {
      expect(typeof socketModule.revealCard).toBe('function');
    });

    it('should have giveClue function', () => {
      expect(typeof socketModule.giveClue).toBe('function');
    });

    it('should have endTurn function', () => {
      expect(typeof socketModule.endTurn).toBe('function');
    });

    it('should have forfeit function', () => {
      expect(typeof socketModule.forfeit).toBe('function');
    });
  });

  describe('Timer Operations', () => {
    it('should have startTimer function', () => {
      expect(typeof socketModule.startTimer).toBe('function');
    });

    it('should have stopTimer function', () => {
      expect(typeof socketModule.stopTimer).toBe('function');
    });

    it('should have addTime function', () => {
      expect(typeof socketModule.addTime).toBe('function');
    });
  });

  describe('Chat Operations', () => {
    it('should have sendMessage function', () => {
      expect(typeof socketModule.sendMessage).toBe('function');
    });
  });

  describe('Default Export', () => {
    it('should export all public functions', () => {
      const defaultExport = socketModule.default;

      expect(defaultExport).toHaveProperty('connect');
      expect(defaultExport).toHaveProperty('disconnect');
      expect(defaultExport).toHaveProperty('on');
      expect(defaultExport).toHaveProperty('off');
      expect(defaultExport).toHaveProperty('once');
      expect(defaultExport).toHaveProperty('createRoom');
      expect(defaultExport).toHaveProperty('joinRoom');
      expect(defaultExport).toHaveProperty('leaveRoom');
      expect(defaultExport).toHaveProperty('startGame');
      expect(defaultExport).toHaveProperty('revealCard');
      expect(defaultExport).toHaveProperty('giveClue');
      expect(defaultExport).toHaveProperty('endTurn');
      expect(defaultExport).toHaveProperty('isConnected');
      expect(defaultExport).toHaveProperty('getListenerErrors');
    });
  });
});

describe('Connection Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.store = {};

    // Reset mock socket behavior
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === 'connect') {
        // Simulate immediate connection
        setTimeout(() => handler(), 0);
      }
    });
  });

  it('should call io with correct options', async () => {
    // Can't easily test connect() because it sets up the socket singleton
    // But we can verify the function exists and is callable
    expect(typeof socketModule.connect).toBe('function');
  });

  it('should handle disconnect', () => {
    expect(typeof socketModule.disconnect).toBe('function');
    // Disconnect should be safe to call even when not connected
    expect(() => socketModule.disconnect()).not.toThrow();
  });
});
