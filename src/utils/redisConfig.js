// src/utils/redisConfig.js
// Shared Redis configuration for all services

// const config = require('../config'); // Removed: Load from environment variables instead
const logger = require('./logger').childLogger('RedisConfig');

/**
 * Validates Redis configuration from environment variables and returns a connection object
 * @returns {Object|null} Redis connection configuration or null if invalid
 */
function getRedisConfig() {
  const redisHost = process.env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT || '6379'; // Default Redis port
  const redisPassword = process.env.REDIS_PASSWORD;
  // Simple check for TLS - set REDIS_TLS=true to enable
  const redisTls = process.env.REDIS_TLS && process.env.REDIS_TLS.toLowerCase() === 'true'; 

  // Validate Redis configuration from environment variables
  if (!redisHost) {
    logger.error('Redis configuration is missing or invalid. Required environment variable: REDIS_HOST');
    return null;
  }

  // Build connection object
  const redisConnection = {
    host: redisHost,
    port: parseInt(redisPort, 10), // Ensure port is an integer
  };

  // Add optional auth if provided
  if (redisPassword) {
    redisConnection.password = redisPassword;
    logger.info('Using Redis password authentication.');
  } else {
    logger.info('No Redis password provided.');
  }

  // Add optional TLS settings if provided
  if (redisTls) {
    redisConnection.tls = {}; // Basic TLS enabled object
    logger.info('Using Redis TLS connection.');
  }

  logger.info(`Redis configuration loaded for ${redisConnection.host}:${redisConnection.port}`);
  return redisConnection;
}

module.exports = {
  getRedisConfig
}; 