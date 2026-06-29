/**
 * Clicker strategies (Phase 1 — no external assets required).
 *
 *  - randomClicker: uniform random over legal unrevealed cards. Baseline.
 *  - cautiousClicker: random pick, but stops after the clue's intended count
 *    (models a careful human who doesn't spend the bonus guess).
 *  - greedyClicker: ranks unrevealed cards by a SemanticBackend's relatedness to
 *    the clue word and reveals the best, up to the clue count. With the default
 *    lexical backend it is weak; swapping in embeddings (Phase 3) makes it smart.
 */
import type { BotAction, BotClickerView, BotContext, ClickerStrategy, SkillParams } from './types';
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
            let bestIdx = choices[0] as number;
            let bestScore = -Infinity;
            for (const i of choices) {
                const score = backend.relatedness(view.words[i] as string, clueWord);
                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = i;
                }
            }

            // After the first guess, a risk-averse bot stops if nothing looks related.
            const confidenceFloor = skill.riskAversion * 0.2;
            if (view.guessesUsed >= 1 && bestScore < confidenceFloor) {
                return { kind: 'endTurn' };
            }
            return { kind: 'reveal', index: bestIdx };
        },
    };
}
