import type { z as ZodType } from 'zod';

import { z } from 'zod';
import { removeControlChars } from '../utils/sanitize';
import { isStrategyId } from '../bots/strategies/registry';
import { isSkillPreset } from '../bots/presets';

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
    role: z.enum(['spymaster', 'clicker']),
    strategyId: z.string().refine((v: string) => isStrategyId(v), 'Unknown strategy'),
    skillPreset: z.string().refine((v: string) => isSkillPreset(v), 'Unknown skill preset'),
    nickname: z
        .string()
        .max(30)
        .transform((val: string) => removeControlChars(val).trim())
        .optional(),
});

// bot:remove — host removes a bot by its session id.
const botRemoveSchema = z.object({
    sessionId: z
        .string()
        .min(1, 'sessionId is required')
        .max(100)
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'sessionId is required'),
});

export type BotAddInput = ZodType.infer<typeof botAddSchema>;
export type BotRemoveInput = ZodType.infer<typeof botRemoveSchema>;

export { botConfigSchema, botAddSchema, botRemoveSchema };
