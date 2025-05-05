// vercel.js - Entry point for Vercel serverless deployment
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const logger = require('./src/utils/logger');
const { expressErrorHandler } = require('./src/utils/errorHandler');

// Initialize Express app
const app = express();
const prisma = new PrismaClient();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging middleware
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.originalUrl}`, { ip: req.ip });
  next();
});

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Import routes
const authRoutes = require('./src/routes/auth.routes');
const chatRoutes = require('./src/routes/chat.routes');
const sessionRoutes = require('./src/routes/session.routes');
const authMiddleware = require('./src/middleware/auth.middleware');

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
  res.sendFile(path.join(__dirname, 'public/NewChat.html'));
});

// Specific route for the profile page
app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/profile.html'));
});

// Serve index.html for any other route (SPA fallback)
app.get('*', (req, res) => {
  // Ensure API routes are not caught here
  if (!req.originalUrl.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
  } else {
    // If it starts with /api but wasn't handled, it's a 404 API endpoint
    res.status(404).json({ success: false, message: 'API endpoint not found' });
  }
});

// Centralized Error Handling Middleware
app.use(expressErrorHandler);

// Export the serverless function handler
module.exports = (req, res) => {
  // Process the request with the Express app
  return app(req, res);
}; 