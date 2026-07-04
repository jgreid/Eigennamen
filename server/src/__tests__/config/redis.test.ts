jest.mock('../../utils/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

import { reconnectStrategy } from '../../config/redis';
import logger from '../../utils/logger';

describe('reconnectStrategy', () => {
    let exitSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    afterEach(() => {
        exitSpy.mockRestore();
    });

    test('returns a backoff delay for attempts within budget', () => {
        const delay = reconnectStrategy(0);
        expect(typeof delay).toBe('number');
        expect(delay).toBeGreaterThanOrEqual(100);
        expect(exitSpy).not.toHaveBeenCalled();
    });

    test('backoff delay is capped at 15s even for large retry counts within budget', () => {
        const delay = reconnectStrategy(20) as number;
        // baseDelay is capped at 15000, plus up to 20% jitter
        expect(delay).toBeLessThanOrEqual(15000 * 1.2);
        expect(exitSpy).not.toHaveBeenCalled();
    });

    test('exits the process once retries exceed the budget', () => {
        reconnectStrategy(21);
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('max reconnection attempts'));
    });

    test('exits on every subsequent call past the budget, not just the first', () => {
        reconnectStrategy(25);
        reconnectStrategy(100);
        expect(exitSpy).toHaveBeenCalledTimes(2);
        expect(exitSpy).toHaveBeenNthCalledWith(1, 1);
        expect(exitSpy).toHaveBeenNthCalledWith(2, 1);
    });
});
