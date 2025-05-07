const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const AIProvider = require('./AIProvider'); // Assuming AIProvider is in the same directory
const { prisma } = require('../db/prisma');
const { validateApiKey } = require('../utils/apiKeyValidator');
const logger = require('../utils/logger').childLogger('GeminiProvider');
const { handleServiceError, ServiceError } = require('../utils/errorHandler');
const aiConfig = require('../../config/ai.config');

class GeminiProvider extends AIProvider {
  constructor() {
    super();
    this.genAI = null;
    this.chatModel = null;
    this.embeddingModel = null;
    this.initialized = false;
  }

  async initialize() {
    const API_KEY = process.env.GOOGLE_AI_API_KEY;
    try {
      validateApiKey(API_KEY, 'Google Generative AI');
      this.genAI = new GoogleGenerativeAI(API_KEY);
      this._initializeModels();
      this.initialized = true;
      logger.info('Gemini Provider initialized successfully.');
    } catch (error) {
      logger.error(`Gemini Provider initialization failed: ${error.message}`);
      this.initialized = false;
      // Decide if we should throw or just log and remain uninitialized
      // throw new Error(`Gemini Provider initialization failed: ${error.message}`);
    }
  }

  _initializeModels() {
    if (!this.genAI) return;

    try {
      // Initialize Chat Model with the main system prompt
      this.chatModel = this.genAI.getGenerativeModel({
        model: aiConfig.geminiModelName,
        generationConfig: aiConfig.generationConfig,
        safetySettings: aiConfig.safetySettings.map(setting => ({
          category: HarmCategory[setting.category],
          threshold: HarmBlockThreshold[setting.threshold],
        })),
        systemInstruction: aiConfig.dotSystemPrompt, // Base system instructions
      });
      logger.info(`Gemini chat model (${aiConfig.geminiModelName}) initialized.`);
    } catch (modelError) {
      logger.error(`Failed to initialize Gemini chat model (${aiConfig.geminiModelName}): ${modelError.message}`);
      this.chatModel = null; // Ensure model is null on error
    }

    try {
      // Initialize Embedding Model
      this.embeddingModel = this.genAI.getGenerativeModel({ model: aiConfig.embeddingModelName });
      logger.info(`Gemini embedding model (${aiConfig.embeddingModelName}) initialized.`);
    } catch (modelError) {
      logger.error(`Failed to initialize Embedding model (${aiConfig.embeddingModelName}): ${modelError.message}`);
      this.embeddingModel = null; // Ensure model is null on error
    }
  }

  async _getConversationHistory(userId, sessionId, limit = aiConfig.conversationHistoryLimit) {
     // This logic is tightly coupled with the RawData model/repo, might move later?
     // For now, keep it similar to how it was in ai.service
    try {
      const rawData = await prisma.rawData.findMany({
        where: {
          userId: userId,
          sessionId: sessionId,
          contentType: {
            in: ['user_chat', 'ai_response', 'uploaded_file_event']
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: limit
      });

      let history = [];
      const chronologicalData = rawData.reverse();
      
      // Ensure the first message has role 'user'
      if (chronologicalData.length > 0 && chronologicalData[0].contentType === 'ai_response') {
        chronologicalData.shift();
      }
      
      if (chronologicalData.length > 0) {
        const firstUserMsgIndex = chronologicalData.findIndex(msg => 
          msg.contentType === 'user_chat' || msg.contentType === 'uploaded_file_event'
        );
        
        if (firstUserMsgIndex >= 0) {
          const validMessages = chronologicalData.slice(firstUserMsgIndex);
          history = validMessages.map(message => ({
            role: message.contentType === 'ai_response' ? 'model' : 'user',
            parts: [{ text: message.content }]
          }));
        }
      }
      
      return history;
    } catch (error) {
      handleServiceError(error, 'GeminiProvider retrieving conversation history');
      return [];
    }
  }

  async sendMessage(userId, sessionId, message, options = {}) {
    if (!this.initialized || !this.chatModel) {
      logger.error('GeminiProvider sendMessage failed: Provider or chat model not initialized.');
      return { success: false, text: null, error: 'AI Service not initialized' };
    }

    try {
      const history = await this._getConversationHistory(userId, sessionId);
      const chatConfig = { history };

      let messageToSend = message;
      let contextPrepended = false; // Flag to ensure only one context block is prepended

      // Prioritize additionalContext (e.g., from file upload for the current turn)
      if (options.additionalContext && options.additionalContext.content) {
        logger.debug('[GeminiProvider] Prepending additionalContext.content to the user message.');
        messageToSend = `CONTEXT FROM UPLOADED DOCUMENT:\n---\n${options.additionalContext.content}\n---\n\nUSER MESSAGE:\n${message}`;
        contextPrepended = true;
      }

      // If no additionalContext was prepended, then check for memoryContextBlock (from memory retrieval)
      if (!contextPrepended && options.memoryContextBlock) {
         logger.debug('[GeminiProvider] Prepending memoryContextBlock to the user message.');
         messageToSend = `${options.memoryContextBlock}\n\nCURRENT MESSAGE:\n${message}`;
      }

      const chat = this.chatModel.startChat(chatConfig);
      logger.info(`[GeminiProvider] Sending message (history length ${history.length}) to model...`);
      const result = await chat.sendMessage(messageToSend); 
      
      const response = result.response;

      if (!response) {
        logger.error('[GeminiProvider] No response received from model.', { result });
        throw new ServiceError('No response received from AI model', 500);
      }
      if (response.promptFeedback?.blockReason) {
        logger.warn(`[GeminiProvider] Response blocked: ${response.promptFeedback.blockReason}`);
        return { success: false, text: `Response blocked: ${response.promptFeedback.blockReason}`, error: `Blocked: ${response.promptFeedback.blockReason}` };
      }

      const text = response.text ? response.text() : '';
      logger.info('[GeminiProvider] Message response received.');
      return { success: true, text: text };

    } catch (error) {
      // Log the specific error details
      logger.error(`[GeminiProvider] Error sending message: ${error?.message}`, { 
        stack: error?.stack, 
        details: error?.details, // Include details if available (like from Google API errors)
        userId, 
        sessionId 
      });
      // Ensure a generic but informative error is returned
      const displayError = error.message.includes('Invalid value at \'system_instruction\'') 
          ? 'Internal configuration error communicating with AI.'
          : (error.message || 'Failed to get AI response');
      handleServiceError(error, 'GeminiProvider chat completion'); // Still log the original error
      return { success: false, text: null, error: displayError };
    }
  }

  _formatImageForModel(imageData, inputMimeType) {
    return {
      inlineData: {
        data: imageData.toString('base64'),
        mimeType: inputMimeType
      }
    };
  }

  async analyzeImage({ userId, sessionId, file, userMessage }) {
    if (!this.initialized || !this.chatModel) {
      logger.error('GeminiProvider analyzeImage failed: Provider or chat model not initialized.');
      return { success: false, text: null, error: 'AI Service not initialized' };
    }
    if (!file || !file.buffer || !file.mimetype) {
      logger.error('[GeminiProvider] Invalid file object for image analysis.');
      return { success: false, text: null, error: 'Invalid image file data' };
    }

    try {
      const imagePart = this._formatImageForModel(file.buffer, file.mimetype);
      let promptText;
      if (userMessage && userMessage.trim() !== '') {
        // Use prompt from config, replacing placeholder
        promptText = aiConfig.imageAnalysisWithUserMessagePrompt.replace('{USER_MESSAGE}', userMessage);
        logger.info('Using user message prompt template for image analysis.');
      } else {
        // Use default prompt from config
        promptText = aiConfig.defaultImageAnalysisPrompt;
        logger.info('Using default prompt template for image analysis.');
      }
      const promptParts = [{ text: promptText }, imagePart];

      logger.info('[GeminiProvider] Sending image analysis request to model...');
      const result = await this.chatModel.generateContent({ contents: [{ role: "user", parts: promptParts }] });
      const response = result.response;

      if (!response) {
        logger.error('[GeminiProvider] No response for image analysis.', { result });
        throw new ServiceError('No response received from AI model', 500);
      }
      if (response.promptFeedback?.blockReason) {
        logger.warn(`[GeminiProvider] Image analysis blocked: ${response.promptFeedback.blockReason}`);
        return { success: false, text: `Analysis blocked: ${response.promptFeedback.blockReason}`, error: `Blocked: ${response.promptFeedback.blockReason}` };
      }

      const text = response.text ? response.text() : '';
      logger.info('[GeminiProvider] Image analysis response received.');
      return { success: true, text: text };

    } catch (error) {
      logger.error(`[GeminiProvider] Error analyzing image: ${error.message}`, { stack: error.stack });
      handleServiceError(error, 'GeminiProvider image analysis');
      return { success: false, text: null, error: error.message || 'Failed to analyze image' };
    }
  }

  async generateEmbeddings(content) {
    if (!this.initialized || !this.embeddingModel) {
      logger.error('GeminiProvider generateEmbeddings failed: Provider or embedding model not initialized.');
      return null;
    }
    if (!content || (Array.isArray(content) && content.length === 0)) {
      return [];
    }

    try {
      const contentArray = Array.isArray(content) ? content : [content];
      logger.info(`[GeminiProvider] Generating embeddings for ${contentArray.length} content piece(s)...`);

      let result;
      if (contentArray.length === 1) {
        result = await this.embeddingModel.embedContent(contentArray[0]);
        return result.embedding ? [result.embedding.values] : null;
      } else {
        const requests = contentArray.map(text => ({ content: { parts: [{ text }] } }));
        result = await this.embeddingModel.batchEmbedContents({ requests });
        return result?.embeddings?.map(emb => emb.values) || null;
      }

    } catch (error) {
      logger.error(`[GeminiProvider] Error generating embeddings: ${error.message}`, { stack: error.stack });
      handleServiceError(error, 'GeminiProvider embedding generation');
      return null;
    }
  }

  async getCompletion(prompt) {
    if (!this.initialized || !this.chatModel) {
      logger.error('GeminiProvider getCompletion failed: Provider or chat model not initialized.');
      return null;
    }

    try {
      logger.info(`[GeminiProvider] Getting completion (first 100 chars): "${prompt.substring(0, 100)}..."`);
      const result = await this.chatModel.generateContent(prompt);
      const response = result.response;

      if (!response) {
        logger.error('[GeminiProvider] No response for completion.', { result });
        throw new ServiceError('No response received from AI model', 500);
      }
      if (response.promptFeedback?.blockReason) {
        logger.warn(`[GeminiProvider] Completion blocked: ${response.promptFeedback.blockReason}`);
        return `Completion blocked: ${response.promptFeedback.blockReason}`;
      }

      const text = response.text ? response.text() : '';
      logger.info('[GeminiProvider] Completion response received.');
      return text;

    } catch (error) {
      logger.error(`[GeminiProvider] Error getting completion: ${error.message}`, { stack: error.stack });
      handleServiceError(error, 'GeminiProvider simple completion');
      return null;
    }
  }
}

module.exports = GeminiProvider; 