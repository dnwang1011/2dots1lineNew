// vercel.js
// This file is specifically for Vercel deployment
// It initializes the database and other services before exposing the app

const { PrismaClient } = require('@prisma/client');
const app = require('./src/index');
const logger = require('./src/utils/logger');

// Global initialization flag to ensure we only initialize once
let isInitialized = false;
let prisma;

// Initialize essential services without starting the server
// (Vercel will handle that part)
async function initialize() {
  if (isInitialized) return app;
  
  try {
    logger.info('Initializing database connection...');
    
    // Test Prisma connection
    prisma = new PrismaClient();
    await prisma.$connect();
    logger.info('Database connection successful');
    
    // Set initialization flag
    isInitialized = true;
    
    logger.info('Vercel serverless initialization complete');
    
    // Return the app instance
    return app;
  } catch (err) {
    logger.error('Failed to initialize in Vercel environment:', err);
    throw err;
  }
}

// For Vercel, export an async function that initializes and returns the app
module.exports = async (req, res) => {
  try {
    // Initialize once
    const appInstance = await initialize();
    
    // Handle the request using the Express app
    return appInstance(req, res);
  } catch (error) {
    // If initialization fails, return a 500 error
    logger.error('Serverless function error:', error);
    res.status(500).send('Server initialization failed: ' + error.message);
  }
}; 