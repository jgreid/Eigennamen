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

const logger = require('../utils/logger');

let prisma = null;
let databaseEnabled = false;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if database should be enabled
 */
function isDatabaseConfigured() {
    const dbUrl = process.env.DATABASE_URL;
    // Skip if not set, empty, or explicitly set to skip
    return dbUrl && dbUrl.length > 0 && !dbUrl.includes('skip');
}

async function connectDatabase() {
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
    let PrismaClient;
    try {
        PrismaClient = require('@prisma/client').PrismaClient;
    } catch (error) {
        logger.warn('Prisma client not available - running without database');
        databaseEnabled = false;
        return null;
    }

    prisma = new PrismaClient({
        log: process.env.NODE_ENV === 'development'
            ? ['query', 'info', 'warn', 'error']
            : ['error']
    });

    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            await prisma.$connect();
            logger.info('PostgreSQL connected via Prisma');
            databaseEnabled = true;
            return prisma;
        } catch (error) {
            lastError = error;
            const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);

            if (attempt < MAX_RETRIES) {
                logger.warn(`Database connection attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    // Database connection failed - continue without it
    logger.warn(`Failed to connect to PostgreSQL after ${MAX_RETRIES} attempts - continuing without database`);
    logger.warn('Game will work normally, but user accounts and game history will be unavailable');
    prisma = null;
    databaseEnabled = false;
    return null;
}

function getDatabase() {
    // Returns null if database is not configured/connected
    return prisma;
}

/**
 * Check if database is enabled and connected
 */
function isDatabaseEnabled() {
    return databaseEnabled && prisma !== null;
}

async function disconnectDatabase() {
    if (prisma) {
        await prisma.$disconnect();
        prisma = null;
        databaseEnabled = false;
        logger.info('PostgreSQL disconnected');
    }
}

module.exports = {
    connectDatabase,
    getDatabase,
    isDatabaseEnabled,
    isDatabaseConfigured,
    disconnectDatabase
};
