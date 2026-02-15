/**
 * Tests for Database Configuration
 */

// Store original env values
const originalEnv = { ...process.env };

describe('Database Configuration', () => {
    let dbModule;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        // Reset env to original values
        process.env = { ...originalEnv };
        delete process.env.DATABASE_URL;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('isDatabaseConfigured', () => {
        it('should return falsy when DATABASE_URL is not set', () => {
            delete process.env.DATABASE_URL;
            dbModule = require('../../config/database');

            expect(dbModule.isDatabaseConfigured()).toBeFalsy();
        });

        it('should return falsy when DATABASE_URL is empty', () => {
            process.env.DATABASE_URL = '';
            dbModule = require('../../config/database');

            expect(dbModule.isDatabaseConfigured()).toBeFalsy();
        });

        it('should return falsy when DATABASE_URL contains "skip"', () => {
            process.env.DATABASE_URL = 'skip';
            dbModule = require('../../config/database');

            expect(dbModule.isDatabaseConfigured()).toBeFalsy();
        });

        it('should return true when DATABASE_URL is valid', () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/codenames';
            dbModule = require('../../config/database');

            expect(dbModule.isDatabaseConfigured()).toBe(true);
        });
    });

    describe('isDatabaseEnabled', () => {
        it('should return false when database is not configured', () => {
            delete process.env.DATABASE_URL;
            dbModule = require('../../config/database');

            expect(dbModule.isDatabaseEnabled()).toBe(false);
        });

        it('should return false when database is not connected', () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/codenames';
            dbModule = require('../../config/database');

            // Before connecting, should be false
            expect(dbModule.isDatabaseEnabled()).toBe(false);
        });
    });

    describe('getDatabase', () => {
        it('should return null when database is not configured', () => {
            delete process.env.DATABASE_URL;
            dbModule = require('../../config/database');

            expect(dbModule.getDatabase()).toBeNull();
        });

        it('should return null when database is not connected', () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/codenames';
            dbModule = require('../../config/database');

            expect(dbModule.getDatabase()).toBeNull();
        });
    });

    describe('connectDatabase', () => {
        it('should skip connection when DATABASE_URL is not set', async () => {
            delete process.env.DATABASE_URL;
            dbModule = require('../../config/database');

            const result = await dbModule.connectDatabase();

            expect(result).toBeNull();
            expect(dbModule.isDatabaseEnabled()).toBe(false);
        });

        it('should skip connection when DATABASE_URL is empty', async () => {
            process.env.DATABASE_URL = '';
            dbModule = require('../../config/database');

            const result = await dbModule.connectDatabase();

            expect(result).toBeNull();
            expect(dbModule.isDatabaseEnabled()).toBe(false);
        });

        it('should skip connection when DATABASE_URL is a sentinel value', async () => {
            for (const sentinel of ['skip', 'disabled', 'none', 'SKIP', 'Disabled']) {
                jest.resetModules();
                process.env.DATABASE_URL = sentinel;
                dbModule = require('../../config/database');

                const result = await dbModule.connectDatabase();

                expect(result).toBeNull();
                expect(dbModule.isDatabaseEnabled()).toBe(false);
            }
        });
    });

    describe('disconnectDatabase', () => {
        it('should do nothing when database is not connected', async () => {
            delete process.env.DATABASE_URL;
            dbModule = require('../../config/database');

            // Should not throw
            await expect(dbModule.disconnectDatabase()).resolves.toBeUndefined();
        });
    });
});

