const rawDataRepository = require('../repositories/rawData.repository');
const memoryManager = require('./memoryManager.service');
const aiService = require('./ai.service');
const logger = require('../utils/logger').childLogger('ChatService');
const { handleServiceError, ServiceError } = require('../utils/errorHandler');
const memoryConfig = require('../../config/memory.config');
const aiConfig = require('../../config/ai.config');
const { addMemoryJob } = require('../utils/queues');

/**
 * Formats memories into a structured block for the AI context.
 * @param {Array<object>} relevantMemories - Array of retrieved memories.
 * @returns {string} - Formatted memory context block or empty string.
 */
function formatMemoryContextBlock(relevantMemories) {
  if (!relevantMemories || relevantMemories.length === 0) {
    return '';
  }

  logger.info(`Formatting ${relevantMemories.length} relevant memories for context block.`);
  
  // Start with the centralized memory context instructions/header
  let memoryBlock = aiConfig.memoryContextPrompt + '\n\n'; // Added newlines for separation
  
  // Format the actual memory content
  memoryBlock += relevantMemories.map((m, i) => {
      const relevance = m.similarity ? `(Relevance: ${(m.similarity * 100).toFixed(1)}%)` : '';
      if (m.type === 'episode') {
          return `[Episode Memory ${i+1}] ${m.title || 'Untitled Episode'} ${relevance}\nNarrative: ${m.narrative || m.content || 'No content available'}`;
      }
      if (m.type === 'thought') return `[Thought Memory ${i+1}] ${m.name}: ${m.content} ${relevance}`;
      if (m.type === 'chunk') return `[Chunk Memory ${i+1}] ${relevance}\n${m.text}`;
      return `[Memory ${i+1}] ${m.content || m.text || 'N/A'} ${relevance}`;
  }).join('\n\n---\n\n'); // Add separator between memories
  
  logger.info('Memory context block created for AI.');
  return memoryBlock;
}

/**
 * Processes an incoming user message, retrieves context, gets AI response, and records data.
 * @param {string} userId - ID of the user sending the message.
 * @param {string} sessionId - ID of the current chat session.
 * @param {string} message - The user's message content.
 * @returns {Promise<object>} - Object containing the AI response text.
 * @throws {ServiceError} - Throws ServiceError for validation or processing issues.
 */
async function processUserMessage(userId, sessionId, message) {
  let userRawDataRecord = null;
  let aiRawDataRecord = null;

  try {
    logger.info(`Processing message for user ${userId} in session ${sessionId}: "${message.substring(0, 50)}..."`);

    // 1. Record user message
    userRawDataRecord = await rawDataRepository.create({
      content: message,
      contentType: 'user_chat',
      userId: userId,
      sessionId: sessionId,
      perspectiveOwnerId: userId,
      importanceScore: null // Evaluation happens in background worker
    });
    logger.info('User message recorded', { rawDataId: userRawDataRecord.id });

    // 2. Retrieve relevant memories
    logger.info('Retrieving relevant memories for context...');
    const relevantMemories = await memoryManager.retrieveMemories(message, userId, {
      limit: memoryConfig.defaultRetrievalLimit,
      minImportance: memoryConfig.defaultRetrievalMinImportance,
      certainty: memoryConfig.defaultRetrievalCertainty,
    });

    // 3. Format memory context
    const memoryContextBlock = formatMemoryContextBlock(relevantMemories);

    // 4. Get AI response
    logger.info('Requesting AI response from aiService...');
    const startTime = Date.now();
    // Pass the formatted memory block to be potentially injected by the provider
    const aiOptions = memoryContextBlock ? { memoryContextBlock } : {}; 
    const aiResponse = await aiService.sendMessage(userId, sessionId, message, aiOptions);
    const duration = Date.now() - startTime;
    logger.info(`aiService call completed in ${duration}ms`);

    if (!aiResponse.success) {
      const errorMessage = aiResponse.error instanceof Error ? aiResponse.error.message : String(aiResponse.error || 'AI service failed to process the message.');
      throw new ServiceError(errorMessage, 500);
    }
    logger.info('AI response received successfully from aiService.');

    // 5. Record AI response
    if (aiResponse.text) {
      aiRawDataRecord = await rawDataRepository.create({
        content: aiResponse.text,
        contentType: 'ai_response',
        userId: userId,
        sessionId: sessionId,
        perspectiveOwnerId: userId, // AI perspective
        subjectId: userId, // About the user
        importanceScore: null // Will be evaluated later
      });
      logger.info('AI response recorded', { rawDataId: aiRawDataRecord.id });
    }

    // 6. Trigger background memory processing VIA QUEUE
    logger.info(`[Queue Trigger] Adding job for User RawData: ${userRawDataRecord.id}`);
    await addMemoryJob('processRawData', { rawDataId: userRawDataRecord.id });

    if (aiRawDataRecord) {
      logger.info(`[Queue Trigger] Adding job for AI RawData: ${aiRawDataRecord.id}`);
      await addMemoryJob('processRawData', { rawDataId: aiRawDataRecord.id });
    }

    // 7. Return success response
    return { success: true, text: aiResponse.text, userRawDataId: userRawDataRecord.id, aiRawDataId: aiRawDataRecord?.id };

  } catch (error) {
    logger.error(`Service Error in processUserMessage: ${error?.message}`, { stack: error?.stack, userId, sessionId });

    if (userRawDataRecord && userRawDataRecord.id) {
        logger.warn(`[Queue Trigger] Adding job for User RawData ${userRawDataRecord.id} after service error occurred.`);
        addMemoryJob('processRawData', { rawDataId: userRawDataRecord.id });
    }

    throw handleServiceError(error, 'processUserMessage');
  }
}

module.exports = {
  processUserMessage,
}; 