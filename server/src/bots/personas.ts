/**
 * Bot personae — the user-facing bot identities.
 *
 * A persona bundles a difficulty (temperature / blunderRate / riskAversion) with
 * a *playstyle* (the style knobs on SkillParams: defenseBias, aggression,
 * assassinCaution). Two experts can feel completely different — a Sharpshooter
 * plays tight, reliable clues while a Daredevil reaches for big numbers on thin
 * margins — even though both are near the top of the difficulty ladder.
 *
 * Personae live in the SAME namespace as the plain difficulty presets
 * (novice/intermediate/expert). A bot's persisted `skillPreset` may name either;
 * `resolveSkill` (presets.ts) checks personae first, then falls back to a preset,
 * so old configs keep working and a persona id is a drop-in replacement.
 */
import type { SkillParams } from './strategies/types';

/** Rough difficulty bucket — used only to group personae in the UI. */
export type PersonaTier = 'novice' | 'intermediate' | 'expert';

export interface PersonaDef {
    readonly id: string;
    /** Short display name for the host UI (e.g. "Sharpshooter"). */
    readonly label: string;
    /** One-line personality blurb shown beside the name. */
    readonly blurb: string;
    readonly tier: PersonaTier;
    /** Full skill + style, minus the per-bot seed (filled in at resolve time). */
    readonly skill: Omit<SkillParams, 'seed'>;
}

/**
 * The roster. Ordered strongest → weakest within the UI grouping. Numbers were
 * tuned against the diagnostics harness (`npm run bots:analyze`) so each persona
 * shows a distinct clue-number distribution, leak rate, and assassin exposure.
 */
export const PERSONAS: readonly PersonaDef[] = [
    {
        id: 'strategist',
        label: 'The Strategist',
        blurb: 'Scary-good all-rounder: strong coverage, real defense, wide assassin berth.',
        tier: 'expert',
        // Pure argmax, never blunders. Balanced: reaches for 2s/3s (aggression),
        // actively avoids arming the opponent (defenseBias), stays well clear of
        // the assassin (assassinCaution).
        skill: {
            temperature: 0.0,
            blunderRate: 0.0,
            riskAversion: 0.8,
            defenseBias: 1.3,
            aggression: 0.4,
            assassinCaution: 1.15,
            commonnessBias: 1.2,
        },
    },
    {
        id: 'sharpshooter',
        label: 'The Sharpshooter',
        blurb: 'Precise and low-variance: small, unmistakable clues that almost never misfire.',
        tier: 'expert',
        // Tight margins, minimal ambition — favours clarity over coverage, so it
        // clues 1s and 2s the clicker can read blind. The safest hands on the roster.
        skill: {
            temperature: 0.0,
            blunderRate: 0.0,
            riskAversion: 0.85,
            defenseBias: 1.0,
            aggression: 0.1,
            assassinCaution: 1.3,
            commonnessBias: 1.5,
        },
    },
    {
        id: 'guardian',
        label: 'The Guardian',
        blurb: 'Defensive wall: refuses to hand the opponent a clue, even at coverage cost.',
        tier: 'expert',
        // Max defenseBias leaves the opponent's board dark; high caution + wide
        // assassin berth. Trades a little ambition for denial — the "make it hard
        // for them" persona.
        skill: {
            temperature: 0.15,
            blunderRate: 0.03,
            riskAversion: 0.9,
            defenseBias: 2.0,
            aggression: 0.15,
            assassinCaution: 1.4,
            commonnessBias: 1.2,
        },
    },
    {
        id: 'daredevil',
        label: 'The Daredevil',
        blurb: 'High-roller: swings for big numbers on thin margins — huge upside, real risk.',
        tier: 'expert',
        // Aggression near max shrinks the margin for gutsy 3s/4s; low defenseBias
        // and trimmed assassin berth mean it leaks and flirts with the assassin
        // more than the others. High ceiling, higher variance.
        skill: {
            temperature: 0.1,
            blunderRate: 0.02,
            riskAversion: 0.3,
            defenseBias: 0.4,
            aggression: 0.95,
            assassinCaution: 0.7,
            commonnessBias: 0.7,
        },
    },
    {
        id: 'maverick',
        label: 'The Maverick',
        blurb: 'Creative and off-kilter: surprising associations, sometimes brilliant, sometimes odd.',
        tier: 'intermediate',
        // High temperature samples plausible-but-suboptimal clues, so it explores
        // the candidate set instead of always taking the argmax — the "vaguely
        // sensible but unpredictable" middle of the range.
        skill: {
            temperature: 0.85,
            blunderRate: 0.1,
            riskAversion: 0.5,
            defenseBias: 0.8,
            aggression: 0.55,
            assassinCaution: 1.0,
            commonnessBias: 0.4,
        },
    },
    {
        id: 'apprentice',
        label: 'The Apprentice',
        blurb: 'Learning the ropes: wobbly reads, frequent blunders, an easy warm-up opponent.',
        tier: 'novice',
        // Very high temperature + big blunder rate + low caution: the beginner
        // model. Barely plays defense and rarely fears the assassin.
        skill: {
            temperature: 1.3,
            blunderRate: 0.4,
            riskAversion: 0.2,
            defenseBias: 0.5,
            aggression: 0.3,
            assassinCaution: 0.9,
            commonnessBias: 0.8,
        },
    },
];

const PERSONA_BY_ID: Record<string, PersonaDef> = Object.fromEntries(PERSONAS.map((p) => [p.id, p]));

export function isPersona(value: string): boolean {
    return Object.prototype.hasOwnProperty.call(PERSONA_BY_ID, value);
}

export function getPersona(id: string): PersonaDef | undefined {
    return PERSONA_BY_ID[id];
}

/** Resolve a persona id to full SkillParams (style knobs included). */
export function resolvePersona(id: string, seed: number): SkillParams | null {
    const persona = PERSONA_BY_ID[id];
    if (!persona) return null;
    return { ...persona.skill, seed };
}
