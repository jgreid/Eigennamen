/**
 * Duet Mode Tests
 *
 * Tests for the cooperative Duet mode game logic including:
 * - Board generation with dual key cards
 * - Card reveal with perspective-based type checking
 * - Timer tokens mechanic
 * - Cooperative win/loss conditions
 * - Player state visibility
 */

const { generateDuetBoard } = require('../../services/game/boardGenerator');
const {
    executeCardReveal,
    determineRevealOutcome,
    switchTurn,
    buildRevealResult,
    getGameStateForPlayer,
    validateRevealPreconditions,
} = require('../../services/game/revealEngine');

const { DUET_BOARD_CONFIG } = require('../../config/constants');

// Helper to create a basic Duet game state
function createDuetGameState(overrides = {}) {
    const types = [
        ...Array(3).fill('red'), // green/green overlap (positions 0-2)
        ...Array(6).fill('red'), // green(A)/bystander(B) (positions 3-8)
        ...Array(6).fill('neutral'), // bystander(A)/green(B) (positions 9-14)
        'assassin', // assassin/assassin (position 15)
        'assassin',
        'assassin', // assassin(A)/bystander(B) (positions 16-17)
        'neutral',
        'neutral', // bystander(A)/assassin(B) (positions 18-19)
        ...Array(5).fill('neutral'), // bystander/bystander (positions 20-24)
    ];

    const duetTypes = [
        ...Array(3).fill('blue'), // green/green overlap
        ...Array(6).fill('neutral'), // green(A)/bystander(B)
        ...Array(6).fill('blue'), // bystander(A)/green(B)
        'assassin', // assassin/assassin
        'neutral',
        'neutral', // assassin(A)/bystander(B)
        'assassin',
        'assassin', // bystander(A)/assassin(B)
        ...Array(5).fill('neutral'), // bystander/bystander
    ];

    return {
        id: 'test-duet-game',
        gameMode: 'duet',
        words: Array(25)
            .fill(null)
            .map((_, i) => `WORD${i}`),
        types,
        duetTypes,
        revealed: Array(25).fill(false),
        currentTurn: 'red' as const,
        redScore: 0,
        blueScore: 0,
        redTotal: 9,
        blueTotal: 9,
        gameOver: false,
        winner: null,
        currentClue: { team: 'red', word: 'CLUE', number: 3, spymaster: 'test', timestamp: Date.now() },
        guessesUsed: 0,
        guessesAllowed: 4,
        clues: [],
        history: [],
        stateVersion: 1,
        createdAt: Date.now(),
        timerTokens: 9,
        greenFound: 0,
        greenTotal: 15,
        seed: 'test-seed',
        wordListId: null,
        ...overrides,
    };
}

describe('Duet Mode - Board Generation', () => {
    it('should generate correct board distribution', () => {
        const seed = 12345;
        const { types, duetTypes } = generateDuetBoard(seed);

        expect(types).toHaveLength(25);
        expect(duetTypes).toHaveLength(25);

        // Count Side A types
        const redCountA = types.filter((t) => t === 'red').length;
        const assassinCountA = types.filter((t) => t === 'assassin').length;
        const neutralCountA = types.filter((t) => t === 'neutral').length;

        expect(redCountA).toBe(9); // 3 overlap + 6 greenOnlyA
        expect(assassinCountA).toBe(3); // 1 overlap + 2 assassinOnlyA
        expect(neutralCountA).toBe(13); // 6 greenOnlyB + 2 assassinOnlyB + 5 bystanderBoth

        // Count Side B types
        const blueCountB = duetTypes.filter((t) => t === 'blue').length;
        const assassinCountB = duetTypes.filter((t) => t === 'assassin').length;
        const neutralCountB = duetTypes.filter((t) => t === 'neutral').length;

        expect(blueCountB).toBe(9); // 3 overlap + 6 greenOnlyB
        expect(assassinCountB).toBe(3); // 1 overlap + 2 assassinOnlyB
        expect(neutralCountB).toBe(13); // 6 greenOnlyA + 2 assassinOnlyA + 5 bystanderBoth
    });

    it('should produce deterministic boards for same seed', () => {
        const seed = 42;
        const board1 = generateDuetBoard(seed);
        const board2 = generateDuetBoard(seed);

        expect(board1.types).toEqual(board2.types);
        expect(board1.duetTypes).toEqual(board2.duetTypes);
    });

    it('should produce different boards for different seeds', () => {
        const board1 = generateDuetBoard(100);
        const board2 = generateDuetBoard(200);

        // At least some positions should differ
        const typesMatch = board1.types.every((t, i) => t === board2.types[i]);
        expect(typesMatch).toBe(false);
    });

    it('should have correct overlap distribution', () => {
        const seed = 99999;
        const { types, duetTypes } = generateDuetBoard(seed);

        let greenGreen = 0;
        let greenBystander = 0;
        let bystanderGreen = 0;
        let assassinAssassin = 0;
        let assassinBystander = 0;
        let bystanderAssassin = 0;
        let bystanderBystander = 0;

        for (let i = 0; i < 25; i++) {
            const a = types[i];
            const b = duetTypes[i];

            if (a === 'red' && b === 'blue') greenGreen++;
            else if (a === 'red' && b === 'neutral') greenBystander++;
            else if (a === 'neutral' && b === 'blue') bystanderGreen++;
            else if (a === 'assassin' && b === 'assassin') assassinAssassin++;
            else if (a === 'assassin' && b === 'neutral') assassinBystander++;
            else if (a === 'neutral' && b === 'assassin') bystanderAssassin++;
            else if (a === 'neutral' && b === 'neutral') bystanderBystander++;
        }

        expect(greenGreen).toBe(DUET_BOARD_CONFIG.greenOverlap); // 3
        expect(greenBystander).toBe(DUET_BOARD_CONFIG.greenOnlyA); // 6
        expect(bystanderGreen).toBe(DUET_BOARD_CONFIG.greenOnlyB); // 6
        expect(assassinAssassin).toBe(DUET_BOARD_CONFIG.assassinOverlap); // 1
        expect(assassinBystander).toBe(DUET_BOARD_CONFIG.assassinOnlyA); // 2
        expect(bystanderAssassin).toBe(DUET_BOARD_CONFIG.assassinOnlyB); // 2
        expect(bystanderBystander).toBe(DUET_BOARD_CONFIG.bystanderBoth); // 5
    });
});

describe('Duet Mode - Card Reveal', () => {
    it('should use Side A types when red team reveals', () => {
        const game = createDuetGameState({ currentTurn: 'red' });
        // Position 0: types[0] = 'red' (green for Side A)
        const type = executeCardReveal(game, 0);

        expect(type).toBe('red');
        expect(game.greenFound).toBe(1);
        expect(game.redScore).toBe(1);
    });

    it('should use Side B types when blue team reveals', () => {
        const game = createDuetGameState({ currentTurn: 'blue' });
        // Position 9: duetTypes[9] = 'blue' (green for Side B)
        const type = executeCardReveal(game, 9);

        expect(type).toBe('blue');
        expect(game.greenFound).toBe(1);
        expect(game.blueScore).toBe(1);
    });

    it('should not count bystanders as greens', () => {
        const game = createDuetGameState({ currentTurn: 'red' });
        // Position 20: types[20] = 'neutral' (bystander for Side A)
        const type = executeCardReveal(game, 20);

        expect(type).toBe('neutral');
        expect(game.greenFound).toBe(0);
        expect(game.redScore).toBe(0);
    });

    it('should handle green/green overlap cards correctly from red perspective', () => {
        const game = createDuetGameState({ currentTurn: 'red' });
        // Position 0: types[0] = 'red' (green from A), duetTypes[0] = 'blue' (green from B)
        const type = executeCardReveal(game, 0);

        expect(type).toBe('red');
        expect(game.greenFound).toBe(1);
    });

    it('should handle green/green overlap cards correctly from blue perspective', () => {
        const game = createDuetGameState({ currentTurn: 'blue' });
        // Position 0: duetTypes[0] = 'blue' (green from B)
        const type = executeCardReveal(game, 0);

        expect(type).toBe('blue');
        expect(game.greenFound).toBe(1);
    });
});

describe('Duet Mode - Reveal Outcome', () => {
    it('should end game on assassin reveal', () => {
        const game = createDuetGameState({ currentTurn: 'red' });
        const outcome = determineRevealOutcome(game, 'assassin', 'red');

        expect(game.gameOver).toBe(true);
        expect(game.winner).toBeNull(); // Cooperative loss
        expect(outcome.endReason).toBe('assassin');
        expect(outcome.turnEnded).toBe(true);
    });

    it('should decrement timer tokens on bystander reveal', () => {
        const game = createDuetGameState({ timerTokens: 5 });
        const outcome = determineRevealOutcome(game, 'neutral', 'red');

        expect(game.timerTokens).toBe(4);
        expect(outcome.turnEnded).toBe(true);
        expect(game.gameOver).toBe(false);
    });

    it('should end game when timer tokens reach 0', () => {
        const game = createDuetGameState({ timerTokens: 1 });
        const outcome = determineRevealOutcome(game, 'neutral', 'red');

        expect(game.timerTokens).toBe(0);
        expect(game.gameOver).toBe(true);
        expect(game.winner).toBeNull(); // Cooperative loss
        expect(outcome.endReason).toBe('timerTokens');
    });

    it('should switch turn on bystander reveal when tokens remain', () => {
        const game = createDuetGameState({ currentTurn: 'red', timerTokens: 5 });
        determineRevealOutcome(game, 'neutral', 'red');

        expect(game.currentTurn).toBe('blue');
    });

    it('should allow continued guessing on correct green reveal', () => {
        const game = createDuetGameState({ greenFound: 3, guessesUsed: 1, guessesAllowed: 4 });
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(outcome.turnEnded).toBe(false);
        expect(game.gameOver).toBe(false);
    });

    it('should win game when all 15 greens found', () => {
        const game = createDuetGameState({ greenFound: 15, greenTotal: 15 });
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(game.gameOver).toBe(true);
        expect(game.winner).toBe('red'); // Cooperative win
        expect(outcome.endReason).toBe('completed');
    });

    it('should end turn on max guesses in duet mode', () => {
        const game = createDuetGameState({
            greenFound: 5,
            guessesUsed: 4,
            guessesAllowed: 4,
            currentTurn: 'red',
        });
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(outcome.turnEnded).toBe(true);
        expect(outcome.endReason).toBe('maxGuesses');
        expect(game.currentTurn).toBe('blue'); // Switched
    });
});

describe('Duet Mode - Build Reveal Result', () => {
    it('should include Duet-specific fields', () => {
        const game = createDuetGameState({ timerTokens: 7, greenFound: 3 });
        const outcome = { turnEnded: false, endReason: null };
        const result = buildRevealResult(game, 0, 'red', outcome);

        expect(result.timerTokens).toBe(7);
        expect(result.greenFound).toBe(3);
        expect(result.allDuetTypes).toBeNull(); // Game not over
    });

    it('should include allDuetTypes when game is over', () => {
        const game = createDuetGameState({ gameOver: true, timerTokens: 0, greenFound: 10 });
        const outcome = { turnEnded: true, endReason: 'timerTokens' };
        const result = buildRevealResult(game, 0, 'neutral', outcome);

        expect(result.allDuetTypes).toEqual(game.duetTypes);
        expect(result.gameOver).toBe(true);
    });

    it('should not include Duet fields for classic games', () => {
        const game = {
            words: Array(25).fill('WORD'),
            types: Array(25).fill('neutral'),
            revealed: Array(25).fill(false),
            redScore: 0,
            blueScore: 0,
            currentTurn: 'red',
            guessesUsed: 0,
            guessesAllowed: 0,
            gameOver: false,
            winner: null,
        };
        const outcome = { turnEnded: false, endReason: null };
        const result = buildRevealResult(game, 0, 'neutral', outcome);

        expect(result.timerTokens).toBeUndefined();
        expect(result.greenFound).toBeUndefined();
        expect(result.allDuetTypes).toBeUndefined();
    });
});

describe('Duet Mode - Player State Visibility', () => {
    it('should show Side A types to red spymaster', () => {
        const game = createDuetGameState();
        const player = { role: 'spymaster', team: 'red', sessionId: 's1', nickname: 'Red SM' };
        const playerState = getGameStateForPlayer(game, player);

        // Red spymaster should see all of types[] (Side A)
        expect(playerState.types).toEqual(game.types);
        // But duetTypes should be hidden for unrevealed
        expect(playerState.duetTypes.every((t, i) => (game.revealed[i] ? t !== null : t === null))).toBe(true);
    });

    it('should show Side B types to blue spymaster', () => {
        const game = createDuetGameState();
        const player = { role: 'spymaster', team: 'blue', sessionId: 's2', nickname: 'Blue SM' };
        const playerState = getGameStateForPlayer(game, player);

        // Blue spymaster should see all of duetTypes[] (Side B)
        expect(playerState.duetTypes).toEqual(game.duetTypes);
        // But types should be hidden for unrevealed
        expect(playerState.types.every((t, i) => (game.revealed[i] ? t !== null : t === null))).toBe(true);
    });

    it('should hide both key cards from non-spymasters', () => {
        const game = createDuetGameState();
        const player = { role: 'clicker', team: 'red', sessionId: 's3', nickname: 'Clicker' };
        const playerState = getGameStateForPlayer(game, player);

        // All unrevealed should be null
        expect(playerState.types.every((t) => t === null)).toBe(true);
        expect(playerState.duetTypes.every((t) => t === null)).toBe(true);
    });

    it('should reveal types for revealed cards to non-spymasters', () => {
        const game = createDuetGameState();
        game.revealed[0] = true; // Reveal position 0
        const player = { role: 'clicker', team: 'red', sessionId: 's3', nickname: 'Clicker' };
        const playerState = getGameStateForPlayer(game, player);

        expect(playerState.types[0]).toBe(game.types[0]);
        expect(playerState.duetTypes[0]).toBe(game.duetTypes[0]);
        expect(playerState.types[1]).toBeNull(); // Still hidden
    });

    it('should show all types when game is over', () => {
        const game = createDuetGameState({ gameOver: true });
        const player = { role: 'clicker', team: 'red', sessionId: 's3', nickname: 'Clicker' };
        const playerState = getGameStateForPlayer(game, player);

        expect(playerState.types).toEqual(game.types);
        expect(playerState.duetTypes).toEqual(game.duetTypes);
    });

    it('should include Duet metadata in player state', () => {
        const game = createDuetGameState({ timerTokens: 7, greenFound: 3 });
        const player = { role: 'clicker', team: 'red', sessionId: 's3', nickname: 'Clicker' };
        const playerState = getGameStateForPlayer(game, player);

        expect(playerState.gameMode).toBe('duet');
        expect(playerState.timerTokens).toBe(7);
        expect(playerState.greenFound).toBe(3);
        expect(playerState.greenTotal).toBe(15);
    });
});

describe('Duet Mode - Edge Cases', () => {
    it('should handle green found count at exactly greenTotal', () => {
        const game = createDuetGameState({ greenFound: 14, guessesUsed: 1, guessesAllowed: 4 });
        // Reveal one more green to reach 15
        game.greenFound = 15;
        const outcome = determineRevealOutcome(game, 'red', 'red');

        expect(game.gameOver).toBe(true);
        expect(game.winner).toBe('red');
        expect(outcome.endReason).toBe('completed');
    });

    it('should handle timer tokens at exactly 0', () => {
        const game = createDuetGameState({ timerTokens: 1 });
        determineRevealOutcome(game, 'neutral', 'red');

        expect(game.timerTokens).toBe(0);
        expect(game.gameOver).toBe(true);
        expect((outcome) => outcome.endReason).toBeDefined();
    });

    it('should correctly switch turns in duet mode', () => {
        const game = createDuetGameState({ currentTurn: 'red' });
        switchTurn(game);
        expect(game.currentTurn).toBe('blue');

        switchTurn(game);
        expect(game.currentTurn).toBe('red');
    });

    it('should validate reveal preconditions for duet games', () => {
        const game = createDuetGameState({ gameOver: true });
        expect(() => validateRevealPreconditions(game, 0)).toThrow();
    });

    it('should handle null player in getGameStateForPlayer for duet', () => {
        const game = createDuetGameState();
        const playerState = getGameStateForPlayer(game, null);

        // Should hide all types
        expect(playerState.types.every((t) => t === null)).toBe(true);
    });
});
