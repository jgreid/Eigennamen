/**
 * Handler Edge Case Tests
 *
 * Tests for edge cases in game logic, specifically:
 * - Issue #61: Prevent clickers/spymasters from switching teams during their turn
 * - Issue #59: Validate game state consistency
 */

const { ERROR_CODES } = require('../../config/constants');

describe('Issue #61: Team Switching Validation Logic', () => {
    /**
     * Tests the validation logic that should be applied when a player tries to switch teams.
     * A player with an active role (spymaster/clicker) should not be able to switch
     * teams during their team's turn.
     */

    function shouldBlockTeamSwitch(player, game) {
        // Logic from playerHandlers.js
        if (!player) return false;
        if (player.role !== 'spymaster' && player.role !== 'clicker') return false;
        if (!game) return false;
        if (game.gameOver) return false;
        if (game.currentTurn !== player.team) return false;
        return true;
    }

    it('should not block when player has no role', () => {
        const player = { team: 'red', role: null };
        const game = { currentTurn: 'red', gameOver: false };

        expect(shouldBlockTeamSwitch(player, game)).toBe(false);
    });

    it('should not block when player is only team member (not spymaster/clicker)', () => {
        const player = { team: 'red', role: 'member' };
        const game = { currentTurn: 'red', gameOver: false };

        expect(shouldBlockTeamSwitch(player, game)).toBe(false);
    });

    it("should block spymaster from switching during their team's turn", () => {
        const player = { team: 'red', role: 'spymaster' };
        const game = { currentTurn: 'red', gameOver: false };

        expect(shouldBlockTeamSwitch(player, game)).toBe(true);
    });

    it("should block clicker from switching during their team's turn", () => {
        const player = { team: 'red', role: 'clicker' };
        const game = { currentTurn: 'red', gameOver: false };

        expect(shouldBlockTeamSwitch(player, game)).toBe(true);
    });

    it("should allow spymaster to switch when not their team's turn", () => {
        const player = { team: 'red', role: 'spymaster' };
        const game = { currentTurn: 'blue', gameOver: false };

        expect(shouldBlockTeamSwitch(player, game)).toBe(false);
    });

    it("should allow clicker to switch when not their team's turn", () => {
        const player = { team: 'blue', role: 'clicker' };
        const game = { currentTurn: 'red', gameOver: false };

        expect(shouldBlockTeamSwitch(player, game)).toBe(false);
    });

    it('should allow switching when game is over', () => {
        const player = { team: 'red', role: 'spymaster' };
        const game = { currentTurn: 'red', gameOver: true, winner: 'blue' };

        expect(shouldBlockTeamSwitch(player, game)).toBe(false);
    });

    it('should not block when no game is active', () => {
        const player = { team: 'red', role: 'clicker' };
        const game = null;

        expect(shouldBlockTeamSwitch(player, game)).toBe(false);
    });

    it('should not block when player is null', () => {
        const player = null;
        const game = { currentTurn: 'red', gameOver: false };

        expect(shouldBlockTeamSwitch(player, game)).toBe(false);
    });
});

describe('Issue #59: Game State Validation', () => {
    /**
     * Tests the validation logic for card reveals.
     */

    function validateReveal(game, cardIndex) {
        if (!game) {
            return { valid: false, code: 'GAME_NOT_FOUND' };
        }
        if (game.gameOver) {
            return { valid: false, code: ERROR_CODES.GAME_OVER };
        }
        if (cardIndex < 0 || cardIndex >= game.revealed.length) {
            return { valid: false, code: ERROR_CODES.INVALID_INPUT };
        }
        if (game.revealed[cardIndex]) {
            return { valid: false, code: ERROR_CODES.CARD_ALREADY_REVEALED };
        }
        return { valid: true };
    }

    it('should reject reveal when game is over', () => {
        const game = {
            gameOver: true,
            winner: 'red',
            revealed: [false, false, false],
        };

        const result = validateReveal(game, 0);
        expect(result.valid).toBe(false);
        expect(result.code).toBe(ERROR_CODES.GAME_OVER);
    });

    it('should reject reveal of already revealed card', () => {
        const game = {
            gameOver: false,
            revealed: [true, false, false],
        };

        const result = validateReveal(game, 0);
        expect(result.valid).toBe(false);
        expect(result.code).toBe(ERROR_CODES.CARD_ALREADY_REVEALED);
    });

    it('should reject reveal of invalid card index', () => {
        const game = {
            gameOver: false,
            revealed: [false, false, false],
        };

        expect(validateReveal(game, -1).valid).toBe(false);
        expect(validateReveal(game, 5).valid).toBe(false);
    });

    it('should allow reveal of unrevealed card', () => {
        const game = {
            gameOver: false,
            revealed: [true, false, false],
        };

        const result = validateReveal(game, 1);
        expect(result.valid).toBe(true);
    });

    it('should reject reveal when no game exists', () => {
        const result = validateReveal(null, 0);
        expect(result.valid).toBe(false);
    });
});

describe('Card Reveal Outcome Logic', () => {
    /**
     * Tests the logic for determining the outcome of a card reveal
     */

    function determineRevealOutcome(cardType, currentTurn, redRemaining, blueRemaining) {
        // Returns: { turnEnded, gameOver, winner }

        if (cardType === 'assassin') {
            // Revealing assassin ends game, other team wins
            const winner = currentTurn === 'red' ? 'blue' : 'red';
            return { turnEnded: true, gameOver: true, winner };
        }

        if (cardType === 'neutral') {
            // Neutral ends turn but not game
            return { turnEnded: true, gameOver: false, winner: null };
        }

        if (cardType !== currentTurn) {
            // Wrong team's card - ends turn and gives them a point
            const newRemaining = cardType === 'red' ? redRemaining - 1 : blueRemaining - 1;
            const gameOver = newRemaining === 0;
            const winner = gameOver ? cardType : null;
            return { turnEnded: true, gameOver, winner };
        }

        // Own team's card
        const newRemaining = currentTurn === 'red' ? redRemaining - 1 : blueRemaining - 1;
        const gameOver = newRemaining === 0;
        const winner = gameOver ? currentTurn : null;
        return { turnEnded: gameOver, gameOver, winner };
    }

    it('should end game when assassin is revealed', () => {
        const result = determineRevealOutcome('assassin', 'red', 5, 5);

        expect(result.gameOver).toBe(true);
        expect(result.winner).toBe('blue'); // Other team wins
    });

    it('should end turn when neutral is revealed', () => {
        const result = determineRevealOutcome('neutral', 'red', 5, 5);

        expect(result.turnEnded).toBe(true);
        expect(result.gameOver).toBe(false);
    });

    it('should end turn when opponent card is revealed', () => {
        const result = determineRevealOutcome('blue', 'red', 5, 5);

        expect(result.turnEnded).toBe(true);
        expect(result.gameOver).toBe(false);
    });

    it("should end game when revealing opponent's last card", () => {
        const result = determineRevealOutcome('blue', 'red', 5, 1);

        expect(result.turnEnded).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.winner).toBe('blue');
    });

    it('should continue turn when own card is revealed with remaining cards', () => {
        const result = determineRevealOutcome('red', 'red', 5, 5);

        expect(result.turnEnded).toBe(false);
        expect(result.gameOver).toBe(false);
    });

    it('should end game when revealing own last card', () => {
        const result = determineRevealOutcome('red', 'red', 1, 5);

        expect(result.turnEnded).toBe(true);
        expect(result.gameOver).toBe(true);
        expect(result.winner).toBe('red');
    });
});

describe('Turn Management Logic', () => {
    function getNextTurn(currentTurn) {
        return currentTurn === 'red' ? 'blue' : 'red';
    }

    it('should switch from red to blue', () => {
        expect(getNextTurn('red')).toBe('blue');
    });

    it('should switch from blue to red', () => {
        expect(getNextTurn('blue')).toBe('red');
    });
});

describe('Error Code Constants', () => {
    it('should have CANNOT_SWITCH_TEAM_DURING_TURN error code', () => {
        expect(ERROR_CODES.CANNOT_SWITCH_TEAM_DURING_TURN).toBe('CANNOT_SWITCH_TEAM_DURING_TURN');
    });

    it('should have all required game error codes', () => {
        expect(ERROR_CODES.CARD_ALREADY_REVEALED).toBeDefined();
        expect(ERROR_CODES.GAME_OVER).toBeDefined();
        expect(ERROR_CODES.NOT_YOUR_TURN).toBeDefined();
        expect(ERROR_CODES.INVALID_INPUT).toBeDefined();
    });
});
