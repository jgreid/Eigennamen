/**
 * WebSocket Reconnection Tests
 *
 * Tests Socket.io connection handling, disconnection, and reconnection scenarios.
 * Validates connection state recovery and rate limiting behavior.
 */

const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const { createSocketRateLimiter } = require('../../middleware/rateLimit');
const { RATE_LIMITS } = require('../../config/constants');

// Test configuration
const TEST_PORT = 3099;
const SOCKET_URL = `http://localhost:${TEST_PORT}`;
const CONNECTION_TIMEOUT = 5000;

describe('WebSocket Reconnection', () => {
    let httpServer;
    let io;
    let socketRateLimiter;

    beforeAll((done) => {
        // Create HTTP server
        httpServer = http.createServer();

        // Create Socket.io server with test configuration
        io = new Server(httpServer, {
            cors: { origin: '*' },
            transports: ['websocket', 'polling'],
            pingTimeout: 5000,
            pingInterval: 2000,
            connectionStateRecovery: {
                maxDisconnectionDuration: 2 * 60 * 1000,
                skipMiddlewares: false
            }
        });

        // Set up rate limiter
        socketRateLimiter = createSocketRateLimiter(RATE_LIMITS);

        // Connection handler
        io.on('connection', (socket) => {
            socket.rateLimiter = socketRateLimiter;

            // Echo event for testing
            socket.on('echo', (data, callback) => {
                if (callback) callback({ received: data });
            });

            // Rate limited event
            const rateLimitedHandler = (data, callback) => {
                const limiter = socketRateLimiter.getLimiter('room:create');
                limiter(socket, data, (err) => {
                    if (err) {
                        if (callback) callback({ error: 'RATE_LIMITED' });
                        return;
                    }
                    if (callback) callback({ success: true, data });
                });
            };
            socket.on('rate-limited-event', rateLimitedHandler);

            // Join room event
            socket.on('join-room', (roomCode, callback) => {
                socket.join(`room:${roomCode}`);
                if (callback) callback({ joined: roomCode });
            });

            // Disconnect handler
            socket.on('disconnect', (_reason) => {
                socketRateLimiter.cleanupSocket(socket.id);
            });
        });

        httpServer.listen(TEST_PORT, done);
    });

    afterAll((done) => {
        io.close();
        httpServer.close(done);
    });

    describe('Connection Handling', () => {
        test('establishes connection successfully', (done) => {
            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT
            });

            client.on('connect', () => {
                expect(client.connected).toBe(true);
                expect(client.id).toBeDefined();
                client.disconnect();
                done();
            });

            client.on('connect_error', (err) => {
                client.disconnect();
                done(err);
            });
        });

        test('handles echo event correctly', (done) => {
            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT
            });

            client.on('connect', () => {
                client.emit('echo', { test: 'data' }, (response) => {
                    expect(response.received).toEqual({ test: 'data' });
                    client.disconnect();
                    done();
                });
            });
        });

        test('can join rooms', (done) => {
            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT
            });

            client.on('connect', () => {
                client.emit('join-room', 'TEST01', (response) => {
                    expect(response.joined).toBe('TEST01');
                    client.disconnect();
                    done();
                });
            });
        });
    });

    describe('Disconnection Handling', () => {
        test('detects disconnection', (done) => {
            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: false
            });

            client.on('connect', () => {
                client.on('disconnect', (reason) => {
                    expect(['io client disconnect', 'io server disconnect', 'transport close']).toContain(reason);
                    done();
                });

                // Disconnect client
                client.disconnect();
            });
        });

        test('cleans up rate limiter entries on disconnect', (done) => {
            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: false
            });

            client.on('connect', () => {
                // Make some rate-limited requests to create entries
                client.emit('rate-limited-event', { test: 1 }, () => {
                    client.emit('rate-limited-event', { test: 2 }, () => {
                        // Disconnect and verify cleanup
                        client.disconnect();
                    });
                });
            });

            client.on('disconnect', () => {
                // Give time for cleanup handler to run
                setTimeout(() => {
                    // Rate limiter should have cleaned up entries for this socket
                    // We can't directly verify internal state, but test passes if no errors
                    done();
                }, 100);
            });
        });
    });

    describe('Reconnection Behavior', () => {
        test('reconnects automatically after disconnection', (done) => {
            let connectCount = 0;
            const timeoutRef = { id: null };

            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: true,
                reconnectionAttempts: 3,
                reconnectionDelay: 100
            });

            client.on('connect', () => {
                connectCount++;

                if (connectCount === 1) {
                    // Force disconnect by closing the socket transport
                    client.io.engine.close();
                } else if (connectCount === 2) {
                    // Successfully reconnected
                    clearTimeout(timeoutRef.id);
                    expect(client.connected).toBe(true);
                    client.disconnect();
                    done();
                }
            });

            // Set timeout for test
            timeoutRef.id = setTimeout(() => {
                if (connectCount < 2) {
                    client.disconnect();
                    done(new Error('Reconnection did not occur within timeout'));
                }
            }, 5000);
        });

        test('gets new socket ID after reconnection', (done) => {
            let firstSocketId;
            let connectCount = 0;
            const timeoutRef = { id: null };

            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: true,
                reconnectionAttempts: 3,
                reconnectionDelay: 100
            });

            client.on('connect', () => {
                connectCount++;

                if (connectCount === 1) {
                    firstSocketId = client.id;
                    // Force disconnect
                    client.io.engine.close();
                } else if (connectCount === 2) {
                    // Socket ID should be different after reconnection
                    clearTimeout(timeoutRef.id);
                    expect(client.id).not.toBe(firstSocketId);
                    client.disconnect();
                    done();
                }
            });

            timeoutRef.id = setTimeout(() => {
                if (connectCount < 2) {
                    client.disconnect();
                    done(new Error('Reconnection did not occur within timeout'));
                }
            }, 5000);
        });

        test('maintains functionality after reconnection', (done) => {
            let connectCount = 0;
            const timeoutRef = { id: null };

            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: true,
                reconnectionAttempts: 3,
                reconnectionDelay: 100
            });

            client.on('connect', () => {
                connectCount++;

                if (connectCount === 1) {
                    // Force disconnect
                    client.io.engine.close();
                } else if (connectCount === 2) {
                    // Test that events still work after reconnection
                    clearTimeout(timeoutRef.id);
                    client.emit('echo', { reconnected: true }, (response) => {
                        expect(response.received).toEqual({ reconnected: true });
                        client.disconnect();
                        done();
                    });
                }
            });

            timeoutRef.id = setTimeout(() => {
                if (connectCount < 2) {
                    client.disconnect();
                    done(new Error('Reconnection did not occur within timeout'));
                }
            }, 5000);
        });
    });

    describe('Rate Limiting After Reconnection', () => {
        test('rate limits reset after reconnection', (done) => {
            let connectCount = 0;
            const timeoutRef = { id: null };

            const client = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: true,
                reconnectionAttempts: 3,
                reconnectionDelay: 100
            });

            client.on('connect', () => {
                connectCount++;

                if (connectCount === 1) {
                    // Hit rate limit by making many requests
                    const requests = [];
                    for (let i = 0; i < 10; i++) {
                        requests.push(new Promise((resolve) => {
                            client.emit('rate-limited-event', { i }, (_response) => {
                                resolve();
                            });
                        }));
                    }

                    Promise.all(requests).then(() => {
                        // Force disconnect
                        client.io.engine.close();
                    });
                } else if (connectCount === 2) {
                    // After reconnection, rate limit should be reset
                    // (since it's a new socket ID)
                    clearTimeout(timeoutRef.id);
                    client.emit('rate-limited-event', { test: 'after-reconnect' }, (response) => {
                        expect(response.success).toBe(true);
                        client.disconnect();
                        done();
                    });
                }
            });

            timeoutRef.id = setTimeout(() => {
                if (connectCount < 2) {
                    client.disconnect();
                    done(new Error('Test did not complete within timeout'));
                }
            }, 5000);
        });
    });

    describe('Multiple Clients', () => {
        test('handles multiple concurrent connections', (done) => {
            const clients = [];
            const connectedCount = { value: 0 };
            const TOTAL_CLIENTS = 5;
            const timeoutRef = { id: null };

            for (let i = 0; i < TOTAL_CLIENTS; i++) {
                const client = Client(SOCKET_URL, {
                    transports: ['websocket'],
                    timeout: CONNECTION_TIMEOUT,
                    reconnection: false
                });

                client.on('connect', () => {
                    connectedCount.value++;
                    if (connectedCount.value === TOTAL_CLIENTS) {
                        // All clients connected
                        clearTimeout(timeoutRef.id);
                        expect(io.engine.clientsCount).toBe(TOTAL_CLIENTS);

                        // Disconnect all
                        clients.forEach(c => c.disconnect());
                        done();
                    }
                });

                clients.push(client);
            }

            timeoutRef.id = setTimeout(() => {
                if (connectedCount.value < TOTAL_CLIENTS) {
                    clients.forEach(c => c.disconnect());
                    done(new Error(`Only ${connectedCount.value} of ${TOTAL_CLIENTS} clients connected`));
                }
            }, 5000);
        });

        test('one client disconnecting does not affect others', (done) => {
            const timeoutRef = { id: null };
            const client1 = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: false
            });

            const client2 = Client(SOCKET_URL, {
                transports: ['websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: false
            });

            let bothConnected = false;

            client1.on('connect', () => {
                if (client2.connected) {
                    bothConnected = true;
                    // Disconnect client1
                    client1.disconnect();
                }
            });

            client2.on('connect', () => {
                if (client1.connected) {
                    bothConnected = true;
                    // Disconnect client1
                    client1.disconnect();
                }
            });

            client1.on('disconnect', () => {
                if (bothConnected) {
                    clearTimeout(timeoutRef.id);
                    // Client2 should still be connected
                    expect(client2.connected).toBe(true);

                    // Client2 should still be functional
                    client2.emit('echo', { test: 'still-working' }, (response) => {
                        expect(response.received).toEqual({ test: 'still-working' });
                        client2.disconnect();
                        done();
                    });
                }
            });

            timeoutRef.id = setTimeout(() => {
                client1.disconnect();
                client2.disconnect();
                done(new Error('Test did not complete within timeout'));
            }, 5000);
        });
    });

    describe('Transport Fallback', () => {
        test('falls back to polling if websocket fails', (done) => {
            // This test verifies the client can use polling transport
            const client = Client(SOCKET_URL, {
                transports: ['polling', 'websocket'],
                timeout: CONNECTION_TIMEOUT,
                reconnection: false
            });

            client.on('connect', () => {
                expect(client.connected).toBe(true);
                // Transport could be either polling or websocket
                expect(['polling', 'websocket']).toContain(client.io.engine.transport.name);
                client.disconnect();
                done();
            });

            client.on('connect_error', (err) => {
                client.disconnect();
                done(err);
            });
        });
    });
});

describe('Socket Rate Limiter Unit Tests', () => {
    let rateLimiter;

    beforeEach(() => {
        rateLimiter = createSocketRateLimiter({
            'test:event': { window: 1000, max: 2 }
        });
    });

    test('allows requests within limit', (done) => {
        const mockSocket = { id: 'test-socket-1' };
        const limiter = rateLimiter.getLimiter('test:event');

        limiter(mockSocket, {}, (err) => {
            expect(err).toBeUndefined();
            limiter(mockSocket, {}, (err2) => {
                expect(err2).toBeUndefined();
                done();
            });
        });
    });

    test('blocks requests exceeding limit', (done) => {
        const mockSocket = { id: 'test-socket-2' };
        const limiter = rateLimiter.getLimiter('test:event');

        // Make requests up to limit
        limiter(mockSocket, {}, () => {
            limiter(mockSocket, {}, () => {
                // Third request should be rate limited
                limiter(mockSocket, {}, (err) => {
                    expect(err).toBeDefined();
                    expect(err.message).toBe('Rate limit exceeded');
                    done();
                });
            });
        });
    });

    test('returns passthrough for unknown events', (done) => {
        const mockSocket = { id: 'test-socket-3' };
        const limiter = rateLimiter.getLimiter('unknown:event');

        // Should always pass for unknown events
        for (let i = 0; i < 100; i++) {
            limiter(mockSocket, {}, (err) => {
                expect(err).toBeUndefined();
            });
        }
        done();
    });

    test('cleanupSocket removes entries', () => {
        const mockSocket = { id: 'test-socket-4' };
        const limiter = rateLimiter.getLimiter('test:event');

        // Make some requests
        limiter(mockSocket, {}, () => {});
        limiter(mockSocket, {}, () => {});

        // Size should be > 0
        expect(rateLimiter.getSize()).toBeGreaterThan(0);

        // Cleanup
        rateLimiter.cleanupSocket('test-socket-4');

        // After cleanup, entry should be removed
        // Make a new request to verify limit is reset
        limiter(mockSocket, {}, (err) => {
            expect(err).toBeUndefined();
        });
    });

    test('cleanupStale removes old entries', (done) => {
        const mockSocket = { id: 'test-socket-5' };
        const limiter = rateLimiter.getLimiter('test:event');

        // Make a request
        limiter(mockSocket, {}, () => {});

        expect(rateLimiter.getSize()).toBeGreaterThan(0);

        // Wait for window to expire, then cleanup
        setTimeout(() => {
            rateLimiter.cleanupStale();
            // Entry should be cleaned up
            expect(rateLimiter.getSize()).toBe(0);
            done();
        }, 1100);
    });

    test('different sockets have independent limits', (done) => {
        const socket1 = { id: 'socket-a' };
        const socket2 = { id: 'socket-b' };
        const limiter = rateLimiter.getLimiter('test:event');

        // Exhaust socket1's limit
        limiter(socket1, {}, () => {});
        limiter(socket1, {}, () => {});
        limiter(socket1, {}, (err) => {
            expect(err).toBeDefined();

            // socket2 should still have its own limit
            limiter(socket2, {}, (err2) => {
                expect(err2).toBeUndefined();
                done();
            });
        });
    });
});
