/**
 * Spymaster strategies.
 *
 *  - randomSpymaster: emits an arbitrary LEGAL clue word from a small built-in
 *    vocabulary plus a small number. It carries no semantic signal — it exists
 *    so a bot can occupy a spymaster seat and a bot-only game runs end to end
 *    with NO external assets.
 *  - embeddingSpymaster: the real semantic spymaster. It scores every legal
 *    candidate clue with a multi-factor model (coverage, clarity, a graded
 *    assassin penalty, and a defensive "don't arm the opponent" penalty), then
 *    selects among the candidates with a temperature-controlled softmax. That
 *    single strategy spans the whole difficulty range: at temperature 0 it plays
 *    the argmax ("scary good"); at higher temperatures it samples plausible-but-
 *    suboptimal clues ("off-kilter but sensible"). riskAversion drives caution
 *    (safety margin + how hard it avoids the assassin and helping the opponent);
 *    blunderRate injects the occasional outright-random clue.
 */
import type { BotAction, BotSpymasterView, BotContext, SpymasterStrategy, SkillParams, SeededRng } from './types';
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
    const isMatch = view.gameMode === 'match';
    const g: BoardGroups = { own: [], assassin: [], opponent: [], neutral: [] };
    for (let i = 0; i < view.types.length; i++) {
        if (view.revealed[i]) continue;
        const w = view.words[i] as string;
        const t = view.types[i];
        if (t === view.team) {
            // Match mode: an OWN card with negative value (a trap) costs points if
            // revealed, so never steer the clicker toward it — treat it as avoid.
            const value = isMatch ? (view.cardScores?.[i] ?? 0) : 1;
            if (isMatch && value < 0) g.neutral.push(w);
            else g.own.push(w);
        } else if (t === 'assassin') g.assassin.push(w);
        else if (t === other) g.opponent.push(w);
        else g.neutral.push(w);
    }
    return g;
}

const MAX_CLUE_NUMBER = 4;

// Scoring weights. leadOwn (an integer card count) is the dominant term; the
// rest are sub-unit adjustments so coverage always wins between comparably-safe
// clues, while the penalties still break ties toward safer / less-helpful clues.
const CLARITY_WEIGHT = 0.4;
const ASSASSIN_WEIGHT = 1.5;
const OPPONENT_WEIGHT = 0.8;
// Match mode: bonus per extra point of value the covered own cards carry beyond
// one-per-card. Zero effect outside match, where every card's value() is 1.
const VALUE_WEIGHT = 0.3;

/** Result of scoring a candidate clue against the board. */
interface ClueEval {
    word: string;
    /** Own cards the clicker would take before crossing onto any non-own card. */
    leadOwn: number;
    /** Ranking key: leadOwn, adjusted for clarity, assassin risk, and defense. */
    score: number;
}

/** Highest relatedness of `clue` to any word in `words` (0 if the group is empty). */
function maxRel(words: readonly string[], clue: string, backend: SemanticBackend): number {
    return words.length > 0 ? Math.max(...words.map((w) => backend.relatedness(clue, w))) : 0;
}

/**
 * Score a candidate clue the way the CLICKER will actually act on it (it reveals
 * the highest-relatedness unrevealed card), then shade the raw coverage by three
 * strategic factors:
 *
 *  - clarity: the gap between the weakest intended own card and the best non-own
 *    card — a wider gap is a clue the clicker is less likely to misread.
 *  - assassin penalty (graded): the closer the clue sits to the assassin, the
 *    worse, scaled by caution. The old hard filter is kept as a floor, but this
 *    adds the missing gradient so a clue that merely flirts with the assassin
 *    loses to an equally-covering clue that stays well clear.
 *  - opponent penalty (defensive, "don't arm them"): a clue that also lights up
 *    the opponent's cards teaches their clicker something, so it is penalised —
 *    scaled by caution, so a cautious/expert bot prefers clues that leave the
 *    opponent's board dark while a reckless bot barely cares.
 *
 * `caution` is riskAversion in [0,1]; the safety margin widens with it. Returns
 * null when no own card leads safely.
 */
function scoreClue(
    clue: string,
    groups: BoardGroups,
    backend: SemanticBackend,
    caution: number,
    valueOf: (word: string) => number
): ClueEval | null {
    if (groups.own.length === 0) return null;
    const margin = 0.05 + 0.1 * caution;

    // Keep each own card's value alongside its relatedness so the intended set
    // (the top-leadOwn by relatedness) can be scored by total value in match mode.
    const ownScored = groups.own
        .map((w) => ({ rel: backend.relatedness(clue, w), value: valueOf(w) }))
        .sort((a, b) => b.rel - a.rel);
    const own = ownScored.map((o) => o.rel);
    const maxOpp = maxRel(groups.opponent, clue, backend);
    const maxNeu = maxRel(groups.neutral, clue, backend);
    const maxAss = maxRel(groups.assassin, clue, backend);
    const maxNonOwn = Math.max(maxOpp, maxNeu, maxAss);

    // Count own cards that clear every non-own card by the safety margin.
    let leadOwn = 0;
    for (const r of own) {
        if (r >= maxNonOwn + margin) leadOwn++;
        else break;
    }
    if (leadOwn === 0) return null;

    // The assassin is catastrophic, so demand a wider berth: drop any intended
    // card that doesn't clear the closest assassin by twice the margin.
    while (leadOwn > 0 && (own[leadOwn - 1] as number) - maxAss < margin * 2) leadOwn--;
    if (leadOwn === 0) return null;

    const weakestIntended = own[leadOwn - 1] as number;
    const clarity = Math.min(0.999, Math.max(0, weakestIntended - maxNonOwn));
    // Graded, caution-scaled penalties. Absolute maxAss / maxOpp are fine here:
    // between two clues that both cover the same cards, the one that stays
    // further from the assassin / the opponent's cards wins.
    const assassinPenalty = caution * ASSASSIN_WEIGHT * maxAss;
    const opponentPenalty = caution * OPPONENT_WEIGHT * maxOpp;
    // Match value-awareness: reward covering higher-value own cards. In non-match
    // every value() is 1, so coveredValue === leadOwn and the bonus is exactly 0.
    const coveredValue = ownScored.slice(0, leadOwn).reduce((s, c) => s + c.value, 0);
    const valueBonus = VALUE_WEIGHT * (coveredValue - leadOwn);

    const score = leadOwn + CLARITY_WEIGHT * clarity - assassinPenalty - opponentPenalty + valueBonus;
    return { word: clue, leadOwn, score };
}

/**
 * Choose one candidate by its score, controlled by temperature:
 *  - temperature <= 0: deterministic argmax (strongest play). Ties resolve to the
 *    first candidate, matching the previous strict-greater selection.
 *  - temperature > 0: softmax sample over scores, so weaker-but-sensible clues
 *    get picked in proportion to how good they are. Higher temperature = flatter
 *    distribution = more "off-kilter". All randomness flows through ctx.rng.
 */
function selectByTemperature(candidates: ClueEval[], temperature: number, rng: SeededRng): ClueEval {
    let best = candidates[0] as ClueEval;
    if (temperature <= 0 || candidates.length === 1) {
        for (const c of candidates) if (c.score > best.score) best = c;
        return best;
    }
    for (const c of candidates) if (c.score > best.score) best = c;
    const maxScore = best.score;
    const weights = candidates.map((c) => Math.exp((c.score - maxScore) / temperature));
    const total = weights.reduce((a, w) => a + w, 0);
    let r = rng.next() * total;
    for (let i = 0; i < candidates.length; i++) {
        r -= weights[i] as number;
        if (r <= 0) return candidates[i] as ClueEval;
    }
    return best;
}

/**
 * Last-resort clue when no clue links an own card safely (e.g. a custom word
 * list the backend barely covers). Every clue here is a gamble, so pick the
 * LEAST-bad legal clue: above all never let the assassin be the clicker's most
 * related card (instant loss), and among assassin-safe clues prefer the one whose
 * single closest board card is actually OURS. Returns the chosen word plus a
 * board-derived number (how many own cards out-rank every opponent/assassin
 * card), so a salvageable best-effort clue no longer collapses to a constant 1.
 */
function pickBestEffort(
    pool: readonly string[],
    groups: BoardGroups,
    backend: SemanticBackend
): { word: string; number: number } | null {
    const dangerous = [...groups.opponent, ...groups.assassin];

    let best: { word: string; ownGap: number; assassinSafe: boolean } | null = null;
    for (const clue of pool) {
        const topOwn = maxRel(groups.own, clue, backend);
        const assassinMax = maxRel(groups.assassin, clue, backend);
        // assassinSafe: some own card out-ranks every assassin, so the clicker's
        // global argmax can't be the assassin. ownGap > 0: an own card is the
        // global argmax, so a number-1 guess lands on ours rather than an opponent.
        const assassinSafe = topOwn > assassinMax;
        const ownGap = topOwn - maxRel([...groups.opponent, ...groups.neutral, ...groups.assassin], clue, backend);
        const better =
            !best ||
            (assassinSafe && !best.assassinSafe) ||
            (assassinSafe === best.assassinSafe && ownGap > best.ownGap);
        if (better) best = { word: clue, ownGap, assassinSafe };
    }
    if (!best) return null;
    const chosenWord = best.word;

    // Number: own cards that safely out-rank every dangerous (opponent/assassin)
    // card by a hair, so the clicker's first guesses land on ours.
    const dangerMax = maxRel(dangerous, chosenWord, backend);
    const ownAheadOfDanger = groups.own.filter((w) => backend.relatedness(chosenWord, w) > dangerMax).length;
    const number = Math.max(1, Math.min(MAX_CLUE_NUMBER, ownAheadOfDanger));
    return { word: chosenWord, number };
}

// Candidate-generation breadth. A broad set drawn near the whole own-card
// centroid surfaces clues that cover many own cards; per-card neighbours surface
// specific, safe single-card clues. Only used when the backend supports nearest().
const CENTROID_NEIGHBOURS = 40;
const PER_CARD_NEIGHBOURS = 8;

/**
 * The legal clue words to consider for a board. With an embedding backend that
 * supports nearest(), this GENERATES board-specific candidates from the whole
 * model vocabulary — words near the own cards — which is what produces strong,
 * creative clues. With a table/lexical backend (no nearest) it degrades to
 * scanning the fixed vocabulary(), so those backends behave exactly as before.
 */
function generateClueCandidates(view: BotSpymasterView, groups: BoardGroups, backend: SemanticBackend): string[] {
    const legal = (words: string[]): string[] => words.filter((c) => isClueLegalForBoard(c, view.words as string[]));

    if (backend.nearest && groups.own.length > 0) {
        const pool = new Set<string>();
        for (const c of backend.nearest(groups.own, CENTROID_NEIGHBOURS)) pool.add(c.word);
        for (const w of groups.own) {
            for (const c of backend.nearest([w], PER_CARD_NEIGHBOURS)) pool.add(c.word);
        }
        const legalPool = legal([...pool]);
        if (legalPool.length > 0) return legalPool;
    }

    return legal(backend.vocabulary ? backend.vocabulary() : []);
}

/**
 * Semantic spymaster: GENERATES board-specific candidate clues (via the backend's
 * nearest() when available, else a fixed-vocabulary scan), scores each with the
 * multi-factor model above, then selects with a temperature-controlled softmax —
 * so a single strategy spans "scary good" (temperature 0, embeddings) to
 * "off-kilter but sensible" (high temperature). When the backend covers the board
 * too poorly for any clue to lead safely, it degrades to a board-derived,
 * assassin-safe best-effort clue rather than a constant placeholder.
 */
export function makeEmbeddingSpymaster(
    skill: SkillParams,
    backend: SemanticBackend = defaultSemanticBackend
): SpymasterStrategy {
    return {
        strategyId: 'embeddingSpymaster',
        chooseClue(view: BotSpymasterView, ctx: BotContext): BotAction {
            const groups = groupBoard(view);
            const legalCandidates = generateClueCandidates(view, groups, backend);

            // Match mode: value each own card by its point value so the scorer can
            // prefer clues that cover the most valuable cards. Every value is 1
            // outside match, making the value term a no-op there.
            const isMatch = view.gameMode === 'match';
            const values = new Map<string, number>();
            if (isMatch && view.cardScores) {
                for (let i = 0; i < view.words.length; i++) {
                    values.set(view.words[i] as string, view.cardScores[i] ?? 0);
                }
            }
            const valueOf = (w: string): number => (isMatch ? (values.get(w) ?? 0) : 1);

            // Occasional blunder: a random legal clue (weak-player model).
            if (legalCandidates.length > 0 && ctx.rng.next() < skill.blunderRate) {
                const word = legalCandidates[ctx.rng.int(legalCandidates.length)] as string;
                return { kind: 'clue', word, number: 1 };
            }

            // Score every legal candidate, then pick one via temperature.
            const scored: ClueEval[] = [];
            for (const clue of legalCandidates) {
                const ev = scoreClue(clue, groups, backend, skill.riskAversion, valueOf);
                if (ev) scored.push(ev);
            }

            if (scored.length > 0) {
                const chosen = selectByTemperature(scored, skill.temperature, ctx.rng);
                const number = Math.max(1, Math.min(chosen.leadOwn, MAX_CLUE_NUMBER));
                return { kind: 'clue', word: chosen.word, number };
            }

            // Nothing leads safely: fall back to the least-bad legal clue, which
            // still refuses to make the assassin the clicker's top pick. Try the
            // generated candidates first, then the built-in abstract words, so even
            // a board the backend can't cover at all gets an assassin-safe placeholder.
            const legalBuiltins = CLUE_VOCAB.filter((w) => isClueLegalForBoard(w, view.words as string[]));
            const fallback =
                pickBestEffort(legalCandidates, groups, backend) ?? pickBestEffort(legalBuiltins, groups, backend);
            if (!fallback) {
                return { kind: 'clue', word: pickFallbackClue(view), number: 1 };
            }
            return { kind: 'clue', word: fallback.word, number: fallback.number };
        },
    };
}
