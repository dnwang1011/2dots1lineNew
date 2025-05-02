// src/db/prisma.js
// Singleton Prisma client to be used across the application

const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger').childLogger('PrismaClient');

let prismaInstance = null;

function getPrismaInstance() {
  if (!prismaInstance) {
    logger.info('Creating new PrismaClient instance (Singleton)');
    
    prismaInstance = new PrismaClient({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'event',
          level: 'error',
        },
        {
          emit: 'event',
          level: 'info',
        },
        {
          emit: 'event',
          level: 'warn',
        },
      ],
    });
    
    // Optional: Add event listeners for debugging
    if (process.env.NODE_ENV === 'development') {
      prismaInstance.$on('query', (e) => {
        // Avoid logging overly long vectors
        const queryLog = e.query.length > 500 ? e.query.substring(0, 500) + '...]' : e.query;
        logger.debug(`Query executed in ${e.duration}ms: ${queryLog}`);
      });
      
      prismaInstance.$on('error', (e) => {
        logger.error('Prisma client error:', e);
      });
    }
    
    // Connect to the database
    prismaInstance.$connect()
      .then(() => logger.info('PrismaClient connected to database'))
      .catch((err) => logger.error('PrismaClient failed to connect:', err));
  } else {
    // logger.info('Using existing PrismaClient instance'); // Remove this potentially confusing log
  }
  return prismaInstance;
}

// Export the singleton instance getter
const prisma = getPrismaInstance();

// Add a central disconnect function
async function disconnectPrisma() {
  if (prismaInstance) {
    try {
      await prismaInstance.$disconnect();
      logger.info('PrismaClient disconnected successfully');
      prismaInstance = null; // Reset instance after disconnect
    } catch (error) {
      logger.error('Error disconnecting PrismaClient:', error);
    }
  }
}

module.exports = {
  prisma,
  disconnectPrisma
}; 