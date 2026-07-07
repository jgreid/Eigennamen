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

// A five-rung difficulty ladder, ordered weakest → strongest. The three knobs
// move monotonically so each rung is a clean step up: temperature (selection
// noise) and blunderRate (random moves) fall as skill rises, while riskAversion
// (stop-early caution + assassin fear + defense) rises. `beginner`/`advanced`
// fill the old novice↔intermediate↔expert cliffs so a host has a real spectrum
// from gently-beatable to scary. Values are tuned against the embeddings
// tournament (monotonic win-rate, no weak-rung assassin self-destruction).
export const SKILL_PRESETS = ['novice', 'beginner', 'intermediate', 'advanced', 'expert'] as const;
export type SkillPreset = (typeof SKILL_PRESETS)[number];

const PRESETS: Record<SkillPreset, Omit<SkillParams, 'seed'>> = {
    // Weak but human: it picks among plausible (clue-related) cards with a lot of
    // noise and gives up early — it loses by under-delivering and misreading, NOT
    // by blundering onto the assassin. The temperature is deliberately below the
    // "flat enough to sample the assassin" range, and caution is real so it fears
    // the assassin and stops when nothing fits.
    novice: { temperature: 1.2, blunderRate: 0.3, riskAversion: 0.4 },
    // Finding its feet: less noise, fewer random moves, a touch more caution.
    beginner: { temperature: 0.62, blunderRate: 0.13, riskAversion: 0.5 },
    // A clear step up: mostly argmax with mild exploration, few blunders, real
    // (but not maximal) caution and defensive avoidance.
    intermediate: { temperature: 0.42, blunderRate: 0.1, riskAversion: 0.58 },
    // Strong: nearly argmax, rare blunders, wide caution — closes most of the gap
    // to expert without the last drop of precision.
    advanced: { temperature: 0.15, blunderRate: 0.03, riskAversion: 0.7 },
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
