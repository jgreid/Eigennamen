/**
 * Scoring Extended Tests
 *
 * Covers uncovered functions and branches in game/scoring.ts:
 * - updateMatchScoreboard (match mode scoreboard rendering)
 * - animateScoreChange (CSS class toggle on score change)
 * - turn-changed animation class on team switch
 */

jest.mock('../../frontend/state', () => ({
    state: {
        gameState: {
            types: [...Array(9).fill('red'), ...Array(8).fill('blue'), ...Array(7).fill('neutral'), 'assassin'],
            revealed: Array(25).fill(false),
            currentTurn: 'red',
            redScore: 0,
            blueScore: 0,
            redTotal: 9,
            blueTotal: 8,
            gameOver: false,
            winner: null,
            redMatchScore: 3,
            blueMatchScore: 2,
            matchRound: 2,
        },
        teamNames: { red: 'Red', blue: 'Blue' },
        clickerTeam: null,
        gameMode: 'match',
        isMultiplayerMode: false,
        cachedElements: {
            redRemaining: null,
            blueRemaining: null,
            redTeamName: null,
            blueTeamName: null,
            turnIndicator: null,
        },
    },
}));

jest.mock('../../frontend/i18n', () => ({
    t: jest.fn((key: string, params?: Record<string, string>) => {
        if (params?.team) return `${params.team}'s turn`;
        return key;
    }),
}));

import { updateMatchScoreboard, updateScoreboard, updateTurnIndicator } from '../../frontend/game/scoring';
import { state } from '../../frontend/state';

function resetState(): void {
    state.gameState.currentTurn = 'red';
    state.gameState.redScore = 0;
    state.gameState.blueScore = 0;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = false;
    state.gameState.winner = null;
    state.gameState.redMatchScore = 3;
    state.gameState.blueMatchScore = 2;
    state.gameState.matchRound = 2;
    state.teamNames = { red: 'Red', blue: 'Blue' };
    state.clickerTeam = null;
    state.gameMode = 'match';
    state.cachedElements.redRemaining = null;
    state.cachedElements.blueRemaining = null;
    state.cachedElements.redTeamName = null;
    state.cachedElements.blueTeamName = null;
    state.cachedElements.turnIndicator = null;
}

beforeEach(() => {
    resetState();
    jest.clearAllMocks();
    document.body.innerHTML = '';
});

describe('updateMatchScoreboard', () => {
    function setupMatchDOM() {
        document.body.innerHTML = `
            <div id="match-scoreboard" hidden>
                <span id="red-match-score"></span>
                <span id="blue-match-score"></span>
                <span id="match-round"></span>
            </div>
        `;
    }

    test('shows scoreboard and populates scores in match mode', () => {
        setupMatchDOM();
        state.gameMode = 'match';
        state.gameState.redMatchScore = 5;
        state.gameState.blueMatchScore = 3;
        state.gameState.matchRound = 4;

        updateMatchScoreboard();

        expect(document.getElementById('match-scoreboard')!.hidden).toBe(false);
        expect(document.getElementById('red-match-score')!.textContent).toBe('5');
        expect(document.getElementById('blue-match-score')!.textContent).toBe('3');
        expect(document.getElementById('match-round')!.textContent).toBe('4');
    });

    test('hides scoreboard when not match mode', () => {
        setupMatchDOM();
        document.getElementById('match-scoreboard')!.hidden = false;
        state.gameMode = 'classic';

        updateMatchScoreboard();

        expect(document.getElementById('match-scoreboard')!.hidden).toBe(true);
    });

    test('displays default values when state values are null/undefined', () => {
        setupMatchDOM();
        state.gameMode = 'match';
        state.gameState.redMatchScore = null as unknown as number;
        state.gameState.blueMatchScore = undefined as unknown as number;
        state.gameState.matchRound = null as unknown as number;

        updateMatchScoreboard();

        expect(document.getElementById('red-match-score')!.textContent).toBe('0');
        expect(document.getElementById('blue-match-score')!.textContent).toBe('0');
        expect(document.getElementById('match-round')!.textContent).toBe('1');
    });

    test('handles missing DOM elements gracefully', () => {
        // No DOM at all
        expect(() => updateMatchScoreboard()).not.toThrow();
    });

    test('handles missing individual score elements', () => {
        document.body.innerHTML = '<div id="match-scoreboard" hidden></div>';
        state.gameMode = 'match';

        expect(() => updateMatchScoreboard()).not.toThrow();
        expect(document.getElementById('match-scoreboard')!.hidden).toBe(false);
    });
});

describe('updateScoreboard animation', () => {
    test('adds changed class when score text changes', () => {
        const redRemainingEl = document.createElement('span');
        redRemainingEl.textContent = '9'; // Old value
        state.cachedElements.redRemaining = redRemainingEl;

        state.gameState.redTotal = 9;
        state.gameState.redScore = 1; // remaining = 8, different from '9'

        updateScoreboard();

        expect(redRemainingEl.textContent).toBe('8');
        // animateScoreChange adds 'changed' class to closest .count or the element itself
        expect(redRemainingEl.classList.contains('changed')).toBe(true);
    });

    test('does not add changed class when score text is unchanged', () => {
        const redRemainingEl = document.createElement('span');
        redRemainingEl.textContent = '9'; // Same as remaining
        state.cachedElements.redRemaining = redRemainingEl;

        state.gameState.redTotal = 9;
        state.gameState.redScore = 0; // remaining = 9, same as current text

        updateScoreboard();

        expect(redRemainingEl.classList.contains('changed')).toBe(false);
    });

    test('animates on .count parent when element is nested', () => {
        const countDiv = document.createElement('div');
        countDiv.className = 'count';
        const innerSpan = document.createElement('span');
        innerSpan.textContent = '5';
        countDiv.appendChild(innerSpan);
        state.cachedElements.redRemaining = innerSpan;

        state.gameState.redTotal = 9;
        state.gameState.redScore = 5; // remaining = 4, different from '5'

        updateScoreboard();

        expect(countDiv.classList.contains('changed')).toBe(true);
    });
});

describe('updateTurnIndicator turn-changed animation', () => {
    function createIndicatorElement(): HTMLElement {
        const indicator = document.createElement('div');
        indicator.id = 'turn-indicator';
        const turnText = document.createElement('span');
        turnText.className = 'turn-text';
        indicator.appendChild(turnText);
        document.body.appendChild(indicator);
        return indicator;
    }

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('adds turn-changed class when team switches from red to blue', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;

        // Start with red-turn class
        indicator.className = 'turn-indicator red-turn';
        state.gameState.currentTurn = 'blue';

        updateTurnIndicator();

        expect(indicator.classList.contains('turn-changed')).toBe(true);
    });

    test('adds turn-changed class when team switches from blue to red', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;

        indicator.className = 'turn-indicator blue-turn';
        state.gameState.currentTurn = 'red';

        updateTurnIndicator();

        expect(indicator.classList.contains('turn-changed')).toBe(true);
    });

    test('removes turn-changed class after 300ms', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;

        indicator.className = 'turn-indicator red-turn';
        state.gameState.currentTurn = 'blue';

        updateTurnIndicator();

        expect(indicator.classList.contains('turn-changed')).toBe(true);
        jest.advanceTimersByTime(300);
        expect(indicator.classList.contains('turn-changed')).toBe(false);
    });

    test('does not add turn-changed when no team switch', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;

        // No previous turn class - fresh indicator
        indicator.className = 'turn-indicator';
        state.gameState.currentTurn = 'red';

        updateTurnIndicator();

        expect(indicator.classList.contains('turn-changed')).toBe(false);
    });
});
