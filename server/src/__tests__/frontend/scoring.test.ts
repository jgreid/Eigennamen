/**
 * Frontend Game Scoring Module Tests
 *
 * Tests all exports from src/frontend/game/scoring.ts:
 * checkGameOver, updateScoreboard, updateTurnIndicator.
 * Test environment: jsdom
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
        },
        teamNames: { red: 'Red', blue: 'Blue' },
        clickerTeam: null,
        gameMode: 'match',
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

import { checkGameOver, updateScoreboard, updateTurnIndicator } from '../../frontend/game/scoring';
import { state } from '../../frontend/state';
import { t } from '../../frontend/i18n';

function resetState(): void {
    state.gameState.types = [
        ...Array(9).fill('red'),
        ...Array(8).fill('blue'),
        ...Array(7).fill('neutral'),
        'assassin',
    ];
    state.gameState.revealed = Array(25).fill(false);
    state.gameState.currentTurn = 'red';
    state.gameState.redScore = 0;
    state.gameState.blueScore = 0;
    state.gameState.redTotal = 9;
    state.gameState.blueTotal = 8;
    state.gameState.gameOver = false;
    state.gameState.winner = null;
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

// ========== checkGameOver ==========

describe('checkGameOver', () => {
    test('sets gameOver=true and winner to opposite team when assassin is revealed on red turn', () => {
        // Assassin is at index 24
        state.gameState.currentTurn = 'red';
        state.gameState.revealed[24] = true;

        checkGameOver();

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('sets gameOver=true and winner to opposite team when assassin is revealed on blue turn', () => {
        state.gameState.currentTurn = 'blue';
        state.gameState.revealed[24] = true;

        checkGameOver();

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('red');
    });

    test('does not overwrite winner if already set when assassin is revealed', () => {
        state.gameState.revealed[24] = true;
        state.gameState.winner = 'red';

        checkGameOver();

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('red');
    });

    test('sets winner to red when red completes all words', () => {
        state.gameState.redScore = 9;
        state.gameState.redTotal = 9;

        checkGameOver();

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('red');
    });

    test('sets winner to red when redScore exceeds redTotal', () => {
        state.gameState.redScore = 10;
        state.gameState.redTotal = 9;

        checkGameOver();

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('red');
    });

    test('sets winner to blue when blue completes all words', () => {
        state.gameState.blueScore = 8;
        state.gameState.blueTotal = 8;

        checkGameOver();

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('sets winner to blue when blueScore exceeds blueTotal', () => {
        state.gameState.blueScore = 9;
        state.gameState.blueTotal = 8;

        checkGameOver();

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('red score completion takes priority over blue score completion', () => {
        state.gameState.redScore = 9;
        state.gameState.redTotal = 9;
        state.gameState.blueScore = 8;
        state.gameState.blueTotal = 8;

        checkGameOver();

        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('red');
    });

    test('does not change state when no game-over conditions are met', () => {
        state.gameState.redScore = 3;
        state.gameState.blueScore = 2;

        checkGameOver();

        expect(state.gameState.gameOver).toBe(false);
        expect(state.gameState.winner).toBeNull();
    });

    test('does not change state when all cards are unrevealed and scores are zero', () => {
        checkGameOver();

        expect(state.gameState.gameOver).toBe(false);
        expect(state.gameState.winner).toBeNull();
    });

    test('assassin check takes priority over score completion', () => {
        state.gameState.revealed[24] = true;
        state.gameState.currentTurn = 'red';
        state.gameState.redScore = 9;
        state.gameState.redTotal = 9;

        checkGameOver();

        // Assassin sets winner to opposite of current turn (blue), not red
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');
    });

    test('handles types array without assassin gracefully', () => {
        state.gameState.types = Array(25).fill('neutral');

        checkGameOver();

        expect(state.gameState.gameOver).toBe(false);
        expect(state.gameState.winner).toBeNull();
    });

    test('does not set gameOver again if already game over from assassin', () => {
        state.gameState.revealed[24] = true;
        state.gameState.currentTurn = 'red';

        checkGameOver();
        expect(state.gameState.gameOver).toBe(true);
        expect(state.gameState.winner).toBe('blue');

        // Call again - winner should not change since it is already set
        state.gameState.currentTurn = 'blue';
        checkGameOver();
        expect(state.gameState.winner).toBe('blue');
    });
});

// ========== updateScoreboard ==========

describe('updateScoreboard', () => {
    test('sets correct remaining values using cached elements', () => {
        const redRemainingEl = document.createElement('span');
        const blueRemainingEl = document.createElement('span');
        const redTeamNameEl = document.createElement('span');
        const blueTeamNameEl = document.createElement('span');

        state.cachedElements.redRemaining = redRemainingEl;
        state.cachedElements.blueRemaining = blueRemainingEl;
        state.cachedElements.redTeamName = redTeamNameEl;
        state.cachedElements.blueTeamName = blueTeamNameEl;

        state.gameState.redTotal = 9;
        state.gameState.redScore = 3;
        state.gameState.blueTotal = 8;
        state.gameState.blueScore = 2;

        updateScoreboard();

        expect(redRemainingEl.textContent).toBe('6');
        expect(blueRemainingEl.textContent).toBe('6');
        expect(redTeamNameEl.textContent).toBe('Red');
        expect(blueTeamNameEl.textContent).toBe('Blue');
    });

    test('sets remaining to zero when all words found', () => {
        const redRemainingEl = document.createElement('span');
        const blueRemainingEl = document.createElement('span');

        state.cachedElements.redRemaining = redRemainingEl;
        state.cachedElements.blueRemaining = blueRemainingEl;

        state.gameState.redScore = 9;
        state.gameState.blueScore = 8;

        updateScoreboard();

        expect(redRemainingEl.textContent).toBe('0');
        expect(blueRemainingEl.textContent).toBe('0');
    });

    test('falls back to document.getElementById when cached elements are null', () => {
        document.body.innerHTML = `
            <span id="red-remaining"></span>
            <span id="blue-remaining"></span>
            <span id="red-team-name"></span>
            <span id="blue-team-name"></span>
        `;

        state.gameState.redTotal = 9;
        state.gameState.redScore = 1;
        state.gameState.blueTotal = 8;
        state.gameState.blueScore = 5;

        updateScoreboard();

        expect(document.getElementById('red-remaining')!.textContent).toBe('8');
        expect(document.getElementById('blue-remaining')!.textContent).toBe('3');
        expect(document.getElementById('red-team-name')!.textContent).toBe('Red');
        expect(document.getElementById('blue-team-name')!.textContent).toBe('Blue');
    });

    test('handles missing DOM elements gracefully without throwing', () => {
        // No cached elements and no DOM elements
        expect(() => updateScoreboard()).not.toThrow();
    });

    test('handles partially missing elements gracefully', () => {
        const redRemainingEl = document.createElement('span');
        state.cachedElements.redRemaining = redRemainingEl;
        // blueRemaining, redTeamName, blueTeamName are all null

        state.gameState.redScore = 4;

        expect(() => updateScoreboard()).not.toThrow();
        expect(redRemainingEl.textContent).toBe('5');
    });

    test('uses custom team names from state', () => {
        const redTeamNameEl = document.createElement('span');
        const blueTeamNameEl = document.createElement('span');
        state.cachedElements.redTeamName = redTeamNameEl;
        state.cachedElements.blueTeamName = blueTeamNameEl;

        state.teamNames.red = 'Crimson';
        state.teamNames.blue = 'Azure';

        updateScoreboard();

        expect(redTeamNameEl.textContent).toBe('Crimson');
        expect(blueTeamNameEl.textContent).toBe('Azure');
    });

    test('displays remaining as string values', () => {
        const redRemainingEl = document.createElement('span');
        state.cachedElements.redRemaining = redRemainingEl;

        state.gameState.redTotal = 9;
        state.gameState.redScore = 0;

        updateScoreboard();

        expect(redRemainingEl.textContent).toBe('9');
        expect(typeof redRemainingEl.textContent).toBe('string');
    });
});

// ========== updateTurnIndicator ==========

describe('updateTurnIndicator', () => {
    function createIndicatorElement(): HTMLElement {
        const indicator = document.createElement('div');
        indicator.id = 'turn-indicator';
        const turnText = document.createElement('span');
        turnText.className = 'turn-text';
        indicator.appendChild(turnText);
        document.body.appendChild(indicator);
        return indicator;
    }

    test('shows current team turn when game is not over', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.currentTurn = 'red';

        updateTurnIndicator();

        const turnText = indicator.querySelector('.turn-text')!;
        expect(turnText.textContent).toBe("Red's turn");
        expect(indicator.className).toBe('turn-indicator red-turn');
    });

    test('shows blue team turn', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.currentTurn = 'blue';

        updateTurnIndicator();

        const turnText = indicator.querySelector('.turn-text')!;
        expect(turnText.textContent).toBe("Blue's turn");
        expect(indicator.className).toBe('turn-indicator blue-turn');
    });

    test('shows "your turn" when clickerTeam matches currentTurn', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.currentTurn = 'red';
        state.clickerTeam = 'red';

        updateTurnIndicator();

        const turnText = indicator.querySelector('.turn-text')!;
        expect(turnText.textContent).toBe("Red's turn");
        expect(indicator.className).toBe('turn-indicator red-turn your-turn');
        expect(t).toHaveBeenCalledWith('game.yourTurnGo', { team: 'Red' });
    });

    test('does not show "your turn" when clickerTeam does not match', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.currentTurn = 'red';
        state.clickerTeam = 'blue';

        updateTurnIndicator();

        expect(indicator.className).toBe('turn-indicator red-turn');
        expect(t).toHaveBeenCalledWith('game.teamsTurn', { team: 'Red' });
    });

    test('does not show "your turn" when clickerTeam is null', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.currentTurn = 'blue';
        state.clickerTeam = null;

        updateTurnIndicator();

        expect(indicator.className).toBe('turn-indicator blue-turn');
        expect(t).toHaveBeenCalledWith('game.teamsTurn', { team: 'Blue' });
    });

    test('shows winner when game is over (classic mode, score completion)', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';

        updateTurnIndicator();

        expect(indicator.className).toBe('turn-indicator game-over');
        expect(t).toHaveBeenCalledWith('game.winner', { team: 'Red' });
    });

    test('shows assassin winner message when assassin was revealed (classic mode)', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.gameOver = true;
        state.gameState.winner = 'blue';
        // Assassin is at index 24, reveal it
        state.gameState.revealed[24] = true;

        updateTurnIndicator();

        expect(indicator.className).toBe('turn-indicator game-over');
        expect(t).toHaveBeenCalledWith('game.winnerAssassin', { team: 'Blue' });
    });

    test('shows duet victory when duet mode game over with winner', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameMode = 'duet';
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';

        updateTurnIndicator();

        const turnText = indicator.querySelector('.turn-text')!;
        expect(indicator.className).toBe('turn-indicator game-over');
        expect(turnText.textContent).toBe('game.duetVictory');
        expect(t).toHaveBeenCalledWith('game.duetVictory');
    });

    test('shows duet assassin game-over message when assassin revealed in duet mode', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameMode = 'duet';
        state.gameState.gameOver = true;
        state.gameState.winner = null;
        state.gameState.revealed[24] = true;

        updateTurnIndicator();

        const turnText = indicator.querySelector('.turn-text')!;
        expect(turnText.textContent).toBe('game.duetGameOverAssassin');
        expect(t).toHaveBeenCalledWith('game.duetGameOverAssassin');
    });

    test('shows duet timeout game-over message when no assassin revealed in duet mode', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameMode = 'duet';
        state.gameState.gameOver = true;
        state.gameState.winner = null;
        // No assassin revealed

        updateTurnIndicator();

        const turnText = indicator.querySelector('.turn-text')!;
        expect(turnText.textContent).toBe('game.duetGameOverTimeout');
        expect(t).toHaveBeenCalledWith('game.duetGameOverTimeout');
    });

    test('returns early when indicator element is missing', () => {
        // No indicator in DOM and no cached element
        updateTurnIndicator();

        // t should not be called if we returned early
        expect(t).not.toHaveBeenCalled();
    });

    test('returns early when .turn-text child is missing', () => {
        const indicator = document.createElement('div');
        indicator.id = 'turn-indicator';
        // No .turn-text child
        state.cachedElements.turnIndicator = indicator;

        updateTurnIndicator();

        expect(t).not.toHaveBeenCalled();
    });

    test('falls back to document.getElementById when cached turnIndicator is null', () => {
        createIndicatorElement();
        // cachedElements.turnIndicator is null, should fallback to getElementById
        state.gameState.currentTurn = 'red';

        updateTurnIndicator();

        const turnText = document.querySelector('.turn-text')!;
        expect(turnText.textContent).toBe("Red's turn");
    });

    test('uses blue teamName for winner display when winner is blue', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.gameOver = true;
        state.gameState.winner = 'blue';
        state.teamNames.blue = 'Azure';

        updateTurnIndicator();

        expect(t).toHaveBeenCalledWith('game.winner', { team: 'Azure' });
    });

    test('uses red teamName for winner display when winner is red', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';
        state.teamNames.red = 'Crimson';

        updateTurnIndicator();

        expect(t).toHaveBeenCalledWith('game.winner', { team: 'Crimson' });
    });

    test('uses custom team names for turn display', () => {
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.currentTurn = 'blue';
        state.teamNames.blue = 'Ocean';

        updateTurnIndicator();

        expect(t).toHaveBeenCalledWith('game.teamsTurn', { team: 'Ocean' });
    });

    test('winner teamName defaults to blue name when winner is not red', () => {
        // When winner is null (not 'red'), winnerTeamName resolves to blue's name
        const indicator = createIndicatorElement();
        state.cachedElements.turnIndicator = indicator;
        state.gameState.gameOver = true;
        state.gameState.winner = null;
        state.gameMode = 'match';

        // No assassin revealed, so it goes to the else branch: t('game.winner', { team: winnerTeamName })
        // winner is null (not 'red'), so winnerTeamName = state.teamNames.blue
        updateTurnIndicator();

        expect(t).toHaveBeenCalledWith('game.winner', { team: 'Blue' });
    });
});
