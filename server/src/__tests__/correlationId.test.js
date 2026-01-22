/**
 * Correlation ID Utility Tests
 */

const {
    getContext,
    getCorrelationId,
    getSessionId,
    getRoomCode,
    getContextFields,
    withContext,
    withNewCorrelation,
    createChildContext,
    createContextFromSocket,
    createContextFromRequest,
    correlationMiddleware,
    socketCorrelationMiddleware,
    wrapHandler,
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

    describe('getSessionId', () => {
        test('returns null when no context', () => {
            expect(getSessionId()).toBeNull();
        });

        test('returns sessionId from context', () => {
            withContext({ sessionId: 'session-789' }, () => {
                expect(getSessionId()).toBe('session-789');
            });
        });
    });

    describe('getRoomCode', () => {
        test('returns null when no context', () => {
            expect(getRoomCode()).toBeNull();
        });

        test('returns roomCode from context', () => {
            withContext({ roomCode: 'ROOM12' }, () => {
                expect(getRoomCode()).toBe('ROOM12');
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

    describe('withNewCorrelation', () => {
        test('creates new correlation ID', () => {
            let capturedId;
            withNewCorrelation(() => {
                capturedId = getCorrelationId();
            });
            expect(capturedId).toBeDefined();
            expect(typeof capturedId).toBe('string');
            expect(capturedId.length).toBeGreaterThan(0);
        });

        test('accepts additional context', () => {
            withNewCorrelation(() => {
                expect(getSessionId()).toBe('my-session');
            }, { sessionId: 'my-session' });
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

    describe('wrapHandler', () => {
        test('wraps handler with correlation context', async () => {
            const socket = {
                correlationContext: { correlationId: 'handler-corr' }
            };

            const handler = jest.fn(async (_s) => {
                return getCorrelationId();
            });

            const wrapped = wrapHandler(handler);
            const result = await wrapped(socket);

            expect(result).toBe('handler-corr');
            expect(handler).toHaveBeenCalledWith(socket);
        });

        test('creates new correlation ID if no context', async () => {
            const handler = jest.fn(async () => {
                return getCorrelationId();
            });

            const wrapped = wrapHandler(handler);
            const result = await wrapped({});

            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
        });
    });

    describe('createChildContext', () => {
        test('creates child context with parent fields', () => {
            withContext({ correlationId: 'parent-123', sessionId: 'sess' }, () => {
                const child = createChildContext({ roomCode: 'ROOM01' });

                expect(child.parentCorrelationId).toBe('parent-123');
                expect(child.sessionId).toBe('sess');
                expect(child.roomCode).toBe('ROOM01');
                expect(child.correlationId).toBeDefined();
            });
        });

        test('uses provided correlation ID if given', () => {
            withContext({ correlationId: 'parent-456' }, () => {
                const child = createChildContext({ correlationId: 'child-789' });

                expect(child.correlationId).toBe('child-789');
                expect(child.parentCorrelationId).toBe('parent-456');
            });
        });

        test('works without parent context', () => {
            const child = createChildContext({ roomCode: 'ROOM02' });

            expect(child.roomCode).toBe('ROOM02');
            expect(child.correlationId).toBeDefined();
        });
    });

    describe('CORRELATION_HEADER constant', () => {
        test('equals x-correlation-id', () => {
            expect(CORRELATION_HEADER).toBe('x-correlation-id');
        });
    });
});
