// vercel.js - Entry point for Vercel serverless deployment
const app = require('./src/index'); // Require the configured Express app
const logger = require('./src/utils/logger');

logger.info('Vercel handler initializing...');

// Export the serverless function handler
// Vercel expects a function that takes (req, res)
module.exports = (req, res) => {
  try {
    // Process the request with the Express app instance
    // The app itself handles routing, middleware, etc.
    return app(req, res);
  } catch (error) {
    logger.error('Unhandled error in Vercel handler:', error);
    // Ensure a response is sent even on unexpected errors
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
}; 