// config/service.config.js
// Configuration for general service-level settings

module.exports = {
  // AI service defaults
  ai: {
    defaultProvider: process.env.DEFAULT_AI_PROVIDER || 'gemini',
    providerFallbackOrder: ['gemini'], // Order to try if primary provider fails
    requestTimeoutMs: parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 30000, // 30 seconds
  },
  
  // Health check intervals
  healthChecks: {
    weaviateHealthCheckMinutes: parseInt(process.env.WEAVIATE_HEALTH_CHECK_MINUTES, 10) || 5,
    redisHealthCheckMinutes: parseInt(process.env.REDIS_HEALTH_CHECK_MINUTES, 10) || 5,
    databaseHealthCheckMinutes: parseInt(process.env.DB_HEALTH_CHECK_MINUTES, 10) || 10,
  },
  
  // Server settings
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    maxRequestSizeBytes: parseInt(process.env.MAX_REQUEST_SIZE_BYTES, 10) || 20 * 1024 * 1024, // 20MB
    rateLimits: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 5 * 60 * 1000, // 5 minutes
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100, // 100 requests per window
    }
  },
  
  // Security settings
  security: {
    csrfProtection: process.env.ENABLE_CSRF === 'true',
    corsAllowedOrigins: process.env.CORS_ALLOWED_ORIGINS ? 
      process.env.CORS_ALLOWED_ORIGINS.split(',') : 
      ['http://localhost:3000'],
  },
  
  // Logging settings
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    includeTimestamp: process.env.LOG_INCLUDE_TIMESTAMP !== 'false',
  },
}; 