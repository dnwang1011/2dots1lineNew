// src/utils/logger.js
const winston = require('winston');

// Determine log level based on environment (default to 'info')
const logLevel = process.env.LOG_LEVEL || 'info';

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' // ISO 8601 format
    }),
    winston.format.errors({ stack: true }), // Log stack traces
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, stack, service, ...metadata }) => {
      let log = `${timestamp} [${level.toUpperCase()}]`;
      if (service) {
        log += ` [${service}]`;
      }
      log += `: ${message}`;
      if (stack) {
        log += `\n${stack}`;
      }
      // Append any additional metadata if present
      const metaString = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '';
      if (metaString) {
        log += ` | Metadata: ${metaString}`;
      }
      return log;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // Add colors for console output
        winston.format.printf(({ timestamp, level, message, stack, service, ...metadata }) => {
          let log = `${timestamp} [${level}]`;
          if (service) {
            log += ` [${service}]`;
          }
          log += `: ${message}`;
          if (stack) {
            log += `\n${stack}`;
          }
          // Append any additional metadata if present
          const metaString = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '';
          if (metaString) {
            log += ` | Metadata: ${metaString}`;
          }
          return log;
        })
      )
    })
    // Add file transport if needed
    // new winston.transports.File({ filename: 'combined.log' })
  ],
  defaultMeta: {
    service: 'app' // Default service name if not specified
  }
});

// Add helper to create child loggers with service names
logger.childLogger = (serviceName) => {
  return logger.child({ service: serviceName });
};

// Log initial level
logger.info(`Logger initialized with level: ${logLevel}`);

module.exports = logger; 