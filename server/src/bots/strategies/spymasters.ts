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
import type {
    BotAction,
    BotSpymasterView,
    BotContext,
    SpymasterStrategy,
    SkillParams,
    SeededRng,
    StyleParams,
} from './types';
import { resolveStyle } from './types';
import type { SemanticBackend } from '../semantics/backend';
import { defaultSemanticBackend } from '../semantics/backend';
import { isClueLegalForBoard, CLUE_NUMBER_MAX } from '../../shared/gameRules';

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
// Hard, persona-independent assassin berth: the weakest intended card must clear
// the closest assassin by at least this, no matter how reckless the persona.
// A clue is only as good as its worst plausible misfire, and the worst misfire
// is the assassin — style knobs tune the *number*, never this gate. Matches the
// diagnostics yardstick's berth (2 × REF_MARGIN in harness/analyze.ts).
const ASSASSIN_BERTH_FLOOR = 0.1;
// Robustness (anti-idiosyncrasy) weights, both scaled by style.commonnessBias.
// Ambiguity: a clue whose best non-own relatedness runs hot is one misread away
// from a misfire even when the margin clears — the model's salience ranking is
// not the guesser's, so hot halos are where that gap bites. Rarity: an obscure
// clue word anchors on a niche association a human may not share; prefer clues
// that live in common knowledge (only applies when the backend has a
// frequency prior — see SemanticBackend.commonness).
const AMBIGUITY_WEIGHT = 0.3;
const RARITY_WEIGHT = 0.25;
// Endgame terms. WIN_BONUS decisively prefers a clue that safely covers EVERY
// remaining own card — converting the game this turn beats any partial clue —
// and only such clues may exceed MAX_CLUE_NUMBER (up to the server-wide
// CLUE_NUMBER_MAX). DESPERATION_MARGIN_FACTOR shrinks the safety margin when
// the opponent is one card from winning: banking a safe single forfeits the
// game anyway, so a clue too thin for normal play becomes the right gamble.
// The hard assassin floor is NOT relaxed — desperation buys thinner margins,
// never a thinner assassin wall.
const WIN_BONUS = 1.0;
const DESPERATION_MARGIN_FACTOR = 0.4;
const DESPERATION_MARGIN_MIN = 0.02;
// Cohesion: each own card a clue leaves behind with NO related partner among
// the other leftovers is likely a future single-card turn, so a clue that
// strands cards pays now for the turns it creates later. The threshold sits
// between real association levels and lexical noise.
const STRAND_THRESHOLD = 0.4;
const STRAND_WEIGHT = 0.15;

/** Result of scoring a candidate clue against the board. */
interface ClueEval {
    word: string;
    /** Own cards the clicker would take before crossing onto any non-own card,
     *  capped at what a single clue number can actually ask for. */
    leadOwn: number;
    /** The clue safely covers EVERY remaining own card — taking it wins the
     *  board this turn, so its number may exceed the normal cap. */
    coversAll: boolean;
    /** Ranking key: leadOwn, adjusted for clarity, assassin risk, and defense. */
    score: number;
}

/** Per-decision board context for scoring, computed once in chooseClue. */
interface ScoreContext {
    /** The opponent is one card from winning: safe play forfeits the game, so
     *  margins relax (never the assassin gate) and denial stops mattering.
     *  (A graded race-aware margin — thinner when trailing by cards — was
     *  measured in mirror self-play and REGRESSED turn counts: the trailing
     *  side's extra misfires outweigh the tempo it buys. Only this binary
     *  last-stand trigger survived the data.) */
    desperate: boolean;
    /** Cost of the own cards a clue would leave behind, by how clue-able they
     *  remain together (stranded singles cost future turns). */
    strandPenalty: (residual: readonly string[]) => number;
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
 *  - robustness (anti-idiosyncrasy): penalises hot halos (high absolute best
 *    non-own relatedness even when the margin clears) and rare/obscure clue
 *    words, both scaled by the persona's commonnessBias — robust clues live in
 *    shared knowledge, not the model's private sense of salience.
 *  - turn economy (endgame + cohesion): a clue that safely covers every
 *    remaining own card wins the board and is decisively preferred (and may
 *    exceed the normal number cap); among partial clues, ones that strand
 *    leftover own cards away from any related partner pay for the future
 *    single-card turns they create. Under desperation (opponent one card from
 *    winning) margins shrink so more cards ride the clue — the hard assassin
 *    floor never does.
 *
 * `caution` is riskAversion in [0,1]; the safety margin widens with it. `style`
 * are the persona knobs: `aggression` shrinks the margin (bigger, bolder numbers),
 * `defenseBias` scales the opponent penalty, `assassinCaution` scales both the
 * assassin penalty and its berth. Returns null when no own card leads safely.
 */
function scoreClue(
    clue: string,
    groups: BoardGroups,
    backend: SemanticBackend,
    caution: number,
    valueOf: (word: string) => number,
    style: StyleParams,
    ctx: ScoreContext
): ClueEval | null {
    if (groups.own.length === 0) return null;
    // Aggression shrinks the safety margin (down to half) so more own cards clear
    // the non-own field on one clue — the persona lever that turns a stream of
    // 1-clues into gutsy 2s and 3s. The floor keeps even a bold clue above chance.
    // Desperation shrinks it much further: with the opponent one card from
    // winning, a thin multi-card clue dominates a safe single that hands them
    // the game on the next turn.
    const baseMargin = (0.05 + 0.1 * caution) * (1 - 0.5 * style.aggression);
    const margin = ctx.desperate
        ? Math.max(DESPERATION_MARGIN_MIN, baseMargin * DESPERATION_MARGIN_FACTOR)
        : baseMargin;

    // Keep each own card's word and value alongside its relatedness so the
    // intended set (the top cards by relatedness) can be scored by total value
    // in match mode, and the residual set fed to the cohesion term.
    const ownScored = groups.own
        .map((w) => ({ word: w, rel: backend.relatedness(clue, w), value: valueOf(w) }))
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
    // card that doesn't clear the closest assassin by twice the margin (scaled by
    // the persona's assassinCaution — a Guardian widens the wall further). The
    // ASSASSIN_BERTH_FLOOR is the hard, persona-independent part: a Daredevil may
    // trim the soft berth, but never below the floor — recklessness buys bigger
    // numbers, not a thinner assassin wall. Skipped entirely when no assassin
    // remains unrevealed: with maxAss = 0 the floor would demand an absolute
    // relatedness of 0.1 from every intended card, silently trimming perfectly
    // safe low-signal cards on a board with nothing to steer clear of.
    if (groups.assassin.length > 0) {
        const berth = Math.max(ASSASSIN_BERTH_FLOOR, margin * 2 * style.assassinCaution);
        while (leadOwn > 0 && (own[leadOwn - 1] as number) - maxAss < berth) leadOwn--;
        if (leadOwn === 0) return null;
    }

    // A clue that safely covers EVERYTHING left wins the board this turn and may
    // carry its true count (the clicker chases all of it); otherwise the intended
    // set is capped at the normal clue-number ceiling, and everything downstream
    // (clarity, value, coverage) is computed on the cards the clicker will
    // actually be asked to take — not on a lead the number can't express.
    const coversAll = leadOwn === groups.own.length;
    const intended = coversAll ? leadOwn : Math.min(leadOwn, MAX_CLUE_NUMBER);

    const weakestIntended = own[intended - 1] as number;
    const clarity = Math.min(0.999, Math.max(0, weakestIntended - maxNonOwn));
    // Graded, caution-scaled penalties. Absolute maxAss / maxOpp are fine here:
    // between two clues that both cover the same cards, the one that stays
    // further from the assassin / the opponent's cards wins. defenseBias and
    // assassinCaution are the persona multipliers on those two instincts. The
    // opponent penalty vanishes under desperation — teaching their clicker
    // something is irrelevant when they win next turn unless we clear the board.
    const assassinPenalty = caution * ASSASSIN_WEIGHT * style.assassinCaution * maxAss;
    const opponentPenalty = ctx.desperate ? 0 : caution * OPPONENT_WEIGHT * style.defenseBias * maxOpp;
    // Match value-awareness: reward covering higher-value own cards. In non-match
    // every value() is 1, so coveredValue === intended and the bonus is exactly 0.
    const coveredValue = ownScored.slice(0, intended).reduce((s, c) => s + c.value, 0);
    const valueBonus = VALUE_WEIGHT * (coveredValue - intended);
    // Aggression also tips near-ties toward the wider-covering clue, so a bold
    // persona reaches for the bigger number even when a tighter clue scores alike.
    const coverageBonus = style.aggression * 0.25 * intended;
    // Robustness: prefer clues a HUMAN would read the same way the model does.
    // Ambiguity punishes a hot halo (high absolute maxNonOwn, even with the
    // margin cleared); rarity punishes obscure clue words when the backend
    // carries a frequency prior (absent one, commonness defaults to 1 = no-op).
    const ambiguityPenalty = AMBIGUITY_WEIGHT * style.commonnessBias * maxNonOwn;
    const rarityPenalty = RARITY_WEIGHT * style.commonnessBias * (1 - (backend.commonness?.(clue) ?? 1));
    // Turn economy: winning now beats any partial clue, and among partial clues
    // prefer the one whose leftovers still clue well together — a stranded own
    // card is a whole future turn spent on a single-card clue.
    const winBonus = coversAll ? WIN_BONUS : 0;
    const strandPenalty = ctx.strandPenalty(ownScored.slice(intended).map((o) => o.word));

    const score =
        intended +
        CLARITY_WEIGHT * clarity -
        assassinPenalty -
        opponentPenalty -
        ambiguityPenalty -
        rarityPenalty +
        valueBonus +
        coverageBonus +
        winBonus -
        strandPenalty;
    return { word: clue, leadOwn: intended, coversAll, score };
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
// specific, safe single-card clues; pair centroids surface cross-domain BRIDGES —
// a word sitting between two own cards in different silos (penguin + maestro =
// TUXEDO), which the full centroid misses because it is dominated by the largest
// own cluster. Pairs are bounded to the densest own cards because every
// first-time nearest() call is a synchronous full-vocabulary scan on the live
// server's event loop: worst case is 1 centroid + 9 per-card + C(4,2) = 16
// calls per clue decision (the vector backend memoises repeats across turns,
// so only a game's first decision pays full price).
const CENTROID_NEIGHBOURS = 40;
const PER_CARD_NEIGHBOURS = 8;
const PAIR_TOP_CARDS = 4;
const PAIR_NEIGHBOURS = 6;

/**
 * The legal clue words to consider for a board. With an embedding backend that
 * supports nearest(), this GENERATES board-specific candidates from the whole
 * model vocabulary — words near the full own-card centroid, near each own card,
 * and near each pair centroid of the densest own cards (2-card bridge clues).
 * With a table/lexical backend (no nearest) it degrades to scanning the fixed
 * vocabulary(), so those backends behave exactly as before.
 */
function generateClueCandidates(view: BotSpymasterView, groups: BoardGroups, backend: SemanticBackend): string[] {
    const legal = (words: string[]): string[] => words.filter((c) => isClueLegalForBoard(c, view.words as string[]));

    if (backend.nearest && groups.own.length > 0) {
        const pool = new Set<string>();
        for (const c of backend.nearest(groups.own, CENTROID_NEIGHBOURS)) pool.add(c.word);
        for (const w of groups.own) {
            for (const c of backend.nearest([w], PER_CARD_NEIGHBOURS)) pool.add(c.word);
        }
        // Pair-centroid bridges. Skipped below three own cards: with two, the
        // full centroid above IS the pair centroid. Density (total relatedness
        // to the other own cards) picks which cards get paired, keeping the
        // extra nearest() calls bounded at C(PAIR_TOP_CARDS, 2).
        if (groups.own.length > 2) {
            const density = new Map<string, number>();
            for (const w of groups.own) {
                let d = 0;
                for (const o of groups.own) if (o !== w) d += backend.relatedness(w, o);
                density.set(w, d);
            }
            const top = [...groups.own]
                .sort((a, b) => (density.get(b) ?? 0) - (density.get(a) ?? 0))
                .slice(0, PAIR_TOP_CARDS);
            for (let i = 0; i < top.length; i++) {
                for (let j = i + 1; j < top.length; j++) {
                    const pair = [top[i] as string, top[j] as string];
                    for (const c of backend.nearest(pair, PAIR_NEIGHBOURS)) pool.add(c.word);
                }
            }
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
            const style = resolveStyle(skill);

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

            // Per-decision board context. desperate: exactly one opponent card
            // left (zero would mean the game is over; duet has no opponent group,
            // so it never triggers there). The own-pair relatedness matrix is
            // computed once so the cohesion term costs each candidate only map
            // lookups over its residual set.
            const desperate = groups.opponent.length === 1;
            const pairRel = new Map<string, number>();
            for (let i = 0; i < groups.own.length; i++) {
                for (let j = i + 1; j < groups.own.length; j++) {
                    const a = groups.own[i] as string;
                    const b = groups.own[j] as string;
                    const r = backend.relatedness(a, b);
                    pairRel.set(`${a}|${b}`, r);
                    pairRel.set(`${b}|${a}`, r);
                }
            }
            const strandPenalty = (residual: readonly string[]): number => {
                let stranded = 0;
                for (const w of residual) {
                    let best = 0;
                    for (const o of residual) {
                        if (o === w) continue;
                        const r = pairRel.get(`${w}|${o}`) ?? 0;
                        if (r > best) best = r;
                    }
                    if (best < STRAND_THRESHOLD) stranded++;
                }
                return STRAND_WEIGHT * stranded;
            };
            const scoreCtx: ScoreContext = { desperate, strandPenalty };

            // Score every legal candidate, then pick one via temperature.
            const scored: ClueEval[] = [];
            for (const clue of legalCandidates) {
                const ev = scoreClue(clue, groups, backend, skill.riskAversion, valueOf, style, scoreCtx);
                if (ev) scored.push(ev);
            }

            if (scored.length > 0) {
                const chosen = selectByTemperature(scored, skill.temperature, ctx.rng);
                // A board-winning clue carries its true count (the server allows
                // up to CLUE_NUMBER_MAX); everything else keeps the normal cap.
                const cap = chosen.coversAll ? CLUE_NUMBER_MAX : MAX_CLUE_NUMBER;
                const number = Math.max(1, Math.min(chosen.leadOwn, cap));
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
