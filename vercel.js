// vercel.js
// This file is specifically for Vercel deployment
// It initializes the database and other services before exposing the app

const app = require('./src/index');
const { initializeDatabase, initializeOntology } = require('./src/utils/db-init');
const logger = require('./src/utils/logger');

// Initialize essential services without starting the server
// (Vercel will handle that part)
async function initialize() {
  try {
    // Initialize database
    const dbInitialized = await initializeDatabase();
    if (!dbInitialized) {
      logger.error('Failed to initialize database in Vercel environment');
      throw new Error('Database initialization failed');
    }
    
    // Initialize ontology (after database is confirmed working)
    await initializeOntology();
    
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
    res.status(500).send('Server initialization failed');
  }
}; 