import { botAddSchema, botRemoveSchema, botConfigSchema } from '../../validators/botSchemas';
import { derivePlayerId } from '../../services/player/publicId';

describe('botAddSchema', () => {
    it('accepts a valid bot spec', () => {
        const r = botAddSchema.safeParse({
            team: 'red',
            role: 'clicker',
            strategyId: 'greedyClicker',
            skillPreset: 'expert',
        });
        expect(r.success).toBe(true);
    });

    it('accepts a persona id as the skill preset', () => {
        const r = botAddSchema.safeParse({
            team: 'blue',
            role: 'spymaster',
            strategyId: 'embeddingSpymaster',
            skillPreset: 'strategist',
        });
        expect(r.success).toBe(true);
    });

    it('rejects an unknown strategy', () => {
        expect(
            botAddSchema.safeParse({ team: 'red', role: 'clicker', strategyId: 'nope', skillPreset: 'expert' }).success
        ).toBe(false);
    });

    it('rejects an unknown skill preset', () => {
        expect(
            botAddSchema.safeParse({
                team: 'red',
                role: 'clicker',
                strategyId: 'greedyClicker',
                skillPreset: 'godlike',
            }).success
        ).toBe(false);
    });

    it('rejects an invalid team/role', () => {
        expect(
            botAddSchema.safeParse({
                team: 'green',
                role: 'clicker',
                strategyId: 'greedyClicker',
                skillPreset: 'expert',
            }).success
        ).toBe(false);
        expect(
            botAddSchema.safeParse({
                team: 'red',
                role: 'spectator',
                strategyId: 'greedyClicker',
                skillPreset: 'expert',
            }).success
        ).toBe(false);
    });
});

describe('botRemoveSchema', () => {
    it('accepts a derived public player id', () => {
        expect(botRemoveSchema.safeParse({ playerId: derivePlayerId('bot-abc') }).success).toBe(true);
    });
    it('rejects an empty player id', () => {
        expect(botRemoveSchema.safeParse({ playerId: '' }).success).toBe(false);
    });
    it('rejects a non-hex player id (e.g. a raw session id)', () => {
        expect(botRemoveSchema.safeParse({ playerId: 'bot-abc' }).success).toBe(false);
    });
});

describe('botConfigSchema', () => {
    it('parses a stored config', () => {
        const r = botConfigSchema.safeParse({ strategyId: 'greedyClicker', skillPreset: 'expert', seed: 123 });
        expect(r.success).toBe(true);
    });
});
