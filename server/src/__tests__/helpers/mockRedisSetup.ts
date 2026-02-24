/**
 * Shared Mock Redis Setup
 *
 * Provides a pre-configured mock for `../../config/redis` that uses the
 * centralized `createMockRedis()` factory. Test files can import the mock
 * instance directly and customize per-test behavior via jest mock APIs.
 *
 * Usage (at the top of a test file):
 *
 *   const { mockRedis, resetMockRedis } = require('../helpers/mockRedisSetup');
 *
 *   jest.mock('../../config/redis', () => require('../helpers/mockRedisSetup').redisMock);
 *
 *   // In beforeEach:
 *   beforeEach(() => { resetMockRedis(); });
 *
 * For tests that need `isRedisHealthy` or `isUsingMemoryMode`, override them:
 *
 *   jest.mock('../../config/redis', () => ({
 *       ...require('../helpers/mockRedisSetup').redisMock,
 *       isRedisHealthy: jest.fn(async () => true),
 *   }));
 */

const _mockFactories = require('./mocks');

// Shared mock Redis instance — persisted across requires within the same test file
let mockRedis = _mockFactories.createMockRedis();

/**
 * Reset all mock Redis state and jest mock counters.
 * Call this in beforeEach() to get a clean slate.
 */
function resetMockRedis(): void {
    mockRedis._clear();
    // Reset all jest.fn() call histories
    Object.keys(mockRedis).forEach((key: string) => {
        if (typeof mockRedis[key] === 'function' && mockRedis[key].mockClear) {
            mockRedis[key].mockClear();
        }
    });
}

/**
 * Replace the mock Redis instance entirely (e.g. to swap in a failing Redis).
 * Returns the new instance.
 */
function replaceMockRedis(newMock: Record<string, any>): Record<string, any> {
    mockRedis = newMock;
    return mockRedis;
}

/**
 * Get the current mock Redis instance.
 * Useful when the instance may have been replaced via replaceMockRedis().
 */
function getMockRedis(): Record<string, any> {
    return mockRedis;
}

// The module mock shape that jest.mock('../../config/redis', ...) expects
const redisMock = {
    getRedis: jest.fn(() => mockRedis),
    isRedisHealthy: jest.fn(async () => true),
    isUsingMemoryMode: jest.fn(() => false),
};

module.exports = {
    mockRedis,
    redisMock,
    resetMockRedis,
    replaceMockRedis,
    getMockRedis,
};
