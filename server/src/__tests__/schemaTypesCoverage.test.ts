/**
 * Schema Types Coverage Tests
 *
 * Tests for validators/schemas.types.ts to cover:
 * - validateWithSchema function
 * - Type re-exports
 */

describe('Schema Types', () => {
    let schemasTypes: typeof import('../validators/schemas.types');

    beforeEach(() => {
        jest.resetModules();
        schemasTypes = require('../validators/schemas.types');
    });

    describe('validateWithSchema', () => {
        it('should return success with valid data', () => {
            const { z } = require('zod');
            const schema = z.object({
                name: z.string(),
                age: z.number()
            });

            const result = schemasTypes.validateWithSchema(schema, { name: 'Test', age: 25 });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.name).toBe('Test');
                expect(result.data.age).toBe(25);
            }
        });

        it('should return failure with invalid data', () => {
            const { z } = require('zod');
            const schema = z.object({
                name: z.string(),
                age: z.number()
            });

            const result = schemasTypes.validateWithSchema(schema, { name: 123, age: 'invalid' });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error).toBeDefined();
                expect(result.error.issues.length).toBeGreaterThan(0);
            }
        });

        it('should work with string schemas', () => {
            const { z } = require('zod');
            const schema = z.string().min(3);

            const successResult = schemasTypes.validateWithSchema(schema, 'hello');
            expect(successResult.success).toBe(true);

            const failResult = schemasTypes.validateWithSchema(schema, 'ab');
            expect(failResult.success).toBe(false);
        });

        it('should work with optional fields', () => {
            const { z } = require('zod');
            const schema = z.object({
                required: z.string(),
                optional: z.string().optional()
            });

            const result = schemasTypes.validateWithSchema(schema, { required: 'test' });
            expect(result.success).toBe(true);
        });
    });

    describe('Re-exports', () => {
        it('should export validationSchemas', () => {
            expect(schemasTypes.validationSchemas).toBeDefined();
        });

        it('should have room schemas available', () => {
            expect(schemasTypes.validationSchemas.roomCreateSchema).toBeDefined();
            expect(schemasTypes.validationSchemas.roomJoinSchema).toBeDefined();
        });

        it('should have game schemas available', () => {
            expect(schemasTypes.validationSchemas.gameStartSchema).toBeDefined();
            expect(schemasTypes.validationSchemas.gameRevealSchema).toBeDefined();
            expect(schemasTypes.validationSchemas.gameClueSchema).toBeDefined();
        });

        it('should have player schemas available', () => {
            expect(schemasTypes.validationSchemas.playerTeamSchema).toBeDefined();
            expect(schemasTypes.validationSchemas.playerRoleSchema).toBeDefined();
            expect(schemasTypes.validationSchemas.playerNicknameSchema).toBeDefined();
        });

        it('should have chat schemas available', () => {
            expect(schemasTypes.validationSchemas.chatMessageSchema).toBeDefined();
        });
    });
});
