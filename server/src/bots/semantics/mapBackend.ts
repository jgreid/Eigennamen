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
 * Two document versions are accepted (Phase 2 of docs/BOT_NUANCE_PLAN.md):
 *  - v1: unweighted string lists — every edge loads at weight 1, exactly the
 *    pre-Phase-2 behaviour.
 *  - v2: weighted edges carrying the per-edge channels (weight, kind,
 *    penetration, collocation) behind SemanticBackend.edgeInfo/collocation,
 *    and structured proper entries ({ contents, fame, rivals? } — rivals are
 *    validated and carried for Phase 3's rival-referent sweep).
 *
 * Chain order (selectBackend): vectors? → custom maps → baked table → lexical.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { EdgeInfo, EdgeKind, SemanticBackend } from './backend';
import { lexicalBackend } from './backend';
import {
    buildAssociationIndex,
    directEdgeMeta,
    scoreCommonAssociation,
    type AssociationIndex,
    type EdgeMeta,
} from './associationIndex';
import { caseSignal, referenceSignal, type CaseSignal } from './properAssociations';
import { normalizeClueWord } from '../../shared/gameRules';
import logger from '../../utils/logger';

/** A v2 map edge: a bare word (weight 1) or a weighted, channelled edge. */
export type SemanticMapEdge =
    string | { word: string; weight?: number; kind?: EdgeKind; penetration?: number; collocation?: number };

/** A v2 structured proper entry. `rivals` (other referents the same clue word
 *  evokes, whose contents also pull guesses) are validated and carried here
 *  but consumed in Phase 3's rival-referent sweep. */
export interface SemanticMapReference {
    contents: SemanticMapEdge[];
    /** Recognizability of the reference itself in (0, 1]. */
    fame?: number;
    rivals?: Array<{ referent: string; fame?: number; contents: SemanticMapEdge[] }>;
}

/** The on-disk semantic-map document produced by `npm run bots:map`. */
export interface SemanticMap {
    version: 1 | 2;
    /** The word list the map was built for (provenance / debugging). */
    words: string[];
    /** Common-sense concept clues (UPPERCASE keys) → list words / edges. */
    concepts: Record<string, SemanticMapEdge[]>;
    /** Proper-noun references (display-case keys) → list words / edges (v1 or
     *  v2 list form) or a structured entry (v2). */
    proper?: Record<string, SemanticMapEdge[] | SemanticMapReference>;
    /** Per-key recognizability prior in (0, 1] (concepts and references). */
    commonness?: Record<string, number>;
    /** Optional metadata the loader ignores (language, source hash, etc.). */
    [extra: string]: unknown;
}

// Typed against EdgeKind so the validator cannot drift from the type (a kind
// accepted here but missing from EDGE_ABSTRACTNESS would otherwise reach the
// scorer; a kind added to EdgeKind but not here just fail-closes validation).
const EDGE_KINDS: readonly EdgeKind[] = ['content', 'member', 'part', 'compound', 'function', 'attribute'];

/** A channel value: a number in (0, 1]. */
const inUnit = (v: unknown): boolean => typeof v === 'number' && v > 0 && v <= 1;

const isWeightedEdge = (e: unknown): boolean => {
    if (typeof e === 'string') return true;
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return false;
    const d = e as Record<string, unknown>;
    if (typeof d.word !== 'string') return false;
    if (d.weight !== undefined && !inUnit(d.weight)) return false;
    if (d.penetration !== undefined && !inUnit(d.penetration)) return false;
    if (d.collocation !== undefined && !inUnit(d.collocation)) return false;
    if (d.kind !== undefined && !(typeof d.kind === 'string' && (EDGE_KINDS as readonly string[]).includes(d.kind))) {
        return false;
    }
    return true;
};

const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((w) => typeof w === 'string');
const isEdgeArray = (v: unknown): boolean => Array.isArray(v) && v.every(isWeightedEdge);

/** A v2 proper entry: an edge list, or { contents, fame?, rivals? }. */
const isReferenceEntry = (v: unknown): boolean => {
    if (isEdgeArray(v)) return true;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const d = v as Record<string, unknown>;
    if (!isEdgeArray(d.contents)) return false;
    if (d.fame !== undefined && !inUnit(d.fame)) return false;
    if (d.rivals !== undefined) {
        if (!Array.isArray(d.rivals)) return false;
        for (const r of d.rivals) {
            if (typeof r !== 'object' || r === null) return false;
            const rr = r as Record<string, unknown>;
            if (typeof rr.referent !== 'string') return false;
            if (rr.fame !== undefined && !inUnit(rr.fame)) return false;
            if (!isEdgeArray(rr.contents)) return false;
        }
    }
    return true;
};

/** Shape-validate a parsed JSON document as a SemanticMap (v1 or v2). */
export function isSemanticMap(doc: unknown): doc is SemanticMap {
    if (typeof doc !== 'object' || doc === null) return false;
    const d = doc as Record<string, unknown>;
    if (d.version !== 1 && d.version !== 2) return false;
    if (!Array.isArray(d.words) || !d.words.every((w) => typeof w === 'string')) return false;
    const isRecordOf = (t: unknown, valueOk: (v: unknown) => boolean): boolean =>
        typeof t === 'object' && t !== null && !Array.isArray(t) && Object.values(t).every(valueOk);
    if (d.version === 1) {
        // v1 stays strictly the original shape: plain string lists only.
        if (!isRecordOf(d.concepts, isStringArray)) return false;
        if (d.proper !== undefined && !isRecordOf(d.proper, isStringArray)) return false;
    } else {
        if (!isRecordOf(d.concepts, isEdgeArray)) return false;
        if (d.proper !== undefined && !isRecordOf(d.proper, isReferenceEntry)) return false;
    }
    if (
        d.commonness !== undefined &&
        (typeof d.commonness !== 'object' ||
            d.commonness === null ||
            !Object.values(d.commonness).every((v) => inUnit(v)))
    ) {
        return false;
    }
    return true;
}

/** Hard ceiling on a single map file. Loading is synchronous (startup /
 *  first decision), so a runaway file must be skipped, not parsed: a real
 *  map for a full custom list is tens of KB — 20 MB is already absurd. */
const MAX_MAP_FILE_BYTES = 20 * 1024 * 1024;

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
            const size = statSync(path).size;
            if (size > MAX_MAP_FILE_BYTES) {
                logger.warn(
                    `Bot semantic map skipped (file too large: ${size} bytes > ${MAX_MAP_FILE_BYTES}): ${path}`
                );
                continue;
            }
            const doc: unknown = JSON.parse(readFileSync(path, 'utf8'));
            if (isSemanticMap(doc)) {
                maps.push(doc);
            } else {
                logger.warn(`Bot semantic map skipped (not a valid v1/v2 map document): ${path}`);
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

/** The edge list of a proper entry, whichever form it was written in. */
function referenceContents(entry: SemanticMapEdge[] | SemanticMapReference): SemanticMapEdge[] {
    return Array.isArray(entry) ? entry : entry.contents;
}

/**
 * Build one overlay backend from the loaded maps, delegating to `fallback`
 * (normally the baked table) whenever the maps carry no signal for a pair.
 * Case-signal semantics are identical to the baked table's.
 */
export function makeCustomMapBackend(maps: SemanticMap[], fallback: SemanticBackend): SemanticBackend {
    // Merge all maps: concept tables union into one weighted index (duplicate
    // edges keep their strongest channels — see buildAssociationIndex); proper
    // references and commonness merge with last-map-wins on exact-key
    // collisions. The proper table reuses the same weighted-index machinery,
    // read only through direct-edge lookups (references have no co-membership
    // semantics).
    const mergedConcepts: Record<string, SemanticMapEdge[]> = {};
    const mergedProper: Record<string, SemanticMapEdge[]> = {};
    const properDisplay = new Map<string, string>();
    const conceptCommonness = new Map<string, number>();
    const properCommonness = new Map<string, number>();
    // Rival referents per reference key (Phase 3): normalized weighted
    // contents whose pull is scaled by the rival's fame — same reading rule as
    // the baked table's PROPER_RIVALS.
    const mapRivals = new Map<string, Array<{ fame: number; contents: Map<string, number> }>>();
    const DEFAULT_RIVAL_FAME = 0.5;

    for (const map of maps) {
        for (const [key, edges] of Object.entries(map.concepts)) {
            const k = normalizeClueWord(key);
            mergedConcepts[k] = [...(mergedConcepts[k] ?? []), ...edges];
        }
        for (const [key, entry] of Object.entries(map.proper ?? {})) {
            const k = normalizeClueWord(key);
            mergedProper[k] = [...(mergedProper[k] ?? []), ...referenceContents(entry)];
            properDisplay.set(k, key);
            if (!Array.isArray(entry)) {
                if (entry.fame !== undefined) properCommonness.set(k, entry.fame);
                if (entry.rivals && entry.rivals.length > 0) {
                    const list = mapRivals.get(k) ?? [];
                    for (const r of entry.rivals) {
                        list.push({
                            fame: r.fame ?? DEFAULT_RIVAL_FAME,
                            contents: new Map(
                                r.contents.map((e) =>
                                    typeof e === 'string'
                                        ? [normalizeClueWord(e), 1]
                                        : [normalizeClueWord(e.word), e.weight ?? 1]
                                )
                            ),
                        });
                    }
                    mapRivals.set(k, list);
                }
            }
        }
        for (const [key, value] of Object.entries(map.commonness ?? {})) {
            const k = normalizeClueWord(key);
            (caseSignal(key) === 'neutral' ? conceptCommonness : properCommonness).set(k, value);
        }
    }
    const index: AssociationIndex = buildAssociationIndex(mergedConcepts);
    const properIndex: AssociationIndex = buildAssociationIndex(mergedProper);

    const totalWords = new Set(maps.flatMap((m) => m.words.map((w) => normalizeClueWord(w)))).size;
    logger.info(
        `Bot semantics: loaded ${maps.length} custom semantic map(s) covering ${totalWords} words ` +
            `(${index.table.size} concepts, ${properIndex.table.size} references). See docs/BOT_SEMANTIC_MAPS.md.`
    );

    /** Signal including this overlay's own canonical all-caps reference keys. */
    const signalFor = (word: string): CaseSignal => {
        const sig = referenceSignal(word);
        if (sig === 'neutral' && properDisplay.get(normalizeClueWord(word)) === word && /\p{Lu}/u.test(word)) {
            return 'proper';
        }
        return sig;
    };

    /** Strongest direct proper edge for the pair (either side the reference). */
    const properEdge = (a: string, b: string): EdgeMeta | null => directEdgeMeta(properIndex, a, b);

    /** A rival referent's content pull for `other` under `refKey`, scaled by
     *  the rival's fame (0 when no rival reaches it). */
    const rivalPull = (refKey: string, other: string): number => {
        let best = 0;
        for (const rival of mapRivals.get(refKey) ?? []) {
            const w = rival.contents.get(other);
            if (w !== undefined && w * rival.fame > best) best = w * rival.fame;
        }
        return best;
    };

    /** Best proper reading of a pair — direct edge or rival pull, with either
     *  side as the reference key (used by the signal-less neutral branch). */
    const properReading = (a: string, b: string): number => {
        const A = normalizeClueWord(a);
        const B = normalizeClueWord(b);
        let best = 0;
        if (properIndex.table.has(A)) {
            best = Math.max(properIndex.table.get(A)?.get(B)?.weight ?? 0, rivalPull(A, B));
        }
        if (properIndex.table.has(B)) {
            best = Math.max(best, properIndex.table.get(B)?.get(A)?.weight ?? 0, rivalPull(B, A));
        }
        return best;
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
                const refKey = normalizeClueWord(reference);
                const entry = properIndex.table.get(refKey);
                if (entry) {
                    // This overlay KNOWS the reference: authoritative, same
                    // exclusion rule as the baked table. A weighted edge scores
                    // its curated weight (1 for a v1 edge); a rival referent's
                    // content pulls at weight × rival fame.
                    const other = normalizeClueWord(aSig === 'proper' ? b : a);
                    const edge = entry.get(other);
                    if (edge) return edge.weight;
                    const rival = rivalPull(refKey, other);
                    if (rival > 0) return rival;
                    return lexicalBackend.relatedness(a, b) * PROPER_MISS_DAMP;
                }
                // Unknown here — the baked proper table may know it.
                return fallback.relatedness(a, b);
            }
            // Neutral: best reading across this overlay and the fallback chain.
            const common = scoreCommonAssociation(index, a, b);
            return Math.max(common ?? 0, properReading(a, b), fallback.relatedness(a, b));
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
        edgeInfo(clue: string, word: string): EdgeInfo | null {
            // Same case-signal routing as relatedness: a lowercase clue never
            // reads the proper table, a reference-signalled clue never reads
            // the concept table, and a neutral pair takes the stronger edge.
            const aSig = signalFor(clue);
            const bSig = signalFor(word);
            let edge: EdgeMeta | null;
            if (aSig === 'common' || bSig === 'common') {
                edge = directEdgeMeta(index, clue, word);
            } else if (aSig === 'proper' || bSig === 'proper') {
                edge = properEdge(clue, word);
            } else {
                const concept = directEdgeMeta(index, clue, word);
                const proper = properEdge(clue, word);
                edge = concept && proper ? (concept.weight >= proper.weight ? concept : proper) : (concept ?? proper);
            }
            if (!edge) return fallback.edgeInfo?.(clue, word) ?? null;
            return { strength: edge.weight, kind: edge.kind, penetration: edge.penetration };
        },
        collocation(a: string, b: string): number {
            // Phrase formation is case-independent ("engine box" is the same
            // compound however the clue was cased), so no signal routing here —
            // just the strongest phrase channel any layer knows for the pair.
            const own = Math.max(directEdgeMeta(index, a, b)?.collocation ?? 0, properEdge(a, b)?.collocation ?? 0);
            return Math.max(own, fallback.collocation?.(a, b) ?? 0);
        },
    };
}
