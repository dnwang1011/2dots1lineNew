const rawDataRepository = require('../repositories/rawData.repository');
const memoryManager = require('./memoryManager.service');
const aiService = require('./ai.service');
const logger = require('../utils/logger').childLogger('FileUploadService');
const { handleServiceError, ServiceError } = require('../utils/errorHandler');
const aiConfig = require('../../config/ai.config');
const fs = require('fs');
const path = require('path');
const { addMemoryJob } = require('../utils/queues'); // Import the queue helper

/**
 * Processes an uploaded file, interacts with AI service, records data, and triggers memory processing.
 *
 * @param {string} userId - The ID of the user uploading the file.
 * @param {string} sessionId - The ID of the current session.
 * @param {object} file - The file object (from Multer). Contains path, originalname, mimetype, size etc.
 * @param {string} [message] - An optional accompanying message from the user.
 * @returns {Promise<object>} - Result object { success: boolean, message: string, error?: string, fileEventRawDataId?: string, analysisRawDataId?: string }
 */
async function processUploadedFile(userId, sessionId, file, message) {
  if (!file) {
      throw new ServiceError("No file provided for upload.", 400);
  }

  let fileEventRawData = null;
  let analysisRawData = null;
  let tempFilePath = file.path; // Now safe to access file.path

  try {
    logger.info(`Starting processing for file: ${file.originalname} (user: ${userId}, session: ${sessionId})`);

    // 1. Record the initial file upload event
    fileEventRawData = await rawDataRepository.create({
        userId: userId,
        perspectiveOwnerId: userId,
        sessionId: sessionId,
        contentType: 'uploaded_file_event',
        content: `User uploaded file: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`,
        metadata: {
            originalFilename: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            path: file.path, // Record temp path just in case
            userMessage: message || null // Include accompanying message if present
        },
    });
    logger.info(`Recorded file upload event: ${fileEventRawData.id}`);

    const fileExtension = path.extname(file.originalname).toLowerCase();
    const isImage = aiConfig.supportedImageExtensions.includes(fileExtension);
    // Assuming non-image supported types are documents for now
    const isDocument = !isImage;

    let analysisResult = null;

    if (isImage) {
      // --- Image Processing ---
      logger.info(`Processing image file: ${file.originalname}`);
      try {
          const imageBuffer = await fs.promises.readFile(tempFilePath);
          const base64Image = imageBuffer.toString('base64');
          const mimeType = file.mimetype;
          // Call AI analysis
          analysisResult = await aiService.analyzeImage(userId, sessionId, base64Image, mimeType, message);
      } catch (imgError) {
          logger.error(`Error processing image file ${file.originalname}: ${imgError.message}`, { stack: imgError.stack });
          // Always wrap and re-throw
          throw new ServiceError(`Failed to process image file: ${imgError.message}`, 500, imgError);
      }

    } else if (isDocument) {
      // --- Document Processing ---
      logger.info(`Processing document file: ${file.originalname}`);
      try {
          // Pass the actual tempFilePath to the processing function
          const fileContentResult = await aiService.processFileContent(tempFilePath);

          if (!fileContentResult.success) {
              throw new Error(fileContentResult.error || 'Unknown error processing document content.');
          }
          if (!fileContentResult.text) {
              throw new Error('Could not extract text content from the document.');
          }
          logger.info(`Document text extracted (first 100 chars): ${fileContentResult.text.substring(0, 100)}...`);


          if (message) {
            // Call AI with user message + document context
            logger.info('Sending doc context and user query to aiService.sendMessage...');
            const aiOptions = { additionalContext: { type: 'document', content: fileContentResult.text } };
            analysisResult = await aiService.sendMessage(userId, sessionId, message, aiOptions);
          } else {
            // Call AI with generic document summary prompt
             logger.info('Sending doc content for generic analysis via aiService.sendMessage...');
            const prompt = aiConfig.defaultDocumentAnalysisPrompt.replace('{DOCUMENT_CONTENT}', fileContentResult.text);
            analysisResult = await aiService.sendMessage(userId, sessionId, prompt);
          }
      } catch (docError) {
           logger.error(`Error processing document file ${file.originalname}: ${docError.message}`, { stack: docError.stack });
           // Always wrap and re-throw
           throw new ServiceError(`Failed to process document file: ${docError.message}`, 500, docError);
      }
    } else {
         // Should not happen if middleware filter works, but handle defensively
         logger.error(`Unsupported file type reached service processing: ${file.mimetype}`);
         throw new ServiceError(`Unsupported file type: ${file.mimetype}`, 400);
    }

    // Check AI analysis/response result *after* both branches
    if (!analysisResult || !analysisResult.success) {
      const errorMsg = analysisResult?.error || 'AI service failed to analyze the file.';
      // Throw a ServiceError, converting plain errors if necessary
      throw new ServiceError(errorMsg instanceof Error ? errorMsg.message : String(errorMsg), 500);
    }

    // 3. Record the AI analysis/response
    // This line should only be reached if no errors occurred above
    logger.info(`Recording AI analysis result for raw event ${fileEventRawData?.id}`);
    analysisRawData = await rawDataRepository.create({
        content: analysisResult.text,
        contentType: isImage ? 'image_analysis' : 'document_analysis',
        userId: userId,
        perspectiveOwnerId: userId,
        sessionId: sessionId,
        metadata: {
            originalFilename: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            fileEventRawDataId: fileEventRawData?.id, // Link back to the event
            userMessage: message || null // Include user message if present
         },
        // Importance determined later by memoryManager
    });
    logger.info(`Recorded AI analysis result: ${analysisRawData.id}`);

    // 4. Trigger memory processing VIA QUEUE
    if (fileEventRawData?.id) { // Null check just in case
        logger.info(`[Queue Trigger] Adding job for File Event RawData: ${fileEventRawData.id}`);
        // Send only ID
        await addMemoryJob('processRawData', { rawDataId: fileEventRawData.id });
        // addMemoryJob logs its own errors
    }
     if (analysisRawData?.id) {
        logger.info(`[Queue Trigger] Adding job for Analysis RawData: ${analysisRawData.id}`);
        await addMemoryJob('processRawData', { rawDataId: analysisRawData.id });
    }

    // 5. Return success result
    return {
        success: true,
        message: analysisResult.text,
        fileEventRawDataId: fileEventRawData?.id,
        analysisRawDataId: analysisRawData?.id
    };

  } catch (error) {
    logger.error(`Error processing uploaded file in outer catch: ${error.message}`, { stack: error.stack, userId, sessionId, filename: file?.originalname });

    // Trigger processing ONLY for the file event record if it was created before the error
    if (fileEventRawData?.id) {
        logger.warn(`[Queue Trigger] Adding job for File Event RawData ${fileEventRawData.id} after service error occurred.`);
        // Fire-and-forget is acceptable here.
        addMemoryJob('processRawData', { rawDataId: fileEventRawData.id });
    }
    // DO NOT trigger for analysisRawData here

    // Use the original handler
    throw handleServiceError(error, 'FileUploadService');

  } finally {
    // 6. Clean up temporary file
    if (tempFilePath) {
      logger.info(`Attempting to delete temp file: ${tempFilePath}`);
      fs.promises.unlink(tempFilePath).catch(err => logger.warn(`Failed to delete temp file ${tempFilePath}: ${err.message}`));
    }
  }
}

module.exports = {
  processUploadedFile,
}; 