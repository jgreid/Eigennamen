import type { z as ZodType } from 'zod';

import { z } from 'zod';
import { removeControlChars } from '../utils/sanitize';
import { isStrategyId } from '../bots/strategies/registry';
import { isSkillOrPersona } from '../bots/presets';
import { PUBLIC_PLAYER_ID_REGEX } from '../services/player/publicId';

// Validates a persisted bot config (bot:{sessionId}:cfg). Lenient on enums so a
// stored config from an older strategy set still parses (controller falls back).
const botConfigSchema = z.object({
    strategyId: z.string().min(1),
    skillPreset: z.string().min(1),
    seed: z.number(),
});

// bot:add — host adds a bot to a seat.
const botAddSchema = z.object({
    team: z.enum(['red', 'blue']),
    role: z.enum(['spymaster', 'clicker', 'advisor']),
    strategyId: z.string().refine((v: string) => isStrategyId(v), 'Unknown strategy'),
    // Accepts a difficulty preset (novice/intermediate/expert) or a persona id.
    skillPreset: z.string().refine((v: string) => isSkillOrPersona(v), 'Unknown skill preset or persona'),
    nickname: z
        .string()
        .max(30)
        .transform((val: string) => removeControlChars(val).trim())
        .optional(),
});

// bot:remove — host removes a bot by its opaque public playerId (N1).
const botRemoveSchema = z.object({
    playerId: z
        .string()
        .min(1, 'playerId is required')
        .max(100)
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => PUBLIC_PLAYER_ID_REGEX.test(val), 'Invalid player ID format'),
});

export type BotAddInput = ZodType.infer<typeof botAddSchema>;
export type BotRemoveInput = ZodType.infer<typeof botRemoveSchema>;

export { botConfigSchema, botAddSchema, botRemoveSchema };
