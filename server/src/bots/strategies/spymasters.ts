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

/** Relatedness threshold for a card to "count" as linked by a clue. */
const LINK = 0.5;
const MAX_CLUE_NUMBER = 4;

/**
 * Semantic spymaster: scans the backend's clue vocabulary and picks the clue
 * that links the most of its own unrevealed cards while never touching the
 * assassin and avoiding opponent/neutral cards (penalty weighted by
 * riskAversion). Uses the table backend by default; a real embedding backend
 * drops in unchanged. With the asset-free lexical fallback it behaves close to
 * randomSpymaster, so it always produces a legal clue.
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

            // Occasional blunder: a random legal clue.
            if (legalVocab.length > 0 && ctx.rng.next() < skill.blunderRate) {
                const word = legalVocab[ctx.rng.int(legalVocab.length)] as string;
                return { kind: 'clue', word, number: 1 };
            }

            const oppWeight = 1 + skill.riskAversion; // opponent links hurt more
            const neutralWeight = 0.5 * skill.riskAversion;

            let best: { word: string; links: number; score: number } | null = null;
            for (const clue of legalVocab) {
                const ownLinks = groups.own.filter((w) => backend.relatedness(clue, w) >= LINK).length;
                if (ownLinks === 0) continue;
                // Never risk the assassin.
                if (groups.assassin.some((w) => backend.relatedness(clue, w) >= LINK)) continue;
                const oppLinks = groups.opponent.filter((w) => backend.relatedness(clue, w) >= LINK).length;
                const neutralLinks = groups.neutral.filter((w) => backend.relatedness(clue, w) >= LINK).length;
                const score = ownLinks - oppWeight * oppLinks - neutralWeight * neutralLinks;
                if (!best || score > best.score) best = { word: clue, links: ownLinks, score };
            }

            if (!best) {
                // No vocabulary linked any own card (e.g. custom list): give a safe,
                // legal placeholder clue so the game proceeds.
                const pool =
                    legalVocab.length > 0
                        ? legalVocab
                        : CLUE_VOCAB.filter((w) => isClueLegalForBoard(w, view.words as string[]));
                const word = (pool[0] ?? pickFallbackClue(view)) as string;
                return { kind: 'clue', word, number: 1 };
            }

            const number = Math.max(1, Math.min(best.links, MAX_CLUE_NUMBER));
            return { kind: 'clue', word: best.word, number };
        },
    };
}
