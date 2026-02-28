/**
 * Frontend URL State Module Tests
 *
 * Tests updateURL() from src/frontend/url-state.ts.
 * Test environment: jsdom
 */

jest.mock('../../frontend/state', () => ({
    state: {
        gameState: {
            seed: 42,
            revealed: [true, false, true, false, false],
            currentTurn: 'blue',
            customWords: false,
            words: ['A', 'B', 'C', 'D', 'E']
        },
        teamNames: { red: 'Red', blue: 'Blue' }
    },
    BOARD_SIZE: 25
}));

jest.mock('../../frontend/utils', () => ({
    encodeWordsForURL: jest.fn(() => 'encoded-words')
}));

import { updateURL } from '../../frontend/url-state';
import { state, BOARD_SIZE } from '../../frontend/state';
const { encodeWordsForURL } = require('../../frontend/utils');

describe('url-state', () => {
    let replaceStateSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        replaceStateSpy = jest.spyOn(window.history, 'replaceState');
        // Reset state
        state.gameState.seed = 42;
        state.gameState.revealed = [true, false, true, false, false];
        state.gameState.currentTurn = 'blue';
        state.gameState.customWords = false;
        state.gameState.words = ['A', 'B', 'C', 'D', 'E'];
        state.teamNames = { red: 'Red', blue: 'Blue' };
    });

    test('encodes revealed state as 1/0 string', () => {
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).toContain('r=10100');
    });

    test('encodes blue turn as "b"', () => {
        state.gameState.currentTurn = 'blue';
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).toContain('t=b');
    });

    test('encodes red turn as "r"', () => {
        state.gameState.currentTurn = 'red';
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).toContain('t=r');
    });

    test('includes seed in URL', () => {
        state.gameState.seed = 12345;
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).toContain('game=12345');
    });

    test('includes custom words when customWords is true and word count matches BOARD_SIZE', () => {
        state.gameState.customWords = true;
        state.gameState.words = Array(BOARD_SIZE).fill('WORD');
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).toContain('w=encoded-words');
        expect(encodeWordsForURL).toHaveBeenCalledWith(state.gameState.words);
    });

    test('does not include custom words when customWords is false', () => {
        state.gameState.customWords = false;
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).not.toContain('w=');
    });

    test('does not include custom words when word count does not match BOARD_SIZE', () => {
        state.gameState.customWords = true;
        state.gameState.words = ['A', 'B']; // Only 2, not 25
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).not.toContain('w=');
    });

    test('includes red team name when non-default', () => {
        state.teamNames.red = 'Feuer';
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).toContain('rn=Feuer');
    });

    test('includes blue team name when non-default', () => {
        state.teamNames.blue = 'Eis';
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).toContain('bn=Eis');
    });

    test('does not include red team name when default "Red"', () => {
        state.teamNames.red = 'Red';
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).not.toContain('rn=');
    });

    test('does not include blue team name when default "Blue"', () => {
        state.teamNames.blue = 'Blue';
        updateURL();

        const url = replaceStateSpy.mock.calls[0][2] as string;
        expect(url).not.toContain('bn=');
    });

    test('calls window.history.replaceState', () => {
        updateURL();

        expect(replaceStateSpy).toHaveBeenCalledTimes(1);
        expect(replaceStateSpy).toHaveBeenCalledWith({}, '', expect.any(String));
    });
});
