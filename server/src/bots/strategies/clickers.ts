/**
 * Clicker strategies.
 *
 *  - randomClicker: uniform random over legal unrevealed cards. Baseline.
 *  - cautiousClicker: random pick, but stops after the clue's intended count
 *    (models a careful human who doesn't spend the bonus guess).
 *  - greedyClicker: ranks unrevealed cards by a SemanticBackend's relatedness to
 *    the clue word and reveals one, up to the clue count. Selection is
 *    temperature-controlled: at temperature 0 it takes the best card (a "scary
 *    good" clicker that reliably reads its spymaster); at higher temperatures it
 *    samples among plausible cards, so a weaker bot makes believable mistakes.
 *    Two discipline layers model the human "core + stretch" instinct: it stops
 *    early when the next card's fit CLIFFS relative to what it already took
 *    (tap the confident core, skip the stretch), and it spends the engine's
 *    number+1 bonus guess only when the top leftover fits tighter than a core
 *    card would — a calibrated stretch, gated by the persona's aggression.
 */
import type { BotAction, BotClickerView, BotContext, ClickerStrategy, SkillParams, SeededRng } from './types';
import type { SemanticBackend } from '../semantics/backend';
import { guessRetrieval, defaultSemanticBackend } from '../semantics/backend';
import { frameContextFromView, resolveClueFrame } from './clueFrame';
import { normalizeClueWord } from '../../shared/gameRules';

function unrevealedIndices(view: BotClickerView): number[] {
    const out: number[] = [];
    for (let i = 0; i < view.revealed.length; i++) {
        if (!view.revealed[i]) out.push(i);
    }
    return out;
}

/** The number of guesses a clue intends (number+? is handled by the engine). */
function intendedGuesses(view: BotClickerView): number {
    const n = view.currentClue ? view.currentClue.number : 0;
    return n > 0 ? n : 1; // unlimited clue -> a cautious bot still commits to ≥1
}

/**
 * Pick one candidate index by its relatedness score, controlled by temperature:
 *  - temperature <= 0: argmax (the card the clue fits best).
 *  - temperature > 0: softmax sample, so a weaker bot sometimes takes the
 *    second- or third-best card. All randomness flows through the seeded rng.
 */
function selectIndexByTemperature(
    scored: { index: number; score: number }[],
    temperature: number,
    rng: SeededRng
): number {
    let best = scored[0] as { index: number; score: number };
    for (const c of scored) if (c.score > best.score) best = c;
    if (temperature <= 0 || scored.length === 1) return best.index;
    const weights = scored.map((c) => Math.exp((c.score - best.score) / temperature));
    const total = weights.reduce((a, w) => a + w, 0);
    let r = rng.next() * total;
    for (let i = 0; i < scored.length; i++) {
        r -= weights[i] as number;
        if (r <= 0) return (scored[i] as { index: number; score: number }).index;
    }
    return best.index;
}

export function makeRandomClicker(skill: SkillParams): ClickerStrategy {
    return {
        strategyId: 'randomClicker',
        chooseGuess(view: BotClickerView, ctx: BotContext): BotAction {
            const choices = unrevealedIndices(view);
            if (choices.length === 0) return { kind: 'endTurn' };
            // Occasionally bail out instead of pressing on, scaled by riskAversion.
            if (view.guessesUsed > 0 && ctx.rng.next() < skill.riskAversion * 0.5) {
                return { kind: 'endTurn' };
            }
            const idx = choices[ctx.rng.int(choices.length)] as number;
            return { kind: 'reveal', index: idx };
        },
    };
}

export function makeCautiousClicker(skill: SkillParams): ClickerStrategy {
    return {
        strategyId: 'cautiousClicker',
        chooseGuess(view: BotClickerView, ctx: BotContext): BotAction {
            const choices = unrevealedIndices(view);
            if (choices.length === 0) return { kind: 'endTurn' };
            const target = intendedGuesses(view);
            // Stop once we've made the clue's intended number of guesses; with high
            // riskAversion, sometimes stop one guess early.
            if (view.guessesUsed >= target) return { kind: 'endTurn' };
            if (view.guessesUsed >= 1 && ctx.rng.next() < skill.riskAversion * 0.4) {
                return { kind: 'endTurn' };
            }
            const idx = choices[ctx.rng.int(choices.length)] as number;
            return { kind: 'reveal', index: idx };
        },
    };
}

// Relative-cliff stopping ("tap the confident core, stop before the stretch").
// The next guess is treated as a blind stretch — and the turn banked — only when
// ALL THREE hold, because each alone still describes a card the spymaster may
// well have intended:
//  - steep: the score drops more than the tolerated fraction below the last
//    taken card (aggression loosens it — a bold persona rides the curve down);
//  - weak: the card is low in ABSOLUTE terms (a strong absolute fit is worth
//    pressing for even after a big drop from a perfect first take);
//  - blurred: the card barely separates from the next-best alternative. This is
//    the decisive tell: a genuinely-intended card stands clear of the field by
//    the spymaster's own safety margin even when the whole board runs cold, so
//    "far below the core AND indistinguishable from its alternatives" is the
//    no-information state where a guess is a coin-flip the clue never promised.
// Calibration note: a margin-sound bot spymaster's intended tail card can score
// as low as ~0.3 (pure lexical signal on a cold board) while still clearing the
// field by its safety margin (>= ~0.04 even for the boldest persona), so the
// ceiling sits just below that level and the separation just below that margin —
// against a sound clue the cliff is a near-no-op, and the delivery it protects
// is real (self-play delivery drops measurably with looser settings).
const CLIFF_BASE_DELTA = 0.55;
const CLIFF_AGGRESSION_SLACK = 0.25;
const CLIFF_ABS_CEILING = 0.3;
const CLIFF_SEPARATION = 0.035;

// The disciplined "+1": thresholds for spending the engine's number+1 bonus
// guess. The top leftover must clear a high absolute floor (higher still for a
// timid persona) AND clear the next-best card by a wide margin — take the bonus
// when it is TIGHTER than the core, not merely plausible.
const BONUS_FLOOR_BASE = 0.6;
const BONUS_FLOOR_TIMIDITY = 0.2;
const BONUS_FIELD_GAP = 0.2;

// Clue debt (Phase 4.3, ledger lessons 9/24/27): a card that also fits an
// OWED earlier clue (promised more than it delivered, never bounced) is more
// likely intended — the spymaster double-codes, and human guessers work the
// debt. The boost is a tie-breaker, not an override: it must never outrank a
// clearly better current-clue fit, so it is small relative to real signal.
// A frame whose guess bounced is void — its promises transfer nothing.
//
// The boost is capped STRICTLY BELOW the spymaster's hard assassin berth
// floor (ASSASSIN_BERTH_FLOOR = 0.1): the spymaster's margin machinery models
// the clicker with clueRetrieval ONLY and never sees this boost, so a boost
// wider than the certified assassin gap could flip the argmax onto the
// assassin/opponent across a gap the gate ruled safe (correctness-review
// finding, runtime-reproduced with a 0.15 boost jumping a 0.10 berth). Kept
// below the floor, debt can only ever reorder cards the gate already treated
// as interchangeably safe.
const DEBT_FIT_BAR = 0.5;
const DEBT_BOOST = 0.08;

// A guesser only ever reaches for cards that PLAUSIBLY match the clue. Even a
// noisy/weak one won't pick a card fitting far worse than the best candidate —
// that is exactly how a blind random guess lands on the clue-unrelated assassin.
// Both the blunder and the temperature sample draw from this plausible set (cards
// scoring at least this fraction of the best card's fit), so a weak bot loses by
// MISREADING among real candidates, not by self-destructing. The best card is
// always in the set, so a lone strong card is still guessable, and a leaky clue
// whose halo genuinely lights the assassin keeps it in play (the spymaster's fault).
const PLAUSIBLE_FIT_FRAC = 0.5;

/** Bonus for a card that fits the strongest owed (undelivered, unbounced)
 *  earlier clue, from the seat's optional memory. 0 without memory. */
function debtBoost(ctx: BotContext, backend: SemanticBackend, currentClue: string, word: string): number {
    const clues = ctx.memory?.clues;
    if (!clues || clues.length === 0) return 0;
    const current = normalizeClueWord(currentClue);
    let best = 0;
    for (const c of clues) {
        if (c.bounced || c.taken >= c.number) continue;
        if (normalizeClueWord(c.word) === current) continue;
        // guessRetrieval, not raw retrieval: a spelling coincidence with an old
        // clue must not manufacture phantom debt (the damp keeps it under the bar).
        const fit = guessRetrieval(backend, c.word, word);
        if (fit >= DEBT_FIT_BAR && fit > best) best = fit;
    }
    return DEBT_BOOST * best;
}

/**
 * Estimate the score (vs the current clue) of the LAST card this clicker took
 * under this clue. Strategies are stateless, but within a turn ONLY this
 * clicker reveals cards, so everything it took this clue is now a revealed
 * own-team card. Which revealed own cards belong to THIS clue isn't recorded,
 * so take the guessesUsed-th highest clue-relatedness among all revealed own
 * cards: a superset's order statistic never underestimates the true value, and
 * own cards revealed in earlier turns were argmax picks for OTHER clues, so
 * they rarely outscore this clue's actual takes. The bias direction (≥ truth)
 * only makes the cliff stop EARLIER — it errs toward discipline, never toward
 * an extra reckless guess. Returns null when the reconstruction is unreliable:
 * fewer revealed own cards than guesses used, or duet — a duet clicker's masked
 * types[] is always the side-A key (which never contains 'blue'), so team
 * attribution works for one seat and not the other; the cliff is disabled there
 * outright so both duet seats guess with identical discipline.
 */
function lastTakenScoreEstimate(view: BotClickerView, clueWord: string, backend: SemanticBackend): number | null {
    if (view.guessesUsed === 0 || view.gameMode === 'duet') return null;
    const ownRevealed: number[] = [];
    for (let i = 0; i < view.revealed.length; i++) {
        if (view.revealed[i] && view.types[i] === view.team) {
            // Same scale as the live ranking (guessRetrieval) so the cliff
            // comparison never mixes damped and undamped scores.
            ownRevealed.push(guessRetrieval(backend, clueWord, view.words[i] as string));
        }
    }
    if (ownRevealed.length < view.guessesUsed) return null;
    ownRevealed.sort((a, b) => b - a);
    return ownRevealed[view.guessesUsed - 1] as number;
}

export function makeGreedyClicker(
    skill: SkillParams,
    backend: SemanticBackend = defaultSemanticBackend
): ClickerStrategy {
    return {
        strategyId: 'greedyClicker',
        chooseGuess(view: BotClickerView, ctx: BotContext): BotAction {
            const choices = unrevealedIndices(view);
            if (choices.length === 0 || !view.currentClue) return { kind: 'endTurn' };

            // Frame doubt (Phase 4.1): when the given reading of the clue is
            // uniformly weak on this board and the case-flipped sense clears
            // the bar, guess under THAT sense instead — deterministic per
            // view, so every tick re-derives the same frame. The view carries
            // the mid-clue continuation evidence (revealed own cards) so a
            // switched frame stays alive across its own guesses without letting
            // a delivering given-frame clue be hijacked once its strong cards
            // are consumed.
            const frame = resolveClueFrame(
                view.currentClue.word,
                choices.map((i) => view.words[i] as string),
                backend,
                frameContextFromView(view)
            );
            // Rank unrevealed cards by how strongly the clue RETRIEVES them:
            // associative relatedness or phrase completion, whichever is
            // stronger (clueRetrieval). A human completes "engine ___" before
            // reasoning about categories, so when the backend carries a
            // collocation channel the compound reading competes directly —
            // this is what makes the greedy clicker a faithful stand-in for a
            // human guesser in misfire-class-D boards. The clue-debt boost
            // (Phase 4.3) breaks ties toward cards an earlier clue still owes.
            const clueWord = frame.word;
            // guessRetrieval, not raw retrieval: a score with no semantic
            // provenance (the lexical bigram floor) is damped so a spelling
            // coincidence never outranks a genuine read (SUNDIAL→INDIA class).
            const scored = choices.map((index) => {
                const word = view.words[index] as string;
                return {
                    index,
                    score: guessRetrieval(backend, clueWord, word) + debtBoost(ctx, backend, clueWord, word),
                };
            });
            // Provenance of the whole decision: does the clue relate SEMANTICALLY
            // to any live candidate, or is this ranking pure spelling noise?
            // (Backends without hasSignal report no provenance — treat as informed.)
            const pairSignal = backend.hasSignal?.bind(backend);
            const informed = !pairSignal || choices.some((i) => pairSignal(clueWord, view.words[i] as string));
            let best = scored[0] as { index: number; score: number };
            let second = -Infinity;
            for (let i = 1; i < scored.length; i++) {
                const c = scored[i] as { index: number; score: number };
                if (c.score > best.score) {
                    second = best.score;
                    best = c;
                } else if (c.score > second) {
                    second = c.score;
                }
            }
            const aggression = skill.aggression ?? 0;

            const target = view.currentClue.number > 0 ? view.currentClue.number : choices.length;
            if (view.guessesUsed >= target) {
                // Opportunistic bonus ("+1"): the engine grants number+1 guesses,
                // and reaching here with the turn alive means every intended guess
                // landed. Spend the extra one only when the top leftover clears the
                // bonus floor AND the rest of the field by a wide margin — and only
                // for a persona with real aggression (plain presets never stretch).
                // Deliberate stretch = deterministic argmax, no temperature.
                const engineAllows = view.guessesAllowed === 0 || view.guessesUsed < view.guessesAllowed;
                const bonusFloor = BONUS_FLOOR_BASE + BONUS_FLOOR_TIMIDITY * (1 - aggression);
                if (
                    engineAllows &&
                    aggression > 0 &&
                    best.score >= bonusFloor &&
                    best.score - Math.max(second, 0) >= BONUS_FIELD_GAP
                ) {
                    return { kind: 'reveal', index: best.index };
                }
                return { kind: 'endTurn' };
            }

            // An UNINFORMED decision — the clue means nothing to the backend, so
            // the ranking above is spelling noise — gets exactly one least-bad
            // guess, then banks. Every further reveal would be a coin flip the
            // clue never promised (~1/3 own on a fresh board, with the assassin
            // in the pool), which is how a bot chained SUNDIAL→INDIA into a
            // three-card junk streak. A human who can't place a clue word taps
            // their best hunch once and stops; so does the bot.
            if (!informed && view.guessesUsed >= 1) {
                return { kind: 'endTurn' };
            }

            // Cards that plausibly match the clue — a weak guess is a MISREAD among
            // these, never a blind pick that could land on the clue-unrelated
            // assassin. The temperature sample below draws from the same set.
            const plausible = scored.filter((c) => c.score >= best.score * PLAUSIBLE_FIT_FRAC);

            // Blunder model: an occasional guess among the plausible candidates.
            if (ctx.rng.next() < skill.blunderRate) {
                const pick = plausible[ctx.rng.int(plausible.length)] as { index: number };
                return { kind: 'reveal', index: pick.index };
            }

            // After the first guess, a risk-averse bot stops if nothing looks related.
            const confidenceFloor = skill.riskAversion * 0.2;
            if (view.guessesUsed >= 1 && best.score < confidenceFloor) {
                return { kind: 'endTurn' };
            }

            // Relative cliff ("core + stretch"): even above the absolute floor,
            // stop when the next card is steep-below the last take, weak in
            // absolute terms, AND blurred into its alternatives (see the
            // three-condition rationale at the CLIFF_* constants above).
            const blurred = best.score - Math.max(second, 0) < CLIFF_SEPARATION;
            if (view.guessesUsed >= 1 && best.score < CLIFF_ABS_CEILING && blurred) {
                const lastTaken = lastTakenScoreEstimate(view, clueWord, backend);
                const delta = Math.min(0.9, CLIFF_BASE_DELTA + CLIFF_AGGRESSION_SLACK * aggression);
                if (lastTaken !== null && best.score < lastTaken * (1 - delta)) {
                    return { kind: 'endTurn' };
                }
            }

            const index = selectIndexByTemperature(plausible, skill.temperature, ctx.rng);
            return { kind: 'reveal', index };
        },
    };
}
