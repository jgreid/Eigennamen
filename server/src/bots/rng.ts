/**
 * Deterministic seeded RNG for bots, backed by the same Mulberry32 generator
 * the board uses (services/game/boardGenerator). Routing every bot draw through
 * this makes (gameSeed, botSeed) fully reproduce a bot's play.
 */
import { seededRandom } from '../services/game/boardGenerator';
import type { SeededRng } from './strategies/types';

export function makeRng(seed: number): SeededRng {
    let state = seed >>> 0;
    return {
        next(): number {
            const value = seededRandom(state);
            // Advance the state by an odd constant so successive draws differ.
            state = (state + 0x9e3779b9) >>> 0;
            return value;
        },
        int(n: number): number {
            if (n <= 0) return 0;
            return Math.floor(this.next() * n);
        },
    };
}
