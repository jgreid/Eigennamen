/**
 * Named skill presets. A bot's `skillPreset` resolves to one of these. Skill is
 * orthogonal to strategy type: any (strategyId, preset) pair is valid.
 *
 * The `seed` here is a base; the controller derives a per-decision seed from it
 * together with the game seed and state version so play stays reproducible.
 *
 * A `skillPreset` value may also name a *persona* (personas.ts), which bundles a
 * difficulty with a playstyle. resolveSkill checks personae first, so a persona
 * id is a drop-in replacement for a plain preset everywhere the field is used.
 */
import type { SkillParams } from './strategies/types';
import { resolvePersona, isPersona } from './personas';

export const SKILL_PRESETS = ['novice', 'intermediate', 'expert'] as const;
export type SkillPreset = (typeof SKILL_PRESETS)[number];

const PRESETS: Record<SkillPreset, Omit<SkillParams, 'seed'>> = {
    // "Off-kilter but sensible": high temperature samples real-but-suboptimal
    // clues/guesses, a big blunder rate injects the occasional random move, and
    // low caution means it barely plays defense or fears the assassin.
    novice: { temperature: 1.3, blunderRate: 0.4, riskAversion: 0.2 },
    // A clear step up: mostly argmax with mild exploration, few blunders, real
    // (but not maximal) caution and defensive avoidance.
    intermediate: { temperature: 0.35, blunderRate: 0.08, riskAversion: 0.55 },
    // "Scary good": pure argmax, never blunders, maximum caution — full defensive
    // avoidance and the widest assassin berth.
    expert: { temperature: 0.0, blunderRate: 0.0, riskAversion: 0.8 },
};

export function isSkillPreset(value: string): value is SkillPreset {
    return (SKILL_PRESETS as readonly string[]).includes(value);
}

export function resolveSkill(preset: string, seed: number): SkillParams {
    // Personae take precedence — they carry a difficulty AND a playstyle.
    const persona = resolvePersona(preset, seed);
    if (persona) return persona;
    const base = PRESETS[(isSkillPreset(preset) ? preset : 'intermediate') as SkillPreset];
    return { ...base, seed };
}

/** True for any value resolveSkill understands — a plain preset or a persona. */
export function isSkillOrPersona(value: string): boolean {
    return isSkillPreset(value) || isPersona(value);
}
