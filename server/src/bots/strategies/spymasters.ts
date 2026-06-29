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

export function makeRandomSpymaster(_skill: SkillParams): SpymasterStrategy {
    return {
        strategyId: 'randomSpymaster',
        chooseClue(view: BotSpymasterView, ctx: BotContext): BotAction {
            const legal = CLUE_VOCAB.filter((w) => isClueLegalForBoard(w, view.words as string[]));
            const pool = legal.length > 0 ? legal : ['CLUE'];
            const word = pool[ctx.rng.int(pool.length)] as string;
            // A small, conservative number bounded by remaining own cards.
            const own = countOwnUnrevealed(view);
            const number = Math.max(1, Math.min(own || 1, 3));
            return { kind: 'clue', word, number };
        },
    };
}
