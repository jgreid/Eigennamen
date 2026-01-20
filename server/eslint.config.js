/**
 * ESLint Configuration for Codenames Server (ESLint 9 Flat Config)
 */

const globals = require('globals');

module.exports = [
    {
        // Global ignores
        ignores: ['node_modules/**', 'coverage/**', 'prisma/**']
    },
    {
        // Main configuration for all JS files
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2021
            }
        },
        rules: {
            // Error prevention
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
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
        }
    },
    {
        // Test files have relaxed rules
        files: ['src/__tests__/**/*.js', '**/*.test.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.jest
            }
        },
        rules: {
            'no-console': 'off',
            'require-await': 'off',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
        }
    }
];
