/**
 * Named skill presets. A bot's `skillPreset` resolves to one of these. Skill is
 * orthogonal to strategy type: any (strategyId, preset) pair is valid.
 *
 * The `seed` here is a base; the controller derives a per-decision seed from it
 * together with the game seed and state version so play stays reproducible.
 */
import type { SkillParams } from './strategies/types';

export const SKILL_PRESETS = ['novice', 'intermediate', 'expert'] as const;
export type SkillPreset = (typeof SKILL_PRESETS)[number];

const PRESETS: Record<SkillPreset, Omit<SkillParams, 'seed'>> = {
    novice: { temperature: 1.0, blunderRate: 0.35, riskAversion: 0.2 },
    intermediate: { temperature: 0.5, blunderRate: 0.1, riskAversion: 0.5 },
    expert: { temperature: 0.0, blunderRate: 0.0, riskAversion: 0.8 },
};

export function isSkillPreset(value: string): value is SkillPreset {
    return (SKILL_PRESETS as readonly string[]).includes(value);
}

export function resolveSkill(preset: string, seed: number): SkillParams {
    const base = PRESETS[(isSkillPreset(preset) ? preset : 'intermediate') as SkillPreset];
    return { ...base, seed };
}
