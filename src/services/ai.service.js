// src/services/ai.service.js
// Service acting as a facade for AI operations, delegating to a specific provider.

const GeminiProvider = require('../providers/GeminiProvider'); // Import the concrete provider
const { prisma } = require('../db/prisma'); // Keep unused prisma import? Maybe remove later.
const logger = require('../utils/logger').childLogger('AI_Service');
const { handleServiceError, ServiceError } = require('../utils/errorHandler');
const aiConfig = require('../../config/ai.config');
const serviceConfig = require('../../config/service.config'); // Import service config
const AIProvider = require('../providers/AIProvider'); // Base class/interface
const { extractTextFromFile } = require('../utils/fileExtractor'); // Import the new utility

// --- File Processing Logic Removed --- 

// --- PROVIDER MANAGEMENT AND FACADE --- 
let currentProvider = null;

function initializeAIService(providerName) {
    const defaultProvider = serviceConfig.ai.defaultProvider;
    logger.info(`Initializing AI Service with provider: ${providerName || defaultProvider}`);
    
    switch ((providerName || defaultProvider).toLowerCase()) {
        case 'gemini':
            currentProvider = new GeminiProvider();
            break;
        // Add other providers here if needed
        default:
            // Default to the configured default provider
            if (providerName && providerName !== defaultProvider) {
                logger.warn(`Unsupported AI provider specified: ${providerName}. Defaulting to ${defaultProvider}.`);
            }
            currentProvider = new GeminiProvider(); // Update this if other providers are supported
    }
    
    if (typeof currentProvider.initialize === 'function') {
         currentProvider.initialize(); 
    }    
    logger.info(`AI Service initialized successfully with ${currentProvider.constructor.name}`);
}

function setAIProviderInstanceForTesting(providerInstance) {
    if (process.env.NODE_ENV !== 'test') {
        logger.warn('Attempted to set AI provider instance outside of test environment. Ignoring.');
        return;
    }
    if (!(providerInstance instanceof AIProvider)) {
         throw new Error('Provided instance does not implement AIProvider interface.');
    }
    logger.warn(`[TESTING] Overriding AI Provider with instance: ${providerInstance.constructor.name}`);
    currentProvider = providerInstance;
}

function getProvider() {
    if (!currentProvider) {
        logger.warn('AI Service provider not initialized. Attempting default initialization (Gemini).');
        initializeAIService(null); // Pass null to trigger default
    }
    return currentProvider;
}

async function sendMessage(userId, sessionId, message, options = {}) {
    // Add basic input validation
    if (!userId || !sessionId || !message) {
        throw new ServiceError('Missing required parameters for sendMessage', 400);
    }
    try {
        return await getProvider().sendMessage(userId, sessionId, message, options);
    } catch (error) {
        throw handleServiceError(error, 'sendMessage', { userId, sessionId });
    }
}

async function analyzeImage(userId, sessionId, base64Image, mimeType, userMessage = null) {
     if (!userId || !sessionId || !base64Image || !mimeType) {
        throw new ServiceError('Missing required parameters for analyzeImage', 400);
    }
    try {
         // Construct the expected 'file' object for the provider
         const fileObject = {
            // Convert base64 back to buffer for the provider
            buffer: Buffer.from(base64Image, 'base64'), 
            mimetype: mimeType
         };
         // Call the provider with the correct options object structure
         return await getProvider().analyzeImage({ userId, sessionId, file: fileObject, userMessage });
    } catch (error) {
         throw handleServiceError(error, 'analyzeImage', { userId, sessionId, mimeType });
    }
}

async function generateEmbeddings(texts) {
    if (!texts || (Array.isArray(texts) && texts.length === 0)) {
         // Allow single string or non-empty array
         if (typeof texts !== 'string') {
            throw new ServiceError("Missing required parameter 'texts' for generateEmbeddings", 400);
         }
    }
     try {
         return await getProvider().generateEmbeddings(texts);
     } catch (error) {
         throw handleServiceError(error, 'generateEmbeddings');
     }
}

async function getCompletion(prompt, options = {}) {
    if (!prompt) {
        throw new ServiceError("Missing required parameter 'prompt' for getCompletion", 400);
    }
    try {
         return await getProvider().getCompletion(prompt, options);
    } catch (error) {
         throw handleServiceError(error, 'getCompletion');
    }
}

// Expose file content processing using the extracted utility
async function processFileContent(filePath) {
    if (!filePath) {
        throw new ServiceError("Missing required parameter 'filePath' for processFileContent", 400);
    }
    logger.debug(`AI Service processFileContent called for path: ${filePath}`);
    try {
        // Call the external utility function
        const result = await extractTextFromFile(filePath);
        // Wrap the result to match expected structure if needed, or just return it.
        // The original internal function returned { text, error, isImage, path }, 
        // the new one returns { text, error, isImage }. Let's adapt.
        if (result.error) {
             // If the extractor returned an error string, return it in the expected structure
             return { success: false, text: null, error: result.error, isImage: result.isImage, path: filePath };
        } else {
             // If successful, return text and isImage status
              return { success: true, text: result.text, error: null, isImage: result.isImage, path: filePath };
        }
    } catch (error) {
        // Catch any unexpected errors from the utility itself
        logger.error(`Unexpected error calling file extractor for ${filePath}: ${error.message}`, { stack: error.stack });
        throw handleServiceError(error, 'processFileContent', { filePath });
    }
}

module.exports = {
    initializeAIService,
    setAIProviderInstanceForTesting, 
    sendMessage,
    analyzeImage,
    generateEmbeddings,
    getCompletion,
    processFileContent // Export the facade method that now uses the utility
}; 