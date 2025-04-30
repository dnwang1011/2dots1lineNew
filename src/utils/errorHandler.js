const logger = require('./logger').childLogger('ErrorHandler');

/**
 * Handles common API and processing errors, returning a standardized response.
 * 
 * @param {Error} error - The error object caught.
 * @param {string} [context='processing'] - Context where the error occurred (e.g., 'AI interaction', 'database operation').
 * @param {string} [userFallbackMessage='An internal error occurred. Please try again later.'] - Generic message for the user.
 * @returns {object} Standardized error response object { success: false, message: string, error?: string }.
 */
function handleServiceError(error, context = 'processing', userFallbackMessage = 'An internal error occurred. Please try again later.') {
  logger.error(`Error during ${context}:`, { error });

  let responseMessage = userFallbackMessage;
  let statusCode = 500; // Default to Internal Server Error

  // Specific error handling (add more as needed)
  if (error.status === 503 || error.message.includes('Service Unavailable') || error.message.includes('overloaded')) {
    responseMessage = 'The service is temporarily unavailable due to high load. Please try again shortly.';
    statusCode = 503;
  } else if (error.status === 401 || error.message.includes('Authentication required')) {
    responseMessage = 'Authentication failed. Please sign in again.';
    statusCode = 401;
  } else if (error.status === 400 || error.name === 'ValidationError') {
     responseMessage = `Invalid request: ${error.message || 'Check input data.'}`;
     statusCode = 400;
  } 
  // Add more specific error checks here based on error types or messages

  const response = {
    success: false,
    message: responseMessage, // User-facing message
    statusCode: statusCode // For potential use in setting HTTP status
  };

  // Include detailed error message in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    response.error = error.message; // Internal error details
  }

  return response;
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
    // Use the centralized handler to format the error
    const errorResponse = handleServiceError(err, `route ${req.method} ${req.originalUrl}`);

    // If headers already sent, delegate to default Express error handler
    if (res.headersSent) {
        return next(err);
    }

    res.status(errorResponse.statusCode || 500).json({
        success: false,
        message: errorResponse.message, // User-friendly message
        // Only include detailed error stack in development
        error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
}


module.exports = {
  handleServiceError,
  expressErrorHandler
}; 