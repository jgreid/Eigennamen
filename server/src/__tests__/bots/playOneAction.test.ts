/**
 * Pure tests for playOneAction: it builds the role-filtered view and dispatches
 * to the correct strategy method, returning noop on a role/strategy mismatch.
 */
import type { GameState, Player, Role } from '../../types';
import { playOneAction } from '../../bots/playOneAction';
import { makeRandomSpymaster } from '../../bots/strategies/spymasters';
import { makeRandomClicker } from '../../bots/strategies/clickers';
import { resolveSkill } from '../../bots/presets';
import { makeRng } from '../../bots/rng';
import type { BotContext } from '../../bots/strategies/types';

const ctx: BotContext = { gameMode: 'classic', skill: resolveSkill('intermediate', 1), rng: makeRng(1) };

function game(overrides: Partial<GameState> = {}): GameState {
    return {
        id: 'g',
        seed: 'abc',
        wordListId: null,
        words: ['APPLE', 'RIVER', 'TIGER', 'MOUNTAIN'],
        types: ['red', 'red', 'blue', 'neutral'],
        revealed: [false, false, false, false],
        currentTurn: 'red',
        redScore: 0,
        blueScore: 0,
        redTotal: 2,
        blueTotal: 1,
        gameOver: false,
        winner: null,
        currentClue: null,
        guessesUsed: 0,
        guessesAllowed: 0,
        clues: [],
        history: [],
        stateVersion: 1,
        createdAt: 0,
        gameMode: 'classic',
        ...overrides,
    };
}

function seat(role: Role): Player {
    return {
        sessionId: 'bot-1',
        roomCode: 'R',
        nickname: 'B',
        team: 'red',
        role,
        isHost: false,
        connected: true,
        isBot: true,
        lastSeen: 0,
    };
}

describe('playOneAction', () => {
    it('dispatches a spymaster seat to chooseClue', () => {
        const action = playOneAction(
            game(),
            seat('spymaster'),
            makeRandomSpymaster(resolveSkill('intermediate', 1)),
            ctx
        );
        expect(action.kind).toBe('clue');
    });

    it('dispatches a clicker seat to chooseGuess', () => {
        const g = game({
            currentClue: { team: 'red', word: 'FRUIT', number: 2, spymaster: 'x', timestamp: 0 },
            guessesAllowed: 3,
        });
        const action = playOneAction(g, seat('clicker'), makeRandomClicker(resolveSkill('intermediate', 1)), ctx);
        expect(['reveal', 'endTurn']).toContain(action.kind);
    });

    it('returns noop for a spectator seat', () => {
        const action = playOneAction(
            game(),
            seat('spectator'),
            makeRandomClicker(resolveSkill('intermediate', 1)),
            ctx
        );
        expect(action.kind).toBe('noop');
    });

    it('returns noop when the strategy cannot fill the seat role', () => {
        // A clicker strategy in a spymaster seat has no chooseClue method.
        const action = playOneAction(
            game(),
            seat('spymaster'),
            makeRandomClicker(resolveSkill('intermediate', 1)),
            ctx
        );
        expect(action.kind).toBe('noop');
    });

    it('masks unrevealed card types from the clicker', () => {
        // The clicker strategy only ever sees its view; verify via a greedy-style
        // probe that the view passed in hides unrevealed types (all null here).
        const g = game({
            currentClue: { team: 'red', word: 'FRUIT', number: 1, spymaster: 'x', timestamp: 0 },
            guessesAllowed: 2,
        });
        let seenTypes: readonly unknown[] | null = null;
        const probe = {
            strategyId: 'probe',
            chooseGuess(view: { types: readonly unknown[] }) {
                seenTypes = view.types;
                return { kind: 'endTurn' as const };
            },
        };
        playOneAction(g, seat('clicker'), probe, ctx);
        expect(seenTypes).not.toBeNull();
        expect((seenTypes as unknown[]).every((t) => t === null)).toBe(true);
    });
});
