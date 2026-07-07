/**
 * Post-Game Recap Tests (A2)
 *
 * Covers the recap fetch/render flow, the derived stats + per-team clue→guesses
 * timeline, and the "View Recap" button visibility rule.
 */

const mockClient = { getRoomCode: () => 'ROOM1' };

jest.mock('../../frontend/ui', () => ({
    openModal: jest.fn(),
    closeModal: jest.fn(),
    showToast: jest.fn(),
}));

jest.mock('../../frontend/i18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => mockClient,
}));

jest.mock('../../frontend/history-replay', () => ({
    copyReplayLink: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../frontend/history', () => ({
    openReplay: jest.fn(),
}));

jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: true,
        currentRoomId: 'ROOM1',
        currentReplayData: null,
        teamNames: { red: 'Red', blue: 'Blue' },
        gameState: { id: 'g1', gameOver: true },
    },
}));

import { openRecap, updateRecapButton } from '../../frontend/recap';
import { state } from '../../frontend/state';
import { openModal, showToast } from '../../frontend/ui';

const sampleReplay = {
    id: 'g1',
    finalState: { winner: 'red' },
    teamNames: { red: 'Red', blue: 'Blue' },
    duration: 65000,
    events: [
        { type: 'clue', data: { team: 'red', word: 'ANIMAL', number: 2 } },
        { type: 'reveal', data: { team: 'red', word: 'CAT', type: 'red' } }, // correct
        { type: 'reveal', data: { team: 'red', word: 'SEA', type: 'neutral' } }, // neutral
        { type: 'endTurn', data: { fromTeam: 'red', toTeam: 'blue' } },
        { type: 'clue', data: { team: 'blue', word: 'SPACE', number: 1 } },
        { type: 'reveal', data: { team: 'blue', word: 'MOON', type: 'blue' } }, // correct
        { type: 'clue', data: { team: 'red', word: 'DANGER', number: 1 } },
        { type: 'reveal', data: { team: 'red', word: 'BOMB', type: 'assassin' } }, // assassin
    ],
};

function setBody(): void {
    document.body.innerHTML = `
        <div id="btn-view-recap" hidden></div>
        <div id="recap-result"></div>
        <div id="recap-stats"></div>
        <div id="recap-timeline"></div>
    `;
}

beforeEach(() => {
    jest.clearAllMocks();
    setBody();
    state.isMultiplayerMode = true;
    state.gameState = { id: 'g1', gameOver: true };
    state.currentReplayData = null;
});

describe('openRecap', () => {
    test('fetches the replay, renders the recap, and opens the modal', async () => {
        (globalThis as Record<string, unknown>).fetch = jest.fn(() =>
            Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ replay: sampleReplay }) })
        );

        await openRecap();

        expect(globalThis.fetch).toHaveBeenCalledWith('/api/replays/ROOM1/g1', expect.any(Object));
        expect(openModal).toHaveBeenCalledWith('recap-modal');

        // Winner heading reflects the red win.
        const result = document.getElementById('recap-result');
        expect(result?.querySelector('.recap-result-heading')?.classList.contains('red')).toBe(true);

        // Stats: red found 1 own card, blue found 1, and the assassin was hit.
        const statsText = document.getElementById('recap-stats')?.textContent ?? '';
        expect(statsText).toContain('recap.assassin');

        // Timeline groups reveals under their clue → 3 clue blocks.
        const blocks = document.querySelectorAll('#recap-timeline .recap-clue-block');
        expect(blocks.length).toBe(3);
        // The assassin guess is styled as such.
        expect(document.querySelector('#recap-timeline .recap-guess-assassin')).not.toBeNull();

        // currentReplayData is populated so the share-link flow can reuse it.
        expect(state.currentReplayData).toEqual(sampleReplay);
    });

    test('renders the "Played with <name>" provenance line when present', async () => {
        (globalThis as Record<string, unknown>).fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ replay: { ...sampleReplay, wordListName: 'Sci-Fi Words' } }),
            })
        );

        await openRecap();

        const line = document.querySelector('#recap-result .recap-wordlist');
        expect(line).not.toBeNull();
        expect(line?.textContent).toContain('recap.playedWith');
        expect(line?.textContent).toContain('Sci-Fi Words');
    });

    test('omits the provenance line when no saved list was used', async () => {
        (globalThis as Record<string, unknown>).fetch = jest.fn(() =>
            Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ replay: sampleReplay }) })
        );

        await openRecap();

        expect(document.querySelector('#recap-result .recap-wordlist')).toBeNull();
    });

    test('warns and does not fetch when there is no game id', async () => {
        state.gameState = { gameOver: true };
        (globalThis as Record<string, unknown>).fetch = jest.fn();

        await openRecap();

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('recap.unavailable', 'warning');
        expect(openModal).not.toHaveBeenCalled();
    });

    test('warns when the replay is not found', async () => {
        (globalThis as Record<string, unknown>).fetch = jest.fn(() =>
            Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        );

        await openRecap();

        expect(openModal).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalled();
    });
});

describe('updateRecapButton', () => {
    test('shows at game over in multiplayer with a game id', () => {
        updateRecapButton();
        expect(document.getElementById('btn-view-recap')?.hidden).toBe(false);
    });

    test('hidden while a game is still in progress', () => {
        state.gameState = { id: 'g1', gameOver: false };
        updateRecapButton();
        expect(document.getElementById('btn-view-recap')?.hidden).toBe(true);
    });

    test('hidden in standalone (non-multiplayer) mode', () => {
        state.isMultiplayerMode = false;
        updateRecapButton();
        expect(document.getElementById('btn-view-recap')?.hidden).toBe(true);
    });
});
