// src/controllers/chat.controller.js
// Controller for handling chat messages, AI responses, and message history

const { PrismaClient } = require('@prisma/client');
const aiService = require('../services/ai.service');
const { processFileContent } = require('../services/ai.service'); // Import processFileContent
const memoryManager = require('../services/memoryManager.service'); // Import MemoryManager
const { v4: uuidv4 } = require('uuid');
// const multer = require('multer'); // Removed - using fileUploadService
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger').childLogger('ChatController'); // Import and create child logger
const fileUploadService = require('../services/fileUpload.service'); // Import file upload service
const { handleServiceError } = require('../utils/errorHandler'); // Import error handler

const prisma = new PrismaClient();

// Configure multer for file uploads (Removed - moved to fileUploadService)
/*
const upload = multer({ ... });
*/

/**
 * Record raw data in the database for memory processing
 * @param {object} data - Raw data to record
 * @returns {Promise<object>} Created raw data record
 */
async function recordRawData(data) {
  try {
    logger.debug('Recording raw data:', { data: JSON.stringify(data) }); // Use logger (debug level)
    
    // Handle system perspective owner (not a UUID)
    const perspectiveOwnerId = data.perspectiveOwnerId === 'system' 
      ? data.userId  // Use the user ID if it's a system perspective
      : data.perspectiveOwnerId;
    
    const subjectId = data.subjectId || perspectiveOwnerId;
    
    return await prisma.rawData.create({
      data: {
        content: data.content,
        contentType: data.contentType,
        topicKey: data.topicKey || null,
        userId: data.userId,
        sessionId: data.sessionId,
        perspectiveOwnerId,
        subjectId,
        importanceScore: data.importanceScore || 0.5, // Default importance score
        processingStatus: "pending" // Will be processed by Memory Manager
      }
    });
  } catch (error) {
    // Log the error using centralized handler, but re-throw 
    // as this function is internal and the caller needs to handle it.
    handleServiceError(error, 'database raw data recording'); 
    throw error; // Re-throw for the calling function
  }
}

/**
 * Process a message and get AI response
 * @route POST /api/chat
 */
exports.sendMessage = async (req, res, next) => { // Add next for error middleware
  let userRawDataRecord = null; // Define outside try block
  const userId = req.user?.id; // Safely access userId
  const sessionId = req.body?.session_id;

  try {
    logger.info('Chat request received:', { body: req.body }); 
    const { session_id, message_type, raw_data } = req.body;
    
    // Input Validation
    if (!userId) {
        return res.status(401).json(handleServiceError(new Error('User ID missing from request token'), 'authentication'));
    }
    if (!session_id || !message_type || !raw_data) {
        return res.status(400).json(handleServiceError(new Error('Missing required fields: session_id, message_type, raw_data'), 'request validation'));
    }
    const message = raw_data.message;
    if (!message) {
        return res.status(400).json(handleServiceError(new Error('Message content is required'), 'request validation'));
    }
    
    logger.info(`Processing message from user ${userId} in session ${session_id}: "${message.substring(0, 50)}..."`);
    
    // Special handling for formatting style update message
    if (message.includes("__FORMAT_UPDATE__") && userId === process.env.ADMIN_USER_ID) {
      logger.info('Admin formatting update request received.');
      return res.status(200).json({
        success: true,
        session_id,
        response: {
          text: "Formatting style updated. The AI will now use a more conversational style with fewer bullet points and will avoid starting with phrases like 'Okay'."
        }
      });
    }
    
    // Record user message FIRST
    userRawDataRecord = await recordRawData({
        content: message,
        contentType: 'user_chat',
        userId: userId,
        sessionId: session_id,
        perspectiveOwnerId: userId,
        importanceScore: null 
    });
    logger.info('User message recorded in database', { rawDataId: userRawDataRecord.id });

    // Retrieve relevant memories for context
    logger.info('Retrieving relevant memories for context...');
    const relevantMemories = await memoryManager.retrieveMemories(message, userId, {
        limit: 5,                
        minImportance: 0.4,      
        certainty: 0.6,          
    });
    
    // Format memories for AI context
    let memoryContext = '';
    if (relevantMemories && relevantMemories.length > 0) {
        logger.info(`Found ${relevantMemories.length} relevant memories with types: ${relevantMemories.map(m => m.type).join(', ')}`);
        
        // Create more detailed memory context with type information
        memoryContext = 'RELEVANT CONTEXT FROM MEMORY:\n' + 
        relevantMemories.map((m, i) => {
            // Format differently based on memory type
            if (m.type === 'episode') {
                return `[Memory ${i+1} - Episode] Title: "${m.title}"\nNarrative: ${m.narrative || 'No narrative available'}\nRelevance: ${m.similarity?.toFixed(2) || 'N/A'}`;
            } else if (m.type === 'thought') {
                return `[Memory ${i+1} - Thought] "${m.name}"\nInsight: ${m.content || 'No content available'}\nRelevance: ${m.similarity?.toFixed(2) || 'N/A'}`;
            } else if (m.type === 'chunk') {
                return `[Memory ${i+1} - Fragment] "${m.text?.substring(0, 300)}${m.text?.length > 300 ? '...' : ''}"\nRelevance: ${m.similarity?.toFixed(2) || 'N/A'}`;
            } else {
                return `[Memory ${i+1} - ${m.type || 'Unknown'}] Content: ${m.text || m.content || 'No content available'}\nRelevance: ${m.similarity?.toFixed(2) || 'N/A'}`;
            }
        }).join('\n\n');
        
        // Add explicit instruction for AI to reference memories when answering
        memoryContext += '\n\nIMPORTANT: Reference these memories naturally when responding to the user\'s current message. Do not mention or list the memories directly, but incorporate the information seamlessly as if it\'s part of your own knowledge about the user.';
        
        logger.info('Enhanced memory context created for AI');
    } else {
        logger.info('No relevant memories found');
    }

    // Get AI response (this will now throw a ServiceError on failure)
    logger.info('Requesting AI response...');
    const startTime = Date.now(); // Start timer
    const aiResponse = await aiService.sendMessage(userId, session_id, message, memoryContext ? { additionalContext: memoryContext } : undefined);
    const duration = Date.now() - startTime; // Calculate duration
    logger.info(`AI service call completed in ${duration}ms`); // Log duration
    
    // Check for success explicitly (aiService might return success:false on non-exception errors)
    if (!aiResponse.success) {
        throw new ServiceError(aiResponse.message || 'AI service failed to process the message.', aiResponse.statusCode || 500);
    }

    logger.info('AI response received successfully', { hasText: !!aiResponse.text });

    // Record AI response
    let aiRawDataRecord = null;
    if (aiResponse.text) { 
        aiRawDataRecord = await recordRawData({
            content: aiResponse.text,
            contentType: 'ai_response',
            userId: userId,
            sessionId: session_id,
            perspectiveOwnerId: userId,
            subjectId: userId,
            importanceScore: null
        });
        logger.info('AI response recorded in database', { rawDataId: aiRawDataRecord.id });
    }

    // Return the success response to the client
    res.status(200).json({
        success: true,
        session_id,
        response: { text: aiResponse.text }
    });

    // --- Asynchronously process memories AFTER responding ---
    // No need to check userRawDataRecord, it must exist if we got here
    logger.info(`[MemoryManager Trigger] Scheduling processing for User RawData: ${userRawDataRecord.id}`);
    memoryManager.processRawData(userRawDataRecord).catch(err => {
        handleServiceError(err, `background processing for User RawData ${userRawDataRecord.id}`); 
    });

    if (aiRawDataRecord) {
        logger.info(`[MemoryManager Trigger] Scheduling processing for AI RawData: ${aiRawDataRecord.id}`);
        memoryManager.processRawData(aiRawDataRecord).catch(err => {
            handleServiceError(err, `background processing for AI RawData ${aiRawDataRecord.id}`);
        });
    }
    // ----------------------------------------------------

  } catch (error) {
    // Catch errors from await calls (recordRawData, retrieveMemories, aiService.sendMessage)
    logger.error('Error during chat processing pipeline:', { error });

    // Try to schedule memory processing for user message if it was recorded before the error
    if (userRawDataRecord) {
        logger.info(`[MemoryManager Trigger] Scheduling processing for User RawData ${userRawDataRecord.id} after pipeline error.`);
        memoryManager.processRawData(userRawDataRecord).catch(err => {
            handleServiceError(err, `background processing for User RawData ${userRawDataRecord.id} after error`);
        });
    }

    // Pass the error to the Express error handling middleware
    next(error); 
  }
};

/**
 * Get chat history for a session
 * @route GET /api/chat/history
 */
exports.getChatHistory = async (req, res, next) => { // Add next
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }
    
    const userId = req.user.id;
    logger.info('Fetching chat history', { userId, sessionId: req.query.session_id }); // Use logger
    
    // Get chat history from raw data
    const messages = await prisma.rawData.findMany({
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
      take: 200 // Limit to last 200 messages (100 exchanges)
    });
    
    // Format messages for client
    const formattedMessages = messages.map(message => {
      return {
        role: message.contentType === 'user_chat' ? 'user' : 'ai',
        content: message.content,
        timestamp: message.createdAt
      };
    });
    
    res.status(200).json({
      success: true,
      session_id,
      messages: formattedMessages
    });
  } catch (error) {
    // Pass error to middleware
    next(error); 
  }
};

/**
 * Upload a file for AI analysis
 * @route POST /api/chat/upload
 */
exports.uploadFile = (req, res, next) => { // Add next
  fileUploadService.uploadSingleFile(req, res, async function (err) {
     let documentContentRawDataRecord = null; // Define here for catch block access
     try { 
        // Handle Multer errors specifically
        if (err instanceof require('multer').MulterError) {
             const errorResponse = handleServiceError(err, 'file upload (multer)');
             return res.status(errorResponse.statusCode || 400).json(errorResponse);
         } else if (err) {
             // Handle other potential errors during upload setup
             throw err; // Throw to outer catch / middleware
         }

        // Check if file exists after middleware
        if (!req.file) {
             // Use handleServiceError for consistency
             const errorResponse = handleServiceError(new Error('No file found after upload processing.'), 'file upload validation');
             return res.status(errorResponse.statusCode || 400).json(errorResponse);
         }

        // Session ID check
        const { session_id } = req.body;
        if (!session_id) {
             // Clean up uploaded file
             fs.unlink(req.file.path, (unlinkErr) => { /* log unlink error */ });
             const errorResponse = handleServiceError(new Error('Session ID is required'), 'file upload validation');
             return res.status(errorResponse.statusCode || 400).json(errorResponse);
         }

        const userId = req.user.id;
        const file = req.file;
        logger.info('File uploaded successfully via service', { userId, sessionId: session_id, filename: file.filename });

        // Record file upload event
        const fileEventRawDataRecord = await recordRawData({
            content: `Uploaded file: ${file.originalname} (${file.mimetype})`,
            contentType: 'uploaded_file_event',
            userId: userId,
            sessionId: session_id,
            perspectiveOwnerId: userId,
            importanceScore: 0.8 // Default importance for the event
        });
        logger.info('File upload event recorded', { rawDataId: fileEventRawDataRecord.id });

        // --- Determine file type and get AI analysis/summary ---
        let aiAnalysisResult;
        const isImage = fileUploadService.allowedMimeTypes.image.includes(file.mimetype);
        const isSupportedDoc = fileUploadService.allowedMimeTypes.document.includes(file.mimetype);

        if (isImage) {
            // *** Handle IMAGE analysis ***
            logger.info(`Sending image file ${file.originalname} to AI service for analysis...`);
            // Read file from disk needed for analyzeImage as currently implemented
            const filePath = file.path;
            // Ensure buffer is attached if needed by aiService.analyzeImage
            // If analyzeImage can take a path, this read might be redundant
            try {
                file.buffer = fs.readFileSync(filePath); 
                logger.info(`Read image file into buffer: ${filePath}, buffer size: ${file.buffer.length} bytes`);
            } catch (readError) {
                logger.error('Failed to read uploaded image file into buffer:', { path: filePath, error: readError });
                throw new Error('Could not read uploaded image file for analysis.'); // Throw to outer catch
            }
            
            aiAnalysisResult = await aiService.analyzeImage({
                userId: userId,
                sessionId: session_id,
                file: file // Pass the file object, now including the buffer
            });

        } else if (isSupportedDoc) {
            // *** Handle DOCUMENT analysis ***
            logger.info(`Processing document file ${file.originalname} for text content...`);
            const fileResult = await processFileContent(file.filename); // Pass filename

            if (fileResult && fileResult.text && !fileResult.text.startsWith('Error processing')) {
                logger.info(`Extracted text (first 100 chars): ${fileResult.text.substring(0, 100)}...`);

                // --- Record the EXTRACTED DOCUMENT CONTENT for memory processing ---
                try {
                    // Set forceImportant=true for document MIME types (per Step 6 in MigrationPlan.md)
                    const forceImportant = true;
                    
                    documentContentRawDataRecord = await recordRawData({
                        content: fileResult.text,
                        contentType: 'uploaded_document_content',
                        userId: userId,
                        sessionId: session_id,
                        perspectiveOwnerId: userId,
                        subjectId: userId,
                        importanceScore: 0.8, // Explicit importance for document content
                        forceImportant: forceImportant // Flag to ensure all chunks are kept
                    });
                    logger.info('Document content recorded for memory processing', { 
                        rawDataId: documentContentRawDataRecord.id,
                        forceImportant: forceImportant
                    });
                    
                    // Trigger immediate consolidation for document uploads
                    try {
                        // Import the consolidationAgent or access the queue
                        const consolidationAgent = require('../services/consolidationAgent');
                        // Try to add to the orphan queue to trigger consolidation
                        await consolidationAgent.processOrphanChunks(userId);
                        logger.info(`[ConsolidationAgent] Triggered immediate consolidation for user ${userId} after document upload`);
                    } catch (queueError) {
                        // Just log, don't fail the upload
                        logger.error(`[ConsolidationAgent] Failed to trigger consolidation after document upload: ${queueError.message}`);
                    }
                } catch (dbError) {
                    handleServiceError(dbError, 'recording document content'); // Log only
                }
                // --------------------------------------------------------------------

                // Send extracted text to the AI for analysis/summary
                const analysisPrompt = `Please analyze or summarize the key points from the following document content:\n\n---\n${fileResult.text}\n---
`;
                logger.info('Sending extracted document text to AI service...');
                aiAnalysisResult = await aiService.sendMessage(userId, session_id, analysisPrompt);
                if (!aiAnalysisResult.success) {
                    logger.warn('AI analysis of document content failed.', { error: aiAnalysisResult.error });
                }
            } else {
                logger.error('Failed to extract text from document:', { filename: file.filename, resultText: fileResult ? fileResult.text : 'No result' });
                aiAnalysisResult = {
                    success: false,
                    text: "I'm sorry, but I encountered an error extracting content from the document.",
                    error: fileResult ? fileResult.text : 'Text extraction failed'
                };
            }
        } else {
            // This case should ideally not be reached due to fileFilter, but handle defensively
            logger.error(`File type passed filter but is not recognized: ${file.mimetype}`);
            aiAnalysisResult = {
                success: false,
                text: `Internal error: Unhandled file type (${file.mimetype}).`,
                error: 'Unhandled file type after filter'
            };
        }
        // --------------------------------------------------------

        logger.info('AI analysis result received', { success: aiAnalysisResult.success });

        // Record the AI's response/message
        let analysisRawDataRecord = null;
        if (aiAnalysisResult && aiAnalysisResult.text) {
            analysisRawDataRecord = await recordRawData({
                content: aiAnalysisResult.text,
                contentType: 'ai_response',
                userId: userId,
                sessionId: session_id,
                perspectiveOwnerId: userId,
                subjectId: userId,
                importanceScore: null // Let MemoryManager evaluate AI response importance
            });
            logger.info('AI analysis response/error recorded in database', { rawDataId: analysisRawDataRecord.id });
        }

        // Return result to client NOW
        res.status(200).json({
            success: aiAnalysisResult.success,
            message: aiAnalysisResult.success 
                        ? 'File processed successfully' 
                        : (aiAnalysisResult.text || 'Processing failed'),
            fileInfo: {
                filename: file.filename,
                originalname: file.originalname,
                mimetype: file.mimetype,
                size: file.size
            },
            aiResponse: { // Return consistent structure
                text: aiAnalysisResult.text,
                ...(aiAnalysisResult.error && { error: aiAnalysisResult.error }) 
            }
        });

        // --- Asynchronously process memories AFTER responding to client ---
        if (documentContentRawDataRecord) {
            logger.info(`[MemoryManager Trigger] Scheduling processing for Document Content RawData: ${documentContentRawDataRecord.id}`);
            memoryManager.processRawData(documentContentRawDataRecord).catch(err => {
                handleServiceError(err, `background processing for Document Content RawData ${documentContentRawDataRecord.id}`);
            });
        }
        if (analysisRawDataRecord) {
            logger.info(`[MemoryManager Trigger] Scheduling processing for File Analysis RawData: ${analysisRawDataRecord.id}`);
            memoryManager.processRawData(analysisRawDataRecord).catch(err => {
                handleServiceError(err, `background processing for File Analysis RawData ${analysisRawDataRecord.id}`);
            });
        }
        // === End: Analysis and DB recording logic ===

    } catch (error) {
        // Catch errors from the main async logic within the middleware callback
        logger.error('Error during upload file processing:', { error });

        // Try to process document content even if analysis failed
        if (documentContentRawDataRecord) {
            logger.info(`[MemoryManager Trigger] Scheduling processing for Document Content RawData: ${documentContentRawDataRecord.id} after error.`);
            memoryManager.processRawData(documentContentRawDataRecord).catch(err => {
                handleServiceError(err, `background processing for Document Content RawData ${documentContentRawDataRecord.id} after error`);
            });
        }
        
        // Pass the error to the Express error handling middleware
        next(error); 
    }
  }); // End of upload middleware callback
}; 