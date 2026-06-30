/**
 * Spymaster strategies (Phase 1).
 *
 *  - randomSpymaster: emits an arbitrary LEGAL clue word from a small built-in
 *    vocabulary plus a small number. It carries no semantic signal — it exists
 *    so a bot can occupy a spymaster seat and a bot-only game runs end to end
 *    with NO external assets. Semantic spymasters (embedding/MCTS) arrive in
 *    Phase 3 behind the same contract.
 */
import type { BotAction, BotSpymasterView, BotContext, SpymasterStrategy, SkillParams } from './types';
import type { SemanticBackend } from '../semantics/backend';
import { defaultSemanticBackend } from '../semantics/backend';
import { isClueLegalForBoard } from '../../shared/gameRules';

/** Abstract words unlikely to collide with a Codenames board; filtered for
 *  legality at runtime so a collision is simply skipped. */
const CLUE_VOCAB = [
    'SIGNAL',
    'MATTER',
    'SYSTEM',
    'REASON',
    'METHOD',
    'FACTOR',
    'THEORY',
    'ENERGY',
    'MEMORY',
    'OPTION',
    'REGION',
    'SOURCE',
    'MOMENT',
    'NATURE',
    'VALUE',
    'LOGIC',
    'RANGE',
    'OBJECT',
    'TARGET',
    'SAMPLE',
    'VECTOR',
    'BUFFER',
    'THREAD',
    'CONCEPT',
    'PATTERN',
] as const;

function countOwnUnrevealed(view: BotSpymasterView): number {
    let n = 0;
    for (let i = 0; i < view.types.length; i++) {
        if (view.types[i] === view.team && !view.revealed[i]) n++;
    }
    return n;
}

/**
 * Pick a last-resort clue when no vocabulary word is legal for the board. Each
 * candidate is validated with the SAME isClueLegalForBoard the authoritative
 * submitClue path uses, so the bot never emits a clue the server would reject —
 * a rejected clue ends the bot tick with no retry, stalling its turn. Returns
 * the first legal candidate; only in a pathological board (every candidate
 * collides) does it fall through to the first word.
 */
const FALLBACK_CLUES = ['CLUE', 'HINT', 'TOPIC', 'THEME', 'NOTION', 'ASPECT', 'DETAIL', 'SUBJECT'] as const;

function pickFallbackClue(view: BotSpymasterView): string {
    const words = view.words as string[];
    for (const w of FALLBACK_CLUES) {
        if (isClueLegalForBoard(w, words)) return w;
    }
    return FALLBACK_CLUES[0];
}

export function makeRandomSpymaster(_skill: SkillParams): SpymasterStrategy {
    return {
        strategyId: 'randomSpymaster',
        chooseClue(view: BotSpymasterView, ctx: BotContext): BotAction {
            const legal = CLUE_VOCAB.filter((w) => isClueLegalForBoard(w, view.words as string[]));
            const pool = legal.length > 0 ? legal : [pickFallbackClue(view)];
            const word = pool[ctx.rng.int(pool.length)] as string;
            // A small, conservative number bounded by remaining own cards.
            const own = countOwnUnrevealed(view);
            const number = Math.max(1, Math.min(own || 1, 3));
            return { kind: 'clue', word, number };
        },
    };
}

/** A board word grouped by how it relates to the clue-giving team. */
interface BoardGroups {
    own: string[];
    assassin: string[];
    opponent: string[];
    neutral: string[];
}

function groupBoard(view: BotSpymasterView): BoardGroups {
    const other = view.team === 'red' ? 'blue' : 'red';
    const g: BoardGroups = { own: [], assassin: [], opponent: [], neutral: [] };
    for (let i = 0; i < view.types.length; i++) {
        if (view.revealed[i]) continue;
        const w = view.words[i] as string;
        const t = view.types[i];
        if (t === view.team) g.own.push(w);
        else if (t === 'assassin') g.assassin.push(w);
        else if (t === other) g.opponent.push(w);
        else g.neutral.push(w);
    }
    return g;
}

const MAX_CLUE_NUMBER = 4;

/** Result of scoring a candidate clue against the board. */
interface ClueEval {
    /** Own cards the clicker would take before crossing onto any non-own card. */
    leadOwn: number;
    /** Sort key: leadOwn, tie-broken by how clear (safe) the clue is. */
    score: number;
}

/**
 * Score a candidate clue the way the CLICKER will actually act on it: a clicker
 * reveals the highest-relatedness unrevealed card. So a clue is worth exactly the
 * number of the spymaster's OWN cards that out-rank EVERY non-own card by a safety
 * margin — those are the ones the clicker takes before it would cross onto a
 * neutral / opponent / (worst of all) the assassin.
 *
 * This relative ranking replaces an absolute relatedness threshold, so it works
 * the same for the asset-free lexical floor, the baked table, and real
 * embeddings (whose cosine scale differs). It inherently avoids the assassin
 * (own cards must beat it), with an extra margin near the assassin since touching
 * it loses instantly. Returns null when no own card leads safely.
 */
function evaluateClue(clue: string, groups: BoardGroups, backend: SemanticBackend, margin: number): ClueEval | null {
    if (groups.own.length === 0) return null;
    const own = groups.own.map((w) => backend.relatedness(clue, w)).sort((a, b) => b - a);
    const nonOwn = [...groups.opponent, ...groups.neutral, ...groups.assassin].map((w) => backend.relatedness(clue, w));
    const maxNonOwn = nonOwn.length > 0 ? Math.max(...nonOwn) : 0;
    const assassinMax =
        groups.assassin.length > 0 ? Math.max(...groups.assassin.map((w) => backend.relatedness(clue, w))) : 0;

    // Count own cards that clear every non-own card by the safety margin.
    let leadOwn = 0;
    for (const r of own) {
        if (r >= maxNonOwn + margin) leadOwn++;
        else break;
    }
    if (leadOwn === 0) return null;

    // The assassin is catastrophic, so demand a wider berth: drop any intended
    // card that doesn't clear the closest assassin by twice the margin.
    while (leadOwn > 0 && (own[leadOwn - 1] as number) - assassinMax < margin * 2) leadOwn--;
    if (leadOwn === 0) return null;

    // Prefer covering more cards; tie-break toward a clearer (wider-margin) clue.
    const safety = Math.min(0.999, Math.max(0, (own[leadOwn - 1] as number) - maxNonOwn));
    return { leadOwn, score: leadOwn + safety };
}

/**
 * Last-resort scoring when no clue links an own card safely (e.g. a custom word
 * list the backend barely covers). Every clue here is a gamble, so pick the
 * LEAST-bad legal clue: above all never let the assassin be the clicker's most
 * related card (instant loss), and among assassin-safe clues prefer the one whose
 * single closest board card is actually OURS (so a number-1 guess lands on own).
 * Always returns a clue when `pool` is non-empty — the caller only needs a
 * deeper fallback when there is no legal candidate at all. Board-derived, so it
 * varies by game rather than emitting a constant placeholder.
 */
function pickBestEffort(pool: readonly string[], groups: BoardGroups, backend: SemanticBackend): string | null {
    const maxRel = (words: readonly string[], clue: string): number =>
        words.length > 0 ? Math.max(...words.map((w) => backend.relatedness(clue, w))) : 0;
    const nonOwn = [...groups.opponent, ...groups.neutral, ...groups.assassin];

    let best: { word: string; ownGap: number; assassinSafe: boolean } | null = null;
    for (const clue of pool) {
        const topOwn = maxRel(groups.own, clue);
        const assassinMax = maxRel(groups.assassin, clue);
        // assassinSafe: some own card out-ranks every assassin, so the clicker's
        // global argmax can't be the assassin. ownGap > 0: an own card is the
        // global argmax, so a number-1 guess lands on ours rather than an opponent.
        const assassinSafe = topOwn > assassinMax;
        const ownGap = topOwn - maxRel(nonOwn, clue);
        const better =
            !best ||
            (assassinSafe && !best.assassinSafe) ||
            (assassinSafe === best.assassinSafe && ownGap > best.ownGap);
        if (better) best = { word: clue, ownGap, assassinSafe };
    }
    return best ? best.word : null;
}

/**
 * Semantic spymaster: scans the backend's clue vocabulary and picks the clue that
 * lets the clicker safely take the most own cards (see evaluateClue). Uses the
 * table backend by default; a real embedding backend drops in unchanged and makes
 * it markedly stronger. With only the lexical floor it degrades gracefully to a
 * best-effort, board-derived clue rather than a constant placeholder.
 */
export function makeEmbeddingSpymaster(
    skill: SkillParams,
    backend: SemanticBackend = defaultSemanticBackend
): SpymasterStrategy {
    const vocab = backend.vocabulary ? backend.vocabulary() : [];
    return {
        strategyId: 'embeddingSpymaster',
        chooseClue(view: BotSpymasterView, ctx: BotContext): BotAction {
            const groups = groupBoard(view);
            const legalVocab = vocab.filter((c) => isClueLegalForBoard(c, view.words as string[]));

            // Occasional blunder: a random legal clue (weak-player model).
            if (legalVocab.length > 0 && ctx.rng.next() < skill.blunderRate) {
                const word = legalVocab[ctx.rng.int(legalVocab.length)] as string;
                return { kind: 'clue', word, number: 1 };
            }

            // A larger safety margin = more cautious (fewer, safer cards per clue).
            const margin = 0.05 + 0.1 * skill.riskAversion;

            let best: { word: string; leadOwn: number; score: number } | null = null;
            for (const clue of legalVocab) {
                const ev = evaluateClue(clue, groups, backend, margin);
                if (ev && (!best || ev.score > best.score)) {
                    best = { word: clue, leadOwn: ev.leadOwn, score: ev.score };
                }
            }

            // Nothing leads safely: fall back to the least-bad legal clue, which
            // still refuses to make the assassin the clicker's top pick. Try the
            // backend vocab first, then the built-in abstract words, so even a board
            // the backend can't cover at all gets an assassin-safe placeholder
            // rather than a random one.
            const legalBuiltins = CLUE_VOCAB.filter((w) => isClueLegalForBoard(w, view.words as string[]));
            const word =
                best?.word ??
                pickBestEffort(legalVocab, groups, backend) ??
                pickBestEffort(legalBuiltins, groups, backend);
            if (!word) {
                return { kind: 'clue', word: pickFallbackClue(view), number: 1 };
            }

            const number = Math.max(1, Math.min(best?.leadOwn ?? 1, MAX_CLUE_NUMBER));
            return { kind: 'clue', word, number };
        },
    };
}
