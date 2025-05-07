// src/index.js
// Defines the Express application

require('dotenv').config();

// --- Server Startup Logic ---
if (require.main === module) {
  const express = require('express');
  const cors = require('cors');
  const cookieParser = require('cookie-parser');
  const path = require('path');
  const logger = require('./utils/logger');
  const { expressErrorHandler } = require('./utils/errorHandler');
  const authMiddleware = require('./middleware/auth.middleware');
  const { PrismaClient } = require('@prisma/client');
  const { initializeDatabase, initializeOntology } = require('./utils/db-init');
  const consolidationAgent = require('./services/consolidationAgent');
  const thoughtAgent = require('./services/thoughtAgent');

  // --- Route Imports ---
  const authRoutes = require('./routes/auth.routes');
  const chatRoutes = require('./routes/chat.routes');
  const sessionRoutes = require('./routes/session.routes');

  // --- Create Express App ---
  const app = express();
  const prisma = new PrismaClient();
  const PORT = process.env.PORT || 3002;

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
  app.use(express.static(path.join(__dirname, '../public')));

  // --- API Routes ---
  app.use('/api/auth', authRoutes);
  app.use('/api/chat', authMiddleware.verifyToken, chatRoutes);
  app.use('/api/session', authMiddleware.verifyToken, sessionRoutes);

  // --- Health Check ---
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date() });
  });

  // --- API 404 Handler ---
  app.use('/api/*', (req, res) => {
    logger.warn(`API endpoint not found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'API endpoint not found' });
  });

  // --- Chat Interface Route ---
  app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'chat.html'));
  });

  // --- Frontend Routes & SPA Fallback ---
  app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
  });

  // --- Centralized Error Handling ---
  app.use(expressErrorHandler);

  // --- Start Server Function ---
  async function startLocalServer() {
    try {
      logger.info('[Bootstrap] Initializing database...');
      const dbInitialized = await initializeDatabase(prisma);
      if (!dbInitialized) {
        logger.error('Failed to initialize database. Exiting...');
        await prisma.$disconnect();
        process.exit(1);
      }
      logger.info('[Bootstrap] Database initialized successfully.');

      logger.info('[Bootstrap] Initializing ontology...');
      await initializeOntology(prisma);
      logger.info('[Bootstrap] Ontology initialized successfully.');

      logger.info('[Bootstrap] Starting background agents...');
      consolidationAgent.startConsolidationWorker();
      thoughtAgent.scheduleNightlyThoughtGeneration();
      logger.info('[Bootstrap] Background agents initialized.');

      const fs = require('fs');
      const uploadsDir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(uploadsDir)) {
        logger.info(`Creating uploads directory at ${uploadsDir}`);
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const server = app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`);
        logger.info(`Access the application at http://localhost:${PORT}`);
        logger.info('Configuration status:');
        logger.info(`- Gemini API Key: ${process.env.GOOGLE_AI_API_KEY ? 'Configured' : 'Missing'}`);
        logger.info(`- JWT Secret: ${process.env.JWT_SECRET ? 'Configured' : 'Missing'}`);
        logger.info(`- Database URL: ${process.env.DATABASE_URL ? 'Configured' : 'Missing'}`);
        logger.info(`- Redis Host: ${process.env.REDIS_HOST ? process.env.REDIS_HOST : 'Missing'}`);
      });

      const shutdown = async (signal) => {
        logger.info(`Received ${signal}. Shutting down gracefully...`);
        server.close(async () => {
          logger.info('HTTP server closed.');
          await prisma.$disconnect();
          logger.info('Database connection closed.');
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

  startLocalServer(); // Start the server

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', { promise, reason });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception thrown:', { error });
    process.exit(1);
  });
} else {
  // This block executes if this file is required by another module
  console.log('This module is designed to be run directly, not required.');
} 