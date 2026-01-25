/**
 * Unit tests for game state management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_WORDS,
  subscribe,
  getGameState,
  getPlayerState,
  getWordListState,
  getTeamNames,
  getMultiplayerState,
  isMultiplayerMode,
  initGame,
  initGameWithWords,
  revealCard,
  endTurn,
  setCardRevealed,
  setCurrentTurn,
  checkGameOver,
  resetGameState,
  setIsHost,
  setSpymasterTeam,
  setClickerTeam,
  setPlayerTeam,
  resetPlayerRoles,
  setActiveWords,
  setWordListMode,
  setCustomWordsList,
  updateActiveWordsFromMode,
  setTeamName,
  setTeamNames,
  resetTeamNames,
  saveGameToHistory,
  loadGameHistory,
  getGameHistory,
  clearGameHistory,
  // Multiplayer state
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
  resetMultiplayerState,
} from '../state.js';
import { BOARD_SIZE } from '../constants.js';

describe('Game State', () => {
  beforeEach(() => {
    resetGameState();
    resetPlayerRoles();
    resetTeamNames();
    clearGameHistory();
  });

  describe('initGame', () => {
    it('should initialize game with seed', () => {
      const success = initGame('test-seed');
      expect(success).toBe(true);

      const state = getGameState();
      expect(state.seed).toBe('test-seed');
      expect(state.words).toHaveLength(BOARD_SIZE);
      expect(state.types).toHaveLength(BOARD_SIZE);
      expect(state.revealed).toHaveLength(BOARD_SIZE);
    });

    it('should fail with insufficient words', () => {
      const shortList = ['A', 'B', 'C'];
      const success = initGame('test', shortList);
      expect(success).toBe(false);
    });

    it('should be deterministic', () => {
      initGame('seed123');
      const state1 = getGameState();

      resetGameState();
      initGame('seed123');
      const state2 = getGameState();

      expect(state1.words).toEqual(state2.words);
      expect(state1.types).toEqual(state2.types);
      expect(state1.currentTurn).toEqual(state2.currentTurn);
    });

    it('should set up correct card distribution', () => {
      initGame('test-seed');
      const state = getGameState();

      const redCount = state.types.filter(t => t === 'red').length;
      const blueCount = state.types.filter(t => t === 'blue').length;
      const neutralCount = state.types.filter(t => t === 'neutral').length;
      const assassinCount = state.types.filter(t => t === 'assassin').length;

      expect(redCount + blueCount).toBe(17); // 9 + 8
      expect(neutralCount).toBe(7);
      expect(assassinCount).toBe(1);
    });
  });

  describe('initGameWithWords', () => {
    it('should use provided words for board', () => {
      const words = Array(BOARD_SIZE).fill(0).map((_, i) => `WORD${i}`);
      const success = initGameWithWords('test-seed', words);

      expect(success).toBe(true);
      expect(getGameState().words).toEqual(words);
      expect(getGameState().customWords).toBe(true);
    });

    it('should fail with wrong word count', () => {
      const words = ['A', 'B', 'C'];
      const success = initGameWithWords('test', words);
      expect(success).toBe(false);
    });
  });

  describe('revealCard', () => {
    beforeEach(() => {
      initGame('reveal-test');
    });

    it('should reveal a card', () => {
      const result = revealCard(0);

      expect(result).not.toBeNull();
      expect(result.index).toBe(0);
      expect(getGameState().revealed[0]).toBe(true);
    });

    it('should not reveal already revealed card', () => {
      revealCard(0);
      const result = revealCard(0);
      expect(result).toBeNull();
    });

    it('should update score for team cards', () => {
      const state = getGameState();
      const redIndex = state.types.findIndex(t => t === 'red');

      revealCard(redIndex);
      expect(getGameState().redScore).toBe(1);
    });

    it('should end turn on neutral', () => {
      const state = getGameState();
      const neutralIndex = state.types.findIndex(t => t === 'neutral');
      const initialTurn = state.currentTurn;

      const result = revealCard(neutralIndex);

      expect(result.turnEnded).toBe(true);
      expect(getGameState().currentTurn).not.toBe(initialTurn);
    });

    it('should end game on assassin', () => {
      const state = getGameState();
      const assassinIndex = state.types.findIndex(t => t === 'assassin');

      const result = revealCard(assassinIndex);

      expect(result.gameOver).toBe(true);
      expect(result.reason).toBe('assassin');
      expect(getGameState().gameOver).toBe(true);
    });

    it('should not reveal when game is over', () => {
      const state = getGameState();
      const assassinIndex = state.types.findIndex(t => t === 'assassin');
      revealCard(assassinIndex);

      const result = revealCard(0);
      expect(result).toBeNull();
    });
  });

  describe('endTurn', () => {
    beforeEach(() => {
      initGame('turn-test');
    });

    it('should switch turn', () => {
      const initialTurn = getGameState().currentTurn;
      endTurn();
      expect(getGameState().currentTurn).not.toBe(initialTurn);
    });

    it('should alternate turns', () => {
      const turn1 = getGameState().currentTurn;
      endTurn();
      const turn2 = getGameState().currentTurn;
      endTurn();
      const turn3 = getGameState().currentTurn;

      expect(turn1).not.toBe(turn2);
      expect(turn1).toBe(turn3);
    });
  });

  describe('subscription', () => {
    it('should notify listeners on state change', () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(callback);

      initGame('sub-test');

      expect(callback).toHaveBeenCalled();
      unsubscribe();
    });

    it('should allow unsubscription', () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(callback);
      unsubscribe();

      initGame('unsub-test');

      // Callback should have been called once during init, then no more after unsub
      const callCount = callback.mock.calls.length;
      initGame('unsub-test-2');
      expect(callback.mock.calls.length).toBe(callCount);
    });
  });
});

describe('Player State', () => {
  beforeEach(() => {
    resetPlayerRoles();
  });

  describe('setIsHost', () => {
    it('should set host status', () => {
      setIsHost(true);
      expect(getPlayerState().isHost).toBe(true);

      setIsHost(false);
      expect(getPlayerState().isHost).toBe(false);
    });
  });

  describe('setSpymasterTeam', () => {
    it('should set spymaster team', () => {
      setSpymasterTeam('red');
      expect(getPlayerState().spymasterTeam).toBe('red');
    });

    it('should clear clicker when becoming spymaster', () => {
      setClickerTeam('blue');
      setSpymasterTeam('red');

      const state = getPlayerState();
      expect(state.spymasterTeam).toBe('red');
      expect(state.clickerTeam).toBeNull();
    });

    it('should set player team when becoming spymaster', () => {
      setSpymasterTeam('blue');
      expect(getPlayerState().playerTeam).toBe('blue');
    });
  });

  describe('setClickerTeam', () => {
    it('should set clicker team', () => {
      setClickerTeam('blue');
      expect(getPlayerState().clickerTeam).toBe('blue');
    });

    it('should clear spymaster when becoming clicker', () => {
      setSpymasterTeam('red');
      setClickerTeam('blue');

      const state = getPlayerState();
      expect(state.clickerTeam).toBe('blue');
      expect(state.spymasterTeam).toBeNull();
    });
  });

  describe('resetPlayerRoles', () => {
    it('should clear roles but keep team', () => {
      setPlayerTeam('red');
      setSpymasterTeam('red');
      resetPlayerRoles();

      const state = getPlayerState();
      expect(state.spymasterTeam).toBeNull();
      expect(state.clickerTeam).toBeNull();
      expect(state.playerTeam).toBe('red');
    });
  });
});

describe('Word List State', () => {
  beforeEach(() => {
    setCustomWordsList([]);
    setWordListMode('combined');
  });

  describe('setActiveWords', () => {
    it('should set active words', () => {
      const words = ['A', 'B', 'C'];
      setActiveWords(words, 'custom');

      const state = getWordListState();
      expect(state.activeWords).toEqual(words);
      expect(state.wordSource).toBe('custom');
    });
  });

  describe('setWordListMode', () => {
    it('should set word list mode', () => {
      setWordListMode('custom');
      expect(getWordListState().wordListMode).toBe('custom');
    });

    it('should ignore invalid modes', () => {
      setWordListMode('invalid');
      expect(getWordListState().wordListMode).toBe('combined');
    });
  });

  describe('updateActiveWordsFromMode', () => {
    it('should use default words in default mode', () => {
      setWordListMode('default');
      updateActiveWordsFromMode();

      expect(getWordListState().activeWords).toEqual(DEFAULT_WORDS);
    });

    it('should use custom words in custom mode', () => {
      const custom = ['A', 'B', 'C'];
      setCustomWordsList(custom);
      setWordListMode('custom');
      updateActiveWordsFromMode();

      expect(getWordListState().activeWords).toEqual(custom);
    });

    it('should combine words in combined mode', () => {
      const custom = ['CUSTOM1', 'CUSTOM2'];
      setCustomWordsList(custom);
      setWordListMode('combined');
      updateActiveWordsFromMode();

      const active = getWordListState().activeWords;
      expect(active).toContain('CUSTOM1');
      expect(active).toContain('AFRICA'); // From DEFAULT_WORDS
    });
  });
});

describe('Team Names', () => {
  beforeEach(() => {
    resetTeamNames();
  });

  describe('setTeamName', () => {
    it('should set individual team name', () => {
      setTeamName('red', 'Dragons');
      expect(getTeamNames().red).toBe('Dragons');
      expect(getTeamNames().blue).toBe('Blue');
    });
  });

  describe('setTeamNames', () => {
    it('should set both team names', () => {
      setTeamNames({ red: 'Dragons', blue: 'Wizards' });
      expect(getTeamNames().red).toBe('Dragons');
      expect(getTeamNames().blue).toBe('Wizards');
    });
  });

  describe('resetTeamNames', () => {
    it('should reset to defaults', () => {
      setTeamNames({ red: 'Dragons', blue: 'Wizards' });
      resetTeamNames();
      expect(getTeamNames()).toEqual({ red: 'Red', blue: 'Blue' });
    });
  });
});

describe('Game History', () => {
  beforeEach(() => {
    clearGameHistory();
    resetGameState();
  });

  it('should not save non-finished games', () => {
    initGame('history-test');
    saveGameToHistory();
    expect(getGameHistory()).toHaveLength(0);
  });

  it('should save finished games', () => {
    initGame('history-test');
    // Find and reveal assassin to end game
    const state = getGameState();
    const assassinIndex = state.types.findIndex(t => t === 'assassin');
    revealCard(assassinIndex);

    saveGameToHistory();
    expect(getGameHistory()).toHaveLength(1);
  });

  it('should limit history size', () => {
    for (let i = 0; i < 15; i++) {
      initGame(`history-${i}`);
      const state = getGameState();
      const assassinIndex = state.types.findIndex(t => t === 'assassin');
      revealCard(assassinIndex);
      saveGameToHistory();
    }

    expect(getGameHistory().length).toBeLessThanOrEqual(10);
  });

  it('should clear history', () => {
    initGame('clear-test');
    const state = getGameState();
    const assassinIndex = state.types.findIndex(t => t === 'assassin');
    revealCard(assassinIndex);
    saveGameToHistory();

    clearGameHistory();
    expect(getGameHistory()).toHaveLength(0);
  });
});

describe('Multiplayer State', () => {
  beforeEach(() => {
    resetMultiplayerState();
  });

  describe('getMultiplayerState', () => {
    it('should return initial multiplayer state', () => {
      const state = getMultiplayerState();

      expect(state.mode).toBe('standalone');
      expect(state.connected).toBe(false);
      expect(state.roomCode).toBeNull();
      expect(state.players).toEqual([]);
      expect(state.isHost).toBe(false);
      expect(state.currentClue).toBeNull();
      expect(state.timer).toBeNull();
    });

    it('should return a copy (immutable)', () => {
      const state1 = getMultiplayerState();
      state1.players.push({ sessionId: 'fake' });

      const state2 = getMultiplayerState();
      expect(state2.players).toHaveLength(0);
    });
  });

  describe('isMultiplayerMode', () => {
    it('should return false by default', () => {
      expect(isMultiplayerMode()).toBe(false);
    });

    it('should return true when in multiplayer mode', () => {
      setMultiplayerMode('multiplayer');
      expect(isMultiplayerMode()).toBe(true);
    });
  });

  describe('setMultiplayerMode', () => {
    it('should set multiplayer mode', () => {
      setMultiplayerMode('multiplayer');
      expect(getMultiplayerState().mode).toBe('multiplayer');
    });

    it('should set standalone mode', () => {
      setMultiplayerMode('multiplayer');
      setMultiplayerMode('standalone');
      expect(getMultiplayerState().mode).toBe('standalone');
    });
  });

  describe('setConnected', () => {
    it('should set connection status', () => {
      setConnected(true);
      expect(getMultiplayerState().connected).toBe(true);

      setConnected(false);
      expect(getMultiplayerState().connected).toBe(false);
    });
  });

  describe('setRoomInfo', () => {
    it('should set room code', () => {
      setRoomInfo('ABCD');
      expect(getMultiplayerState().roomCode).toBe('ABCD');
    });

    it('should set room code and password', () => {
      setRoomInfo('EFGH', 'secret123');
      const state = getMultiplayerState();
      expect(state.roomCode).toBe('EFGH');
      expect(state.roomPassword).toBe('secret123');
    });
  });

  describe('clearRoomInfo', () => {
    it('should clear all room-related state', () => {
      setRoomInfo('ABCD', 'pass');
      setPlayers([{ sessionId: '1', nickname: 'Test' }]);
      setCurrentClue({ word: 'test', number: 2, team: 'red' });

      clearRoomInfo();

      const state = getMultiplayerState();
      expect(state.roomCode).toBeNull();
      expect(state.roomPassword).toBeNull();
      expect(state.players).toEqual([]);
      expect(state.currentClue).toBeNull();
    });
  });

  describe('Player Management', () => {
    const player1 = { sessionId: 'session1', nickname: 'Alice', team: 'red', role: 'clicker' };
    const player2 = { sessionId: 'session2', nickname: 'Bob', team: 'blue', role: 'spymaster' };

    describe('setPlayers', () => {
      it('should set players list', () => {
        setPlayers([player1, player2]);
        expect(getMultiplayerState().players).toHaveLength(2);
        expect(getMultiplayerState().players[0].nickname).toBe('Alice');
      });

      it('should replace existing players', () => {
        setPlayers([player1]);
        setPlayers([player2]);
        expect(getMultiplayerState().players).toHaveLength(1);
        expect(getMultiplayerState().players[0].nickname).toBe('Bob');
      });
    });

    describe('addPlayer', () => {
      it('should add a new player', () => {
        addPlayer(player1);
        expect(getMultiplayerState().players).toHaveLength(1);
        expect(getMultiplayerState().players[0].sessionId).toBe('session1');
      });

      it('should not add duplicate players', () => {
        addPlayer(player1);
        addPlayer(player1);
        expect(getMultiplayerState().players).toHaveLength(1);
      });

      it('should add multiple unique players', () => {
        addPlayer(player1);
        addPlayer(player2);
        expect(getMultiplayerState().players).toHaveLength(2);
      });
    });

    describe('removePlayer', () => {
      it('should remove a player by sessionId', () => {
        setPlayers([player1, player2]);
        removePlayer('session1');

        const players = getMultiplayerState().players;
        expect(players).toHaveLength(1);
        expect(players[0].sessionId).toBe('session2');
      });

      it('should handle removing non-existent player', () => {
        setPlayers([player1]);
        removePlayer('nonexistent');
        expect(getMultiplayerState().players).toHaveLength(1);
      });
    });

    describe('updatePlayer', () => {
      it('should update player properties', () => {
        setPlayers([player1]);
        updatePlayer('session1', { team: 'blue', role: 'spymaster' });

        const player = getMultiplayerState().players[0];
        expect(player.team).toBe('blue');
        expect(player.role).toBe('spymaster');
        expect(player.nickname).toBe('Alice'); // Unchanged
      });

      it('should handle updating non-existent player', () => {
        setPlayers([player1]);
        updatePlayer('nonexistent', { team: 'blue' });

        // Should not throw, player1 should be unchanged
        expect(getMultiplayerState().players[0].team).toBe('red');
      });
    });
  });

  describe('setMultiplayerHost', () => {
    it('should set host status in multiplayer state', () => {
      setMultiplayerHost(true);
      expect(getMultiplayerState().isHost).toBe(true);
    });

    it('should also update player state', () => {
      setMultiplayerHost(true);
      expect(getPlayerState().isHost).toBe(true);
    });
  });

  describe('Clue Management', () => {
    describe('setCurrentClue', () => {
      it('should set current clue', () => {
        const clue = { word: 'ANIMAL', number: 3, team: 'red', spymaster: 'Alice' };
        setCurrentClue(clue);

        const state = getMultiplayerState();
        expect(state.currentClue).toEqual(clue);
      });

      it('should set guesses allowed to number + 1', () => {
        setCurrentClue({ word: 'TEST', number: 2, team: 'blue' });
        expect(getMultiplayerState().guessesAllowed).toBe(3);
      });

      it('should set infinite guesses for 0 clue', () => {
        setCurrentClue({ word: 'UNLIMITED', number: 0, team: 'red' });
        expect(getMultiplayerState().guessesAllowed).toBe(Infinity);
      });

      it('should reset guesses used', () => {
        setCurrentClue({ word: 'FIRST', number: 2, team: 'red' });
        incrementGuessesUsed();
        incrementGuessesUsed();

        setCurrentClue({ word: 'SECOND', number: 3, team: 'blue' });
        expect(getMultiplayerState().guessesUsed).toBe(0);
      });

      it('should clear clue when set to null', () => {
        setCurrentClue({ word: 'TEST', number: 2, team: 'red' });
        setCurrentClue(null);

        const state = getMultiplayerState();
        expect(state.currentClue).toBeNull();
        expect(state.guessesAllowed).toBe(0);
      });
    });

    describe('incrementGuessesUsed', () => {
      it('should increment guesses used', () => {
        setCurrentClue({ word: 'TEST', number: 3, team: 'red' });
        incrementGuessesUsed();
        expect(getMultiplayerState().guessesUsed).toBe(1);

        incrementGuessesUsed();
        expect(getMultiplayerState().guessesUsed).toBe(2);
      });
    });
  });

  describe('Timer Management', () => {
    describe('setTimer', () => {
      it('should set timer state', () => {
        const timer = { remaining: 60, total: 120, running: true };
        setTimer(timer);

        expect(getMultiplayerState().timer).toEqual(timer);
      });

      it('should clear timer when set to null', () => {
        setTimer({ remaining: 60, total: 120, running: true });
        setTimer(null);

        expect(getMultiplayerState().timer).toBeNull();
      });

      it('should return a copy (immutable)', () => {
        const timer = { remaining: 60, total: 120, running: true };
        setTimer(timer);

        const state1 = getMultiplayerState();
        state1.timer.remaining = 30;

        const state2 = getMultiplayerState();
        expect(state2.timer.remaining).toBe(60);
      });
    });
  });

  describe('Room Settings', () => {
    describe('updateRoomSettings', () => {
      it('should update room settings', () => {
        updateRoomSettings({ turnTimeLimit: 120 });
        expect(getMultiplayerState().settings.turnTimeLimit).toBe(120);
      });

      it('should merge with existing settings', () => {
        updateRoomSettings({ turnTimeLimit: 120 });
        updateRoomSettings({ strictSpymaster: true });

        const settings = getMultiplayerState().settings;
        expect(settings.turnTimeLimit).toBe(120);
        expect(settings.strictSpymaster).toBe(true);
        expect(settings.allowSpectators).toBe(true); // Default unchanged
      });
    });
  });

  describe('resetMultiplayerState', () => {
    it('should reset all multiplayer state to initial values', () => {
      setMultiplayerMode('multiplayer');
      setConnected(true);
      setRoomInfo('ABCD', 'pass');
      setPlayers([{ sessionId: '1', nickname: 'Test' }]);
      setMultiplayerHost(true);
      setCurrentClue({ word: 'TEST', number: 2, team: 'red' });
      setTimer({ remaining: 60, total: 120, running: true });
      updateRoomSettings({ turnTimeLimit: 120 });

      resetMultiplayerState();

      const state = getMultiplayerState();
      expect(state.mode).toBe('standalone');
      expect(state.connected).toBe(false);
      expect(state.roomCode).toBeNull();
      expect(state.players).toEqual([]);
      expect(state.isHost).toBe(false);
      expect(state.currentClue).toBeNull();
      expect(state.timer).toBeNull();
      expect(state.settings.turnTimeLimit).toBe(0);
    });
  });

  describe('State Notifications', () => {
    it('should notify listeners on mode change', () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(callback);

      setMultiplayerMode('multiplayer');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'modeChange', mode: 'multiplayer' })
      );
      unsubscribe();
    });

    it('should notify listeners on player join', () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(callback);

      addPlayer({ sessionId: '1', nickname: 'Test' });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'playerJoined' })
      );
      unsubscribe();
    });

    it('should notify listeners on player leave', () => {
      const callback = vi.fn();
      setPlayers([{ sessionId: '1', nickname: 'Test' }]);

      const unsubscribe = subscribe(callback);
      removePlayer('1');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'playerLeft', sessionId: '1' })
      );
      unsubscribe();
    });

    it('should notify listeners on clue change', () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(callback);

      setCurrentClue({ word: 'TEST', number: 2, team: 'red' });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'clueChange' })
      );
      unsubscribe();
    });

    it('should notify listeners on connection change', () => {
      const callback = vi.fn();
      const unsubscribe = subscribe(callback);

      setConnected(true);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'connectionChange', connected: true })
      );
      unsubscribe();
    });
  });
});
