/**
 * Frontend ClientAccessor Module Tests
 *
 * Tests the ACTUAL accessor functions from src/frontend/clientAccessor.ts.
 * No re-implementations — imports the real code directly.
 *
 * Test environment: jsdom (provides window, global scope).
 *
 * The module accesses `EigennamenClient` as a global variable declared in
 * globals.d.ts. We simulate its presence/absence via globalThis.
 */

import { getClient, isClientConnected } from '../../frontend/clientAccessor';

// Minimal mock that satisfies the EigennamenClientAPI interface for testing
interface MockClientAPI {
    isConnected: jest.Mock<boolean>;
    [key: string]: unknown;
}

function createMockClient(connected: boolean = false): MockClientAPI {
    return {
        socket: null,
        sessionId: 'test-session',
        roomCode: 'ABCD',
        player: null,
        connected,
        isConnected: jest.fn().mockReturnValue(connected),
        isInRoom: jest.fn().mockReturnValue(false),
        connect: jest.fn(),
        joinRoom: jest.fn(),
        createRoom: jest.fn(),
        leaveRoom: jest.fn(),
        getRoomCode: jest.fn().mockReturnValue(null),
        requestResync: jest.fn(),
        startGame: jest.fn(),
        revealCard: jest.fn(),
        endTurn: jest.fn(),
        forfeit: jest.fn(),
        setTeam: jest.fn(),
        setRole: jest.fn(),
        setNickname: jest.fn(),
        kickPlayer: jest.fn(),
        updateSettings: jest.fn(),
        getGameHistory: jest.fn(),
        getReplay: jest.fn(),
        sendMessage: jest.fn(),
        sendSpectatorChat: jest.fn(),
        on: jest.fn(),
        off: jest.fn(),
    };
}

describe('clientAccessor', () => {
    // Save and restore any pre-existing global
    const originalClient = (globalThis as Record<string, unknown>).EigennamenClient;

    afterEach(() => {
        // Clean up: restore original state
        if (originalClient !== undefined) {
            (globalThis as Record<string, unknown>).EigennamenClient = originalClient;
        } else {
            delete (globalThis as Record<string, unknown>).EigennamenClient;
        }
    });

    describe('getClient', () => {
        it('returns null when EigennamenClient is not defined', () => {
            delete (globalThis as Record<string, unknown>).EigennamenClient;
            expect(getClient()).toBeNull();
        });

        it('returns the client when it exists', () => {
            const mockClient = createMockClient();
            (globalThis as Record<string, unknown>).EigennamenClient = mockClient;
            const result = getClient();
            expect(result).toBe(mockClient);
        });
    });

    describe('isClientConnected', () => {
        it('returns false when client is null (not defined)', () => {
            delete (globalThis as Record<string, unknown>).EigennamenClient;
            expect(isClientConnected()).toBe(false);
        });

        it('returns false when client exists but isConnected() returns false', () => {
            const mockClient = createMockClient(false);
            (globalThis as Record<string, unknown>).EigennamenClient = mockClient;
            expect(isClientConnected()).toBe(false);
            expect(mockClient.isConnected).toHaveBeenCalled();
        });

        it('returns true when client exists and isConnected() returns true', () => {
            const mockClient = createMockClient(true);
            (globalThis as Record<string, unknown>).EigennamenClient = mockClient;
            expect(isClientConnected()).toBe(true);
            expect(mockClient.isConnected).toHaveBeenCalled();
        });
    });
});
