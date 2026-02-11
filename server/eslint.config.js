/**
 * ESLint Configuration for Codenames Server (ESLint 9 Flat Config)
 * Supports both JavaScript and TypeScript files
 */

const globals = require('globals');

// Base rules shared between JS and TS
const baseRules = {
    // Error prevention
    'no-undef': 'error',
    'no-console': 'warn',
    'no-debugger': 'error',

    // Best practices
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-throw-literal': 'off', // Codebase uses custom error objects with codes
    'no-return-await': 'warn',
    'require-await': 'warn',

    // Code style (relaxed for existing codebase)
    'semi': ['error', 'always'],
    'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    'indent': ['warn', 4, { SwitchCase: 1 }],
    'comma-dangle': 'off',
    'no-trailing-spaces': 'warn',
    'no-multiple-empty-lines': ['warn', { max: 2, maxEOF: 1 }],

    // Async/await
    'no-async-promise-executor': 'error',
    'no-await-in-loop': 'warn',

    // Security
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error'
};

module.exports = [
    {
        // Global ignores
        ignores: ['node_modules/**', 'coverage/**', 'prisma/**', 'dist/**']
    },
    {
        // TypeScript files configuration (non-type-checked rules for faster linting)
        files: ['src/**/*.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2021
            },
            parser: require('@typescript-eslint/parser'),
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            }
        },
        plugins: {
            '@typescript-eslint': require('@typescript-eslint/eslint-plugin')
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
            '@typescript-eslint/explicit-function-return-type': 'off', // Too strict for migration
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-non-null-assertion': 'warn',
            '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }]
            // Note: Type-checked rules (require-await, no-floating-promises, etc.)
            // are enforced by TypeScript compiler, not ESLint, for better performance
        }
    },
    {
        // Memory storage implements Redis-compatible async interface with sync ops
        files: ['src/config/memoryStorage.ts'],
        rules: {
            'require-await': 'off'
        }
    },
    {
        // These files legitimately use sequential await in loops for Redis ops
        files: [
            'src/services/gameService.ts',
            'src/services/playerService.ts',
            'src/config/redis.ts',
            'src/config/database.ts',
            'src/config/memoryStorage.ts',
            'src/utils/retry.ts',
            'src/utils/distributedLock.ts',
            'src/socket/reliableEmit.ts',
            'src/routes/adminRoutes.ts'
        ],
        rules: {
            'no-await-in-loop': 'off'
        }
    },
    {
        // Test files have relaxed rules (TypeScript)
        files: ['src/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.jest
            },
            parser: require('@typescript-eslint/parser'),
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module'
            }
        },
        plugins: {
            '@typescript-eslint': require('@typescript-eslint/eslint-plugin')
        },
        rules: {
            'no-console': 'off',
            'require-await': 'off',
            'no-await-in-loop': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off'
        }
    }
];
