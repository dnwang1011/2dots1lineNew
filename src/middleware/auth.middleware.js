// src/middleware/auth.middleware.js
// Authentication middleware for verifying JWT tokens

const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Middleware to verify JWT token from request
 * Checks Authorization header, cookies, and query parameters
 */
exports.verifyToken = async (req, res, next) => {
  try {
    // Get token from various sources
    const authHeader = req.headers.authorization;
    const cookieToken = req.cookies.token;
    const queryToken = req.query.token;
    
    // Extract token from Bearer format or use direct token
    let token;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (cookieToken) {
      token = cookieToken;
    } else if (queryToken) {
      token = queryToken;
    }
    
    // If no token found, return error
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.'
      });
    }
    
    // Attach user info to request
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    };
    
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }
    
    return res.status(401).json({
      success: false,
      message: 'Invalid token. Please login again.'
    });
  }
}; 