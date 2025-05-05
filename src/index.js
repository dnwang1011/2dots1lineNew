// src/index.js
// Defines the Express application

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const logger = require('./utils/logger');
const { expressErrorHandler } = require('./utils/errorHandler');
const authMiddleware = require('./middleware/auth.middleware');

// --- Route Imports ---
const authRoutes = require('./routes/auth.routes');
const chatRoutes = require('./routes/chat.routes');
const sessionRoutes = require('./routes/session.routes');

// --- Create Express App ---
const app = express();

// --- Core Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- Logging Middleware ---
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.originalUrl}`, { ip: req.ip });
  next();
});

// --- Static Files ---
// Serve static files from public folder (relative to project root)
app.use(express.static(path.join(__dirname, '../public')));

// --- API Routes ---
app.use('/api/auth', authRoutes);
// Apply token verification middleware AFTER public auth routes
app.use('/api/chat', authMiddleware.verifyToken, chatRoutes);
app.use('/api/session', authMiddleware.verifyToken, sessionRoutes);

// --- Health Check ---
app.get('/health', (req, res) => {
  // Basic health check, doesn't require DB connection here
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// --- API 404 Handler ---
app.use('/api/*', (req, res) => {
  logger.warn(`API endpoint not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: 'API endpoint not found' });
});

// --- Frontend Routes & SPA Fallback ---
// Specific route for the chat page (if needed, otherwise SPA fallback handles it)
// app.get('/newchat', (req, res) => {
//   res.sendFile(path.join(__dirname, '../public/NewChat.html'));
// });
// Specific route for the profile page (if needed)
// app.get('/profile', (req, res) => {
//   res.sendFile(path.join(__dirname, '../public/profile.html'));
// });

// Serve index.html (or chat.html) for any other non-API route
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api')) {
    // Let the API 404 handler catch this
    return next();
  }
  // Adjust the file served based on your frontend structure
  res.sendFile(path.join(__dirname, '../public', 'chat.html'));
});

// --- Centralized Error Handling ---
// This MUST be the last middleware added
app.use(expressErrorHandler);


// --- Server Startup Logic (Only when run directly) ---
if (require.main === module) {
  const { PrismaClient } = require('@prisma/client');
  const { initializeDatabase, initializeOntology } = require('./utils/db-init');
  const consolidationAgent = require('./services/consolidationAgent');
  const thoughtAgent = require('./services/thoughtAgent');

  const prisma = new PrismaClient(); // Instantiate PrismaClient *only* here
  const PORT = process.env.PORT || 3002;

  async function startServer() {
    try {
      logger.info('[Bootstrap] Initializing database...');
      // Pass the prisma instance to the initialization function
      const dbInitialized = await initializeDatabase(prisma);
      if (!dbInitialized) {
        logger.error('Failed to initialize database. Exiting...');
        await prisma.$disconnect();
        process.exit(1);
      }
      logger.info('[Bootstrap] Database initialized successfully.');

      // Initialize ontology (if it needs prisma, pass it)
      logger.info('[Bootstrap] Initializing ontology...');
      await initializeOntology(prisma); // Assuming it might need prisma
      logger.info('[Bootstrap] Ontology initialized successfully.');

      // ---> Start Agent Workers/Schedulers <---
      // Pass prisma instance if needed by agents
      logger.info('[Bootstrap] Starting background agents...');
      consolidationAgent.startConsolidationWorker(/* pass prisma if needed */);
      thoughtAgent.scheduleNightlyThoughtGeneration(/* pass prisma if needed */);
      logger.info('[Bootstrap] Background agents initialized.');
      // ---> End Agent Start <---

      // Create uploads directory (only needed for local server)
      const fs = require('fs');
      const uploadsDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadsDir)) {
        logger.info(`Creating uploads directory at ${uploadsDir}`);
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      // Start HTTP server
      const server = app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`);
        logger.info(`Access the application at http://localhost:${PORT}`);

        // Log configuration status
        logger.info('Configuration status:');
        logger.info(`- Gemini API Key: ${process.env.GOOGLE_AI_API_KEY ? 'Configured' : 'Missing'}`);
        logger.info(`- JWT Secret: ${process.env.JWT_SECRET ? 'Configured' : 'Missing'}`);
        logger.info(`- Database URL: ${process.env.DATABASE_URL ? 'Configured' : 'Missing'}`);
        logger.info(`- Redis Host: ${process.env.REDIS_HOST ? process.env.REDIS_HOST : 'Missing'}`);
      });

      // Handle graceful shutdown
      const shutdown = async (signal) => {
        logger.info(`Received ${signal}. Shutting down gracefully...`);
        server.close(async () => {
          logger.info('HTTP server closed.');
          await prisma.$disconnect();
          logger.info('Database connection closed.');
          // Add agent shutdown logic here if needed
          await consolidationAgent.shutdown();
          await thoughtAgent.shutdown();
          logger.info('Agents shut down.');
          process.exit(0);
        });
      };

      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));

    } catch (err) {
      logger.error('Failed to start server:', err);
      if (prisma) await prisma.$disconnect();
      process.exit(1);
    }
  }

  startServer();

  // Optional: Handle unhandled promise rejections and uncaught exceptions
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', { promise, reason });
    // Consider exiting or implementing more robust error handling
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception thrown:', { error });
    // It is strongly recommended to restart the process after an uncaught exception
    process.exit(1);
  });
}

// --- Export the Express App (for Vercel/testing) ---
module.exports = app; 