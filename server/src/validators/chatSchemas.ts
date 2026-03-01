import type { z as ZodType } from 'zod';

import { z } from 'zod';
import { VALIDATION } from '../config/constants';
import { removeControlChars } from '../utils/sanitize';

const chatMessageSchema = z.object({
    text: z
        .string()
        .min(1, 'Message is required')
        .max(VALIDATION.CHAT_MESSAGE_MAX_LENGTH, 'Message too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'Message is required'),
    teamOnly: z.boolean().default(false),
    spectatorOnly: z.boolean().default(false), // Spectator-only chat
});

// Spectator chat schema (for dedicated spectator chat event)
const spectatorChatSchema = z.object({
    message: z
        .string()
        .min(1, 'Message is required')
        .max(VALIDATION.CHAT_MESSAGE_MAX_LENGTH, 'Message too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'Message is required'),
});

// Type exports for schema inference
export type ChatMessageInput = ZodType.infer<typeof chatMessageSchema>;
export type SpectatorChatInput = ZodType.infer<typeof spectatorChatSchema>;

export { chatMessageSchema, spectatorChatSchema };
