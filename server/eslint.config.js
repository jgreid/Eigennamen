/**
 * ESLint Configuration for Eigennamen Server (ESLint 9 Flat Config)
 * Supports both JavaScript and TypeScript files
 */

const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

// Base rules shared between JS and TS
const baseRules = {
    // Error prevention
    'no-undef': 'error',
    'no-console': 'warn',
    'no-debugger': 'error',

    // Best practices
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-throw-literal': 'off', // Codebase uses custom error objects with codes
    'no-return-await': 'warn',
    'require-await': 'warn',

    // Async/await
    'no-async-promise-executor': 'error',
    'no-await-in-loop': 'warn',

    // Security
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
};

module.exports = [
    {
        // Global ignores
        ignores: ['node_modules/**', 'coverage/**', 'dist/**'],
    },
    {
        // TypeScript files configuration (non-type-checked rules for faster linting)
        files: ['src/**/*.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2021,
            },
            parser: require('@typescript-eslint/parser'),
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
        },
        rules: {
            ...baseRules,
            // Disable base rules that have TS equivalents
            'no-unused-vars': 'off',
            'no-undef': 'off', // TypeScript handles this
            'require-await': 'off',
            'no-return-await': 'off',

            // TypeScript-specific rules (non-type-checked for performance)
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-non-null-assertion': 'warn',
            '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
            // Note: Type-checked rules (require-await, no-floating-promises, etc.)
            // are enforced by TypeScript compiler, not ESLint, for better performance
        },
    },
    {
        // Frontend TypeScript modules (browser environment, not Node)
        files: ['src/frontend/**/*.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2021,
                EigennamenClient: 'readonly',
                qrcode: 'readonly',
                io: 'readonly',
            },
            parser: require('@typescript-eslint/parser'),
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
        },
        rules: {
            ...baseRules,
            'no-unused-vars': 'off',
            'no-undef': 'off', // TypeScript handles this via globals.d.ts
            'require-await': 'off',
            'no-return-await': 'off',
            'no-console': 'off', // Console is fine for frontend debugging
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/consistent-type-imports': 'off', // Not useful for browser ES modules
        },
    },
    {
        // These files legitimately use sequential await in loops for Redis ops
        files: [
            'src/services/gameService.ts',
            'src/services/playerService.ts',
            'src/services/player/reconnection.ts',
            'src/config/redis.ts',
            'src/utils/distributedLock.ts',
            'src/routes/adminRoutes.ts',
            'src/routes/admin/statsRoutes.ts',
            'src/routes/admin/roomRoutes.ts',
        ],
        rules: {
            'no-await-in-loop': 'off',
        },
    },
    {
        // Test files have relaxed rules (TypeScript)
        files: ['src/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.jest,
            },
            parser: require('@typescript-eslint/parser'),
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': require('@typescript-eslint/eslint-plugin'),
        },
        rules: {
            'no-console': 'off',
            'require-await': 'off',
            'no-await-in-loop': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
    // Prettier: disables ESLint rules that conflict with Prettier formatting.
    // Must be last to override any formatting rules from earlier configs.
    prettierConfig,
];
