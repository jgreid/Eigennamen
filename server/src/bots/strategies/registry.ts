/**
 * Strategy registry. Adding a bot type = one entry here.
 *
 * Each factory may provide a clicker and/or a spymaster implementation. The
 * controller asks for the role it needs; if the chosen strategy can't fill that
 * role (e.g. a clicker strategy landed in a spymaster seat) it falls back to the
 * matching `random*` driver so a game never stalls.
 */
import type { ClickerStrategy, SpymasterStrategy, SkillParams, StrategyFactory } from './types';
import { makeRandomClicker, makeCautiousClicker, makeGreedyClicker } from './clickers';
import { makeRandomSpymaster } from './spymasters';

export const STRATEGY_IDS = ['randomClicker', 'cautiousClicker', 'greedyClicker', 'randomSpymaster'] as const;
export type StrategyId = (typeof STRATEGY_IDS)[number];

const REGISTRY: Record<string, StrategyFactory> = {
    randomClicker: { strategyId: 'randomClicker', label: 'Random', makeClicker: makeRandomClicker },
    cautiousClicker: { strategyId: 'cautiousClicker', label: 'Cautious', makeClicker: makeCautiousClicker },
    greedyClicker: { strategyId: 'greedyClicker', label: 'Greedy', makeClicker: makeGreedyClicker },
    randomSpymaster: { strategyId: 'randomSpymaster', label: 'Random Spymaster', makeSpymaster: makeRandomSpymaster },
};

export function isStrategyId(value: string): value is StrategyId {
    return (STRATEGY_IDS as readonly string[]).includes(value);
}

export function getFactory(strategyId: string): StrategyFactory | undefined {
    return REGISTRY[strategyId];
}

/** Human-readable label for a strategy (used in default bot nicknames). */
export function strategyLabel(strategyId: string): string {
    return REGISTRY[strategyId]?.label ?? 'Bot';
}

/** Resolve a clicker strategy, falling back to randomClicker. */
export function resolveClicker(strategyId: string, skill: SkillParams): ClickerStrategy {
    const factory = REGISTRY[strategyId];
    return factory?.makeClicker?.(skill) ?? makeRandomClicker(skill);
}

/** Resolve a spymaster strategy, falling back to randomSpymaster. */
export function resolveSpymaster(strategyId: string, skill: SkillParams): SpymasterStrategy {
    const factory = REGISTRY[strategyId];
    return factory?.makeSpymaster?.(skill) ?? makeRandomSpymaster(skill);
}
