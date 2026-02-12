/**
 * Chat Validation Schemas
 *
 * Zod schemas for team/global chat messages and
 * spectator-only chat.
 */

import type { z as ZodType } from 'zod';

const { z } = require('zod');
const { VALIDATION } = require('../config/constants');
const { removeControlChars } = require('../utils/sanitize');

const chatMessageSchema = z.object({
    text: z.string()
        .min(1, 'Message is required')
        .max(VALIDATION.CHAT_MESSAGE_MAX_LENGTH, 'Message too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'Message is required'),
    teamOnly: z.boolean().default(false),
    spectatorOnly: z.boolean().default(false) // US-16.1: Spectator-only chat
});

// Spectator chat schema (for dedicated spectator chat event)
const spectatorChatSchema = z.object({
    message: z.string()
        .min(1, 'Message is required')
        .max(VALIDATION.CHAT_MESSAGE_MAX_LENGTH, 'Message too long')
        .transform((val: string) => removeControlChars(val).trim())
        .refine((val: string) => val.length >= 1, 'Message is required')
});

// Type exports for schema inference
export type ChatMessageInput = ZodType.infer<typeof chatMessageSchema>;
export type SpectatorChatInput = ZodType.infer<typeof spectatorChatSchema>;

export {
    chatMessageSchema,
    spectatorChatSchema
};
