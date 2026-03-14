/**
 * Tests for multiplayerListeners.ts
 *
 * Verifies the idempotency guard and client-existence check
 * in setupMultiplayerListeners.
 */

jest.mock('../../frontend/state', () => ({
    state: {
        multiplayerListenersSetup: false,
    },
}));

const mockGetClient = jest.fn();
jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => mockGetClient(),
}));

const mockRegisterGameHandlers = jest.fn();
const mockRegisterPlayerHandlers = jest.fn();
const mockRegisterRoomHandlers = jest.fn();
const mockRegisterTimerHandlers = jest.fn();
const mockRegisterChatAndErrorHandlers = jest.fn();

jest.mock('../../frontend/handlers/gameEventHandlers', () => ({
    registerGameHandlers: () => mockRegisterGameHandlers(),
}));
jest.mock('../../frontend/handlers/playerEventHandlers', () => ({
    registerPlayerHandlers: () => mockRegisterPlayerHandlers(),
}));
jest.mock('../../frontend/handlers/roomEventHandlers', () => ({
    registerRoomHandlers: () => mockRegisterRoomHandlers(),
}));
jest.mock('../../frontend/handlers/timerEventHandlers', () => ({
    registerTimerHandlers: () => mockRegisterTimerHandlers(),
}));
jest.mock('../../frontend/handlers/chatEventHandlers', () => ({
    registerChatAndErrorHandlers: () => mockRegisterChatAndErrorHandlers(),
}));

import { setupMultiplayerListeners } from '../../frontend/multiplayerListeners';
import { state } from '../../frontend/state';

describe('setupMultiplayerListeners', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        state.multiplayerListenersSetup = false;
        mockGetClient.mockReturnValue({});
    });

    it('registers all handler groups when called first time', () => {
        setupMultiplayerListeners();

        expect(mockRegisterGameHandlers).toHaveBeenCalledTimes(1);
        expect(mockRegisterPlayerHandlers).toHaveBeenCalledTimes(1);
        expect(mockRegisterRoomHandlers).toHaveBeenCalledTimes(1);
        expect(mockRegisterTimerHandlers).toHaveBeenCalledTimes(1);
        expect(mockRegisterChatAndErrorHandlers).toHaveBeenCalledTimes(1);
        expect(state.multiplayerListenersSetup).toBe(true);
    });

    it('is idempotent — calling twice only registers handlers once', () => {
        setupMultiplayerListeners();
        setupMultiplayerListeners();

        expect(mockRegisterGameHandlers).toHaveBeenCalledTimes(1);
        expect(mockRegisterPlayerHandlers).toHaveBeenCalledTimes(1);
    });

    it('returns early without registering if client is not available', () => {
        mockGetClient.mockReturnValue(null);

        setupMultiplayerListeners();

        expect(mockRegisterGameHandlers).not.toHaveBeenCalled();
        expect(state.multiplayerListenersSetup).toBe(false);
    });
});
