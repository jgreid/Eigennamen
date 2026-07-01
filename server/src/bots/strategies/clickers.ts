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
 */
import type { BotAction, BotClickerView, BotContext, ClickerStrategy, SkillParams, SeededRng } from './types';
import type { SemanticBackend } from '../semantics/backend';
import { defaultSemanticBackend } from '../semantics/backend';

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

export function makeGreedyClicker(
    skill: SkillParams,
    backend: SemanticBackend = defaultSemanticBackend
): ClickerStrategy {
    return {
        strategyId: 'greedyClicker',
        chooseGuess(view: BotClickerView, ctx: BotContext): BotAction {
            const choices = unrevealedIndices(view);
            if (choices.length === 0 || !view.currentClue) return { kind: 'endTurn' };

            const target = view.currentClue.number > 0 ? view.currentClue.number : choices.length;
            if (view.guessesUsed >= target) return { kind: 'endTurn' };

            // Blunder model: an occasional outright random guess.
            if (ctx.rng.next() < skill.blunderRate) {
                const idx = choices[ctx.rng.int(choices.length)] as number;
                return { kind: 'reveal', index: idx };
            }

            // Rank unrevealed cards by relatedness to the clue word.
            const clueWord = view.currentClue.word;
            const scored = choices.map((index) => ({
                index,
                score: backend.relatedness(view.words[index] as string, clueWord),
            }));
            const bestScore = scored.reduce((m, c) => (c.score > m ? c.score : m), -Infinity);

            // After the first guess, a risk-averse bot stops if nothing looks related.
            const confidenceFloor = skill.riskAversion * 0.2;
            if (view.guessesUsed >= 1 && bestScore < confidenceFloor) {
                return { kind: 'endTurn' };
            }

            const index = selectIndexByTemperature(scored, skill.temperature, ctx.rng);
            return { kind: 'reveal', index };
        },
    };
}
