/**
 * Socket.io Integration Test Helpers
 *
 * Provides utilities for testing socket handlers with real Socket.io server.
 * Manages server lifecycle, client connections, and mock services.
 */

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// Default test configuration
const DEFAULT_CONFIG = {
    port: 3098,
    connectionTimeout: 5000,
    defaultTimeout: 10000
};

/**
 * Creates a test server with Socket.io and mock services
 */
class SocketTestServer {
    constructor(options = {}) {
        this.config = { ...DEFAULT_CONFIG, ...options };
        this.httpServer = null;
        this.io = null;
        this.clients = [];
        this.mockServices = {};
        this.eventLog = [];
    }

    /**
     * Start the test server
     */
    async start() {
        return new Promise((resolve, reject) => {
            this.httpServer = http.createServer();

            this.io = new Server(this.httpServer, {
                cors: { origin: '*' },
                transports: ['websocket', 'polling'],
                pingTimeout: 5000,
                pingInterval: 2000
            });

            // Setup connection handler
            this.io.on('connection', (socket) => {
                this._handleConnection(socket);
            });

            this.httpServer.listen(this.config.port, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Stop the test server and disconnect all clients
     */
    async stop() {
        // Disconnect all clients
        for (const client of this.clients) {
            if (client.connected) {
                client.disconnect();
            }
        }
        this.clients = [];

        // Close server
        if (this.io) {
            this.io.close();
            this.io = null;
        }

        return new Promise((resolve) => {
            if (this.httpServer) {
                this.httpServer.close(() => {
                    this.httpServer = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Create a connected client
     */
    async createClient(options = {}) {
        const sessionId = options.sessionId || uuidv4();
        const url = `http://localhost:${this.config.port}`;

        const client = Client(url, {
            transports: ['websocket'],
            timeout: this.config.connectionTimeout,
            reconnection: false,
            auth: { sessionId },
            ...options
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                client.disconnect();
                reject(new Error('Connection timeout'));
            }, this.config.connectionTimeout);

            client.on('connect', () => {
                clearTimeout(timeout);
                client.sessionId = sessionId;
                this.clients.push(client);
                resolve(client);
            });

            client.on('connect_error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    /**
     * Create multiple connected clients
     */
    async createClients(count, options = {}) {
        const clients = [];
        for (let i = 0; i < count; i++) {
            const clientOptions = {
                sessionId: options.sessionIds?.[i] || uuidv4(),
                ...options
            };
            // eslint-disable-next-line no-await-in-loop -- Sequential creation for deterministic test setup
            clients.push(await this.createClient(clientOptions));
        }
        return clients;
    }

    /**
     * Wait for an event on a client
     */
    waitForEvent(client, event, timeout = this.config.defaultTimeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for event: ${event}`));
            }, timeout);

            client.once(event, (data) => {
                clearTimeout(timer);
                resolve(data);
            });
        });
    }

    /**
     * Emit and wait for response
     */
    emitAndWait(client, event, data, responseEvent, timeout = this.config.defaultTimeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for response to ${event}`));
            }, timeout);

            client.once(responseEvent, (response) => {
                clearTimeout(timer);
                resolve(response);
            });

            client.once(`${event.split(':')[0]}:error`, (error) => {
                clearTimeout(timer);
                reject(error);
            });

            client.emit(event, data);
        });
    }

    /**
     * Emit with callback acknowledgment
     */
    emitWithAck(client, event, data, timeout = this.config.defaultTimeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for ack on ${event}`));
            }, timeout);

            client.emit(event, data, (response) => {
                clearTimeout(timer);
                resolve(response);
            });
        });
    }

    /**
     * Register mock service
     */
    registerMockService(name, service) {
        this.mockServices[name] = service;
    }

    /**
     * Get mock service
     */
    getMockService(name) {
        return this.mockServices[name];
    }

    /**
     * Log an event (for debugging)
     */
    logEvent(event, data) {
        this.eventLog.push({ event, data, timestamp: Date.now() });
    }

    /**
     * Get event log
     */
    getEventLog() {
        return [...this.eventLog];
    }

    /**
     * Clear event log
     */
    clearEventLog() {
        this.eventLog = [];
    }

    /**
     * Internal connection handler
     */
    _handleConnection(socket) {
        socket.sessionId = socket.handshake.auth?.sessionId || uuidv4();
        socket.roomCode = null;

        this.logEvent('connection', { socketId: socket.id, sessionId: socket.sessionId });

        socket.on('disconnect', (reason) => {
            this.logEvent('disconnect', { socketId: socket.id, reason });
        });
    }

    /**
     * Get the Socket.io server instance
     */
    getIO() {
        return this.io;
    }

    /**
     * Get server URL
     */
    getUrl() {
        return `http://localhost:${this.config.port}`;
    }
}

/**
 * Mock Redis client for testing
 */
class MockRedis {
    constructor() {
        this._storage = new Map();
        this._sets = new Map();
        this._watching = new Set();
        this._subscriptions = new Map();
    }

    async get(key) {
        return this._storage.get(key) || null;
    }

    async set(key, value, options = {}) {
        this._storage.set(key, value);
        if (options.EX) {
            setTimeout(() => this._storage.delete(key), options.EX * 1000);
        }
        return 'OK';
    }

    async del(key) {
        const existed = this._storage.has(key);
        this._storage.delete(key);
        return existed ? 1 : 0;
    }

    async exists(key) {
        return this._storage.has(key) ? 1 : 0;
    }

    async expire(key, seconds) {
        if (this._storage.has(key)) {
            setTimeout(() => this._storage.delete(key), seconds * 1000);
            return 1;
        }
        return 0;
    }

    async sAdd(key, ...members) {
        if (!this._sets.has(key)) {
            this._sets.set(key, new Set());
        }
        const set = this._sets.get(key);
        let added = 0;
        for (const member of members) {
            if (!set.has(member)) {
                set.add(member);
                added++;
            }
        }
        return added;
    }

    async sRem(key, ...members) {
        const set = this._sets.get(key);
        if (!set) return 0;
        let removed = 0;
        for (const member of members) {
            if (set.delete(member)) removed++;
        }
        return removed;
    }

    async sMembers(key) {
        const set = this._sets.get(key);
        return set ? [...set] : [];
    }

    async sIsMember(key, member) {
        const set = this._sets.get(key);
        return set && set.has(member) ? 1 : 0;
    }

    async watch(key) {
        this._watching.add(key);
        return 'OK';
    }

    async unwatch() {
        this._watching.clear();
        return 'OK';
    }

    multi() {
        const commands = [];
        const self = this;

        return {
            set(key, value, options) {
                commands.push({ cmd: 'set', args: [key, value, options] });
                return this;
            },
            del(key) {
                commands.push({ cmd: 'del', args: [key] });
                return this;
            },
            async exec() {
                const results = [];
                // Sequential execution required for transaction semantics
                for (const { cmd, args } of commands) {
                    // eslint-disable-next-line no-await-in-loop
                    const result = await self[cmd](...args);
                    results.push([null, result]);
                }
                return results;
            }
        };
    }

    async hSet(key, field, value) {
        if (!this._storage.has(key)) {
            this._storage.set(key, {});
        }
        const hash = this._storage.get(key);
        if (typeof field === 'object') {
            Object.assign(hash, field);
        } else {
            hash[field] = value;
        }
        return 1;
    }

    async hGet(key, field) {
        const hash = this._storage.get(key);
        return hash ? hash[field] : null;
    }

    async hGetAll(key) {
        return this._storage.get(key) || {};
    }

    async publish(channel, message) {
        const handlers = this._subscriptions.get(channel) || [];
        handlers.forEach(handler => handler(message));
        return handlers.length;
    }

    async subscribe(channel, handler) {
        if (!this._subscriptions.has(channel)) {
            this._subscriptions.set(channel, []);
        }
        this._subscriptions.get(channel).push(handler);
    }

    // Clear all data (useful for test cleanup)
    clear() {
        this._storage.clear();
        this._sets.clear();
        this._watching.clear();
    }
}

/**
 * Create mock player data
 */
function createMockPlayer(overrides = {}) {
    return {
        sessionId: uuidv4(),
        nickname: `Player${Math.floor(Math.random() * 1000)}`,
        team: null,
        role: 'spectator',
        isHost: false,
        connected: true,
        roomCode: null,
        createdAt: Date.now(),
        lastSeen: Date.now(),
        ...overrides
    };
}

/**
 * Create mock room data
 */
function createMockRoom(overrides = {}) {
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
 * Create mock game data
 */
function createMockGame(overrides = {}) {
    const words = overrides.words || Array.from({ length: 25 }, (_, i) => `WORD${i + 1}`);
    const types = overrides.types || [
        ...Array(9).fill('red'),
        ...Array(8).fill('blue'),
        ...Array(7).fill('neutral'),
        'assassin'
    ];

    return {
        id: uuidv4(),
        seed: 'test-seed',
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
        createdAt: Date.now(),
        ...overrides
    };
}

/**
 * Generate a random room code
 */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

/**
 * Wait for a specified time
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Flush all pending promises
 */
function flushPromises() {
    return new Promise(resolve => setImmediate(resolve));
}

/**
 * Assert that an async function throws an error with specific properties
 */
async function expectAsyncError(fn, expectedCode) {
    try {
        await fn();
        throw new Error('Expected function to throw');
    } catch (error) {
        if (error.message === 'Expected function to throw') {
            throw error;
        }
        if (expectedCode && error.code !== expectedCode) {
            throw new Error(`Expected error code ${expectedCode}, got ${error.code}`);
        }
        return error;
    }
}

module.exports = {
    SocketTestServer,
    MockRedis,
    createMockPlayer,
    createMockRoom,
    createMockGame,
    generateRoomCode,
    sleep,
    flushPromises,
    expectAsyncError,
    DEFAULT_CONFIG
};
