/**
 * Jest Configuration for TypeScript Tests
 *
 * This configuration is used when running `npm run test:ts`
 * It extends the base Jest config to support both JS and TS files.
 */

module.exports = {
    // Use ts-jest for TypeScript files
    preset: 'ts-jest',

    // Test environment
    testEnvironment: 'node',

    // Root directory
    rootDir: '.',

    // Module directories
    moduleDirectories: ['node_modules', 'src'],

    // File extensions to consider
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

    // Test file patterns - support both JS and TS
    testMatch: [
        '**/__tests__/**/*.test.ts',
        '**/__tests__/**/*.test.js'
    ],

    // Ignore patterns
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/',
        '/helpers/'
    ],

    // Transform configuration
    transform: {
        // Use ts-jest for TypeScript files
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
            // Faster compilation for tests
            isolatedModules: true
        }],
        // Use default for JavaScript files
        '^.+\\.jsx?$': 'babel-jest'
    },

    // Don't transform node_modules except specific packages
    transformIgnorePatterns: [
        '/node_modules/(?!(@socket.io|socket.io-client)/)'
    ],

    // Module path aliases (match tsconfig.json)
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

    // Coverage collection
    collectCoverageFrom: [
        'src/**/*.ts',
        'src/**/*.js',
        '!src/index.js',
        '!src/index.ts',
        '!src/__tests__/**',
        '!src/types/**'
    ],

    // Coverage thresholds (same as JS config)
    coverageThreshold: {
        global: {
            branches: 80,
            functions: 80,
            lines: 80,
            statements: 80
        }
    },

    // Coverage output
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],

    // Setup files
    setupFilesAfterEnv: [],

    // Test timeout
    testTimeout: 10000,

    // Verbose output
    verbose: true,

    // Clear mocks between tests
    clearMocks: true,

    // Restore mocks between tests
    restoreMocks: true,

    // Detect open handles
    detectOpenHandles: true,

    // Force exit after tests complete
    forceExit: true
};
