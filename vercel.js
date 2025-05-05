// vercel.js - Vercel Entry Point
// Defines and exports the Express app for serverless deployment.

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const logger = require('./src/utils/logger');
const { expressErrorHandler } = require('./src/utils/errorHandler');
const authMiddleware = require('./src/middleware/auth.middleware');

// IMPORTANT: Initialize PrismaClient here for the serverless context
// Vercel manages the lifecycle; ensure DATABASE_URL is set in env vars.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// --- Route Imports ---
const authRoutes = require('./src/routes/auth.routes');
const chatRoutes = require('./src/routes/chat.routes');
const sessionRoutes = require('./src/routes/session.routes');

// --- Create Express App ---
const app = express();

// --- Core Middleware ---
app.use(cors()); // Configure CORS appropriately for your frontend
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- Logging Middleware ---
app.use((req, res, next) => {
  // Use a more specific logger context if desired
  logger.info(`Vercel Request: ${req.method} ${req.originalUrl}`, { ip: req.ip });
  next();
});

// --- Static Files ---
// Serve static files from the 'public' directory in the *root* of the deployment
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---
// IMPORTANT: Inject the prisma client instance into routes if they need it.
// Modify your route handlers to accept `prisma` or use a middleware approach.
app.use('/api/auth', authRoutes); // Assuming auth routes might not need prisma directly
app.use('/api/chat', authMiddleware.verifyToken, chatRoutes); // Pass prisma if needed: chatRoutes(prisma)
app.use('/api/session', authMiddleware.verifyToken, sessionRoutes); // Pass prisma if needed: sessionRoutes(prisma)

// --- Health Check ---
app.get('/health', async (req, res) => {
  try {
    // Optional: Check database connectivity for a more thorough health check
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'healthy', db: 'connected', timestamp: new Date() });
  } catch (dbError) {
    logger.error('Health check DB connection failed:', dbError);
    res.status(503).json({ status: 'unhealthy', db: 'disconnected', timestamp: new Date() });
  }
});

// --- API 404 Handler ---
app.use('/api/*', (req, res) => {
  logger.warn(`API endpoint not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ message: 'API endpoint not found' });
});

// --- Frontend Routes & SPA Fallback ---
// Serve index.html (or chat.html) for any other non-API route
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api')) {
    return next(); // Let the API 404 handler manage it
  }
  // Serve the main HTML file from the 'public' directory in the root
  res.sendFile(path.join(__dirname, 'public', 'chat.html'), (err) => {
    if (err) {
      logger.error(`Error sending SPA file: ${err.message}`);
      // Avoid sending error if headers already sent (e.g., by static middleware)
      if (!res.headersSent) {
         res.status(500).send('Error serving frontend application.');
      }
    }
  });
});

// --- Centralized Error Handling ---
app.use(expressErrorHandler);

// --- Export the Vercel Handler ---
// Vercel expects a function that takes (req, res)
module.exports = app; 