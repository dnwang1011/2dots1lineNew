const GeminiProvider = require('../../src/providers/GeminiProvider');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { prisma } = require('../../src/db/prisma');
const { validateApiKey } = require('../../src/utils/apiKeyValidator');

// Mock dependencies
jest.mock('@google/generative-ai');
jest.mock('../../src/db/prisma', () => ({
  prisma: {
    rawData: {
      findMany: jest.fn(),
    },
  },
}));
jest.mock('../../src/utils/apiKeyValidator');
jest.mock('../../config/ai.config', () => ({
  geminiModelName: 'gemini-test-model',
  embeddingModelName: 'embedding-test-model',
  generationConfig: { temperature: 0.5 },
  safetySettings: [],
  dotSystemPrompt: 'Test System Prompt',
  conversationHistoryLimit: 10,
}));

describe('GeminiProvider', () => {
  let provider;
  let mockChatModel;
  let mockEmbeddingModel;
  let mockGenAIInstance;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock return values for the SDK
    mockChatModel = {
      startChat: jest.fn().mockReturnThis(),
      sendMessage: jest.fn(),
      generateContent: jest.fn(),
    };
    mockEmbeddingModel = {
      embedContent: jest.fn(),
      batchEmbedContents: jest.fn(),
    };
    mockGenAIInstance = {
      getGenerativeModel: jest.fn((config) => {
        if (config.model === 'gemini-test-model') return mockChatModel;
        if (config.model === 'embedding-test-model') return mockEmbeddingModel;
        return null;
      }),
    };

    // Configure the main mock constructor
    GoogleGenerativeAI.mockImplementation(() => mockGenAIInstance);

    // Mock Prisma history retrieval correctly using the mocked module
    const { prisma: mockPrisma } = require('../../src/db/prisma');
    mockPrisma.rawData.findMany.mockResolvedValue([]); // Default empty history

    // Default mock for validateApiKey (no error)
    validateApiKey.mockImplementation(() => {});

    // Set API Key env variable for initialization by default
    process.env.GOOGLE_AI_API_KEY = 'test-api-key';

    provider = new GeminiProvider();
    // Initialization happens async, await it here for tests
    await provider.initialize();
  });

  afterEach(() => {
      delete process.env.GOOGLE_AI_API_KEY;
  });

  it('should initialize correctly with API key', () => {
    expect(GoogleGenerativeAI).toHaveBeenCalledWith('test-api-key');
    expect(mockGenAIInstance.getGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-test-model' }));
    expect(mockGenAIInstance.getGenerativeModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'embedding-test-model' }));
    expect(validateApiKey).toHaveBeenCalledWith('test-api-key', 'Google Generative AI');
    expect(provider.initialized).toBe(true);
  });

  it('should not initialize if API key is missing', async () => {
    delete process.env.GOOGLE_AI_API_KEY;
    // Mock validateApiKey to throw specifically for this test
    validateApiKey.mockImplementation((key, serviceName) => {
        if (!key) {
            throw new Error(`${serviceName} API Key is missing`);
        }
    });

    const providerNoKey = new GeminiProvider();
    await providerNoKey.initialize(); // Await the explicit initialize

    expect(validateApiKey).toHaveBeenCalledWith(undefined, 'Google Generative AI');
    expect(providerNoKey.initialized).toBe(false);
  });

  describe('sendMessage', () => {
    it('should send a message and return response', async () => {
      const { prisma: mockPrisma } = require('../../src/db/prisma');
      mockPrisma.rawData.findMany.mockResolvedValue([]); // Ensure history is empty for this test
      const mockResponse = { response: { text: () => 'AI Response' } };
      mockChatModel.sendMessage.mockResolvedValue(mockResponse);

      const result = await provider.sendMessage('user1', 'session1', 'Hello');

      expect(mockChatModel.startChat).toHaveBeenCalledWith({ history: [] });
      expect(mockChatModel.sendMessage).toHaveBeenCalledWith('Hello');
      expect(result).toEqual({ success: true, text: 'AI Response' });
    });

    it('should include additional context', async () => {
       const { prisma: mockPrisma } = require('../../src/db/prisma');
       mockPrisma.rawData.findMany.mockResolvedValue([]);
       const mockResponse = { response: { text: () => 'AI Response' } };
       mockChatModel.sendMessage.mockResolvedValue(mockResponse);
       const context = 'Previous info';
       const message = 'Current question';
       const expectedFullMessage = `${context}\n\n---\n\nUser Query: ${message}`;

       await provider.sendMessage('user1', 'session1', message, { additionalContext: context });

       expect(mockChatModel.sendMessage).toHaveBeenCalledWith(expectedFullMessage);
     });

     it('should handle blocked responses', async () => {
       const { prisma: mockPrisma } = require('../../src/db/prisma');
       mockPrisma.rawData.findMany.mockResolvedValue([]);
       const mockResponse = { response: { promptFeedback: { blockReason: 'SAFETY' } } };
       mockChatModel.sendMessage.mockResolvedValue(mockResponse);

       const result = await provider.sendMessage('user1', 'session1', 'Blocked content');
       expect(result.success).toBe(false);
       expect(result.text).toContain('Response blocked: SAFETY');
       expect(result.error).toContain('Blocked: SAFETY');
     });

    it('should handle errors', async () => {
      const { prisma: mockPrisma } = require('../../src/db/prisma');
      mockPrisma.rawData.findMany.mockResolvedValue([]);
      const error = new Error('Model failed');
      mockChatModel.sendMessage.mockRejectedValue(error);

      const result = await provider.sendMessage('user1', 'session1', 'Causes error');
      expect(result.success).toBe(false);
      expect(result.text).toBeNull();
      expect(result.error).toEqual('Model failed');
    });
  });

  describe('analyzeImage', () => {
      it('should analyze image with prompt and return response', async () => {
          const mockResponse = { response: { text: () => 'Image Analysis Result' } };
          mockChatModel.generateContent.mockResolvedValue(mockResponse);
          const file = { buffer: Buffer.from('imagedata'), mimetype: 'image/png' };

          const result = await provider.analyzeImage({ userId: 'u1', sessionId: 's1', file });

          expect(mockChatModel.generateContent).toHaveBeenCalledWith({
              contents: [{ role: 'user', parts: [
                  { text: 'Analyze this image and describe what you see.' },
                  { inlineData: { data: 'aW1hZ2VkYXRh', mimeType: 'image/png' } }
              ]}]
          });
          expect(result).toEqual({ success: true, text: 'Image Analysis Result' });
      });

      it('should analyze image with user message', async () => {
          const mockResponse = { response: { text: () => 'Image Analysis Result' } };
          mockChatModel.generateContent.mockResolvedValue(mockResponse);
          const file = { buffer: Buffer.from('imagedata'), mimetype: 'image/png' };
          const userMessage = 'What is this?';

          await provider.analyzeImage({ userId: 'u1', sessionId: 's1', file, userMessage });

          expect(mockChatModel.generateContent).toHaveBeenCalledWith({
              contents: [{ role: 'user', parts: [
                  { text: `The user uploaded this image and provided the following comment: '${userMessage}'. Please respond to the user's comment, using the image as context.` },
                  { inlineData: { data: 'aW1hZ2VkYXRh', mimeType: 'image/png' } }
              ]}]
          });
      });

       it('should handle errors during image analysis', async () => {
          const error = new Error('Analysis failed');
          mockChatModel.generateContent.mockRejectedValue(error);
          const file = { buffer: Buffer.from('imagedata'), mimetype: 'image/png' };

          const result = await provider.analyzeImage({ userId: 'u1', sessionId: 's1', file });
          expect(result.success).toBe(false);
          expect(result.text).toBeNull();
          expect(result.error).toEqual('Analysis failed');
       });
  });

  describe('generateEmbeddings', () => {
    it('should generate single embedding', async () => {
      const mockEmbedding = { embedding: { values: [0.1, 0.2, 0.3] } };
      mockEmbeddingModel.embedContent.mockResolvedValue(mockEmbedding);

      const result = await provider.generateEmbeddings('Text to embed');

      expect(mockEmbeddingModel.embedContent).toHaveBeenCalledWith('Text to embed');
      expect(result).toEqual([[0.1, 0.2, 0.3]]);
    });

    it('should generate batch embeddings', async () => {
        const mockEmbeddings = {
            embeddings: [
                { values: [0.1, 0.2] },
                { values: [0.3, 0.4] }
            ]
        };
        mockEmbeddingModel.batchEmbedContents.mockResolvedValue(mockEmbeddings);
        const texts = ['Text 1', 'Text 2'];
        const expectedRequests = texts.map(text => ({ content: { parts: [{ text }] } }));

        const result = await provider.generateEmbeddings(texts);

        expect(mockEmbeddingModel.batchEmbedContents).toHaveBeenCalledWith({ requests: expectedRequests });
        expect(result).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    });

     it('should handle errors during embedding', async () => {
          const error = new Error('Embedding failed');
          mockEmbeddingModel.embedContent.mockRejectedValue(error);

          const result = await provider.generateEmbeddings('Text');
          expect(result).toBeNull();
     });
  });

  describe('getCompletion', () => {
    it('should get completion', async () => {
      const mockResponse = { response: { text: () => 'Completion Result' } };
      mockChatModel.generateContent.mockResolvedValue(mockResponse);

      const result = await provider.getCompletion('Prompt text');

      expect(mockChatModel.generateContent).toHaveBeenCalledWith('Prompt text');
      expect(result).toEqual('Completion Result');
    });

     it('should handle errors during completion', async () => {
          const error = new Error('Completion failed');
          mockChatModel.generateContent.mockRejectedValue(error);

          const result = await provider.getCompletion('Prompt');
          expect(result).toBeNull();
     });
  });

}); 