// src/controllers/chat.controller.js
// Controller for handling chat messages, AI responses, and message history

// Remove direct PrismaClient import if singleton is used consistently
// const { PrismaClient } = require('@prisma/client');
// const { prisma } = require('../db/prisma'); // Remove direct prisma import
const rawDataRepository = require('../repositories/rawData.repository'); // Import RawData repository
const aiService = require('../services/ai.service');
const memoryManager = require('../services/memoryManager.service'); // Import MemoryManager instance
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger').childLogger('ChatController');
// const fileUploadService = require('../services/fileUpload.service'); // Old service (now middleware)
const fileUploadMiddleware = require('../middleware/fileUpload.middleware'); // Import middleware
const fileUploadService = require('../services/fileUpload.service'); // Import the NEW service
const { handleServiceError, ServiceError } = require('../utils/errorHandler');
const memoryConfig = require('../../config/memory.config'); // Import memory config
const aiConfig = require('../../config/ai.config'); // Import AI config
const chatService = require('../services/chat.service'); // Import the new chat service
const { addMemoryJob } = require('../utils/queues');

// Remove local Prisma instance
// const prisma = new PrismaClient();

/**
 * Process a message and get AI response
 * @route POST /api/chat
 */
exports.sendMessage = async (req, res, next) => {
  const userId = req.user?.id;
  const sessionIdFromBody = req.body?.session_id;
  const messageFromBody = req.body?.raw_data?.message;
  const messageTypeFromBody = req.body?.message_type;

  try {
    logger.info('Chat message request received in controller', { body: req.body });

    // Input Validation
    if (!userId) {
      // Use next for errors to let middleware handle the response
      return next(new ServiceError('User ID missing from request token', 401));
    }
    if (!sessionIdFromBody || !messageTypeFromBody || !messageFromBody) {
      return next(new ServiceError('Missing required fields: session_id, message_type, raw_data.message', 400));
    }
    // Optional: Add validation for message_type if needed

    // --- Special Handling (Keep in Controller?) ---
    // This logic seems like UI/Admin control rather than core chat processing.
    // Keeping it here might be appropriate, or moving it to a dedicated admin route/service.
    if (messageFromBody.includes("__FORMAT_UPDATE__") && userId === process.env.ADMIN_USER_ID) {
      logger.info('Admin formatting update request received.');
      // Standardize this response too
      return res.status(200).json({
        success: true,
        data: {
          session_id: sessionIdFromBody, // Include session_id within data
          message: "Formatting style updated."
        }
      });
    }
    // --- End Special Handling ---

    // Delegate core processing to the Chat Service
    const serviceResult = await chatService.processUserMessage(userId, sessionIdFromBody, messageFromBody);

    // Return the success response using the standardized format
    res.status(200).json({
      success: true,
      data: {
        session_id: sessionIdFromBody, // Include session_id within data
        text: serviceResult.text // Main AI response text
        // Include rawData IDs if needed by frontend?
        // userRawDataId: serviceResult.userRawDataId,
        // aiRawDataId: serviceResult.aiRawDataId
      }
    });

  } catch (error) {
    // Service layer errors (including wrapped errors) are passed here
    logger.error('Error caught in sendMessage controller:', { error: error.message });
    // Pass the error to the centralized Express error handling middleware
    next(error);
  }
};

/**
 * Get chat history for a session
 * @route GET /api/chat/history
 */
exports.getChatHistory = async (req, res, next) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return next(new ServiceError('Session ID is required', 400));
    }

    const userId = req.user.id;
    logger.info('Fetching chat history', { userId, sessionId: session_id });

    // Get chat history from raw data using repository
    const messages = await rawDataRepository.findMany({
      where: {
        userId: userId,
        sessionId: session_id,
        contentType: {
          in: ['user_chat', 'ai_response']
        }
      },
      orderBy: {
        createdAt: 'asc'
      },
      take: memoryConfig.chatHistoryRetrievalLimit
    });

    // Format messages for client (remains same)
    const formattedMessages = messages.map(message => ({
      role: message.contentType === 'user_chat' ? 'user' : 'ai',
      content: message.content,
      timestamp: message.createdAt
    }));

    // Standardized response
    res.status(200).json({
      success: true,
      data: {
        session_id, // Include session_id within data
        messages: formattedMessages
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Upload a file for AI analysis - delegates logic to fileUploadService.
 * @route POST /api/chat/upload
 */
exports.uploadFile = (req, res, next) => {
  // Use the renamed middleware
  fileUploadMiddleware.uploadSingleFile(req, res, async function (uploadMiddlewareErr) {
    const uploadedFilePath = req.file?.path; // Get path for potential cleanup

    try {
        // --- Input Validation --- 
        // Handle Multer errors first
        if (uploadMiddlewareErr instanceof require('multer').MulterError) {
            logger.warn('Multer error during file upload:', { code: uploadMiddlewareErr.code, message: uploadMiddlewareErr.message });
            // Provide user-friendly message based on code
            let userMessage = 'File upload error.';
            if (uploadMiddlewareErr.code === 'LIMIT_FILE_SIZE') {
                userMessage = 'File is too large.';
            } else if (uploadMiddlewareErr.code === 'LIMIT_UNEXPECTED_FILE') {
                userMessage = uploadMiddlewareErr.message || 'Unsupported file type.'; // Use Multer's specific message if available
            }
            return next(new ServiceError(userMessage, 400));
        } else if (uploadMiddlewareErr) {
            // Handle other potential errors during upload setup (rare)
            logger.error('Non-Multer error during upload middleware:', uploadMiddlewareErr);
            return next(uploadMiddlewareErr); // Pass to generic handler
        }

        // Check if file exists after middleware (shouldn't happen if Multer runs ok)
        if (!req.file) {
            return next(new ServiceError('No file provided or file rejected by filter.', 400));
        }

        // Check for required body fields
        const { session_id, message } = req.body;
        if (!session_id) {
            // Clean up uploaded file if session_id is missing
            if (uploadedFilePath) fs.unlink(uploadedFilePath, (err) => { if (err) logger.error('Failed to clean up orphaned upload:', err); });
            return next(new ServiceError('Session ID is required for file upload.', 400));
        }

        const userId = req.user.id;
        const file = req.file; // File object from Multer
        // --- End Validation --- 

        logger.info('File upload passed controller validation, delegating to service');

        // Delegate core processing to the File Upload Service
        const serviceResult = await fileUploadService.processUploadedFile(
            userId,
            session_id,
            file, 
            message // Pass the accompanying message
        );

        // Check service result success explicitly
        if (!serviceResult.success) {
            // This case *should* ideally be caught by the service throwing an error,
            // but handle defensively. If the service returns success: false but doesn't throw,
            // pass it as a generic server error to the error handler.
            logger.error('FileUpload service indicated failure but did not throw an error', { serviceResult });
            // Pass a generic error to the handler
            return next(new ServiceError(serviceResult.message || 'File processing failed in service', 500));
        }

        // Standardized SUCCESS response
        res.status(200).json({
            success: true,
            data: {
                message: 'File processed successfully', // Confirmation message
                fileInfo: {
                    // filename: file.filename, // Temporary server filename might not be useful to client
                    originalname: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size
                },
                analysisText: serviceResult.message // Use a clearer key for the AI text response
                // Include rawData IDs if needed by frontend?
                // fileEventRawDataId: serviceResult.fileEventRawDataId,
                // analysisRawDataId: serviceResult.analysisRawDataId
            }
        });

    } catch (error) {
        // Catch errors from the service layer or validation
        logger.error('Error caught in uploadFile controller:', { error: error.message });
        
        // Pass the error to the centralized Express error handling middleware
        next(error);
    }
  }); // End of upload middleware callback
};

/**
 * Upload a file asynchronously (returns immediately with a jobId)
 * @route POST /api/chat/upload/async
 */
exports.uploadFileAsync = (req, res, next) => {
  // Use the renamed middleware
  fileUploadMiddleware.uploadSingleFile(req, res, async function (uploadMiddlewareErr) {
    const uploadedFilePath = req.file?.path; // Get path for potential cleanup

    try {
      // --- Input Validation --- 
      // Handle Multer errors first
      if (uploadMiddlewareErr instanceof require('multer').MulterError) {
        logger.warn('Multer error during file upload:', { code: uploadMiddlewareErr.code, message: uploadMiddlewareErr.message });
        // Provide user-friendly message based on code
        let userMessage = 'File upload error.';
        if (uploadMiddlewareErr.code === 'LIMIT_FILE_SIZE') {
          userMessage = 'File is too large.';
        } else if (uploadMiddlewareErr.code === 'LIMIT_UNEXPECTED_FILE') {
          userMessage = uploadMiddlewareErr.message || 'Unsupported file type.'; // Use Multer's specific message if available
        }
        return next(new ServiceError(userMessage, 400));
      } else if (uploadMiddlewareErr) {
        // Handle other potential errors during upload setup (rare)
        logger.error('Non-Multer error during upload middleware:', uploadMiddlewareErr);
        return next(uploadMiddlewareErr); // Pass to generic handler
      }

      // Check if file exists after middleware (shouldn't happen if Multer runs ok)
      if (!req.file) {
        return next(new ServiceError('No file provided or file rejected by filter.', 400));
      }

      // Check for required body fields
      const { session_id, message } = req.body;
      if (!session_id) {
        // Clean up uploaded file if session_id is missing
        if (uploadedFilePath) fs.unlink(uploadedFilePath, (err) => { if (err) logger.error('Failed to clean up orphaned upload:', err); });
        return next(new ServiceError('Session ID is required for file upload.', 400));
      }

      const userId = req.user.id;
      const file = req.file; // File object from Multer

      // Generate a unique job ID for tracking
      const jobId = uuidv4();
      
      // Move the file to a persistent location to survive after response
      const persistentDir = path.join(__dirname, '../../uploads/pending');
      if (!fs.existsSync(persistentDir)) {
        fs.mkdirSync(persistentDir, { recursive: true });
      }
      
      const persistentFilePath = path.join(persistentDir, `${jobId}-${file.originalname}`);
      fs.copyFileSync(file.path, persistentFilePath);
      
      // Clean up the original temp file
      if (uploadedFilePath) {
        fs.unlink(uploadedFilePath, (unlinkErr) => {
          if (unlinkErr) logger.error('Error cleaning up temp uploaded file:', { path: uploadedFilePath, error: unlinkErr });
        });
      }

      // Create a placeholder record to track the job status
      await prisma.fileUploadJob.create({
        data: {
          id: jobId,
          userId: userId,
          sessionId: session_id,
          status: 'PENDING',
          filename: file.originalname,
          filePath: persistentFilePath,
          message: message || '',
          fileSize: file.size,
          mimeType: file.mimetype,
          createdAt: new Date()
        }
      });

      // Queue the job for background processing
      await addMemoryJob('processFileUpload', {
        jobId,
        userId,
        sessionId: session_id,
        message,
        filePath: persistentFilePath,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      });

      // Return 202 Accepted with the job ID
      res.status(202).json({
        success: true,
        data: {
          message: 'File upload accepted for processing',
          jobId: jobId,
          status: 'PENDING',
          statusUrl: `/api/chat/upload/status/${jobId}`
        }
      });

    } catch (error) {
      // Catch errors during job creation
      logger.error('Error caught in uploadFileAsync controller:', { error: error.message });
      
      // Pass the error to the centralized Express error handling middleware
      next(error);
    }
  });
};

/**
 * Get the status of an asynchronous file upload
 * @route GET /api/chat/upload/status/:jobId
 */
exports.getUploadStatus = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    if (!jobId) {
      return next(new ServiceError('Job ID is required', 400));
    }

    // Find the job in the database
    const job = await prisma.fileUploadJob.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      return next(new ServiceError('Upload job not found', 404));
    }

    // Security check - only the user who created the job can check its status
    if (job.userId !== userId) {
      return next(new ServiceError('Unauthorized to access this upload job', 403));
    }

    // Format the response based on status
    let response = {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        fileInfo: {
          originalname: job.filename,
          mimetype: job.mimeType,
          size: job.fileSize
        },
        createdAt: job.createdAt,
        completedAt: job.completedAt
      }
    };

    // Add result data if job is completed
    if (job.status === 'COMPLETED' && job.resultData) {
      response.data.result = {
        analysisText: job.resultData.analysisText,
        rawDataIds: job.resultData.rawDataIds
      };
    } else if (job.status === 'FAILED') {
      response.data.error = job.errorMessage || 'Unknown error occurred during processing';
    }

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}; 