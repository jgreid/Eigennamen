/**
 * Database Configuration Coverage Tests
 *
 * Tests for database.ts to cover uncovered lines:
 * - connectDatabase with Prisma client available (retry logic, success, failure)
 * - disconnectDatabase with active connection
 * - Development vs production logging
 */

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

describe('Database Configuration - Extended Coverage', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    // Helper to get the logger instance the database module uses
    function getLogger() {
        return require('../utils/logger');
    }

    describe('connectDatabase with Prisma available', () => {
        it('should connect successfully with Prisma client', async () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

            const mockPrismaInstance = {
                $connect: jest.fn().mockResolvedValue(undefined),
                $disconnect: jest.fn().mockResolvedValue(undefined)
            };

            jest.doMock('@prisma/client', () => ({
                PrismaClient: jest.fn(() => mockPrismaInstance)
            }));

            const db = require('../infrastructure/database');
            const result = await db.connectDatabase();

            expect(result).toBe(mockPrismaInstance);
            expect(mockPrismaInstance.$connect).toHaveBeenCalled();
            expect(db.isDatabaseEnabled()).toBe(true);
        });

        it('should return existing prisma instance if already connected', async () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

            const mockPrismaInstance = {
                $connect: jest.fn().mockResolvedValue(undefined),
                $disconnect: jest.fn().mockResolvedValue(undefined)
            };

            jest.doMock('@prisma/client', () => ({
                PrismaClient: jest.fn(() => mockPrismaInstance)
            }));

            const db = require('../infrastructure/database');
            const first = await db.connectDatabase();
            const second = await db.connectDatabase();

            expect(first).toBe(second);
        });

        it('should retry on connection failure with exponential backoff', async () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

            const mockPrismaInstance = {
                $connect: jest.fn()
                    .mockRejectedValueOnce(new Error('Connection refused'))
                    .mockRejectedValueOnce(new Error('Connection refused'))
                    .mockResolvedValueOnce(undefined),
                $disconnect: jest.fn().mockResolvedValue(undefined)
            };

            jest.doMock('@prisma/client', () => ({
                PrismaClient: jest.fn(() => mockPrismaInstance)
            }));

            const db = require('../infrastructure/database');
            const result = await db.connectDatabase();

            expect(result).toBe(mockPrismaInstance);
            expect(mockPrismaInstance.$connect).toHaveBeenCalledTimes(3);
            const logger = getLogger();
            expect(logger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Database connection attempt 1/5 failed')
            );
        });

        it('should fall back gracefully after all retries fail', async () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

            // Mock setTimeout to avoid real delays
            jest.useFakeTimers();

            const mockPrismaInstance = {
                $connect: jest.fn().mockRejectedValue(new Error('Connection refused')),
                $disconnect: jest.fn().mockResolvedValue(undefined)
            };

            jest.doMock('@prisma/client', () => ({
                PrismaClient: jest.fn(() => mockPrismaInstance)
            }));

            const db = require('../infrastructure/database');

            // Run connectDatabase and advance timers for each sleep
            const connectPromise = db.connectDatabase();

            // Advance timers for each retry delay
            for (let i = 0; i < 5; i++) {
                await Promise.resolve(); // Let the current attempt fail
                jest.advanceTimersByTime(32000); // Skip past max delay
                await Promise.resolve();
            }

            const result = await connectPromise;

            expect(result).toBeNull();
            expect(db.isDatabaseEnabled()).toBe(false);

            jest.useRealTimers();
        }, 30000);

        it('should handle Prisma client not available', async () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

            jest.doMock('@prisma/client', () => {
                throw new Error('Cannot find module @prisma/client');
            });

            const db = require('../infrastructure/database');
            const result = await db.connectDatabase();

            expect(result).toBeNull();
            expect(db.isDatabaseEnabled()).toBe(false);
        });

        it('should use development logging when NODE_ENV is development', async () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
            process.env.NODE_ENV = 'development';

            const PrismaClientMock = jest.fn((options: any) => {
                expect(options.log).toEqual(['query', 'info', 'warn', 'error']);
                return {
                    $connect: jest.fn().mockResolvedValue(undefined),
                    $disconnect: jest.fn().mockResolvedValue(undefined)
                };
            });

            jest.doMock('@prisma/client', () => ({
                PrismaClient: PrismaClientMock
            }));

            const db = require('../infrastructure/database');
            await db.connectDatabase();

            expect(PrismaClientMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    log: ['query', 'info', 'warn', 'error']
                })
            );
        });

        it('should use production logging when NODE_ENV is production', async () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
            process.env.NODE_ENV = 'production';

            const PrismaClientMock = jest.fn(() => ({
                $connect: jest.fn().mockResolvedValue(undefined),
                $disconnect: jest.fn().mockResolvedValue(undefined)
            }));

            jest.doMock('@prisma/client', () => ({
                PrismaClient: PrismaClientMock
            }));

            const db = require('../infrastructure/database');
            await db.connectDatabase();

            expect(PrismaClientMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    log: ['error']
                })
            );
        });
    });

    describe('disconnectDatabase with active connection', () => {
        it('should disconnect an active database connection', async () => {
            process.env.DATABASE_URL = 'postgresql://localhost:5432/test';

            const mockPrismaInstance = {
                $connect: jest.fn().mockResolvedValue(undefined),
                $disconnect: jest.fn().mockResolvedValue(undefined)
            };

            jest.doMock('@prisma/client', () => ({
                PrismaClient: jest.fn(() => mockPrismaInstance)
            }));

            const db = require('../infrastructure/database');
            await db.connectDatabase();
            expect(db.isDatabaseEnabled()).toBe(true);

            await db.disconnectDatabase();
            expect(mockPrismaInstance.$disconnect).toHaveBeenCalled();
            expect(db.isDatabaseEnabled()).toBe(false);
            expect(db.getDatabase()).toBeNull();
        });
    });
});
