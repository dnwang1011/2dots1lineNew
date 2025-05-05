// src/index.js
// Main entry point for the 2dots1line API server

require('dotenv').config();

// Set default Weaviate host if not defined
if (!process.env.WEAVIATE_HOST) {
  process.env.WEAVIATE_HOST = 'http://localhost:8080';
}

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const logger = require('./utils/logger');
const { expressErrorHandler } = require('./utils/errorHandler');

// Initialize Express app
const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging middleware (optional - winston handles timestamps etc.)
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.originalUrl}`, { ip: req.ip });
  next();
});

// Serve static files from public folder
app.use(express.static(path.join(__dirname, '../public')));

// Create uploads directory if running in development
if (process.env.NODE_ENV !== 'production') {
  const fs = require('fs');
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

// Import routes
const authRoutes = require('./routes/auth.routes');
const chatRoutes = require('./routes/chat.routes');
const sessionRoutes = require('./routes/session.routes');
const authMiddleware = require('./middleware/auth.middleware');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', authMiddleware.verifyToken, chatRoutes);
app.use('/api/session', authMiddleware.verifyToken, sessionRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ message: 'API endpoint not found' });
});

// Specific route for the chat page
app.get('/newchat', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/NewChat.html'));
});

// Specific route for the profile page
app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profile.html'));
});

// Serve index.html for any other route (SPA fallback)
app.get('*', (req, res) => {
  // Ensure API routes are not caught here
  if (!req.originalUrl.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../public', 'chat.html'));
  } else {
    // If it starts with /api but wasn't handled, it's a 404 API endpoint
    res.status(404).json({ success: false, message: 'API endpoint not found' });
  }
});

// Centralized Error Handling Middleware
app.use(expressErrorHandler);

// Only start the server when running directly (not as a module in Vercel)
if (process.env.NODE_ENV !== 'production' || require.main === module) {
  const { initializeDatabase, initializeOntology } = require('./utils/db-init');
  const consolidationAgent = require('./services/consolidationAgent');
  const thoughtAgent = require('./services/thoughtAgent');
  
  // Start server and initialize database
  async function startServer() {
    try {
      // Initialize database
      const dbInitialized = await initializeDatabase();
      if (!dbInitialized) {
        logger.error('Failed to initialize database. Exiting...');
        process.exit(1);
      }
      
      // Initialize ontology (after database is confirmed working)
      await initializeOntology();
      
      // ---> Start Agent Workers/Schedulers <---
      logger.info('[Bootstrap] Starting background agents...');
      consolidationAgent.startConsolidationWorker(); 
      thoughtAgent.scheduleNightlyThoughtGeneration();
      logger.info('[Bootstrap] Background agents initialized.');
      // ---> End Agent Start <---
      
      // Start HTTP server
      const server = app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`);
        logger.info(`Access the application at http://localhost:${PORT}`);
        
        // Log configuration status
        logger.info('Configuration status:');
        logger.info(`- Gemini API Key: ${process.env.GOOGLE_AI_API_KEY ? 'Configured' : 'Missing'}`);
        logger.info(`- JWT Secret: ${process.env.JWT_SECRET ? 'Configured' : 'Missing'}`);
      });

      // Expose server instance for graceful shutdown
      module.exports.server = server;
    } catch (err) {
      logger.error('Failed to start server:', err);
      process.exit(1);
    }
  }

  startServer();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    // Optional: Add agent shutdown logic here if needed
    await consolidationAgent.shutdown();
    await thoughtAgent.shutdown();
    // ---> End Agent Shutdown <---
    logger.info('Database connection closed.');
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await prisma.$disconnect();
    // Optional: Add agent shutdown logic here if needed
    await consolidationAgent.shutdown();
    await thoughtAgent.shutdown();
    // ---> End Agent Shutdown <---
    logger.info('Database connection closed.');
    process.exit(0);
  });

  // Optional: Handle unhandled promise rejections and uncaught exceptions
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', { promise, reason });
    // Application specific logging, throwing an error, or other logic here
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception thrown:', { error });
    // It is generally recommended to restart the process after an uncaught exception
    process.exit(1);
  });
}

// For Vercel serverless functions, export the Express app instance
module.exports = app; 