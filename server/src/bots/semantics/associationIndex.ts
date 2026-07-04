/**
 * Shared association-index machinery: build the clue→words and word→concepts
 * lookups from an association table, and score the common-sense reading of a
 * word pair against it. Used by the baked table backend and by custom
 * semantic-map overlays (mapBackend) so both grade identically.
 *
 * Phase 2 (docs/BOT_NUANCE_PLAN.md): edges are WEIGHTED. A table entry may be
 * a plain word (weight 1 — the baked v1 tables keep working unchanged) or a
 * weighted edge carrying the per-edge channels (kind, penetration,
 * collocation) that feed SemanticBackend.edgeInfo / collocation.
 */
import { normalizeClueWord } from '../../shared/gameRules';
import { lexicalBackend, type EdgeKind } from './backend';

/** Per-edge metadata stored in the index. Weight defaults to 1 (a v1 edge). */
export interface EdgeMeta {
    weight: number;
    kind?: EdgeKind;
    /** Fame-of-fact: fraction of guessers retrieving this edge at table speed. */
    penetration?: number;
    /** Phrase/compound completion frequency of clue+word (either order). */
    collocation?: number;
}

/** One table entry: a bare word (weight 1) or a weighted, channelled edge. */
export type AssociationTarget =
    string | { word: string; weight?: number; kind?: EdgeKind; penetration?: number; collocation?: number };

export interface AssociationIndex {
    /** Normalized clue key → normalized related word → edge metadata. */
    readonly table: Map<string, Map<string, EdgeMeta>>;
    /** Inverted: normalized word → set of concept keys it belongs to. */
    readonly membership: Map<string, Set<string>>;
}

/**
 * Merge a duplicate edge (same clue→word from another map or batch): numeric
 * channels take the max — monotone and order-independent — and the kind is
 * kept from whichever edge declared one first.
 */
function mergeEdge(into: EdgeMeta, from: EdgeMeta): void {
    into.weight = Math.max(into.weight, from.weight);
    if (into.kind === undefined) into.kind = from.kind;
    if (from.penetration !== undefined) {
        into.penetration =
            into.penetration === undefined ? from.penetration : Math.max(into.penetration, from.penetration);
    }
    if (from.collocation !== undefined) {
        into.collocation =
            into.collocation === undefined ? from.collocation : Math.max(into.collocation, from.collocation);
    }
}

function toEdge(target: AssociationTarget): { word: string; meta: EdgeMeta } {
    if (typeof target === 'string') return { word: target, meta: { weight: 1 } };
    return {
        word: target.word,
        meta: {
            weight: target.weight ?? 1,
            kind: target.kind,
            penetration: target.penetration,
            collocation: target.collocation,
        },
    };
}

export function buildAssociationIndex(associations: Record<string, readonly AssociationTarget[]>): AssociationIndex {
    const table = new Map<string, Map<string, EdgeMeta>>();
    for (const [clue, targets] of Object.entries(associations)) {
        const key = normalizeClueWord(clue);
        let edges = table.get(key);
        if (!edges) {
            edges = new Map();
            table.set(key, edges);
        }
        for (const target of targets) {
            const { word, meta } = toEdge(target);
            const w = normalizeClueWord(word);
            const existing = edges.get(w);
            if (existing) mergeEdge(existing, meta);
            else edges.set(w, meta);
        }
    }
    const membership = new Map<string, Set<string>>();
    for (const [concept, edges] of table) {
        for (const w of edges.keys()) {
            let concepts = membership.get(w);
            if (!concepts) {
                concepts = new Set();
                membership.set(w, concepts);
            }
            concepts.add(concept);
        }
    }
    return { table, membership };
}

/** The strongest DIRECT edge between two words, in either lookup order. */
export function directEdgeMeta(index: AssociationIndex, a: string, b: string): EdgeMeta | null {
    const A = normalizeClueWord(a);
    const B = normalizeClueWord(b);
    const ab = index.table.get(A)?.get(B);
    const ba = index.table.get(B)?.get(A);
    if (ab && ba) return ab.weight >= ba.weight ? ab : ba;
    return ab ?? ba ?? null;
}

/**
 * Partial score for a given number of shared concept groups. Saturating and
 * always < 1 so a co-membership never outranks a full-weight direct edge:
 * 1 shared → 0.50, 2 → 0.67, 3 → 0.75, 4 → 0.80, … (1 - 1/(n+1)).
 */
function sharedConceptScore(shared: number): number {
    return shared > 0 ? 1 - 1 / (shared + 1) : 0;
}

/**
 * The common-sense reading of a pair against an index:
 *  - the direct clue→word edge weight (either lookup order, so relatedness
 *    stays symmetric) — 1 for a v1 edge, the curated weight for a v2 edge;
 *  - a graded co-membership score (never below the lexical floor) when both
 *    words share one or more concept groups — this is what lets a clicker
 *    make sense of a human clue that isn't itself a table key. A weighted
 *    direct edge never scores below this graded path either: an edge the
 *    table KNOWS is at least as related as one it merely infers;
 *  - null when the index carries NO signal for the pair — the caller decides
 *    the fallback (lexical floor for the baked table, the next backend in the
 *    chain for a custom-map overlay).
 */
export function scoreCommonAssociation(index: AssociationIndex, a: string, b: string): number | null {
    const direct = directEdgeMeta(index, a, b)?.weight ?? 0;

    const A = normalizeClueWord(a);
    const B = normalizeClueWord(b);
    let coMembership = 0;
    const ca = index.membership.get(A);
    const cb = index.membership.get(B);
    if (ca && cb) {
        let shared = 0;
        // Iterate the smaller set for a cheaper intersection.
        const [small, large] = ca.size <= cb.size ? [ca, cb] : [cb, ca];
        for (const c of small) if (large.has(c)) shared++;
        if (shared > 0) {
            coMembership = Math.max(sharedConceptScore(shared), lexicalBackend.relatedness(a, b));
        }
    }
    if (direct > 0 || coMembership > 0) return Math.max(direct, coMembership);
    return null;
}
