/**
 * jsdom polyfills for the frontend Jest project.
 *
 * jsdom does not expose TextEncoder/TextDecoder on its global, but every
 * browser the frontend targets does — and the standalone URL codec relies on
 * them for UTF-8-safe word encoding (R6). Borrow Node's implementations.
 */
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

const g = globalThis as unknown as Record<string, unknown>;
if (typeof g['TextEncoder'] === 'undefined') {
    g['TextEncoder'] = NodeTextEncoder;
}
if (typeof g['TextDecoder'] === 'undefined') {
    g['TextDecoder'] = NodeTextDecoder;
}
