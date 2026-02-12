/**
 * Timer Validation Schemas
 *
 * Zod schemas for timer add-time operations.
 */

import type { z as ZodType } from 'zod';

const { z } = require('zod');

// Timer add-time schema (centralized from timerHandlers.ts)
const timerAddTimeSchema = z.object({
    seconds: z.number()
        .int()
        .min(10, 'Must add at least 10 seconds')
        .max(300, 'Cannot add more than 5 minutes')
});

// Type exports for schema inference
export type TimerAddTimeInput = ZodType.infer<typeof timerAddTimeSchema>;

export {
    timerAddTimeSchema
};
