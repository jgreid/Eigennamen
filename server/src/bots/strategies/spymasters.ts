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
    BotSeatMemory,
} from './types';
import { resolveStyle } from './types';
import type { EdgeKind, SemanticBackend } from '../semantics/backend';
import { clueRetrieval, defaultSemanticBackend } from '../semantics/backend';
import { isClueLegalForBoard, normalizeClueWord, CLUE_NUMBER_MAX, ROUND_WIN_BONUS } from '../../shared/gameRules';
import { makeBoardSafetyCheck, isClueBoardSafe } from './clueSafety';

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
    /**
     * Match-mode own cards with negative value (traps). They're kept OUT of `own`
     * (never steer the clicker toward them) but tracked here: while any remains
     * unrevealed, covering all of `own` does NOT win the round, so a clue must not
     * be treated as board-winning (G1).
     */
    ownTraps: string[];
}

export function groupBoard(view: BotSpymasterView): BoardGroups {
    const other = view.team === 'red' ? 'blue' : 'red';
    const isMatch = view.gameMode === 'match';
    const g: BoardGroups = { own: [], assassin: [], opponent: [], neutral: [], ownTraps: [] };
    for (let i = 0; i < view.types.length; i++) {
        if (view.revealed[i]) continue;
        const w = view.words[i] as string;
        const t = view.types[i];
        if (t === view.team) {
            // Match mode: an OWN card with negative value (a trap) costs points if
            // revealed, so never steer the clicker toward it — treat it as avoid,
            // but remember it so the win check below knows the own set isn't cleared.
            const value = isMatch ? (view.cardScores?.[i] ?? 0) : 1;
            if (isMatch && value < 0) {
                g.neutral.push(w);
                g.ownTraps.push(w);
            } else g.own.push(w);
        } else if (t === 'assassin') g.assassin.push(w);
        else if (t === other) g.opponent.push(w);
        else g.neutral.push(w);
    }
    return g;
}

/**
 * G1 endgame trap targeting. A match trap IS an own card, so the round cannot end
 * while one is unrevealed — yet groupBoard keeps traps out of `own` so the clicker
 * is never steered onto a point-losing card. That leaves the bot structurally
 * unable to CLOSE a round it could win. This re-admits traps into the targetable
 * own set (mutating `groups` in place) in exactly the two cases where revealing
 * them is correct:
 *   (a) the only own cards left ARE traps — the bot cannot progress its own set
 *       otherwise, so it must clue toward them to finish; or
 *   (b) the round-win bonus outweighs the traps' total cost — closing the round
 *       nets positive even after eating the traps.
 * A re-admitted trap re-enters `own` (and leaves `neutral`/`ownTraps`), so a
 * board-covering clue can finish the round and groupBoard's win-guard (ownTraps
 * empty) then correctly treats it as board-winning. No-op outside match / with no
 * traps. Exported for direct testing.
 */
export function admitClosingTraps(groups: BoardGroups, isMatch: boolean, valueOf: (word: string) => number): void {
    if (!isMatch || groups.ownTraps.length === 0) return;
    // Sum of |negative value| over the remaining traps — the points closing the
    // round would cost.
    const trapCost = groups.ownTraps.reduce((sum, w) => sum - Math.min(0, valueOf(w)), 0);
    const onlyTrapsRemain = groups.own.length === 0;
    if (!onlyTrapsRemain && ROUND_WIN_BONUS <= trapCost) return;
    for (const w of groups.ownTraps) {
        groups.own.push(w);
        const idx = groups.neutral.indexOf(w);
        if (idx >= 0) groups.neutral.splice(idx, 1);
    }
    groups.ownTraps = [];
}

/**
 * Build the spymaster's targetable board groups together with the match value
 * function, admitting closing traps (G1) BEFORE returning. This is the single
 * source of truth for "which own cards the spymaster is aiming at this turn",
 * shared by the live strategy (chooseClue) and the async prewarm
 * (prewarmSpymasterClues). Sharing it guarantees candidate generation targets
 * the trap cards when revealing them closes the round, and that the E4 prewarm
 * warms exactly the nearest() keys the live scan will read (no drift).
 */
export function buildTargeting(view: BotSpymasterView): {
    groups: BoardGroups;
    isMatch: boolean;
    valueOf: (word: string) => number;
} {
    const groups = groupBoard(view);
    // Match mode: value each own card by its point value so the scorer can prefer
    // clues that cover the most valuable cards. Every value is 1 outside match,
    // making the value term a no-op there.
    const isMatch = view.gameMode === 'match';
    const values = new Map<string, number>();
    if (isMatch && view.cardScores) {
        for (let i = 0; i < view.words.length; i++) {
            values.set(view.words[i] as string, view.cardScores[i] ?? 0);
        }
    }
    const valueOf = (w: string): number => (isMatch ? (values.get(w) ?? 0) : 1);
    admitClosingTraps(groups, isMatch, valueOf);
    return { groups, isMatch, valueOf };
}

const MAX_CLUE_NUMBER = 4;

// Guesser-competence margin scaling. The safety margin (baseMargin, below) is the
// buffer that keeps an own card ahead of the field by enough that the GUESSER
// takes it and not a look-alike neutral/opponent — so its right size depends on
// how noisily the guesser reads, NOT on the spymaster's own caution. A known
// low-temperature (argmax) bot clicker reads a tight clue correctly; against it
// the spymaster can narrow the margin toward the reference and cover more cards.
// A high-temperature bot clicker, or an unknown/human guesser (temperature
// undefined), keeps the full misread-tolerant width. MARGIN_SCALE_MIN is the
// tightest the margin ever goes (an argmax guesser); it interpolates up to 1.0 as
// the guesser's temperature rises to GUESSER_TEMP_REF, so only genuinely-sharp
// guessers earn the narrower margin and everyone else is unchanged. This is the
// guesser-side analogue of the PROMISE_FLOOR scale fix: an absolute margin tuned
// for one reader is wrong for a different one.
const MARGIN_SCALE_MIN = 0.5;
const GUESSER_TEMP_REF = 0.4;

/** Margin multiplier from the team clicker's temperature (see MARGIN_SCALE_MIN).
 *  Undefined guesser (human/unknown) ⇒ 1 (full width). Only ever ≤ 1. */
function guesserMarginScale(guesserTemperature: number | undefined): number {
    if (guesserTemperature === undefined) return 1;
    const t = Math.min(1, Math.max(0, guesserTemperature) / GUESSER_TEMP_REF);
    return MARGIN_SCALE_MIN + (1 - MARGIN_SCALE_MIN) * t;
}

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
// Number-conditional rarity (Phase 4.4 / 2.20 — the singles doctrine, ledger
// lesson 26): rarity taxes BREADTH. A rare word costs when the guesser must
// generalize across several targets; a near-definitional single fires
// regardless (vertebrae → SPINE beats book → SPINE at N=1, where book's
// laterals are the real hazard). Mostly waived at N=1 — the residual scale
// keeps outright obscurities from riding entirely free.
const RARITY_SINGLES_SCALE = 0.25;
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
// The number is a PROMISE (ledger lesson 18): when it exceeds the targets the
// guesser can actually see, the excess is spent fishing in the clue's residual
// halo — brightest-first, whatever color that is (Tinder 3 → GOLD; ENGINE 2 →
// BOX). So a tail card may only be PROMISED when it is strong in absolute
// terms, not merely margin-clearing on a cold board. Aligned with the
// clicker's CLIFF_ABS_CEILING (0.3): below it a guesser is in the
// no-information state a clue never promised. Never trims below 1 — a single
// is always promiseable (one guess is the argmax; there is no excess promise).
//
// 0.3 is calibrated to a relatedness scale where a strong own pull sits ~0.6–0.9
// (the curated table). A dense vector backend's cosine scale is COMPRESSED —
// under Numberbatch a genuinely-related own pair sits ~0.22, and the strongest
// own card only ~0.33 — so a flat 0.3 floor trims ~84% of safe multi-card clues
// down to a 1 purely on scale, not on gettability. For a dense generative backend
// (one with nearest() — the vector models) the *effective* floor is therefore
// scaled to the board's own demonstrated strong signal (own[0]): it can only ever
// LOWER the floor (capped at PROMISE_FLOOR) and never below PROMISE_FLOOR_MIN so a
// cold board can't over-promise a noise card. The curated table / semantic maps /
// lexical floor (no nearest(), explicit 0–1 weights where 0.3 is the real
// coin-flip line — ledger 2.29) keep the flat 0.3 untouched. Assassin/opponent
// safety is untouched either way — this only tunes the NUMBER on cards the relative
// margin + assassin berth already certified safe, so the worst case of over-
// promising is a short-delivery, never a lit assassin.
const PROMISE_FLOOR = 0.3;
const PROMISE_FLOOR_REL = 0.6;
const PROMISE_FLOOR_MIN = 0.15;
// Endgame assassin discipline (ledger lessons 11/18): as own cards dwindle,
// spymasters relax and guessers lower their acceptance thresholds — the exact
// phase where both live-play assassin hits landed. The berth FLOOR therefore
// widens one-way as the board empties (up to 2× with the last own card).
// Desperation still never touches the berth; this ramp only ever raises it.
const ENDGAME_BERTH_RAMP = 1.0;
// Cohesion: each own card a clue leaves behind with NO related partner among
// the other leftovers is likely a future single-card turn, so a clue that
// strands cards pays now for the turns it creates later. The threshold sits
// between real association levels and lexical noise.
const STRAND_THRESHOLD = 0.4;
const STRAND_WEIGHT = 0.15;
// Phase-2 edge channels (docs/BOT_NUANCE_PLAN.md), active only when the
// backend carries per-edge data (v2 semantic maps) — exact no-ops otherwise.
// Fame-of-fact (ledger lesson 14): an intended edge only a fraction of
// guessers retrieve at table speed (Hooke → SPRING) is a promise most tables
// can't cash; penalize by the WEAKEST-penetration intended edge, scaled like
// the other shared-knowledge terms by the persona's commonnessBias.
const FAME_OF_FACT_WEIGHT = 0.3;
// Concreteness gradient (ledger lesson 16): contents > members/parts >
// compounds > function/attribute. Abstract retrieval paths misfire more, so
// intended edges pay by their kind's abstractness (unknown kind = 0).
const CONCRETENESS_WEIGHT = 0.2;
const EDGE_ABSTRACTNESS: Record<EdgeKind, number> = {
    content: 0,
    member: 0.1,
    part: 0.1,
    compound: 0.2,
    function: 0.45,
    attribute: 0.55,
};

/** Result of scoring a candidate clue against the board. */
export interface ClueEval {
    word: string;
    /** Own cards the clicker would take before crossing onto any non-own card,
     *  capped at what a single clue number can actually ask for. */
    leadOwn: number;
    /** The clue safely covers EVERY remaining own card — taking it wins the
     *  board this turn, so its number may exceed the normal cap. */
    coversAll: boolean;
    /** Ranking key: leadOwn, adjusted for clarity, assassin risk, and defense. */
    score: number;
    /** Relatedness of the weakest card the number actually promises. Retained
     *  so the assassin gate is REPLAYABLE at give time without recomputation. */
    weakestIntended: number;
    /** Closest unrevealed assassin's relatedness (0 with no assassin left). */
    maxAss: number;
    /** The berth this eval was gated against (0 with no assassin left). */
    berth: number;
}

/**
 * The assassin gate as a standalone, replayable invariant: the weakest card a
 * clue promises must clear the closest assassin by the full berth. scoreClue
 * enforces this during scoring today; re-asserting it on the SELECTED clue at
 * give time is the ledger's failure-E defense — any future path that caches or
 * carries candidates between planning and emission must pass this same gate,
 * and when analyses disagree, the assassin-negative verdict wins.
 */
export function passesAssassinGate(ev: Pick<ClueEval, 'weakestIntended' | 'maxAss' | 'berth'>): boolean {
    return ev.weakestIntended - ev.maxAss >= ev.berth;
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
    /** Hard assassin-berth floor for this decision. ASSASSIN_BERTH_FLOOR early,
     *  ramped up (one-way) as own cards dwindle — see ENDGAME_BERTH_RAMP. */
    assassinBerthFloor: number;
    /** Cost of the own cards a clue would leave behind, by how clue-able they
     *  remain together (stranded singles cost future turns). */
    strandPenalty: (residual: readonly string[]) => number;
    /** Multiplier on the guesser-safety margin, from the team clicker's competence
     *  (guesserMarginScale). 1 = full width (unknown/human/noisy guesser); < 1
     *  narrows it for a known argmax bot guesser that reads a tight clue correctly. */
    marginScale: number;
}

/** Highest retrieval of `clue` against any word in `words` (0 if the group is
 *  empty). Retrieval, not bare relatedness: a clue that forms a common phrase
 *  with a board word pulls the guess whatever the model's association says
 *  (misfire class D), so every clue-vs-board comparison in this file runs on
 *  clueRetrieval — which is exactly relatedness for channel-less backends. */
function maxRel(words: readonly string[], clue: string, backend: SemanticBackend): number {
    return words.length > 0 ? Math.max(...words.map((w) => clueRetrieval(backend, clue, w))) : 0;
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
export function scoreClue(
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
    const baseMargin = (0.05 + 0.1 * caution) * (1 - 0.5 * style.aggression) * ctx.marginScale;
    const margin = ctx.desperate
        ? Math.max(DESPERATION_MARGIN_MIN, baseMargin * DESPERATION_MARGIN_FACTOR)
        : baseMargin;

    // Keep each own card's word and value alongside its relatedness so the
    // intended set (the top cards by relatedness) can be scored by total value
    // in match mode, and the residual set fed to the cohesion term.
    const ownScored = groups.own
        .map((w) => ({ word: w, rel: clueRetrieval(backend, clue, w), value: valueOf(w) }))
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
    let berth = 0;
    if (groups.assassin.length > 0) {
        berth = Math.max(ctx.assassinBerthFloor, margin * 2 * style.assassinCaution);
        while (leadOwn > 0 && (own[leadOwn - 1] as number) - maxAss < berth) leadOwn--;
        if (leadOwn === 0) return null;
    }

    // A clue that safely covers EVERYTHING left wins the board this turn and may
    // carry its true count (the clicker chases all of it); otherwise the intended
    // set is capped at the normal clue-number ceiling, and everything downstream
    // (clarity, value, coverage) is computed on the cards the clicker will
    // actually be asked to take — not on a lead the number can't express.
    // A board-winning clue must cover every own card the clicker will be asked to
    // take AND leave no own trap behind: while a match trap own card is unrevealed
    // the round can't end (redScore < redTotal), so covering only the non-trap own
    // set is NOT a win — treating it as one grants an illusory WIN_BONUS, exempts
    // it from the promise trim, and lifts the number cap, sending the clicker
    // fishing for cards the round doesn't actually need (G1).
    const fullLead = leadOwn === groups.own.length && groups.ownTraps.length === 0;
    let intended = fullLead ? leadOwn : Math.min(leadOwn, MAX_CLUE_NUMBER);
    // Promise trim (lesson 18): never promise a tail card that is only
    // margin-clearing but absolutely weak — the number would send the clicker
    // fishing in the residual halo. Trims the NUMBER, never the clue (a single
    // is always promiseable), and a trimmed clue no longer counts as
    // board-winning: an undeliverable tail is an illusory win. One exemption:
    // a board-winning attempt under desperation. With the opponent one card
    // from winning, trimming the win attempt forfeits the game outright —
    // exactly the case the desperation margins exist for — so the last stand
    // keeps its full number. The assassin berth already vetted every one of
    // those cards; desperation thins promises, never the assassin wall.
    const desperateWinAttempt = ctx.desperate && fullLead;
    // Scale the promise floor to this board's strongest own pull so a compressed
    // vector backend isn't taxed on a flat 0.3 (see PROMISE_FLOOR). Clamped so it
    // can only relax the floor (≤ PROMISE_FLOOR) and never drop below the noise
    // guard (≥ PROMISE_FLOOR_MIN). ONLY for dense generative backends (those with
    // nearest() — the vector models, whose cosine scale is compressed): the curated
    // table / semantic maps / lexical floor carry explicit 0–1 weights where 0.3 is
    // the real coin-flip line (ledger lesson 2.29), so they keep the absolute floor
    // untouched — scaling to a per-board own[0] there would wrongly relax a genuinely
    // weak clue as if the whole scale were compressed.
    const promiseFloor = backend.nearest
        ? Math.max(PROMISE_FLOOR_MIN, Math.min(PROMISE_FLOOR, (own[0] as number) * PROMISE_FLOOR_REL))
        : PROMISE_FLOOR;
    while (!desperateWinAttempt && intended > 1 && (own[intended - 1] as number) < promiseFloor) intended--;
    const coversAll = fullLead && intended === leadOwn;
    // A trimmed full-board lead is no longer a win attempt, so it re-enters the
    // normal number cap like any other partial clue.
    if (!coversAll) intended = Math.min(intended, MAX_CLUE_NUMBER);

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
    // Rarity scales with the number (the singles doctrine): full tax on
    // breadth clues, mostly waived for a single where narrowness dominates.
    const rarityScale = intended === 1 ? RARITY_SINGLES_SCALE : 1;
    const rarityPenalty = RARITY_WEIGHT * rarityScale * style.commonnessBias * (1 - (backend.commonness?.(clue) ?? 1));
    // Phase-2 edge channels over the INTENDED edges: fame-of-fact (the
    // weakest-penetration edge bounds how much of the promise a median table
    // retrieves) and the concreteness gradient (abstract retrieval paths
    // misfire more). Both exact no-ops without per-edge data — a missing
    // method, a null edge, and missing channel fields all read as neutral.
    let fameOfFactPenalty = 0;
    let abstractnessPenalty = 0;
    if (backend.edgeInfo) {
        let minPenetration = 1;
        let abstractness = 0;
        for (const o of ownScored.slice(0, intended)) {
            const edge = backend.edgeInfo(clue, o.word);
            if (edge?.penetration !== undefined && edge.penetration < minPenetration) {
                minPenetration = edge.penetration;
            }
            // `?? 0`: the kind is typed, but edgeInfo data crosses a JSON
            // boundary — an unknown kind must read as neutral, never as NaN
            // poisoning every score this candidate touches.
            if (edge?.kind !== undefined) abstractness += EDGE_ABSTRACTNESS[edge.kind] ?? 0;
        }
        fameOfFactPenalty = FAME_OF_FACT_WEIGHT * style.commonnessBias * (1 - minPenetration);
        abstractnessPenalty = CONCRETENESS_WEIGHT * style.commonnessBias * (abstractness / intended);
    }
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
        rarityPenalty -
        fameOfFactPenalty -
        abstractnessPenalty +
        valueBonus +
        coverageBonus +
        winBonus -
        strandPenalty;
    return { word: clue, leadOwn: intended, coversAll, score, weakestIntended, maxAss, berth };
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
    const ownAheadOfDanger = groups.own.filter((w) => clueRetrieval(backend, chosenWord, w) > dangerMax).length;
    const number = Math.max(1, Math.min(MAX_CLUE_NUMBER, ownAheadOfDanger));
    return { word: chosenWord, number };
}

// The candidate-quality board-safety filter (foreign-script + orthographic
// near-duplicate guards) now lives in ./clueSafety.ts (H3 decomposition); it is
// imported at the top and used at generateClueCandidates' legality choke point
// below. Re-export here so existing importers of these symbols from this module
// keep working.
export { makeBoardSafetyCheck, isClueBoardSafe };

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
/**
 * The exact nearest() queries generateClueCandidates issues for a board: the full
 * own-card centroid, one per own card, and the pair centroids of the densest own
 * cards (2-card bridges). Exported as the SINGLE SOURCE OF TRUTH so the live
 * driver can prewarm them off the event loop before the (sync) clue decision (E4)
 * — generateClueCandidates runs exactly this list, so the prewarm and the
 * decision can never drift. Empty when the backend can't generate (no nearest()).
 */
export function clueCandidateQueries(
    groups: BoardGroups,
    backend: SemanticBackend
): Array<{ words: string[]; k: number }> {
    if (!backend.nearest || groups.own.length === 0) return [];
    const queries: Array<{ words: string[]; k: number }> = [{ words: groups.own, k: CENTROID_NEIGHBOURS }];
    for (const w of groups.own) queries.push({ words: [w], k: PER_CARD_NEIGHBOURS });
    // Pair-centroid bridges. Skipped below three own cards: with two, the full
    // centroid above IS the pair centroid. Density (total relatedness to the
    // other own cards) picks which cards get paired, keeping the extra nearest()
    // calls bounded at C(PAIR_TOP_CARDS, 2).
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
                queries.push({ words: [top[i] as string, top[j] as string], k: PAIR_NEIGHBOURS });
            }
        }
    }
    return queries;
}

function generateClueCandidates(
    view: BotSpymasterView,
    groups: BoardGroups,
    backend: SemanticBackend,
    extraCandidates: readonly string[] = []
): string[] {
    // Board-safe AND legal: the substring/stem legality gate plus the embeddings
    // hygiene filter (cognate near-duplicates, wrong-language tokens). Applied at
    // the single choke point every generated/scanned candidate flows through, so
    // nearest() junk never reaches scoring. The board-safety predicate is built
    // once (board-derived data cached) and reused across the whole pool.
    // `extraCandidates` (LLM clue proposals) enter HERE, not downstream — they
    // face the exact same legality/safety gates as every generated candidate.
    const words = view.words as string[];
    const boardSafe = makeBoardSafetyCheck(words);
    const legal = (candidates: string[]): string[] =>
        candidates.filter((c) => isClueLegalForBoard(c, words) && boardSafe(c));
    const extras = legal([...extraCandidates]);

    const queries = clueCandidateQueries(groups, backend);
    if (backend.nearest && queries.length > 0) {
        const pool = new Set<string>(extras);
        for (const q of queries) {
            for (const c of backend.nearest(q.words, q.k)) pool.add(c.word);
        }
        const legalPool = legal([...pool]);
        if (legalPool.length > 0) return legalPool;
    }

    const scanned = legal(backend.vocabulary ? backend.vocabulary() : []);
    // Dedupe on the normalized key; extras first so a proposal survives the merge.
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const c of [...extras, ...scanned]) {
        const k = normalizeClueWord(c);
        if (!seen.has(k)) {
            seen.add(k);
            merged.push(c);
        }
    }
    return merged;
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
/**
 * Never repeat a clue word the guessers already FAILED to convert (live-play
 * finding): a frame that bounced (a guess under it hit a non-own card) or
 * undershot (taken < number) is one the guesser demonstrably could not read —
 * re-giving the identical word carries zero new information and spends a whole
 * turn re-asking a question the table already answered. A frame that FULLY
 * delivered is NOT burned: repeating it for fresh cards ("ANIMALS 2" delivered
 * → "ANIMALS 2" again for two new animal cards) is the legitimate classic
 * tactic. This composes with the clicker's clue-debt memory, which explicitly
 * skips same-word frames — the designed recovery for a missed clue is a
 * DIFFERENT word whose debt boost still points at the owed target. Matching is
 * on the normalized clue key. Returns the burned key set (empty without
 * memory, e.g. duet, where frame outcomes aren't classified).
 */
export function burnedClueKeys(memory: BotSeatMemory | undefined): Set<string> {
    const burned = new Set<string>();
    for (const c of memory?.clues ?? []) {
        if (c.bounced || c.taken < c.number) burned.add(normalizeClueWord(c.word));
    }
    return burned;
}

export function makeEmbeddingSpymaster(
    skill: SkillParams,
    backend: SemanticBackend = defaultSemanticBackend
): SpymasterStrategy {
    return {
        strategyId: 'embeddingSpymaster',
        chooseClue(view: BotSpymasterView, ctx: BotContext): BotAction {
            // G1 endgame trap targeting: buildTargeting admits closing traps into
            // the own set BEFORE candidate generation, so when revealing traps wins
            // the round the candidate pool actually contains trap-bridging clues
            // (not just re-scored after generation). Shared with the E4 prewarm.
            const { groups, isMatch, valueOf } = buildTargeting(view);
            // LLM clue proposals (when the controller attached advice) join the
            // pool at the same choke point as generated candidates — they must
            // win the same scoring and safety gates below to be emitted.
            const proposals = (ctx.llm?.clueProposals ?? []).map((p) => p.word);
            // No-repeat rule (burnedClueKeys): filtering the CANDIDATE POOL —
            // not scoring — means the blunder branch, temperature selection,
            // and the best-effort fallback all obey it, and LLM proposals face
            // it too. If it empties the pool, the builtin/abstract fallbacks
            // below still produce a fresh word, so a burned repeat is only ever
            // possible from the last-resort constant list (a board with
            // literally no other legal clue — the "very good reason").
            const burned = burnedClueKeys(ctx.memory);
            const legalCandidates = generateClueCandidates(view, groups, backend, proposals).filter(
                (c) => !burned.has(normalizeClueWord(c))
            );
            const style = resolveStyle(skill);
            // Restore the house-rule display case of a generated clue at emit time:
            // nearest() returns normalized (uppercase) keys, so a reference like
            // "Cinderella" would otherwise go out as legacy-neutral "CINDERELLA" and
            // lose its reference signal (G2). Only ever changes case, so it's applied
            // after all legality/scoring. A no-op for non-references and lexical backends.
            const emitCase = (word: string): string => backend.displayCase?.(word) ?? word;

            // Occasional blunder: a random legal clue (weak-player model).
            if (legalCandidates.length > 0 && ctx.rng.next() < skill.blunderRate) {
                const word = legalCandidates[ctx.rng.int(legalCandidates.length)] as string;
                return { kind: 'clue', word: emitCase(word), number: 1 };
            }

            // Per-decision board context. desperate: exactly one opponent card
            // left (zero would mean the game is over; duet has no opponent group,
            // so it never triggers there). The own-pair relatedness matrix is
            // computed once so the cohesion term costs each candidate only map
            // lookups over its residual set.
            const desperate = groups.opponent.length === 1;
            // Endgame assassin discipline: the berth floor widens one-way as own
            // cards dwindle (fraction cleared of the team's TOTAL key cards, so
            // the ramp is progress-driven and monotonic across a game). Clamped
            // to [1, 2]× so a fresh board is exactly the classic floor. Counts
            // mirror groupBoard's match-mode trap rule (negative-value own cards
            // are never steer-targets), so a fresh match board also starts at 1×.
            let ownTotal = 0;
            for (let i = 0; i < view.types.length; i++) {
                if (view.types[i] !== view.team) continue;
                if (isMatch && (view.cardScores?.[i] ?? 0) < 0) continue;
                ownTotal++;
            }
            const cleared = ownTotal > 0 ? 1 - groups.own.length / ownTotal : 0;
            const berthScale = 1 + ENDGAME_BERTH_RAMP * Math.min(1, Math.max(0, cleared));
            const assassinBerthFloor = ASSASSIN_BERTH_FLOOR * berthScale;
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
            // Score every legal candidate at the given berth floor, then pick
            // one via temperature — with the give-time assassin re-gate
            // (failure-E defense): scoreClue already enforced the berth during
            // scoring, but the gate is re-asserted on the SELECTED clue at the
            // moment of emission — the invariant that protects any future path
            // where candidates are cached or carried between planning and give
            // time. A failing candidate is dropped and selection re-runs on the
            // remainder; an emptied pool returns null.
            // Size the guesser-safety margin to the team clicker's competence:
            // a known argmax bot guesser earns a tighter margin (more coverage);
            // an unknown/human/noisy guesser keeps the full width. Constant per
            // decision, so computed once outside the per-candidate scoring loop.
            const marginScale = guesserMarginScale(ctx.guesserTemperature);
            const emitAt = (berthFloor: number): BotAction | null => {
                const scoreCtx: ScoreContext = {
                    desperate,
                    assassinBerthFloor: berthFloor,
                    strandPenalty,
                    marginScale,
                };
                const scored: ClueEval[] = [];
                for (const clue of legalCandidates) {
                    const ev = scoreClue(clue, groups, backend, skill.riskAversion, valueOf, style, scoreCtx);
                    if (ev) scored.push(ev);
                }
                let pool = scored;
                while (pool.length > 0) {
                    const chosen = selectByTemperature(pool, skill.temperature, ctx.rng);
                    if (!passesAssassinGate(chosen)) {
                        pool = pool.filter((c) => c !== chosen);
                        continue;
                    }
                    // A board-winning clue carries its true count (the server
                    // allows up to CLUE_NUMBER_MAX); everything else keeps the
                    // normal cap.
                    const cap = chosen.coversAll ? CLUE_NUMBER_MAX : MAX_CLUE_NUMBER;
                    const number = Math.max(1, Math.min(chosen.leadOwn, cap));
                    return { kind: 'clue', word: emitCase(chosen.word), number };
                }
                return null;
            };

            // Try the ramped endgame floor first; if it empties the pool, retry
            // once at the base floor before degrading further. The ramp is a
            // PREFERENCE, not a cliff: a clue clearing the classic berth is
            // strictly safer than the berth-FREE best-effort fallback the ramp
            // would otherwise cascade into — exactly the endgame states the
            // ramp exists to protect.
            const emitted =
                emitAt(assassinBerthFloor) ??
                (assassinBerthFloor > ASSASSIN_BERTH_FLOOR ? emitAt(ASSASSIN_BERTH_FLOOR) : null);
            if (emitted) return emitted;

            // Nothing leads safely: fall back to the least-bad legal clue, which
            // still refuses to make the assassin the clicker's top pick. Try the
            // generated candidates first, then the built-in abstract words, so even
            // a board the backend can't cover at all gets an assassin-safe placeholder.
            const legalBuiltins = CLUE_VOCAB.filter(
                (w) => isClueLegalForBoard(w, view.words as string[]) && !burned.has(normalizeClueWord(w))
            );
            const fallback =
                pickBestEffort(legalCandidates, groups, backend) ?? pickBestEffort(legalBuiltins, groups, backend);
            if (!fallback) {
                return { kind: 'clue', word: pickFallbackClue(view), number: 1 };
            }
            return { kind: 'clue', word: emitCase(fallback.word), number: fallback.number };
        },
    };
}
