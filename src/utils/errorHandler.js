const logger = require('./logger').childLogger('ErrorHandler');

/**
 * Custom error class for service layer errors.
 */
class ServiceError extends Error {
  constructor(message, statusCode = 500, originalError = null, errorCode = null) {
    super(message);
    this.name = 'ServiceError';
    this.statusCode = statusCode;
    this.originalError = originalError; // Store original error for context if needed
    this.errorCode = errorCode; // Add optional errorCode property
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ServiceError);
    }
  }
}

/**
 * Centralized handler for service layer errors.
 * Ensures that errors thrown are always instances of ServiceError.
 * Logs the error appropriately.
 * 
 * @param {Error} error - The error object caught.
 * @param {string} [context='Unknown Context'] - Context where the error occurred.
 * @returns {ServiceError} - Either the original error if it was a ServiceError, or a new wrapped ServiceError.
 */
function handleServiceError(error, context = 'Unknown Context') {
  if (error instanceof ServiceError) {
    // Log existing ServiceError with context - ensure logging doesn't throw!
    try {
      logger.error(`ServiceError in ${context}: ${error.message}`, { 
        statusCode: error.statusCode, 
        errorCode: error.errorCode, // Log errorCode if present
        originalError: error.originalError?.message, // Log original message if present
        stack: error.stack 
      });
    } catch (logError) {
      console.error("!!! Logging failed in handleServiceError !!!", logError);
    }
    return error; // Return the original ServiceError
  } else {
    // Wrap other errors (Error objects or other types)
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Log the unexpected error
    try {
        logger.error(`Unhandled error in ${context}: ${errorMessage}`, { 
            originalError: error, // Log the full original error object
            stack: error?.stack 
        });
    } catch (logError) {
        console.error("!!! Logging failed in handleServiceError (wrapping) !!!", logError);
    }
    // Return a new generic ServiceError, including the original error
    // Assign a generic errorCode for unexpected errors
    return new ServiceError(`Internal server error in ${context}. Details: ${errorMessage}`, 500, error, 'INTERNAL_SERVER_ERROR'); 
  }
}

/**
 * Middleware for handling errors in Express routes.
 * Should be added LAST in the middleware chain.
 * 
 * @param {Error} err - The error object.
 * @param {Request} req - Express request object.
 * @param {Response} res - Express response object.
 * @param {NextFunction} next - Express next function.
 */
function expressErrorHandler(err, req, res, next) {
    // Ensure the error is a ServiceError using the centralized handler
    const serviceError = handleServiceError(err, `route ${req.method} ${req.originalUrl}`);

    // If headers already sent, delegate to default Express error handler
    if (res.headersSent) {
        return next(serviceError); // Pass the processed error
    }

    // Standardized error response format
    const statusCode = serviceError.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        error: {
            code: serviceError.errorCode || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'), // Provide a default code
            message: serviceError.message // User-friendly message from ServiceError
            // Optionally include details in development?
            // details: process.env.NODE_ENV === 'development' ? serviceError.originalError?.stack : undefined
        }
    });
}


module.exports = {
  handleServiceError,
  expressErrorHandler,
  ServiceError // Export the class
}; 