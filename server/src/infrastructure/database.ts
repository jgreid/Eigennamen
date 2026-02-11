/**
 * Database Configuration (PostgreSQL via Prisma)
 *
 * The database is OPTIONAL - the game works fully without it.
 * If DATABASE_URL is not set, the database is skipped entirely.
 *
 * Features requiring database:
 * - User accounts and authentication
 * - Game history and statistics
 * - Persistent custom word lists
 */

import logger from '../utils/logger';
// Type for Prisma client (dynamic import)
export interface PrismaClientType {
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
}

let prisma: PrismaClientType | null = null;
let databaseEnabled = false;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if database should be enabled
 */
function isDatabaseConfigured(): boolean {
    const dbUrl = process.env.DATABASE_URL;
    // Skip if not set, empty, or explicitly set to skip
    return !!(dbUrl && dbUrl.length > 0 && !dbUrl.includes('skip'));
}

async function connectDatabase(): Promise<PrismaClientType | null> {
    // Skip database if not configured
    if (!isDatabaseConfigured()) {
        logger.info('DATABASE_URL not configured - running without database (game history and accounts disabled)');
        databaseEnabled = false;
        return null;
    }

    if (prisma) {
        return prisma;
    }

    // Dynamic import to avoid errors when Prisma client isn't generated
    let PrismaClient: new (options?: unknown) => PrismaClientType;
    try {
        PrismaClient = require('@prisma/client').PrismaClient;
    } catch {
        logger.warn('Prisma client not available - running without database');
        databaseEnabled = false;
        return null;
    }

    prisma = new PrismaClient({
        log: process.env.NODE_ENV === 'development'
            ? ['query', 'info', 'warn', 'error']
            : ['error']
    });

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await prisma.$connect();
            logger.info('PostgreSQL connected via Prisma');
            databaseEnabled = true;
            return prisma;
        } catch (error) {
            lastError = error as Error;
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);

            if (attempt < MAX_RETRIES) {
                logger.warn(`Database connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    // Database connection failed - continue without it
    logger.warn(`Failed to connect to PostgreSQL after ${MAX_RETRIES} attempts - continuing without database`, lastError?.message);
    logger.warn('Game will work normally, but user accounts and game history will be unavailable');
    prisma = null;
    databaseEnabled = false;
    return null;
}

function getDatabase(): PrismaClientType | null {
    // Returns null if database is not configured/connected
    return prisma;
}

/**
 * Check if database is enabled and connected
 */
function isDatabaseEnabled(): boolean {
    return databaseEnabled && prisma !== null;
}

async function disconnectDatabase(): Promise<void> {
    if (prisma) {
        await prisma.$disconnect();
        prisma = null;
        databaseEnabled = false;
        logger.info('PostgreSQL disconnected');
    }
}
export {
    connectDatabase,
    getDatabase,
    isDatabaseEnabled,
    isDatabaseConfigured,
    disconnectDatabase
};
