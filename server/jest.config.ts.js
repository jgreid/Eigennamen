/**
 * Unified Jest Configuration
 *
 * Uses Jest's `projects` feature to run backend (node) and frontend (jsdom)
 * tests from a single config. This replaces the previous separate configs:
 *   - jest.config.ts.js (backend)
 *   - jest.config.frontend.js (frontend)
 */

/** Shared settings applied to all projects */
const sharedConfig = {
    preset: 'ts-jest',
    rootDir: '.',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json'
        }]
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    testTimeout: 10000,
    clearMocks: true,
    restoreMocks: true,
};

module.exports = {
    // Top-level settings
    verbose: true,
    forceExit: true,
    detectOpenHandles: true,
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],

    projects: [
        // ── Backend tests (Node environment) ──
        {
            ...sharedConfig,
            displayName: 'backend',
            testEnvironment: 'node',
            moduleDirectories: ['node_modules', 'src'],
            testMatch: [
                '**/__tests__/**/*.test.ts'
            ],
            testPathIgnorePatterns: [
                '/node_modules/',
                '/dist/',
                '/helpers/',
                '/__tests__/frontend/'
            ],
            transformIgnorePatterns: [
                '/node_modules/(?!(@socket.io|socket.io-client)/)'
            ],
            moduleNameMapper: {
                '^@/(.*)$': '<rootDir>/src/$1',
                '^@config/(.*)$': '<rootDir>/src/config/$1',
                '^@services/(.*)$': '<rootDir>/src/services/$1',
                '^@errors/(.*)$': '<rootDir>/src/errors/$1',
                '^@utils/(.*)$': '<rootDir>/src/utils/$1',
                '^@middleware/(.*)$': '<rootDir>/src/middleware/$1',
                '^@routes/(.*)$': '<rootDir>/src/routes/$1',
                '^@socket/(.*)$': '<rootDir>/src/socket/$1',
                '^@validators/(.*)$': '<rootDir>/src/validators/$1',
                '^@types/(.*)$': '<rootDir>/src/types/$1'
            },
            collectCoverageFrom: [
                'src/**/*.ts',
                '!src/index.ts',
                '!src/__tests__/**',
                '!src/types/**',
                '!src/frontend/**'
            ],
            // Note: Global thresholds are lower because redis.ts, memoryStorage.ts, and
            // socket/index.ts are infrastructure modules that require integration tests
            // (real Redis, real Socket.IO) for meaningful coverage. Business logic modules
            // (services, handlers, middleware) individually exceed 80%.
            coverageThreshold: {
                global: {
                    branches: 65,
                    functions: 80,
                    lines: 75,
                    statements: 75
                }
            },
        },

        // ── Frontend tests (jsdom environment) ──
        {
            ...sharedConfig,
            displayName: 'frontend',
            testEnvironment: 'jsdom',
            testMatch: [
                '**/__tests__/frontend/**/*.test.ts'
            ],
            testPathIgnorePatterns: [
                '/node_modules/',
                '/dist/'
            ],
        },
    ],
};
