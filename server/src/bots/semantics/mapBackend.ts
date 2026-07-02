/**
 * Custom semantic-map overlay backend (the "prepared custom word list" path).
 *
 * A semantic map is a JSON asset built OFFLINE for a specific custom word list
 * by `npm run bots:map` (scripts/build-semantic-map.mjs), which uses an LLM to
 * curate concept groups and pop-culture references over the list — the same
 * shape as the baked ASSOCIATIONS / PROPER_ASSOCIATIONS tables, but covering
 * words the built-in tables cannot. At runtime every map found in the maps
 * directory is loaded and merged into one overlay that sits in front of the
 * baked table: pairs the maps know are scored with full table-quality
 * semantics; everything else falls through the chain unchanged. Merging is
 * sound because associations are pairwise facts — a map's entries only ever
 * fire when its words are actually on the board.
 *
 * Chain order (selectBackend): vectors? → custom maps → baked table → lexical.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { SemanticBackend } from './backend';
import { lexicalBackend } from './backend';
import { buildAssociationIndex, scoreCommonAssociation, type AssociationIndex } from './associationIndex';
import { caseSignal, referenceSignal, type CaseSignal } from './properAssociations';
import { normalizeClueWord } from '../../shared/gameRules';
import logger from '../../utils/logger';

/** The on-disk semantic-map document produced by `npm run bots:map`. */
export interface SemanticMap {
    version: number;
    /** The word list the map was built for (provenance / debugging). */
    words: string[];
    /** Common-sense concept clues (UPPERCASE keys) → list words. */
    concepts: Record<string, string[]>;
    /** Proper-noun references (display-case keys) → list words. */
    proper?: Record<string, string[]>;
    /** Per-key recognizability prior in (0, 1] (concepts and references). */
    commonness?: Record<string, number>;
    /** Optional metadata the loader ignores (language, source hash, etc.). */
    [extra: string]: unknown;
}

/** Shape-validate a parsed JSON document as a SemanticMap. */
export function isSemanticMap(doc: unknown): doc is SemanticMap {
    if (typeof doc !== 'object' || doc === null) return false;
    const d = doc as Record<string, unknown>;
    if (d.version !== 1) return false;
    if (!Array.isArray(d.words) || !d.words.every((w) => typeof w === 'string')) return false;
    const isTable = (t: unknown): boolean =>
        typeof t === 'object' &&
        t !== null &&
        Object.values(t).every((v) => Array.isArray(v) && v.every((w) => typeof w === 'string'));
    if (!isTable(d.concepts)) return false;
    if (d.proper !== undefined && !isTable(d.proper)) return false;
    if (
        d.commonness !== undefined &&
        (typeof d.commonness !== 'object' ||
            d.commonness === null ||
            !Object.values(d.commonness).every((v) => typeof v === 'number' && v > 0 && v <= 1))
    ) {
        return false;
    }
    return true;
}

/**
 * Load every *.json semantic map in a directory. Invalid documents are logged
 * and skipped — one bad map must never take the bots down. Returns [] when the
 * directory doesn't exist (the common case: no prepared lists).
 */
export function loadSemanticMaps(dir: string): SemanticMap[] {
    let entries: string[];
    try {
        entries = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
        return [];
    }
    const maps: SemanticMap[] = [];
    for (const file of entries.sort()) {
        const path = join(dir, file);
        try {
            const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
            if (isSemanticMap(doc)) {
                maps.push(doc);
            } else {
                logger.warn(`Bot semantic map skipped (not a valid v1 map document): ${path}`);
            }
        } catch (err) {
            logger.warn(`Bot semantic map skipped (unreadable/unparsable): ${path}`, {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return maps;
}

/** A reference clue that misses is dampened — same rule as the baked table. */
const PROPER_MISS_DAMP = 0.5;

/**
 * Build one overlay backend from the loaded maps, delegating to `fallback`
 * (normally the baked table) whenever the maps carry no signal for a pair.
 * Case-signal semantics are identical to the baked table's.
 */
export function makeCustomMapBackend(maps: SemanticMap[], fallback: SemanticBackend): SemanticBackend {
    // Merge all maps: concept tables union into one index; proper references
    // and commonness merge with last-map-wins on exact-key collisions.
    const mergedConcepts: Record<string, string[]> = {};
    const properTable = new Map<string, Set<string>>();
    const properDisplay = new Map<string, string>();
    const conceptCommonness = new Map<string, number>();
    const properCommonness = new Map<string, number>();

    for (const map of maps) {
        for (const [key, words] of Object.entries(map.concepts)) {
            const k = normalizeClueWord(key);
            mergedConcepts[k] = [...(mergedConcepts[k] ?? []), ...words];
        }
        for (const [key, words] of Object.entries(map.proper ?? {})) {
            const k = normalizeClueWord(key);
            const existing = properTable.get(k) ?? new Set<string>();
            for (const w of words) existing.add(normalizeClueWord(w));
            properTable.set(k, existing);
            properDisplay.set(k, key);
        }
        for (const [key, value] of Object.entries(map.commonness ?? {})) {
            const k = normalizeClueWord(key);
            (caseSignal(key) === 'neutral' ? conceptCommonness : properCommonness).set(k, value);
        }
    }
    const index: AssociationIndex = buildAssociationIndex(mergedConcepts);

    const totalWords = new Set(maps.flatMap((m) => m.words.map((w) => normalizeClueWord(w)))).size;
    logger.info(
        `Bot semantics: loaded ${maps.length} custom semantic map(s) covering ${totalWords} words ` +
            `(${index.table.size} concepts, ${properTable.size} references). See docs/BOT_SEMANTIC_MAPS.md.`
    );

    /** Signal including this overlay's own canonical all-caps reference keys. */
    const signalFor = (word: string): CaseSignal => {
        const sig = referenceSignal(word);
        if (sig === 'neutral' && properDisplay.get(normalizeClueWord(word)) === word && /\p{Lu}/u.test(word)) {
            return 'proper';
        }
        return sig;
    };

    const properDirect = (a: string, b: string): number => {
        const A = normalizeClueWord(a);
        const B = normalizeClueWord(b);
        return properTable.get(A)?.has(B) || properTable.get(B)?.has(A) ? 1 : 0;
    };

    return {
        id: 'custom-map',
        relatedness(a: string, b: string): number {
            if (normalizeClueWord(a) === normalizeClueWord(b)) return 1;

            const aSig = signalFor(a);
            const bSig = signalFor(b);
            // Explicit lowercase = the common sense, period (see tableBackend).
            if (aSig === 'common' || bSig === 'common') {
                const common = scoreCommonAssociation(index, a, b);
                // The fallback applies the same lowercase semantics; take the
                // best common reading either layer knows (a combined list can
                // mix map words with default-table words on one board).
                return Math.max(common ?? 0, fallback.relatedness(a, b));
            }
            if (aSig === 'proper' || bSig === 'proper') {
                const reference = aSig === 'proper' ? a : b;
                const other = aSig === 'proper' ? b : a;
                const entry = properTable.get(normalizeClueWord(reference));
                if (entry) {
                    // This overlay KNOWS the reference: authoritative, same
                    // exclusion rule as the baked table.
                    if (entry.has(normalizeClueWord(other))) return 1;
                    return lexicalBackend.relatedness(a, b) * PROPER_MISS_DAMP;
                }
                // Unknown here — the baked proper table may know it.
                return fallback.relatedness(a, b);
            }
            // Neutral: best reading across this overlay and the fallback chain.
            const common = scoreCommonAssociation(index, a, b);
            return Math.max(common ?? 0, properDirect(a, b), fallback.relatedness(a, b));
        },
        vocabulary(): string[] {
            // Map concepts + display-cased references first (they cover the
            // custom words), then whatever the fallback offers.
            const own = [...index.table.keys(), ...properDisplay.values()];
            return [...own, ...(fallback.vocabulary ? fallback.vocabulary() : [])];
        },
        commonness(word: string): number {
            const key = normalizeClueWord(word);
            const concept = conceptCommonness.get(key);
            if (concept !== undefined) return concept;
            const fame = properCommonness.get(key);
            if (fame !== undefined && caseSignal(word) !== 'common') return fame;
            return fallback.commonness?.(word) ?? 1;
        },
    };
}
