/**
 * Database Configuration (PostgreSQL via Prisma)
 */

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

let prisma = null;

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000; // 1 second

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function connectDatabase() {
    if (prisma) {
        return prisma;
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

    logger.error(`Failed to connect to PostgreSQL after ${MAX_RETRIES} attempts:`, lastError);
    throw lastError;
}

function getDatabase() {
    if (!prisma) {
        throw new Error('Database not initialized. Call connectDatabase() first.');
    }
    return prisma;
}

async function disconnectDatabase() {
    if (prisma) {
        await prisma.$disconnect();
        prisma = null;
        logger.info('PostgreSQL disconnected');
    }
}

module.exports = {
    connectDatabase,
    getDatabase,
    disconnectDatabase
};
