/**
 * Tests for Socket Function Provider
 *
 * Tests the dependency injection pattern used to break circular dependencies
 * between socket/index.js and handler modules.
 */

const {
    registerSocketFunctions,
    getSocketFunctions,
    isRegistered,
    clearSocketFunctions,
    getRequiredFunctions
} = require('../socket/socketFunctionProvider');

describe('Socket Function Provider', () => {
    // Reset state before each test
    beforeEach(() => {
        clearSocketFunctions();
    });

    afterEach(() => {
        clearSocketFunctions();
    });

    describe('registerSocketFunctions', () => {
        test('registers valid functions object', () => {
            const mockFunctions = {
                emitToRoom: jest.fn(),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            expect(() => registerSocketFunctions(mockFunctions)).not.toThrow();
            expect(isRegistered()).toBe(true);
        });

        test('throws error if functions is null', () => {
            expect(() => registerSocketFunctions(null))
                .toThrow('Socket functions must be an object');
        });

        test('throws error if functions is undefined', () => {
            expect(() => registerSocketFunctions(undefined))
                .toThrow('Socket functions must be an object');
        });

        test('throws error if functions is not an object', () => {
            expect(() => registerSocketFunctions('not an object'))
                .toThrow('Socket functions must be an object');
        });

        test('throws error if functions is a number', () => {
            expect(() => registerSocketFunctions(123))
                .toThrow('Socket functions must be an object');
        });

        test('throws error if required function is missing', () => {
            const incompleteFunctions = {
                emitToRoom: jest.fn(),
                // Missing other required functions
            };

            expect(() => registerSocketFunctions(incompleteFunctions))
                .toThrow(/Missing required socket functions/);
        });

        test('throws error listing all missing functions', () => {
            const partialFunctions = {
                emitToRoom: jest.fn(),
                emitToPlayer: jest.fn()
                // Missing: startTurnTimer, stopTurnTimer, getTimerStatus, getIO, createTimerExpireCallback
            };

            try {
                registerSocketFunctions(partialFunctions);
                throw new Error('Should have thrown');
            } catch (error) {
                expect(error.message).toContain('startTurnTimer');
                expect(error.message).toContain('stopTurnTimer');
                expect(error.message).toContain('getTimerStatus');
                expect(error.message).toContain('getIO');
            }
        });

        test('throws error if a required function is not a function', () => {
            const invalidFunctions = {
                emitToRoom: 'not a function',
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            expect(() => registerSocketFunctions(invalidFunctions))
                .toThrow(/Missing required socket functions.*emitToRoom/);
        });

        test('freezes the registered functions object', () => {
            const mockFunctions = {
                emitToRoom: jest.fn(),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            registerSocketFunctions(mockFunctions);
            const registered = getSocketFunctions();

            // Object should be frozen
            expect(Object.isFrozen(registered)).toBe(true);

            // In strict mode, assigning to frozen object would throw
            // In non-strict mode, assignment silently fails
            registered.newProperty = 'test';
            expect(registered.newProperty).toBeUndefined();
        });

        test('allows extra functions beyond required', () => {
            const mockFunctions = {
                emitToRoom: jest.fn(),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn(),
                extraFunction: jest.fn()
            };

            expect(() => registerSocketFunctions(mockFunctions)).not.toThrow();

            const registered = getSocketFunctions();
            expect(registered.extraFunction).toBeDefined();
        });
    });

    describe('getSocketFunctions', () => {
        test('returns registered functions', () => {
            const mockEmitToRoom = jest.fn();
            const mockFunctions = {
                emitToRoom: mockEmitToRoom,
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            registerSocketFunctions(mockFunctions);
            const result = getSocketFunctions();

            expect(result.emitToRoom).toBe(mockEmitToRoom);
        });

        test('throws error if functions not registered', () => {
            expect(() => getSocketFunctions())
                .toThrow(/Socket functions not yet registered/);
        });

        test('error message includes helpful guidance', () => {
            try {
                getSocketFunctions();
                throw new Error('Should have thrown');
            } catch (error) {
                expect(error.message).toContain('registerSocketFunctions()');
                expect(error.message).toContain('socket initialization');
            }
        });

        test('returns same frozen object on multiple calls', () => {
            const mockFunctions = {
                emitToRoom: jest.fn(),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            registerSocketFunctions(mockFunctions);

            const first = getSocketFunctions();
            const second = getSocketFunctions();

            expect(first).toBe(second);
        });
    });

    describe('isRegistered', () => {
        test('returns false when not registered', () => {
            expect(isRegistered()).toBe(false);
        });

        test('returns true when registered', () => {
            const mockFunctions = {
                emitToRoom: jest.fn(),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            registerSocketFunctions(mockFunctions);
            expect(isRegistered()).toBe(true);
        });

        test('returns false after clear', () => {
            const mockFunctions = {
                emitToRoom: jest.fn(),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            registerSocketFunctions(mockFunctions);
            expect(isRegistered()).toBe(true);

            clearSocketFunctions();
            expect(isRegistered()).toBe(false);
        });
    });

    describe('clearSocketFunctions', () => {
        test('clears registered functions', () => {
            const mockFunctions = {
                emitToRoom: jest.fn(),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            registerSocketFunctions(mockFunctions);
            expect(isRegistered()).toBe(true);

            clearSocketFunctions();
            expect(isRegistered()).toBe(false);
            expect(() => getSocketFunctions()).toThrow();
        });

        test('can be called multiple times safely', () => {
            expect(() => {
                clearSocketFunctions();
                clearSocketFunctions();
                clearSocketFunctions();
            }).not.toThrow();
        });

        test('allows re-registration after clear', () => {
            const mockFunctions1 = {
                emitToRoom: jest.fn().mockReturnValue('first'),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            const mockFunctions2 = {
                emitToRoom: jest.fn().mockReturnValue('second'),
                emitToPlayer: jest.fn(),
                startTurnTimer: jest.fn(),
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            };

            registerSocketFunctions(mockFunctions1);
            clearSocketFunctions();
            registerSocketFunctions(mockFunctions2);

            const result = getSocketFunctions();
            expect(result.emitToRoom()).toBe('second');
        });
    });

    describe('getRequiredFunctions', () => {
        test('returns array of required function names', () => {
            const required = getRequiredFunctions();

            expect(Array.isArray(required)).toBe(true);
            expect(required).toContain('emitToRoom');
            expect(required).toContain('emitToPlayer');
            expect(required).toContain('startTurnTimer');
            expect(required).toContain('stopTurnTimer');
            expect(required).toContain('getTimerStatus');
            expect(required).toContain('getIO');
            expect(required).toContain('createTimerExpireCallback');
        });

        test('returns a copy, not the original array', () => {
            const required1 = getRequiredFunctions();
            const required2 = getRequiredFunctions();

            expect(required1).not.toBe(required2);
            expect(required1).toEqual(required2);

            // Modifying returned array should not affect future calls
            required1.push('testFunction');
            const required3 = getRequiredFunctions();
            expect(required3).not.toContain('testFunction');
        });
    });

    describe('Integration: Usage Pattern', () => {
        test('simulates typical handler usage pattern', async () => {
            // 1. During socket initialization, register functions
            const mockEmitToRoom = jest.fn();
            const mockStartTurnTimer = jest.fn().mockResolvedValue({ duration: 60 });

            registerSocketFunctions({
                emitToRoom: mockEmitToRoom,
                emitToPlayer: jest.fn(),
                startTurnTimer: mockStartTurnTimer,
                stopTurnTimer: jest.fn(),
                getTimerStatus: jest.fn(),
                getIO: jest.fn(),
                createTimerExpireCallback: jest.fn()
            });

            // 2. Handler calls getSocketFunctions at runtime
            async function simulatedHandler(roomCode, data) {
                const { emitToRoom, startTurnTimer } = getSocketFunctions();

                await startTurnTimer(roomCode, 60);
                emitToRoom(roomCode, 'game:started', data);
            }

            // 3. Execute handler and await
            await simulatedHandler('TEST12', { gameId: 'game-1' });

            expect(mockStartTurnTimer).toHaveBeenCalledWith('TEST12', 60);
            expect(mockEmitToRoom).toHaveBeenCalledWith('TEST12', 'game:started', { gameId: 'game-1' });
        });

        test('handler fails gracefully if called before registration', () => {
            // Handler that uses getSocketFunctions
            function prematureHandler() {
                const { emitToRoom } = getSocketFunctions();
                emitToRoom('TEST12', 'test:event', {});
            }

            // Should throw with helpful message
            expect(() => prematureHandler())
                .toThrow(/Socket functions not yet registered/);
        });
    });
});
