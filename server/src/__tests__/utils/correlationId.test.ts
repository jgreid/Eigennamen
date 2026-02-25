const {
    getContext,
    getCorrelationId,
    getContextFields,
    withContext,
} = require('../../utils/correlationId');

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

});
