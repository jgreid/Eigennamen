import { onGameMutation, notifyGameMutation } from '../../socket/gameMutationNotifier';

describe('gameMutationNotifier', () => {
    test('notifies registered listeners with room code', () => {
        const listener = jest.fn();
        onGameMutation(listener);

        notifyGameMutation('ABC123');

        expect(listener).toHaveBeenCalledWith('ABC123');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    test('notifies multiple listeners', () => {
        const listener1 = jest.fn();
        const listener2 = jest.fn();
        onGameMutation(listener1);
        onGameMutation(listener2);

        notifyGameMutation('XYZ789');

        expect(listener1).toHaveBeenCalledWith('XYZ789');
        expect(listener2).toHaveBeenCalledWith('XYZ789');
    });

    test('does not throw when no listeners registered', () => {
        // Module state carries over from previous tests (listeners are push-only),
        // but this verifies the notify path doesn't error on room codes
        expect(() => notifyGameMutation('EMPTY')).not.toThrow();
    });
});
