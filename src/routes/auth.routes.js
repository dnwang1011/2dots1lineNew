// src/routes/auth.routes.js
// Authentication routes for login, register, and logout

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');

// Apply rate limiting to sensitive routes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per window
  message: 'Too many login attempts, please try again later'
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 60 minutes
  max: 3, // Limit each IP to 3 requests per window
  message: 'Too many registration attempts, please try again later'
});

// POST /api/auth/register - Register a new user
router.post('/register', registerLimiter, authController.register);

// POST /api/auth/login - Login a user
router.post('/login', loginLimiter, authController.login);

// POST /api/auth/logout - Logout a user (requires authentication)
router.post('/logout', authMiddleware.verifyToken, authController.logout);

// GET /api/auth/verify - Verify JWT token and return user info
router.get('/verify', authMiddleware.verifyToken, authController.verifyUser);

module.exports = router; 