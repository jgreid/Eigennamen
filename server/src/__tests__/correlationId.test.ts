/**
 * Correlation ID Utility Tests
 */

const {
    getContext,
    getCorrelationId,
    getContextFields,
    withContext,
    createContextFromSocket,
    createContextFromRequest,
    correlationMiddleware,
    socketCorrelationMiddleware,
    CORRELATION_HEADER
} = require('../utils/correlationId');

describe('Correlation ID Utility', () => {
    describe('getContext', () => {
        test('returns undefined when no context', () => {
            expect(getContext()).toBeUndefined();
        });

        test('returns context when in withContext', () => {
            const testContext = { correlationId: 'test-123' };
            withContext(testContext, () => {
                expect(getContext()).toBe(testContext);
            });
        });
    });

    describe('getCorrelationId', () => {
        test('returns null when no context', () => {
            expect(getCorrelationId()).toBeNull();
        });

        test('returns correlationId from context', () => {
            withContext({ correlationId: 'test-456' }, () => {
                expect(getCorrelationId()).toBe('test-456');
            });
        });
    });

    describe('getContextFields', () => {
        test('returns empty object when no context', () => {
            expect(getContextFields()).toEqual({});
        });

        test('returns context fields', () => {
            const context = {
                correlationId: 'corr-123',
                sessionId: 'sess-456',
                roomCode: 'ROOM01',
                instanceId: 'inst-789'
            };

            withContext(context, () => {
                expect(getContextFields()).toEqual({
                    correlationId: 'corr-123',
                    sessionId: 'sess-456',
                    roomCode: 'ROOM01',
                    instanceId: 'inst-789'
                });
            });
        });
    });

    describe('withContext', () => {
        test('runs function with context', () => {
            const result = withContext({ correlationId: 'test' }, () => {
                return getCorrelationId();
            });
            expect(result).toBe('test');
        });

        test('supports nested contexts', () => {
            withContext({ correlationId: 'outer' }, () => {
                expect(getCorrelationId()).toBe('outer');

                withContext({ correlationId: 'inner' }, () => {
                    expect(getCorrelationId()).toBe('inner');
                });

                expect(getCorrelationId()).toBe('outer');
            });
        });
    });

    describe('createContextFromSocket', () => {
        test('creates context from socket with correlation header', () => {
            const socket = {
                handshake: {
                    headers: {
                        'x-correlation-id': 'existing-corr-id'
                    }
                },
                sessionId: 'socket-session',
                roomCode: 'ROOM99',
                id: 'socket-id-123'
            };

            const context = createContextFromSocket(socket);
            expect(context.correlationId).toBe('existing-corr-id');
            expect(context.sessionId).toBe('socket-session');
            expect(context.roomCode).toBe('ROOM99');
            expect(context.socketId).toBe('socket-id-123');
        });

        test('generates new correlation ID when no header', () => {
            const socket = {
                handshake: { headers: {} },
                sessionId: 'session-1',
                id: 'socket-1'
            };

            const context = createContextFromSocket(socket);
            expect(context.correlationId).toBeDefined();
            expect(context.correlationId.length).toBeGreaterThan(0);
        });

        test('handles missing handshake', () => {
            const socket = {
                sessionId: 'session-1',
                id: 'socket-1'
            };

            const context = createContextFromSocket(socket);
            expect(context.correlationId).toBeDefined();
        });
    });

    describe('createContextFromRequest', () => {
        test('creates context from request with correlation header', () => {
            const req = {
                headers: {
                    'x-correlation-id': 'req-corr-id'
                },
                sessionId: 'req-session',
                method: 'GET',
                path: '/api/test'
            };

            const context = createContextFromRequest(req);
            expect(context.correlationId).toBe('req-corr-id');
            expect(context.sessionId).toBe('req-session');
            expect(context.method).toBe('GET');
            expect(context.path).toBe('/api/test');
        });

        test('generates new correlation ID when no header', () => {
            const req = {
                headers: {},
                method: 'POST',
                path: '/api/rooms'
            };

            const context = createContextFromRequest(req);
            expect(context.correlationId).toBeDefined();
            expect(context.correlationId.length).toBeGreaterThan(0);
        });
    });

    describe('correlationMiddleware', () => {
        test('sets correlation ID on response and request', () => {
            let capturedContext;
            const req = {
                headers: { 'x-correlation-id': 'middleware-corr' },
                method: 'GET',
                path: '/test'
            };
            const res = {
                setHeader: jest.fn()
            };
            const next = jest.fn(() => {
                capturedContext = req.correlationContext;
            });

            correlationMiddleware(req, res, next);

            expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'middleware-corr');
            expect(next).toHaveBeenCalled();
            expect(capturedContext).toBeDefined();
            expect(capturedContext.correlationId).toBe('middleware-corr');
        });

        test('generates correlation ID when not provided', () => {
            const req = {
                headers: {},
                method: 'POST',
                path: '/rooms'
            };
            const res = {
                setHeader: jest.fn()
            };
            const next = jest.fn();

            correlationMiddleware(req, res, next);

            expect(res.setHeader).toHaveBeenCalledWith(
                'x-correlation-id',
                expect.any(String)
            );
        });
    });

    describe('socketCorrelationMiddleware', () => {
        test('attaches correlation context to socket', () => {
            const socket = {
                handshake: {
                    headers: { 'x-correlation-id': 'socket-corr' }
                },
                sessionId: 'sess-1',
                id: 'socket-1'
            };
            const next = jest.fn();

            socketCorrelationMiddleware(socket, next);

            expect(socket.correlationContext).toBeDefined();
            expect(socket.correlationContext.correlationId).toBe('socket-corr');
            expect(socket.correlationId).toBe('socket-corr');
            expect(next).toHaveBeenCalled();
        });
    });

    describe('CORRELATION_HEADER constant', () => {
        test('equals x-correlation-id', () => {
            expect(CORRELATION_HEADER).toBe('x-correlation-id');
        });
    });
});
