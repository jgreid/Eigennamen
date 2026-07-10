/**
 * Pure tests for playOneAction: it builds the role-filtered view and dispatches
 * to the correct strategy method, returning noop on a role/strategy mismatch.
 */
import type { GameState, Player, Role } from '../../types';
import { buildClickerView, playOneAction } from '../../bots/playOneAction';
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

    it('gives the duet blue spymaster its OWN (side-B) perspective, not red types', () => {
        // Duet: types[] encodes side-A greens as 'red'; duetTypes[] encodes
        // side-B greens as 'blue'. A blue spymaster must group against duetTypes,
        // otherwise it sees zero own cards. Capture the view the strategy receives.
        const g = game({
            gameMode: 'duet',
            types: ['red', 'neutral', 'assassin', 'neutral'],
            duetTypes: ['neutral', 'blue', 'neutral', 'blue'],
        });
        const blueSeat: Player = { ...seat('spymaster'), team: 'blue' };
        let seenTypes: readonly unknown[] | null = null;
        const probe = {
            strategyId: 'probe',
            chooseClue(view: { types: readonly unknown[] }) {
                seenTypes = view.types;
                return { kind: 'clue' as const, word: 'X', number: 1 };
            },
        };
        playOneAction(g, blueSeat, probe, ctx);
        expect(seenTypes).toEqual(['neutral', 'blue', 'neutral', 'blue']);
    });

    it('gives the duet red spymaster the side-A types perspective', () => {
        const g = game({
            gameMode: 'duet',
            types: ['red', 'neutral', 'assassin', 'red'],
            duetTypes: ['neutral', 'blue', 'neutral', 'blue'],
        });
        let seenTypes: readonly unknown[] | null = null;
        const probe = {
            strategyId: 'probe',
            chooseClue(view: { types: readonly unknown[] }) {
                seenTypes = view.types;
                return { kind: 'clue' as const, word: 'X', number: 1 };
            },
        };
        playOneAction(g, seat('spymaster'), probe, ctx);
        expect(seenTypes).toEqual(['red', 'neutral', 'assassin', 'red']);
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

describe('buildClickerView ownRemaining (ledger 2.11 — public scoreboard count)', () => {
    const seat = (role: Role, team: 'red' | 'blue'): Player =>
        ({ sessionId: 's', nickname: 'B', team, role, isBot: true, connected: true, isHost: false }) as Player;

    it('counts unrevealed own cards from the unmasked types', () => {
        const g = game({ revealed: [true, false, false, false] }); // one red revealed
        expect(buildClickerView(g, seat('clicker', 'red'), 'red').ownRemaining).toBe(1);
        expect(buildClickerView(g, seat('clicker', 'blue'), 'blue').ownRemaining).toBe(1);
    });

    it('duet blue counts against duetTypes (side-B key), red against types', () => {
        const g = game({
            gameMode: 'duet',
            types: ['red', 'neutral', 'red', 'neutral'],
            duetTypes: ['neutral', 'blue', 'neutral', 'blue'],
            revealed: [false, true, false, false],
        });
        expect(buildClickerView(g, seat('clicker', 'red'), 'red').ownRemaining).toBe(2);
        expect(buildClickerView(g, seat('clicker', 'blue'), 'blue').ownRemaining).toBe(1);
    });
});
