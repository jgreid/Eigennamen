/**
 * Socket.io Integration Test Helpers
 *
 * Provides utilities for testing socket handlers with real Socket.io server.
 * Manages server lifecycle, client connections, and mock services.
 */

import http from 'http';
import { Server } from 'socket.io';

const Client = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');


type AnyRecord = Record<string, any>;

// Default test configuration
const DEFAULT_CONFIG = {
    port: 3098,
    connectionTimeout: 5000,
    defaultTimeout: 10000
};

interface EventLogEntry {
    event: string;
    data: unknown;
    timestamp: number;
}

/**
 * Creates a test server with Socket.io and mock services
 */
class SocketTestServer {
    config: typeof DEFAULT_CONFIG;
    httpServer: http.Server | null;
    io: Server | null;
    clients: AnyRecord[];
    mockServices: AnyRecord;
    eventLog: EventLogEntry[];

    constructor(options: Partial<typeof DEFAULT_CONFIG> = {}) {
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
    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.httpServer = http.createServer();
            // Increase max listeners to prevent EventEmitter warning during tests
            this.httpServer.setMaxListeners(30);

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

            this.httpServer.listen(this.config.port, (err?: Error) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    /**
     * Stop the test server and disconnect all clients
     */
    async stop(): Promise<void> {
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
    async createClient(options: AnyRecord = {}): Promise<AnyRecord> {
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

            client.on('connect_error', (err: Error) => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    }

    /**
     * Create multiple connected clients
     */
    async createClients(count: number, options: AnyRecord = {}): Promise<AnyRecord[]> {
        const clients: AnyRecord[] = [];
        for (let i = 0; i < count; i++) {
            const clientOptions = {
                sessionId: options.sessionIds?.[i] || uuidv4(),
                ...options
            };
            clients.push(await this.createClient(clientOptions));
        }
        return clients;
    }

    /**
     * Wait for an event on a client
     */
    waitForEvent(client: AnyRecord, event: string, timeout: number = this.config.defaultTimeout): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for event: ${event}`));
            }, timeout);

            client.once(event, (data: unknown) => {
                clearTimeout(timer);
                resolve(data);
            });
        });
    }

    /**
     * Emit and wait for response
     */
    emitAndWait(client: AnyRecord, event: string, data: unknown, responseEvent: string, timeout: number = this.config.defaultTimeout): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for response to ${event}`));
            }, timeout);

            client.once(responseEvent, (response: unknown) => {
                clearTimeout(timer);
                resolve(response);
            });

            client.once(`${event.split(':')[0]}:error`, (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            });

            client.emit(event, data);
        });
    }

    /**
     * Emit with callback acknowledgment
     */
    emitWithAck(client: AnyRecord, event: string, data: unknown, timeout: number = this.config.defaultTimeout): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout waiting for ack on ${event}`));
            }, timeout);

            client.emit(event, data, (response: unknown) => {
                clearTimeout(timer);
                resolve(response);
            });
        });
    }

    /**
     * Register mock service
     */
    registerMockService(name: string, service: AnyRecord): void {
        this.mockServices[name] = service;
    }

    /**
     * Get mock service
     */
    getMockService(name: string): AnyRecord {
        return this.mockServices[name];
    }

    /**
     * Log an event (for debugging)
     */
    logEvent(event: string, data: unknown): void {
        this.eventLog.push({ event, data, timestamp: Date.now() });
    }

    /**
     * Get event log
     */
    getEventLog(): EventLogEntry[] {
        return [...this.eventLog];
    }

    /**
     * Clear event log
     */
    clearEventLog(): void {
        this.eventLog = [];
    }

    /**
     * Internal connection handler
     */
    _handleConnection(socket: AnyRecord): void {
        socket.sessionId = socket.handshake.auth?.sessionId || uuidv4();
        socket.roomCode = null;

        this.logEvent('connection', { socketId: socket.id, sessionId: socket.sessionId });

        socket.on('disconnect', (reason: string) => {
            this.logEvent('disconnect', { socketId: socket.id, reason });
        });
    }

    /**
     * Get the Socket.io server instance
     */
    getIO(): Server | null {
        return this.io;
    }

    /**
     * Get server URL
     */
    getUrl(): string {
        return `http://localhost:${this.config.port}`;
    }
}

// F-5: Import shared utilities from mocks.ts instead of duplicating them
// MockRedis class removed — use createMockRedis() from mocks.ts instead
const {
    createMockRedis,
    createMockPlayer,
    createMockRoom,
    createMockGame,
    generateRoomCode,
    sleep,
    flushPromises,
    drainMicrotasks,
    expectAsyncError
} = require('./mocks');

module.exports = {
    SocketTestServer,
    createMockRedis,
    createMockPlayer,
    createMockRoom,
    createMockGame,
    generateRoomCode,
    sleep,
    flushPromises,
    drainMicrotasks,
    expectAsyncError,
    DEFAULT_CONFIG
};
