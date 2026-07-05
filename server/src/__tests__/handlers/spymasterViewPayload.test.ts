import { buildSpymasterViewPayload } from '../../socket/handlers/roomHandlerUtils';
import type { GameState, Player } from '../../types';

/**
 * Unit coverage for buildSpymasterViewPayload — the pure masking helper shared by
 * the resync/role-change path and (per A1) the game-start path. The A1 bug was a
 * Duet BLUE spymaster never receiving their key card at game start; the critical
 * assertion here is that a blue spymaster's payload renders duetTypes as `types`.
 */

const player = (over: Partial<Player>): Player =>
    ({ sessionId: 's', nickname: 'n', role: 'spymaster', team: 'red', ...over }) as Player;

const game = (over: Partial<GameState>): GameState =>
    ({ gameOver: false, gameMode: 'classic', types: ['red', 'blue', 'neutral', 'assassin'], ...over }) as GameState;

describe('buildSpymasterViewPayload', () => {
    test('Duet BLUE spymaster receives duetTypes as their board (A1)', () => {
        const duetTypes = ['green', 'green', 'assassin', 'neutral'];
        const g = game({ gameMode: 'duet', types: ['neutral', 'green', 'neutral', 'green'], duetTypes });
        const payload = buildSpymasterViewPayload(g, player({ team: 'blue' }));
        expect(payload).not.toBeNull();
        // The board renders `types`; a blue spymaster's key lives in duetTypes.
        expect(payload!.types).toEqual(duetTypes);
        expect(payload!.types).not.toEqual(g.types);
    });

    test('Duet RED spymaster receives the base types (their own perspective)', () => {
        const g = game({ gameMode: 'duet', duetTypes: ['green', 'green', 'assassin', 'neutral'] });
        const payload = buildSpymasterViewPayload(g, player({ team: 'red' }));
        expect(payload!.types).toEqual(g.types);
        expect(payload!.duetTypes).toBeUndefined();
    });

    test('Duet observer receives BOTH sides key cards', () => {
        const duetTypes = ['green', 'green', 'assassin', 'neutral'];
        const g = game({ gameMode: 'duet', duetTypes });
        const payload = buildSpymasterViewPayload(
            g,
            player({ role: 'observer', team: null as unknown as Player['team'] })
        );
        expect(payload!.types).toEqual(g.types);
        expect(payload!.duetTypes).toEqual(duetTypes);
    });

    test('Match spymaster receives cardScores', () => {
        const cardScores = [3, 1, 0, 2];
        const g = game({ gameMode: 'match', cardScores });
        const payload = buildSpymasterViewPayload(g, player({ team: 'red' }));
        expect(payload!.types).toEqual(g.types);
        expect(payload!.cardScores).toEqual(cardScores);
    });

    test('Classic spymaster receives plain types, no duet/match extras', () => {
        const g = game({ gameMode: 'classic' });
        const payload = buildSpymasterViewPayload(g, player({ team: 'blue' }));
        expect(payload!.types).toEqual(g.types);
        expect(payload!.duetTypes).toBeUndefined();
        expect(payload!.cardScores).toBeUndefined();
    });

    test('returns null for a non-spymaster/observer (clicker)', () => {
        expect(buildSpymasterViewPayload(game({}), player({ role: 'clicker' }))).toBeNull();
    });

    test('returns null once the game is over', () => {
        expect(buildSpymasterViewPayload(game({ gameOver: true }), player({}))).toBeNull();
    });

    test('returns null when there is no game', () => {
        expect(buildSpymasterViewPayload(null, player({}))).toBeNull();
    });
});
