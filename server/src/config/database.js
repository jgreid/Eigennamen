/**
 * Database Configuration (PostgreSQL via Prisma)
 */

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

let prisma = null;

async function connectDatabase() {
    if (prisma) {
        return prisma;
    }

    prisma = new PrismaClient({
        log: process.env.NODE_ENV === 'development'
            ? ['query', 'info', 'warn', 'error']
            : ['error']
    });

    try {
        await prisma.$connect();
        logger.info('PostgreSQL connected via Prisma');
        return prisma;
    } catch (error) {
        logger.error('Failed to connect to PostgreSQL:', error);
        throw error;
    }
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
