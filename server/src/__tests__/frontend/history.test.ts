/**
 * Frontend History Module Tests
 *
 * Tests exports from src/frontend/history.ts:
 * renderGameHistory, renderReplayData, applyReplayState,
 * renderReplayEventLog, updateReplayControls, toggleReplayPlayback,
 * cycleReplaySpeed, closeReplay, setupHistoryEventDelegation.
 * Test environment: jsdom
 */

const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
const mockShowToast = jest.fn();
jest.mock('../../frontend/ui', () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal,
    showToast: mockShowToast,
}));

jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: true,
        currentReplayData: null,
        currentReplayIndex: -1,
        replayPlaying: false,
        replayInterval: null,
        historyDelegationSetup: false,
        currentRoomId: 'TESTROOM',
        gameState: { status: 'playing' },
    },
}));

jest.mock('../../frontend/i18n', () => ({
    t: jest.fn((key, params) => {
        if (key === 'history.teamWins') return `${params?.team} wins!`;
        if (key === 'history.moveStats') return `${params?.moves} moves, ${params?.clues} clues`;
        if (key === 'history.clueCount') return `${params?.count} clues`;
        if (key === 'history.endReason.completed') return 'Completed';
        if (key === 'history.endReason.assassin') return 'Assassin';
        if (key === 'history.endReason.forfeit') return 'Forfeit';
        if (key === 'history.moveProgress') return `${params?.current}/${params?.total}`;
        if (key === 'history.loadingReplay') return 'Loading replay...';
        if (key === 'history.loading') return 'Loading...';
        if (key === 'history.noEvents') return 'No events';
        if (key === 'history.gaveClue') return 'gave clue';
        if (key === 'history.revealed') return 'revealed';
        if (key === 'history.endedTurn') return 'ended turn';
        if (key === 'history.forfeited') return 'forfeited';
        if (key === 'history.replayBoard') return 'Replay Board';
        if (key === 'history.cardLabel') return `Card ${params?.number}: ${params?.word}`;
        if (key === 'history.duration') return `${params?.duration}, ${params?.moves} moves`;
        if (key === 'toast.replaySpeed') return `Speed: ${params?.speed}`;
        return key;
    }),
}));

jest.mock('../../frontend/utils', () => ({
    formatGameTimestamp: jest.fn((ts) => new Date(ts).toLocaleDateString()),
    formatDuration: jest.fn((ms) => `${Math.floor(ms / 60000)}m`),
    formatShortDuration: jest.fn((ms) => `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`),
    copyToClipboard: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: jest.fn(() => ({ getRoomCode: () => 'TESTROOM' })),
}));

// Mock EigennamenClient global
(global as any).EigennamenClient = {
    isConnected: jest.fn(() => true),
    getGameHistory: jest.fn(),
    getReplay: jest.fn(),
};

import {
    renderGameHistory,
    renderReplayData,
    applyReplayState,
    renderReplayEventLog,
    updateReplayControls,
    toggleReplayPlayback,
    cycleReplaySpeed,
    closeReplay,
    setupHistoryEventDelegation,
    openGameHistory,
    closeGameHistory,
    openReplay,
    renderReplayBoard,
    scrollToCurrentEvent,
    copyReplayLink,
    checkURLForReplayLoad,
} from '../../frontend/history';
import { state } from '../../frontend/state';
import type { GameHistoryEntry, ReplayData } from '../../frontend/multiplayerTypes';

describe('history module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        state.currentReplayData = null;
        state.currentReplayIndex = -1;
        state.replayPlaying = false;
        if (state.replayInterval) {
            clearInterval(state.replayInterval);
            state.replayInterval = null;
        }
        state.historyDelegationSetup = false;
        document.body.innerHTML = '';
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('renderGameHistory', () => {
        test('shows empty state when no games', () => {
            setupHistoryDOM();
            renderGameHistory([]);
            expect(document.getElementById('history-empty')!.hidden).toBe(false);
            expect(document.getElementById('history-list')!.hidden).toBe(true);
        });

        test('hides loading indicator', () => {
            setupHistoryDOM();
            renderGameHistory([]);
            expect(document.getElementById('history-loading')!.hidden).toBe(true);
        });

        test('renders game history items', () => {
            setupHistoryDOM();
            const games: GameHistoryEntry[] = [
                createHistoryEntry('game1', 'red', 5, 3, 10, 4),
                createHistoryEntry('game2', 'blue', 4, 6, 15, 5),
            ];
            renderGameHistory(games);

            const items = document.querySelectorAll('.history-item');
            expect(items).toHaveLength(2);
        });

        test('displays winner information', () => {
            setupHistoryDOM();
            renderGameHistory([createHistoryEntry('g1', 'red', 9, 3, 12, 5)]);

            const winner = document.querySelector('.history-item-winner');
            expect(winner!.textContent).toContain('Red wins!');
        });

        test('displays score information', () => {
            setupHistoryDOM();
            renderGameHistory([createHistoryEntry('g1', 'red', 9, 3, 12, 5)]);

            const redScore = document.querySelector('.red-score');
            const blueScore = document.querySelector('.blue-score');
            expect(redScore!.textContent).toBe('9');
            expect(blueScore!.textContent).toBe('3');
        });

        test('displays end reason, duration, and clue count', () => {
            setupHistoryDOM();
            renderGameHistory([createHistoryEntry('g1', 'red', 9, 3, 12, 5)]);

            const details = document.querySelector('.history-item-details');
            expect(details!.textContent).toContain('5 clues');
        });

        test('sets game ID on history items', () => {
            setupHistoryDOM();
            renderGameHistory([createHistoryEntry('unique-game-id', 'blue', 4, 8, 20, 8)]);

            const item = document.querySelector('.history-item') as HTMLElement;
            expect(item.dataset.gameId).toBe('unique-game-id');
        });

        test('handles entries with missing optional fields gracefully', () => {
            setupHistoryDOM();
            const minimalEntry: GameHistoryEntry = { id: 'minimal-game' };
            renderGameHistory([minimalEntry]);

            const items = document.querySelectorAll('.history-item');
            expect(items).toHaveLength(1);
            expect((items[0] as HTMLElement).dataset.gameId).toBe('minimal-game');
        });

        test('renders multiple games in order', () => {
            setupHistoryDOM();
            const games: GameHistoryEntry[] = [
                createHistoryEntry('first', 'red', 9, 2, 8, 3),
                createHistoryEntry('second', 'blue', 3, 8, 12, 5),
                createHistoryEntry('third', 'red', 9, 4, 15, 6),
            ];
            renderGameHistory(games);

            const items = document.querySelectorAll('.history-item');
            expect(items).toHaveLength(3);
            expect((items[0] as HTMLElement).dataset.gameId).toBe('first');
            expect((items[1] as HTMLElement).dataset.gameId).toBe('second');
            expect((items[2] as HTMLElement).dataset.gameId).toBe('third');
        });

        test('re-rendering replaces previous history items', () => {
            setupHistoryDOM();
            renderGameHistory([createHistoryEntry('game1', 'red', 9, 3, 10, 4)]);
            expect(document.querySelectorAll('.history-item')).toHaveLength(1);

            // Re-render with different data
            renderGameHistory([
                createHistoryEntry('game2', 'blue', 4, 8, 20, 7),
                createHistoryEntry('game3', 'red', 9, 1, 5, 2),
            ]);
            const items = document.querySelectorAll('.history-item');
            expect(items).toHaveLength(2);
            expect((items[0] as HTMLElement).dataset.gameId).toBe('game2');
        });
    });

    describe('renderReplayData', () => {
        test('stores data in state', () => {
            setupReplayDOM();
            const data = createReplayData();
            renderReplayData(data);
            expect(state.currentReplayData).toBe(data);
            expect(state.currentReplayIndex).toBe(-1);
        });

        test('shows info message when data is null', () => {
            setupReplayDOM();
            renderReplayData(null as any);
            expect(document.getElementById('replay-info')!.textContent).toContain('history.couldNotLoad');
        });

        test('displays winner badge', () => {
            setupReplayDOM();
            renderReplayData(createReplayData());
            const badge = document.querySelector('.winner-badge');
            expect(badge).not.toBeNull();
            expect(badge!.textContent).toContain('wins');
        });

        test('initializes replay board with words', () => {
            setupReplayDOM();
            renderReplayData(createReplayData());
            const cards = document.querySelectorAll('.replay-card');
            expect(cards).toHaveLength(25);
        });
    });

    describe('applyReplayState', () => {
        test('resets all cards when index is -1', () => {
            setupReplayDOM();
            const data = createReplayData();
            renderReplayData(data);

            // All cards should have just 'replay-card' class
            const cards = document.querySelectorAll('.replay-card');
            cards.forEach((card) => {
                expect(card.className).toBe('replay-card');
            });
        });

        test('reveals cards up to current index', () => {
            setupReplayDOM();
            const data = createReplayData();
            data.events = [
                { type: 'reveal', data: { index: 0, type: 'red', word: 'APPLE', team: 'red' } },
                { type: 'reveal', data: { index: 1, type: 'blue', word: 'BANANA', team: 'blue' } },
            ];
            renderReplayData(data);

            state.currentReplayIndex = 1;
            applyReplayState();

            const cards = document.querySelectorAll('.replay-card');
            expect(cards[0].classList.contains('revealed')).toBe(true);
            expect(cards[1].classList.contains('revealed')).toBe(true);
            expect(cards[1].classList.contains('current-move')).toBe(true);
            expect(cards[2].classList.contains('revealed')).toBe(false);
        });
    });

    describe('renderReplayEventLog', () => {
        test('shows no events message when empty', () => {
            setupReplayDOM();
            state.currentReplayData = { ...createReplayData(), events: [] };
            renderReplayEventLog();
            expect(document.getElementById('replay-event-log')!.textContent).toContain('No events');
        });

        test('renders clue events', () => {
            setupReplayDOM();
            state.currentReplayData = {
                ...createReplayData(),
                events: [{ type: 'clue', data: { word: 'Fruit', number: 3, team: 'red' } }],
            };
            state.currentReplayIndex = -1;
            renderReplayEventLog();

            const action = document.querySelector('.event-action');
            expect(action!.textContent).toBe('gave clue');
        });

        test('renders reveal events', () => {
            setupReplayDOM();
            state.currentReplayData = {
                ...createReplayData(),
                events: [{ type: 'reveal', data: { word: 'APPLE', type: 'red', index: 0, team: 'red' } }],
            };
            renderReplayEventLog();

            const detail = document.querySelector('.event-detail');
            expect(detail!.textContent).toContain('APPLE');
        });

        test('highlights current event', () => {
            setupReplayDOM();
            state.currentReplayData = {
                ...createReplayData(),
                events: [
                    { type: 'clue', data: { word: 'A', team: 'red' } },
                    { type: 'reveal', data: { word: 'B', type: 'red', index: 0, team: 'red' } },
                ],
            };
            state.currentReplayIndex = 1;
            renderReplayEventLog();

            const events = document.querySelectorAll('.replay-event');
            expect(events[0].classList.contains('current')).toBe(false);
            expect(events[1].classList.contains('current')).toBe(true);
        });
    });

    describe('updateReplayControls', () => {
        test('disables prev button at start', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();
            state.currentReplayIndex = -1;
            updateReplayControls();

            expect((document.getElementById('replay-prev') as HTMLButtonElement).disabled).toBe(true);
        });

        test('disables next button at end', () => {
            setupReplayDOM();
            state.currentReplayData = {
                ...createReplayData(),
                events: [{ type: 'reveal', data: { index: 0, team: 'red' } }],
            };
            state.currentReplayIndex = 0;
            updateReplayControls();

            expect((document.getElementById('replay-next') as HTMLButtonElement).disabled).toBe(true);
        });

        test('shows progress text', () => {
            setupReplayDOM();
            state.currentReplayData = {
                ...createReplayData(),
                events: [
                    { type: 'reveal', data: { index: 0, team: 'red' } },
                    { type: 'reveal', data: { index: 1, team: 'red' } },
                ],
            };
            state.currentReplayIndex = 0;
            updateReplayControls();

            expect(document.getElementById('replay-progress')!.textContent).toBe('1/2');
        });

        test('shows play icon when not playing', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();
            state.replayPlaying = false;
            updateReplayControls();

            // Play symbol ▶
            expect(document.getElementById('replay-play')!.textContent).toContain('\u25B6');
        });

        test('shows pause icon when playing', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();
            state.replayPlaying = true;
            updateReplayControls();

            // Pause symbol ❚
            expect(document.getElementById('replay-play')!.textContent).toContain('\u23F8');
        });
    });

    describe('toggleReplayPlayback', () => {
        test('starts playback when stopped', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();
            state.replayPlaying = false;

            toggleReplayPlayback();

            expect(state.replayPlaying).toBe(true);
            expect(state.replayInterval).not.toBeNull();
        });

        test('stops playback when playing', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();
            state.replayPlaying = true;
            state.replayInterval = setInterval(() => {}, 1000);

            toggleReplayPlayback();

            expect(state.replayPlaying).toBe(false);
            expect(state.replayInterval).toBeNull();
        });
    });

    describe('cycleReplaySpeed', () => {
        test('cycles through speed options', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();

            // Start at 1x, cycle to 2x
            cycleReplaySpeed();
            const speedBtn = document.getElementById('replay-speed');
            expect(speedBtn!.textContent).toBe('2x');

            // Cycle to 4x
            cycleReplaySpeed();
            expect(speedBtn!.textContent).toBe('4x');
        });

        test('shows toast notification with speed', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();
            cycleReplaySpeed();
            expect(mockShowToast).toHaveBeenCalled();
        });
    });

    describe('closeReplay', () => {
        test('clears replay state', () => {
            state.currentReplayData = createReplayData();
            state.currentReplayIndex = 5;
            state.replayPlaying = true;
            state.replayInterval = setInterval(() => {}, 1000);

            closeReplay();

            expect(state.currentReplayData).toBeNull();
            expect(state.currentReplayIndex).toBe(-1);
            expect(state.replayPlaying).toBe(false);
            expect(state.replayInterval).toBeNull();
            expect(mockCloseModal).toHaveBeenCalledWith('replay-modal');
        });
    });

    describe('openGameHistory', () => {
        test('shows loading state and requests history', () => {
            setupHistoryDOM();
            openGameHistory();

            expect(document.getElementById('history-loading')!.hidden).toBe(false);
            expect(mockOpenModal).toHaveBeenCalledWith('history-modal');
            expect((global as any).EigennamenClient.getGameHistory).toHaveBeenCalledWith(10);
        });

        test('shows toast when not in multiplayer mode', () => {
            setupHistoryDOM();
            state.isMultiplayerMode = false;

            openGameHistory();

            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'info');
            expect(mockOpenModal).not.toHaveBeenCalled();
        });

        test('shows toast when not connected', () => {
            setupHistoryDOM();
            state.isMultiplayerMode = true;
            (global as any).EigennamenClient.isConnected.mockReturnValue(false);

            openGameHistory();

            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'info');
        });
    });

    describe('closeGameHistory', () => {
        test('closes history modal', () => {
            closeGameHistory();
            expect(mockCloseModal).toHaveBeenCalledWith('history-modal');
        });
    });

    describe('openReplay', () => {
        test('closes history, shows loading, and requests replay', () => {
            setupReplayDOM();
            openReplay('game-123');

            expect(mockCloseModal).toHaveBeenCalledWith('history-modal');
            expect(mockOpenModal).toHaveBeenCalledWith('replay-modal');
            expect((global as any).EigennamenClient.getReplay).toHaveBeenCalledWith('game-123');
        });

        test('shows loading text in replay info', () => {
            setupReplayDOM();
            openReplay('game-123');

            expect(document.getElementById('replay-info')!.textContent).toBe('Loading replay...');
        });
    });

    describe('renderReplayEventLog (additional event types)', () => {
        test('renders endTurn events', () => {
            setupReplayDOM();
            state.currentReplayData = {
                ...createReplayData(),
                events: [{ type: 'endTurn', data: { team: 'red' } }],
            };
            renderReplayEventLog();

            const action = document.querySelector('.event-action');
            expect(action!.textContent).toBe('ended turn');
        });

        test('renders forfeit events', () => {
            setupReplayDOM();
            state.currentReplayData = {
                ...createReplayData(),
                events: [{ type: 'forfeit', data: { team: 'blue', winner: 'red' } }],
            };
            renderReplayEventLog();

            const action = document.querySelector('.event-action');
            expect(action!.textContent).toBe('forfeited');
            const detail = document.querySelector('.event-detail');
            expect(detail).not.toBeNull();
        });

        test('renders unknown event types', () => {
            setupReplayDOM();
            state.currentReplayData = {
                ...createReplayData(),
                events: [{ type: 'custom', data: { team: 'red' } }],
            };
            renderReplayEventLog();

            const action = document.querySelector('.event-action');
            expect(action!.textContent).toBe('custom');
        });
    });

    describe('scrollToCurrentEvent', () => {
        test('scrolls to current event', () => {
            setupReplayDOM();
            const logEl = document.getElementById('replay-event-log')!;
            const event = document.createElement('div');
            event.className = 'replay-event current';
            event.scrollIntoView = jest.fn();
            logEl.appendChild(event);

            scrollToCurrentEvent();

            expect(event.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        });

        test('does nothing when no log element', () => {
            document.body.innerHTML = '';
            expect(() => scrollToCurrentEvent()).not.toThrow();
        });

        test('does nothing when no current event', () => {
            setupReplayDOM();
            expect(() => scrollToCurrentEvent()).not.toThrow();
        });
    });

    describe('copyReplayLink', () => {
        test('copies replay link to clipboard', async () => {
            state.currentReplayData = { ...createReplayData(), id: 'replay-abc' };
            const { copyToClipboard } = require('../../frontend/utils');
            (copyToClipboard as jest.Mock).mockResolvedValue(true);

            await copyReplayLink();

            expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('replay=replay-abc'));
            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'success');
        });

        test('shows error toast when no replay data', async () => {
            state.currentReplayData = null;

            await copyReplayLink();

            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
        });

        test('shows error toast when copy fails', async () => {
            state.currentReplayData = { ...createReplayData(), id: 'replay-abc' };
            const { copyToClipboard } = require('../../frontend/utils');
            (copyToClipboard as jest.Mock).mockResolvedValue(false);

            await copyReplayLink();

            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
        });
    });

    describe('checkURLForReplayLoad', () => {
        test('returns false when no replay param in URL', async () => {
            window.history.replaceState({}, '', 'http://localhost/');
            const result = await checkURLForReplayLoad();
            expect(result).toBe(false);
        });

        test('returns false when missing room param', async () => {
            window.history.replaceState({}, '', 'http://localhost/?replay=game123');
            const result = await checkURLForReplayLoad();
            expect(result).toBe(false);
        });

        test('returns true and renders replay on success', async () => {
            setupReplayDOM();
            window.history.replaceState({}, '', 'http://localhost/?replay=game123&room=ROOM1');

            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ replay: true, ...createReplayData() }),
            }) as any;

            const result = await checkURLForReplayLoad();

            expect(result).toBe(true);
            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'success');
        });

        test('returns false and shows error on 404', async () => {
            window.history.replaceState({}, '', 'http://localhost/?replay=game123&room=ROOM1');

            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 404,
            }) as any;

            const result = await checkURLForReplayLoad();

            expect(result).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
        });

        test('returns false and shows error on other HTTP errors', async () => {
            window.history.replaceState({}, '', 'http://localhost/?replay=game123&room=ROOM1');

            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status: 500,
            }) as any;

            const result = await checkURLForReplayLoad();

            expect(result).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
        });

        test('returns false and shows error on fetch failure', async () => {
            window.history.replaceState({}, '', 'http://localhost/?replay=game123&room=ROOM1');

            global.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as any;

            const result = await checkURLForReplayLoad();

            expect(result).toBe(false);
            expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
        });
    });

    describe('renderReplayBoard', () => {
        test('renders board with words', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();
            state.currentReplayIndex = -1;
            renderReplayBoard();

            const cards = document.querySelectorAll('.replay-card');
            expect(cards.length).toBe(25);
            expect(cards[0].textContent).toBe('WORD0');
        });

        test('renders empty board when no data', () => {
            setupReplayDOM();
            state.currentReplayData = null;
            renderReplayBoard();

            const cards = document.querySelectorAll('.replay-card');
            expect(cards.length).toBe(0);
        });
    });

    describe('cycleReplaySpeed (restart while playing)', () => {
        test('restarts interval when currently playing', () => {
            setupReplayDOM();
            state.currentReplayData = createReplayData();
            state.replayPlaying = true;
            state.replayInterval = setInterval(() => {}, 10000) as any;

            cycleReplaySpeed();

            // Interval should be replaced (not null since we're playing)
            expect(state.replayInterval).not.toBeNull();
            expect(mockShowToast).toHaveBeenCalled();

            // Clean up
            if (state.replayInterval) clearInterval(state.replayInterval);
            state.replayInterval = null;
        });
    });

    describe('setupHistoryEventDelegation', () => {
        test('sets up event delegation on history list', () => {
            setupHistoryDOM();
            const addEventSpy = jest.spyOn(document.getElementById('history-list')!, 'addEventListener');

            setupHistoryEventDelegation();

            expect(addEventSpy).toHaveBeenCalledWith('click', expect.any(Function));
            expect(state.historyDelegationSetup).toBe(true);
        });

        test('only sets up once (idempotent)', () => {
            setupHistoryDOM();
            setupHistoryEventDelegation();
            const listEl = document.getElementById('history-list')!;
            const spy = jest.spyOn(listEl, 'addEventListener');

            setupHistoryEventDelegation();
            expect(spy).not.toHaveBeenCalled();
        });
    });
});

// Helpers

function setupHistoryDOM(): void {
    document.body.innerHTML = `
        <div id="history-loading" style="display: flex"></div>
        <div id="history-empty" style="display: none"></div>
        <div id="history-list" style="display: none"></div>
    `;
}

function setupReplayDOM(): void {
    document.body.innerHTML = `
        <div id="replay-info"></div>
        <div id="replay-board"></div>
        <div id="replay-event-log"></div>
        <div id="replay-progress"></div>
        <div class="replay-controls">
            <button id="replay-prev"></button>
            <button id="replay-play"></button>
            <button id="replay-next"></button>
            <button id="replay-speed">1x</button>
            <button id="replay-share"></button>
        </div>
    `;
}

function createHistoryEntry(
    id: string,
    winner: string,
    redScore: number,
    blueScore: number,
    moveCount: number,
    clueCount: number
): GameHistoryEntry {
    return {
        id,
        winner,
        redScore,
        blueScore,
        moveCount,
        clueCount,
        endReason: 'completed',
        duration: 272000,
        timestamp: Date.now(),
        teamNames: { red: 'Red', blue: 'Blue' },
    };
}

function createReplayData(): ReplayData {
    return {
        id: 'replay-1',
        events: [],
        initialBoard: {
            words: Array.from({ length: 25 }, (_, i) => `WORD${i}`),
            types: [...Array(9).fill('red'), ...Array(8).fill('blue'), ...Array(7).fill('neutral'), 'assassin'],
        },
        finalState: { winner: 'red' },
        teamNames: { red: 'Red', blue: 'Blue' },
        duration: 120000,
        totalMoves: 15,
    };
}
