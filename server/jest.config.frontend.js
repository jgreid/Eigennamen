/**
 * Jest Configuration for Frontend (Browser) Tests
 *
 * Uses jsdom environment for DOM API access.
 * Tests for client-side JavaScript modules.
 */

module.exports = {
    // Use ts-jest for TypeScript test files
    preset: 'ts-jest',

    // jsdom environment for DOM APIs
    testEnvironment: 'jsdom',

    // Root directory
    rootDir: '.',

    // Only match frontend test files
    testMatch: [
        '**/__tests__/frontend/**/*.test.ts'
    ],

    // Ignore patterns
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/'
    ],

    // Transform configuration
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json'
        }]
    },

    // Test timeout
    testTimeout: 10000,

    verbose: true,
    clearMocks: true,
    restoreMocks: true,
    forceExit: true
};
