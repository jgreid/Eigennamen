/**
 * Unit tests for UI module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// Set up DOM environment
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="board" class="board" role="grid"></div>
  <div id="role-banner" class="role-banner"></div>
  <div id="turn-indicator" class="turn-indicator"></div>
  <button id="btn-end-turn">End Turn</button>
  <button id="btn-spymaster">Spymaster</button>
  <button id="btn-clicker">Clicker</button>
  <button id="btn-team-red">Red Team</button>
  <button id="btn-team-blue">Blue Team</button>
  <button id="btn-spectate">Spectate</button>
  <span id="red-remaining">9</span>
  <span id="blue-remaining">8</span>
  <span id="red-team-name">Red</span>
  <span id="blue-team-name">Blue</span>
  <input id="share-link" />
  <input id="share-link-input" />
  <div id="sr-announcements" aria-live="polite"></div>
  <div id="toast-container"></div>
  <div id="settings-modal" class="modal-overlay"></div>
  <div id="game-over-modal" class="modal-overlay">
    <div class="modal-content">
      <div id="winner-display"></div>
    </div>
  </div>
  <div id="error-modal" class="modal-overlay">
    <div class="modal-content">
      <div id="error-message"></div>
      <div id="error-details"></div>
    </div>
  </div>
  <div id="word-count"></div>
  <div id="multiplayer-section"></div>
  <div id="mp-standalone"></div>
  <div id="mp-create"></div>
  <div id="mp-join"></div>
  <div id="mp-room"></div>
  <div id="room-code-display"></div>
  <div id="player-count"></div>
  <ul id="player-list"></ul>
  <div id="clue-display">
    <span id="clue-word"></span>
    <span id="clue-number"></span>
    <span id="clue-giver"></span>
  </div>
  <div id="guesses-display"></div>
  <div id="timer-display">
    <span id="timer-time"></span>
    <div id="timer-bar"></div>
  </div>
  <div id="connection-status"></div>
  <button id="btn-start-game">Start Game</button>
  <div id="give-clue-section"></div>
  <button id="btn-forfeit">Forfeit</button>
</body>
</html>
`);

// Set up globals
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.navigator = { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } };

// Import the UI module after DOM setup
import * as ui from '../ui.js';

describe('UI Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.initCachedElements();

    // Clear toast container
    const container = document.getElementById('toast-container');
    if (container) container.innerHTML = '';
  });

  describe('initCachedElements', () => {
    it('should cache DOM elements', () => {
      ui.initCachedElements();
      expect(ui.getElement('board')).toBe(document.getElementById('board'));
    });

    it('should return cached element', () => {
      const board = ui.getElement('board');
      expect(board).not.toBeNull();
      expect(board.id).toBe('board');
    });
  });

  describe('announceToScreenReader', () => {
    it('should update screen reader announcement', () => {
      ui.announceToScreenReader('Test message');
      const announcer = document.getElementById('sr-announcements');
      expect(announcer.textContent).toBe('Test message');
    });

    it('should clear announcement after timeout', async () => {
      vi.useFakeTimers();
      ui.announceToScreenReader('Test message');

      vi.advanceTimersByTime(1500);

      const announcer = document.getElementById('sr-announcements');
      expect(announcer.textContent).toBe('');

      vi.useRealTimers();
    });
  });

  describe('showToast', () => {
    it('should create a toast element', () => {
      const toast = ui.showToast('Test message', 'info');
      expect(toast).not.toBeNull();
      expect(toast.classList.contains('toast')).toBe(true);
      expect(toast.classList.contains('info')).toBe(true);
    });

    it('should add toast to container', () => {
      ui.showToast('Test message');
      const container = document.getElementById('toast-container');
      expect(container.children.length).toBe(1);
    });

    it('should default to error type', () => {
      const toast = ui.showToast('Error message');
      expect(toast.classList.contains('error')).toBe(true);
    });

    it('should support different toast types', () => {
      const types = ['error', 'success', 'warning', 'info'];
      types.forEach(type => {
        const toast = ui.showToast(`${type} message`, type);
        expect(toast.classList.contains(type)).toBe(true);
      });
    });

    it('should enforce max toast count (5)', () => {
      // Add 7 toasts
      for (let i = 0; i < 7; i++) {
        ui.showToast(`Message ${i}`);
      }

      const container = document.getElementById('toast-container');
      // Should have at most 5 toasts (some may be hiding)
      const visibleToasts = container.querySelectorAll('.toast:not(.hiding)');
      expect(visibleToasts.length).toBeLessThanOrEqual(5);
    });

    it('should include close button', () => {
      const toast = ui.showToast('Test');
      const closeBtn = toast.querySelector('[data-action="dismiss-toast"]');
      expect(closeBtn).not.toBeNull();
    });
  });

  describe('dismissToast', () => {
    it('should add hiding class to toast', () => {
      const toast = ui.showToast('Test');
      ui.dismissToast(toast);
      expect(toast.classList.contains('hiding')).toBe(true);
    });

    it('should not dismiss already hiding toast', () => {
      const toast = ui.showToast('Test');
      ui.dismissToast(toast);
      ui.dismissToast(toast); // Second call should be ignored
      // Should not throw
    });

    it('should handle null toast gracefully', () => {
      expect(() => ui.dismissToast(null)).not.toThrow();
    });
  });

  describe('Modal Management', () => {
    it('should open modal', () => {
      ui.openModal('settings-modal');
      const modal = document.getElementById('settings-modal');
      expect(modal.classList.contains('active')).toBe(true);
    });

    it('should close modal', () => {
      ui.openModal('settings-modal');
      ui.closeModal('settings-modal');
      const modal = document.getElementById('settings-modal');
      expect(modal.classList.contains('active')).toBe(false);
    });

    it('should handle non-existent modal', () => {
      expect(() => ui.openModal('nonexistent')).not.toThrow();
      expect(() => ui.closeModal('nonexistent')).not.toThrow();
    });
  });

  describe('showErrorModal', () => {
    it('should display error message', () => {
      ui.showErrorModal('Test error');
      const msgEl = document.getElementById('error-message');
      expect(msgEl.textContent).toBe('Test error');
    });

    it('should display error details when provided', () => {
      ui.showErrorModal('Error', 'Details here');
      const detailsEl = document.getElementById('error-details');
      expect(detailsEl.textContent).toBe('Details here');
      expect(detailsEl.style.display).toBe('block');
    });

    it('should hide details when not provided', () => {
      ui.showErrorModal('Error only');
      const detailsEl = document.getElementById('error-details');
      expect(detailsEl.style.display).toBe('none');
    });
  });

  describe('Board Rendering', () => {
    const mockGameState = {
      words: Array(25).fill(0).map((_, i) => `WORD${i}`),
      types: [
        ...Array(9).fill('red'),
        ...Array(8).fill('blue'),
        ...Array(7).fill('neutral'),
        'assassin'
      ],
      revealed: Array(25).fill(false),
      currentTurn: 'red',
      redScore: 0,
      blueScore: 0,
      redTotal: 9,
      blueTotal: 8,
      gameOver: false,
      winner: null,
    };

    const mockPlayerState = {
      spymasterTeam: null,
      clickerTeam: null,
      playerTeam: null,
      isHost: false,
    };

    const mockTeamNames = { red: 'Red', blue: 'Blue' };

    it('should render 25 cards', () => {
      ui.renderBoard(mockGameState, mockPlayerState, mockTeamNames);
      const board = document.getElementById('board');
      const cards = board.querySelectorAll('.card');
      expect(cards.length).toBe(25);
    });

    it('should show spy classes for spymaster', () => {
      const spymasterPlayerState = { ...mockPlayerState, spymasterTeam: 'red' };
      ui.renderBoard(mockGameState, spymasterPlayerState, mockTeamNames);
      const board = document.getElementById('board');
      const spyCards = board.querySelectorAll('.card[class*="spymaster-"]');
      expect(spyCards.length).toBe(25);
    });

    it('should mark revealed cards', () => {
      const revealedState = {
        ...mockGameState,
        revealed: [true, ...Array(24).fill(false)],
      };
      ui.renderBoard(revealedState, mockPlayerState, mockTeamNames);
      const board = document.getElementById('board');
      const revealedCards = board.querySelectorAll('.card.revealed');
      expect(revealedCards.length).toBe(1);
    });
  });

  describe('resetBoardState', () => {
    it('should reset board initialization flag', () => {
      ui.resetBoardState();
      // Should not throw and allows re-rendering
      expect(() => ui.resetBoardState()).not.toThrow();
    });
  });

  describe('updateScoreboard', () => {
    it('should update remaining counts', () => {
      ui.updateScoreboard({
        redScore: 3,
        blueScore: 2,
        redTotal: 9,
        blueTotal: 8,
      });

      const redRemaining = document.getElementById('red-remaining');
      const blueRemaining = document.getElementById('blue-remaining');

      expect(redRemaining.textContent).toBe('6');
      expect(blueRemaining.textContent).toBe('6');
    });
  });

  describe('updateTeamNameDisplays', () => {
    it('should update team name elements', () => {
      ui.updateTeamNameDisplays({ red: 'Dragons', blue: 'Wizards' });

      const redName = document.getElementById('red-team-name');
      const blueName = document.getElementById('blue-team-name');

      expect(redName.textContent).toBe('Dragons');
      expect(blueName.textContent).toBe('Wizards');
    });
  });

  describe('updateTurnIndicator', () => {
    it('should show current turn', () => {
      ui.updateTurnIndicator(
        { currentTurn: 'red', gameOver: false, winner: null },
        { red: 'Red Team', blue: 'Blue Team' }
      );

      const indicator = document.getElementById('turn-indicator');
      expect(indicator.textContent).toBe("Red Team's turn");
      expect(indicator.classList.contains('red')).toBe(true);
    });

    it('should show winner when game over', () => {
      ui.updateTurnIndicator(
        { currentTurn: 'red', gameOver: true, winner: 'blue' },
        { red: 'Red', blue: 'Blue' }
      );

      const indicator = document.getElementById('turn-indicator');
      expect(indicator.textContent).toBe('Blue wins!');
    });
  });

  describe('updateRoleBanner', () => {
    it('should show spymaster role', () => {
      ui.updateRoleBanner(
        { spymasterTeam: 'red', clickerTeam: null, playerTeam: 'red', isHost: false },
        { red: 'Red', blue: 'Blue' }
      );

      const banner = document.getElementById('role-banner');
      expect(banner.classList.contains('spymaster-red')).toBe(true);
      expect(banner.innerHTML).toContain('Spymaster');
    });

    it('should show clicker role', () => {
      ui.updateRoleBanner(
        { spymasterTeam: null, clickerTeam: 'blue', playerTeam: 'blue', isHost: false },
        { red: 'Red', blue: 'Blue' }
      );

      const banner = document.getElementById('role-banner');
      expect(banner.classList.contains('clicker-blue')).toBe(true);
      expect(banner.innerHTML).toContain('Clicker');
    });

    it('should show host badge when host', () => {
      ui.updateRoleBanner(
        { spymasterTeam: 'red', clickerTeam: null, playerTeam: 'red', isHost: true },
        { red: 'Red', blue: 'Blue' }
      );

      const banner = document.getElementById('role-banner');
      expect(banner.innerHTML).toContain('Host');
    });

    it('should show spectator for no team', () => {
      ui.updateRoleBanner(
        { spymasterTeam: null, clickerTeam: null, playerTeam: null, isHost: false },
        { red: 'Red', blue: 'Blue' }
      );

      const banner = document.getElementById('role-banner');
      expect(banner.classList.contains('viewer')).toBe(true);
    });
  });

  describe('updateControls', () => {
    it('should disable end turn when not clicker', () => {
      ui.updateControls(
        { currentTurn: 'red', gameOver: false },
        { clickerTeam: null, playerTeam: null, spymasterTeam: null }
      );

      const btn = document.getElementById('btn-end-turn');
      expect(btn.disabled).toBe(true);
    });

    it('should enable end turn for current team clicker', () => {
      ui.updateControls(
        { currentTurn: 'red', gameOver: false },
        { clickerTeam: 'red', playerTeam: 'red', spymasterTeam: null }
      );

      const btn = document.getElementById('btn-end-turn');
      expect(btn.disabled).toBe(false);
    });

    it('should disable end turn when game over', () => {
      ui.updateControls(
        { currentTurn: 'red', gameOver: true },
        { clickerTeam: 'red', playerTeam: 'red', spymasterTeam: null }
      );

      const btn = document.getElementById('btn-end-turn');
      expect(btn.disabled).toBe(true);
    });
  });

  describe('showGameOverModal', () => {
    it('should display winner', () => {
      ui.showGameOverModal(
        { winner: 'red' },
        { red: 'Dragons', blue: 'Wizards' }
      );

      const winnerDisplay = document.getElementById('winner-display');
      expect(winnerDisplay.textContent).toBe('Dragons wins!');
    });
  });

  describe('Share Link', () => {
    it('should update share link input', () => {
      ui.updateShareLink('http://test.com/game#abc');

      const shareLinkInput = document.getElementById('share-link-input');
      expect(shareLinkInput.value).toBe('http://test.com/game#abc');
    });

    it('should copy to clipboard', async () => {
      const shareLinkInput = document.getElementById('share-link-input');
      shareLinkInput.value = 'http://test.com';

      const result = await ui.copyShareLink();
      expect(result).toBe(true);
    });
  });

  describe('updateWordCount', () => {
    it('should display word count', () => {
      ui.updateWordCount(50);
      const el = document.getElementById('word-count');
      expect(el.textContent).toBe('50 words');
    });

    it('should handle singular word', () => {
      ui.updateWordCount(1);
      const el = document.getElementById('word-count');
      expect(el.textContent).toBe('1 word');
    });
  });

  describe('Multiplayer UI', () => {
    describe('updateMultiplayerPanel', () => {
      it('should show correct panel for mode', () => {
        ui.updateMultiplayerPanel('create');
        expect(document.getElementById('mp-create').style.display).toBe('block');
        expect(document.getElementById('mp-standalone').style.display).toBe('none');
      });
    });

    describe('updateRoomInfo', () => {
      it('should display room code and player count', () => {
        ui.updateRoomInfo('ABCD', 3);
        expect(document.getElementById('room-code-display').textContent).toBe('ABCD');
        expect(document.getElementById('player-count').textContent).toBe('3 players');
      });

      it('should handle singular player', () => {
        ui.updateRoomInfo('EFGH', 1);
        expect(document.getElementById('player-count').textContent).toBe('1 player');
      });
    });

    describe('renderPlayerList', () => {
      it('should render players', () => {
        const players = [
          { sessionId: '1', nickname: 'Alice', team: 'red', role: 'clicker', isHost: true, connected: true },
          { sessionId: '2', nickname: 'Bob', team: 'blue', role: 'spymaster', isHost: false, connected: true },
        ];

        ui.renderPlayerList(players, '1', true);

        const list = document.getElementById('player-list');
        expect(list.children.length).toBe(2);
        expect(list.innerHTML).toContain('Alice');
        expect(list.innerHTML).toContain('Bob');
      });

      it('should show empty message for no players', () => {
        ui.renderPlayerList([], '1', false);
        const list = document.getElementById('player-list');
        expect(list.innerHTML).toContain('No players');
      });

      it('should show (you) for current player', () => {
        const players = [
          { sessionId: 'me', nickname: 'Me', team: 'red', role: 'clicker', isHost: false, connected: true },
        ];

        ui.renderPlayerList(players, 'me', false);

        const list = document.getElementById('player-list');
        expect(list.innerHTML).toContain('(you)');
      });

      it('should show kick button for host viewing others', () => {
        const players = [
          { sessionId: 'me', nickname: 'Me', team: 'red', role: 'clicker', isHost: true, connected: true },
          { sessionId: 'other', nickname: 'Other', team: 'blue', role: 'clicker', isHost: false, connected: true },
        ];

        ui.renderPlayerList(players, 'me', true);

        const list = document.getElementById('player-list');
        expect(list.innerHTML).toContain('btn-kick');
      });
    });

    describe('updateClueDisplay', () => {
      it('should show clue when provided', () => {
        ui.updateClueDisplay(
          { word: 'ANIMAL', number: 3, team: 'red', spymaster: 'Alice' },
          { red: 'Red', blue: 'Blue' }
        );

        const display = document.getElementById('clue-display');
        expect(display.style.display).toBe('block');
        expect(document.getElementById('clue-word').textContent).toBe('ANIMAL');
        expect(document.getElementById('clue-number').textContent).toBe('3');
      });

      it('should hide when no clue', () => {
        ui.updateClueDisplay(null, { red: 'Red', blue: 'Blue' });
        const display = document.getElementById('clue-display');
        expect(display.style.display).toBe('none');
      });

      it('should show infinity for 0 clue', () => {
        ui.updateClueDisplay(
          { word: 'UNLIMITED', number: 0, team: 'blue', spymaster: 'Bob' },
          { red: 'Red', blue: 'Blue' }
        );

        expect(document.getElementById('clue-number').textContent).toBe('∞');
      });
    });

    describe('updateGuessesDisplay', () => {
      it('should show guesses used and allowed', () => {
        ui.updateGuessesDisplay(2, 4);
        const display = document.getElementById('guesses-display');
        expect(display.textContent).toBe('Guesses: 2 / 4');
      });

      it('should show infinity for unlimited', () => {
        ui.updateGuessesDisplay(1, Infinity);
        const display = document.getElementById('guesses-display');
        expect(display.textContent).toBe('Guesses: 1 / ∞');
      });
    });

    describe('updateTimerDisplay', () => {
      it('should show timer when running', () => {
        ui.updateTimerDisplay({ remaining: 65, total: 120, running: true });
        const display = document.getElementById('timer-display');
        expect(display.style.display).toBe('flex');
        expect(document.getElementById('timer-time').textContent).toBe('1:05');
      });

      it('should hide when no timer', () => {
        ui.updateTimerDisplay(null);
        const display = document.getElementById('timer-display');
        expect(display.style.display).toBe('none');
      });

      it('should add danger class when low', () => {
        ui.updateTimerDisplay({ remaining: 5, total: 120, running: true });
        const bar = document.getElementById('timer-bar');
        expect(bar.classList.contains('danger')).toBe(true);
      });
    });

    describe('showConnectionStatus', () => {
      it('should show connected status', () => {
        ui.showConnectionStatus(true);
        const status = document.getElementById('connection-status');
        expect(status.classList.contains('connected')).toBe(true);
        expect(status.textContent).toBe('Connected');
      });

      it('should show disconnected status', () => {
        ui.showConnectionStatus(false);
        const status = document.getElementById('connection-status');
        expect(status.classList.contains('disconnected')).toBe(true);
        expect(status.textContent).toBe('Disconnected');
      });
    });

    describe('updateMultiplayerControls', () => {
      it('should show start button for host before game', () => {
        ui.updateMultiplayerControls({
          isHost: true,
          isSpymaster: false,
          isClicker: false,
          isMyTurn: false,
          gameInProgress: false,
          gameOver: false,
        });

        const startBtn = document.getElementById('btn-start-game');
        expect(startBtn.style.display).toBe('inline-block');
      });

      it('should hide start button during game', () => {
        ui.updateMultiplayerControls({
          isHost: true,
          isSpymaster: false,
          isClicker: false,
          isMyTurn: false,
          gameInProgress: true,
          gameOver: false,
        });

        const startBtn = document.getElementById('btn-start-game');
        expect(startBtn.style.display).toBe('none');
      });
    });

    describe('showMultiplayerSection', () => {
      it('should show/hide multiplayer section', () => {
        ui.showMultiplayerSection(true);
        expect(document.getElementById('multiplayer-section').style.display).toBe('block');

        ui.showMultiplayerSection(false);
        expect(document.getElementById('multiplayer-section').style.display).toBe('none');
      });
    });
  });

  describe('Default Export', () => {
    it('should export all public functions', () => {
      const defaultExport = ui.default;

      expect(defaultExport).toHaveProperty('initCachedElements');
      expect(defaultExport).toHaveProperty('showToast');
      expect(defaultExport).toHaveProperty('dismissToast');
      expect(defaultExport).toHaveProperty('openModal');
      expect(defaultExport).toHaveProperty('closeModal');
      expect(defaultExport).toHaveProperty('renderBoard');
      expect(defaultExport).toHaveProperty('updateScoreboard');
      expect(defaultExport).toHaveProperty('updateRoleBanner');
      expect(defaultExport).toHaveProperty('renderPlayerList');
      expect(defaultExport).toHaveProperty('updateClueDisplay');
      expect(defaultExport).toHaveProperty('updateTimerDisplay');
    });
  });
});
