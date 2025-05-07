const AIProvider = require('../../../src/providers/AIProvider');

/**
 * Mock AI Provider for testing
 * This class simulates the behavior of an AI provider for testing purposes
 */
class MockAIProvider extends AIProvider {
    constructor() {
        super();
        this.calls = {};
        this.mockResults = {};
        this.mockFailures = {};
    }

    // Record a method call for testing assertions
    recordCall(method, ...args) {
        if (!this.calls[method]) {
            this.calls[method] = [];
        }
        this.calls[method].push(...args);
    }

    // Get calls made to a specific method
    getCalls(method) {
        return this.calls[method] || [];
    }

    // Clear all recorded calls
    clearCalls() {
        this.calls = {};
    }

    // Set mock result for a method
    setMockResult(method, result) {
        this.mockResults[method] = result;
    }

    // Set mock failure for a method
    setMockFailure(method, error) {
        this.mockFailures[method] = error;
    }

    // Clear mock failures
    clearMockFailures() {
        this.mockFailures = {};
    }

    // Implementation of initialize method
    async initialize() {
        this.recordCall('initialize');
        return true;
    }

    // Implementation of sendMessage method required by AIProvider
    async sendMessage(userId, sessionId, message, options = {}) {
        this.recordCall('sendMessage', { userId, sessionId, message, options });
        
        if (this.mockFailures.sendMessage) {
            throw this.mockFailures.sendMessage;
        }
        
        return this.mockResults.sendMessage || { success: true, text: 'Mock AI response' };
    }

    // Implementation of analyzeImage method required by AIProvider
    async analyzeImage(userId, sessionId, imageData, mimeType, userMessage = null) {
        this.recordCall('analyzeImage', { userId, sessionId, mimeType, userMessage });
        
        if (this.mockFailures.analyzeImage) {
            throw this.mockFailures.analyzeImage;
        }
        
        return this.mockResults.analyzeImage || { success: true, text: 'Mock image analysis' };
    }

    // Implementation of generateEmbeddings method required by AIProvider
    async generateEmbeddings(content) {
        this.recordCall('generateEmbeddings', { content });
        
        if (this.mockFailures.generateEmbeddings) {
            throw this.mockFailures.generateEmbeddings;
        }
        
        return this.mockResults.generateEmbeddings || [[0.1, 0.2, 0.3]];
    }

    // Implementation of getCompletion method required by AIProvider
    async getCompletion(prompt) {
        this.recordCall('getCompletion', { prompt });
        
        if (this.mockFailures.getCompletion) {
            throw this.mockFailures.getCompletion;
        }
        
        return this.mockResults.getCompletion || 'Mock completion';
    }

    // Mock implementation of processFileContent
    async processFileContent(filePath) {
        this.recordCall('processFileContent', { filePath });
        
        if (this.mockFailures.processFileContent) {
            throw this.mockFailures.processFileContent;
        }
        
        return this.mockResults.processFileContent || { 
            success: true, 
            text: 'Mock document content',
            isImage: false
        };
    }

    // Get provider name
    getProviderName() {
        return 'MockAIProvider';
    }
}

module.exports = MockAIProvider; 