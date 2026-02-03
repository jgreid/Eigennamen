/**
 * Module Import/Export Validation Tests
 *
 * Static analysis tests that verify all named imports in the modular frontend
 * (server/public/js/modules/) reference symbols that are actually exported
 * by their source modules. Catches missing export errors at test time.
 */

const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.resolve(__dirname, '../../public/js/modules');

/**
 * Parse all named imports from a JS file's source.
 * Returns array of { symbols: string[], source: string, line: number }
 */
function parseImports(source) {
    const results = [];
    // Match: import { a, b, c } from './file.js';
    // Handles multiline imports
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(source)) !== null) {
        const symbols = match[1]
            .split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        const sourcePath = match[2];
        // Find line number
        const lineNum = source.substring(0, match.index).split('\n').length;
        results.push({ symbols, source: sourcePath, line: lineNum });
    }
    return results;
}

/**
 * Parse all named exports from a JS file's source.
 * Handles: export function name, export const name, export { name },
 * export async function name, export let name, export var name
 */
function parseExports(source) {
    const exports = new Set();

    // export function name / export async function name
    const funcRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
    let match;
    while ((match = funcRegex.exec(source)) !== null) {
        exports.add(match[1]);
    }

    // export const/let/var name
    const varRegex = /export\s+(?:const|let|var)\s+(\w+)/g;
    while ((match = varRegex.exec(source)) !== null) {
        exports.add(match[1]);
    }

    // export { name1, name2, ... }
    const namedRegex = /export\s*\{([^}]+)\}/g;
    while ((match = namedRegex.exec(source)) !== null) {
        match[1].split(',').forEach(s => {
            // Handle "name as alias" — export the alias
            const parts = s.trim().split(/\s+as\s+/);
            const exported = parts.length > 1 ? parts[1].trim() : parts[0].trim();
            if (exported) exports.add(exported);
        });
    }

    // export default — tracked as 'default'
    if (/export\s+default\s+/.test(source)) {
        exports.add('default');
    }

    return exports;
}

describe('Module import/export validation', () => {
    let moduleFiles;

    beforeAll(() => {
        // Skip if modules directory doesn't exist (e.g., CI without public assets)
        if (!fs.existsSync(MODULES_DIR)) {
            return;
        }
        moduleFiles = fs.readdirSync(MODULES_DIR).filter(f => f.endsWith('.js'));
    });

    it('modules directory should exist and contain JS files', () => {
        expect(fs.existsSync(MODULES_DIR)).toBe(true);
        expect(moduleFiles.length).toBeGreaterThan(0);
    });

    it('every named import should have a matching export in its source module', () => {
        const errors = [];

        for (const file of moduleFiles) {
            const filePath = path.join(MODULES_DIR, file);
            const source = fs.readFileSync(filePath, 'utf-8');
            const imports = parseImports(source);

            for (const imp of imports) {
                // Resolve relative source path
                const sourceName = imp.source.replace(/^\.\//, '');
                const sourceFile = path.join(MODULES_DIR, sourceName);

                if (!fs.existsSync(sourceFile)) {
                    errors.push(`${file}:${imp.line} imports from '${imp.source}' which does not exist`);
                    continue;
                }

                const sourceCode = fs.readFileSync(sourceFile, 'utf-8');
                const exportedSymbols = parseExports(sourceCode);

                for (const symbol of imp.symbols) {
                    if (!exportedSymbols.has(symbol)) {
                        errors.push(
                            `${file}:${imp.line} imports '${symbol}' from '${imp.source}', ` +
                            `but '${sourceName}' does not export it. ` +
                            `Available exports: ${[...exportedSymbols].sort().join(', ')}`
                        );
                    }
                }
            }
        }

        if (errors.length > 0) {
            throw new Error(`Found ${errors.length} import/export mismatch(es):\n  - ${errors.join('\n  - ')}`);
        }
    });
});
