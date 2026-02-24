/**
 * Shared Test Mock Utilities
 *
 * Provides reusable mock factories for Redis, services, and game objects.
 * Reduces boilerplate and ensures consistency across tests.
 */

const { v4: uuidv4 } = require('uuid');


type AnyRecord = Record<string, any>;

/**
 * Create a mock Redis client with all common operations
 */
function createMockRedis(overrides: AnyRecord = {}): AnyRecord {
    const storage = new Map<string, string>();
    const sets = new Map<string, Set<string>>();
    const sortedSets = new Map<string, Array<{ score: number; value: string }>>();
    const lists = new Map<string, string[]>();
    const watchers = new Set<string>();
    const subscriptions = new Map<string, Array<(message: string) => void>>();

    const mockRedis: AnyRecord = {
        // Storage for test inspection
        _storage: storage,
        _sets: sets,
        _sortedSets: sortedSets,
        _lists: lists,

        // String operations
        get: jest.fn(async (key: string) => storage.get(key) || null),
        set: jest.fn(async (key: string, value: string, options: AnyRecord = {}) => {
            // Handle NX (Not Exists) option - must check BEFORE setting
            if (options.NX && storage.has(key)) {
                return null; // Key already exists, don't set
            }
            storage.set(key, value);
            return 'OK';
        }),
        del: jest.fn(async (...keys: Array<string | string[]>) => {
            let deleted = 0;
            for (const key of keys.flat()) {
                if (storage.delete(key)) deleted++;
                if (sets.delete(key)) deleted++;
                if (lists.delete(key)) deleted++;
            }
            return deleted;
        }),
        exists: jest.fn(async (...keys: Array<string | string[]>) => {
            return keys.flat().filter(k => storage.has(k) || sets.has(k)).length;
        }),
        expire: jest.fn(async () => 1),
        ttl: jest.fn(async () => -1),
        mGet: jest.fn(async (keys: string[]) => keys.map(k => storage.get(k) || null)),
        incr: jest.fn(async (key: string) => {
            const val = parseInt(storage.get(key) || '0', 10) + 1;
            storage.set(key, val.toString());
            return val;
        }),

        // Set operations
        sAdd: jest.fn(async (key: string, ...members: Array<string | string[]>) => {
            if (!sets.has(key)) sets.set(key, new Set());
            const set = sets.get(key)!;
            let added = 0;
            for (const member of members.flat()) {
                if (!set.has(member)) {
                    set.add(member);
                    added++;
                }
            }
            return added;
        }),
        sRem: jest.fn(async (key: string, ...members: Array<string | string[]>) => {
            const set = sets.get(key);
            if (!set) return 0;
            let removed = 0;
            for (const member of members.flat()) {
                if (set.delete(member)) removed++;
            }
            return removed;
        }),
        sMembers: jest.fn(async (key: string) => {
            const set = sets.get(key);
            return set ? [...set] : [];
        }),
        sIsMember: jest.fn(async (key: string, member: string) => {
            const set = sets.get(key);
            return set && set.has(member) ? 1 : 0;
        }),
        sCard: jest.fn(async (key: string) => {
            const set = sets.get(key);
            return set ? set.size : 0;
        }),

        // Sorted set operations
        zAdd: jest.fn(async (key: string, items: AnyRecord | AnyRecord[]) => {
            if (!sortedSets.has(key)) sortedSets.set(key, []);
            const sorted = sortedSets.get(key)!;
            const itemsArray = Array.isArray(items) ? items : [items];
            for (const item of itemsArray) {
                sorted.push({ score: item.score, value: item.value });
            }
            sorted.sort((a, b) => a.score - b.score);
            return itemsArray.length;
        }),
        zRem: jest.fn(async (key: string, ...members: Array<string | string[]>) => {
            const sorted = sortedSets.get(key);
            if (!sorted) return 0;
            let removed = 0;
            for (const member of members.flat()) {
                const idx = sorted.findIndex(i => i.value === member);
                if (idx !== -1) {
                    sorted.splice(idx, 1);
                    removed++;
                }
            }
            return removed;
        }),
        // E-12: Added missing sorted set operations used in production
        zCard: jest.fn(async (key: string) => {
            const sorted = sortedSets.get(key);
            return sorted ? sorted.length : 0;
        }),
        zRange: jest.fn(async (key: string, start: number | string, end: number | string, options: AnyRecord = {}) => {
            const sorted = sortedSets.get(key);
            if (!sorted) return [];
            let items = [...sorted];
            if (options.REV) {
                items.reverse();
            }
            // Handle numeric range indices
            const startIdx = typeof start === 'number' ? (start < 0 ? Math.max(0, items.length + start) : start) : 0;
            const endIdx = typeof end === 'number' ? (end < 0 ? items.length + end + 1 : end + 1) : items.length;
            items = items.slice(startIdx, endIdx);
            if (options.LIMIT) {
                items = items.slice(options.LIMIT.offset, options.LIMIT.offset + options.LIMIT.count);
            }
            if (options.WITHSCORES) {
                return items.map(i => ({ value: i.value, score: i.score }));
            }
            return items.map(i => i.value);
        }),
        zRangeByScore: jest.fn(async (key: string, min: number, max: number, options: AnyRecord = {}) => {
            const sorted = sortedSets.get(key);
            if (!sorted) return [];
            let results = sorted
                .filter(i => i.score >= min && i.score <= max)
                .map(i => i.value);
            if (options.LIMIT) {
                results = results.slice(options.LIMIT.offset, options.LIMIT.offset + options.LIMIT.count);
            }
            return results;
        }),

        // List operations
        lPush: jest.fn(async (key: string, ...values: Array<string | string[]>) => {
            if (!lists.has(key)) lists.set(key, []);
            const list = lists.get(key)!;
            for (const val of values.flat()) {
                list.unshift(val);
            }
            return list.length;
        }),
        rPush: jest.fn(async (key: string, ...values: Array<string | string[]>) => {
            if (!lists.has(key)) lists.set(key, []);
            const list = lists.get(key)!;
            list.push(...values.flat());
            return list.length;
        }),
        lRange: jest.fn(async (key: string, start: number, end: number) => {
            const list = lists.get(key);
            if (!list) return [];
            const actualEnd = end === -1 ? list.length : end + 1;
            return list.slice(start, actualEnd);
        }),
        lTrim: jest.fn(async (key: string, start: number, end: number) => {
            const list = lists.get(key);
            if (!list) return 'OK';
            const actualEnd = end === -1 ? list.length : end + 1;
            const trimmed = list.slice(start, actualEnd);
            lists.set(key, trimmed);
            return 'OK';
        }),
        lLen: jest.fn(async (key: string) => {
            const list = lists.get(key);
            return list ? list.length : 0;
        }),
        lIndex: jest.fn(async (key: string, index: number) => {
            const list = lists.get(key);
            if (!list) return null;
            const actualIndex = index < 0 ? list.length + index : index;
            return list[actualIndex] || null;
        }),

        // Transaction operations
        watch: jest.fn(async (key: string) => {
            watchers.add(key);
            return 'OK';
        }),
        unwatch: jest.fn(async () => {
            watchers.clear();
            return 'OK';
        }),
        multi: jest.fn(() => {
            const commands: Array<{ cmd: string; args: unknown[] }> = [];
            const self = mockRedis;

            const chain: AnyRecord = {
                set(key: string, value: string, options?: AnyRecord) {
                    commands.push({ cmd: 'set', args: [key, value, options] });
                    return chain;
                },
                del(key: string) {
                    commands.push({ cmd: 'del', args: [key] });
                    return chain;
                },
                expire(key: string, seconds: number) {
                    commands.push({ cmd: 'expire', args: [key, seconds] });
                    return chain;
                },
                lPush(key: string, value: string) {
                    commands.push({ cmd: 'lPush', args: [key, value] });
                    return chain;
                },
                lTrim(key: string, start: number, end: number) {
                    commands.push({ cmd: 'lTrim', args: [key, start, end] });
                    return chain;
                },
                async exec() {
                    const results: Array<[Error | null, unknown]> = [];
                    // Sequential execution required - commands must run in order for transaction semantics
                    for (const { cmd, args } of commands) {
                        try {
                            const result = await self[cmd](...args);
                            results.push([null, result]);
                        } catch (e) {
                            results.push([e as Error, null]);
                        }
                    }
                    return results;
                }
            };

            return chain;
        }),

        // Pub/Sub operations
        publish: jest.fn(async (channel: string, message: string) => {
            const handlers = subscriptions.get(channel) || [];
            handlers.forEach(h => h(message));
            return handlers.length;
        }),
        subscribe: jest.fn(async (channel: string, handler: (message: string) => void) => {
            if (!subscriptions.has(channel)) {
                subscriptions.set(channel, []);
            }
            subscriptions.get(channel)!.push(handler);
        }),
        unsubscribe: jest.fn(async (channel: string) => {
            subscriptions.delete(channel);
        }),

        // Lua script evaluation
        eval: jest.fn(async () => null),
        evalSha: jest.fn(async () => null),
        scriptLoad: jest.fn(async () => 'mock-sha'),

        // E-12: Added scan operation (used in adminRoutes.ts)
        scan: jest.fn(async (cursor: number, options: AnyRecord = {}) => {
            const pattern = options.MATCH || '*';
            const count = options.COUNT || 10;
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            const allKeys = [...storage.keys()].filter(key => regex.test(key));
            const startIdx = cursor;
            const endIdx = Math.min(startIdx + count, allKeys.length);
            const keys = allKeys.slice(startIdx, endIdx);
            const nextCursor = endIdx >= allKeys.length ? 0 : endIdx;
            return { cursor: nextCursor, keys };
        }),

        // SCAN iterator
        scanIterator: jest.fn(function* (options: AnyRecord = {}) {
            const pattern = options.MATCH || '*';
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            for (const key of storage.keys()) {
                if (regex.test(key)) {
                    yield key;
                }
            }
        }),

        // Connection state
        isOpen: true,
        isReady: true,
        ping: jest.fn(async () => 'PONG'),
        quit: jest.fn(async () => 'OK'),
        disconnect: jest.fn(() => {}),
        duplicate: jest.fn(() => createMockRedis()),

        // Utility methods for tests
        _clear: () => {
            storage.clear();
            sets.clear();
            sortedSets.clear();
            lists.clear();
            watchers.clear();
            subscriptions.clear();
        },
        _resetMocks: () => {
            Object.keys(mockRedis).forEach(key => {
                if (typeof mockRedis[key] === 'function' && mockRedis[key].mockReset) {
                    mockRedis[key].mockReset();
                }
            });
        }
    };

    // Apply overrides
    return { ...mockRedis, ...overrides };
}

/**
 * Create a mock player object
 */
function createMockPlayer(overrides: AnyRecord = {}): AnyRecord {
    return {
        sessionId: uuidv4(),
        roomCode: 'TESTXX',
        nickname: `Player${Math.floor(Math.random() * 1000)}`,
        team: null,
        role: 'spectator',
        isHost: false,
        connected: true,
        connectedAt: Date.now(),
        lastSeen: Date.now(),
        ...overrides
    };
}

/**
 * Create a mock room object
 */
function createMockRoom(overrides: AnyRecord = {}): AnyRecord {
    const code = overrides.code || generateRoomCode();
    return {
        code,
        hostSessionId: overrides.hostSessionId || uuidv4(),
        settings: {
            redTeamName: 'Red Team',
            blueTeamName: 'Blue Team',
            turnTimer: null,
            ...overrides.settings
        },
        status: 'waiting',
        createdAt: Date.now(),
        ...overrides
    };
}

/**
 * Create a mock game object
 */
function createMockGame(overrides: AnyRecord = {}): AnyRecord {
    const words = overrides.words || Array.from({ length: 25 }, (_, i) => `WORD${i + 1}`);
    const types = overrides.types || [
        ...Array(9).fill('red'),
        ...Array(8).fill('blue'),
        ...Array(7).fill('neutral'),
        'assassin'
    ];

    return {
        id: uuidv4(),
        seed: 'test-seed-' + Date.now(),
        wordListId: null,
        words,
        types,
        revealed: Array(25).fill(false),
        currentTurn: 'red',
        redScore: 0,
        blueScore: 0,
        redTotal: 9,
        blueTotal: 8,
        gameOver: false,
        winner: null,
        currentClue: null,
        guessesUsed: 0,
        guessesAllowed: 0,
        clues: [],
        history: [],
        stateVersion: 1,
        createdAt: Date.now(),
        ...overrides
    };
}

/**
 * Create a mock socket object matching real Socket.io shape.
 * Includes event handler registration, rooms Set, and rateLimiter.
 */
function createMockSocket(overrides: AnyRecord = {}): AnyRecord {
    const sessionId = overrides.sessionId || uuidv4();
    const socketId = overrides.id || `socket-${uuidv4()}`;
    const eventHandlers: Record<string, Function> = {};

    const mockSocket: AnyRecord = {
        id: socketId,
        sessionId,
        roomCode: overrides.roomCode || null,
        clientIP: overrides.clientIP || '127.0.0.1',
        flyInstanceId: undefined,
        rateLimiter: overrides.rateLimiter || { cleanupSocket: jest.fn() },
        rooms: new Set([socketId]),
        handshake: {
            auth: { sessionId },
            address: '127.0.0.1',
            ...overrides.handshake
        },
        join: jest.fn((room: string) => { mockSocket.rooms.add(room); }),
        leave: jest.fn((room: string) => { mockSocket.rooms.delete(room); }),
        to: jest.fn(() => ({ emit: jest.fn() })),
        on: jest.fn((event: string, handler: Function) => { eventHandlers[event] = handler; }),
        once: jest.fn((event: string, handler: Function) => { eventHandlers[event] = handler; }),
        removeAllListeners: jest.fn(),
        emit: jest.fn(),
        broadcast: {
            to: jest.fn(() => ({ emit: jest.fn() }))
        },
        disconnect: jest.fn(),
        // Test utility: access registered handlers
        _eventHandlers: eventHandlers,
        ...overrides
    };

    return mockSocket;
}

/**
 * Create a mock Socket.io server matching real Server shape.
 * Includes adapter stub, sockets namespace, and fetchSockets.
 */
function createMockIO(overrides: AnyRecord = {}): AnyRecord {
    const mockEmit = jest.fn();
    return {
        to: jest.fn(() => ({ emit: mockEmit })),
        in: jest.fn(() => ({
            emit: mockEmit,
            fetchSockets: jest.fn(async () => [])
        })),
        emit: jest.fn(),
        on: jest.fn(),
        use: jest.fn(),
        close: jest.fn(),
        sockets: {
            adapter: {
                rooms: new Map(),
                sids: new Map()
            },
            sockets: new Map()
        },
        // Test utility: access the emit mock used by .to()/.in()
        _roomEmit: mockEmit,
        ...overrides
    };
}

/**
 * Create a mock logger
 */
function createMockLogger(): AnyRecord {
    return {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn(() => createMockLogger())
    };
}

/**
 * Generate a random room code
 */
function generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

/**
 * Create mock services bundle
 */
function createMockServices(): AnyRecord {
    return {
        gameService: {
            createGame: jest.fn(async () => createMockGame()),
            getGame: jest.fn(async () => null),
            getGameStateForPlayer: jest.fn(() => createMockGame()),
            revealCard: jest.fn(async () => ({ index: 0, type: 'red' })),
            endTurn: jest.fn(async () => ({ currentTurn: 'blue' })),
            forfeitGame: jest.fn(async () => ({ winner: 'blue' })),
            cleanupGame: jest.fn(async () => {})
        },
        roomService: {
            createRoom: jest.fn(async () => createMockRoom()),
            getRoom: jest.fn(async () => null),
            getRoomWithPlayers: jest.fn(async () => null),
            updateRoomSettings: jest.fn(async () => createMockRoom()),
            deleteRoom: jest.fn(async () => {}),
            roomExists: jest.fn(async () => false)
        },
        playerService: {
            createPlayer: jest.fn(async () => createMockPlayer()),
            getPlayer: jest.fn(async () => null),
            updatePlayer: jest.fn(async () => createMockPlayer()),
            setTeam: jest.fn(async () => createMockPlayer()),
            setRole: jest.fn(async () => createMockPlayer()),
            setNickname: jest.fn(async () => createMockPlayer()),
            getPlayersInRoom: jest.fn(async () => []),
            removePlayer: jest.fn(async () => {}),
            handleDisconnect: jest.fn(async () => null)
        },
        timerService: {
            startTimer: jest.fn(async () => ({ endTime: Date.now() + 60000 })),
            stopTimer: jest.fn(async () => {}),
            getTimerStatus: jest.fn(async () => null),
            pauseTimer: jest.fn(async () => 60),
            resumeTimer: jest.fn(async () => ({ endTime: Date.now() + 60000 })),
            hasActiveTimer: jest.fn(async () => false)
        }
    };
}

/**
 * Wait for a specified time
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Flush all pending promises
 */
function flushPromises(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

/**
 * Assert that an async function throws an error with specific properties
 */
async function expectAsyncError(fn: () => Promise<unknown>, expectedCode?: string): Promise<Error> {
    try {
        await fn();
        throw new Error('Expected function to throw');
    } catch (error: unknown) {
        const err = error as Error & { code?: string };
        if (err.message === 'Expected function to throw') {
            throw err;
        }
        if (expectedCode && err.code !== expectedCode) {
            throw new Error(`Expected error code ${expectedCode}, got ${err.code}`);
        }
        return err;
    }
}

/**
 * Create a Redis mock where every operation rejects with an error.
 * Useful for testing error handling and timeout paths.
 *
 * @param errorMessage - Message for the rejection error
 * @param options - Control which operations fail: { failAfter: N } makes the first N
 *   calls succeed (using the delegate) then all subsequent calls fail.
 * @param delegate - Optional working mock to delegate to for initial calls
 */
function createFailingRedis(
    errorMessage = 'Redis connection lost',
    options: { failAfter?: number } = {},
    delegate?: AnyRecord
): AnyRecord {
    const error = new Error(errorMessage);
    (error as Error & { code?: string }).code = 'ECONNRESET';

    let callCount = 0;
    const failAfter = options.failAfter ?? 0;

    function makeFailingFn(name: string): jest.Mock {
        return jest.fn(async (...args: unknown[]) => {
            callCount++;
            if (failAfter > 0 && callCount <= failAfter && delegate && delegate[name]) {
                return delegate[name](...args);
            }
            throw error;
        });
    }

    return {
        get: makeFailingFn('get'),
        set: makeFailingFn('set'),
        del: makeFailingFn('del'),
        exists: makeFailingFn('exists'),
        expire: makeFailingFn('expire'),
        ttl: makeFailingFn('ttl'),
        mGet: makeFailingFn('mGet'),
        incr: makeFailingFn('incr'),
        eval: makeFailingFn('eval'),
        hSet: makeFailingFn('hSet'),
        hGet: makeFailingFn('hGet'),
        hGetAll: makeFailingFn('hGetAll'),
        hDel: makeFailingFn('hDel'),
        sAdd: makeFailingFn('sAdd'),
        sRem: makeFailingFn('sRem'),
        sMembers: makeFailingFn('sMembers'),
        lPush: makeFailingFn('lPush'),
        lRange: makeFailingFn('lRange'),
        lLen: makeFailingFn('lLen'),
        publish: makeFailingFn('publish'),
        subscribe: makeFailingFn('subscribe'),
        ping: makeFailingFn('ping'),
        scanIterator: jest.fn(function* () { throw error; }),
        _callCount: () => callCount,
        _error: error
    };
}

module.exports = {
    createMockRedis,
    createFailingRedis,
    createMockPlayer,
    createMockRoom,
    createMockGame,
    createMockSocket,
    createMockIO,
    createMockLogger,
    createMockServices,
    generateRoomCode,
    sleep,
    flushPromises,
    expectAsyncError
};
