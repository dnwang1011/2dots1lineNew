const aiService = require('../../src/services/ai.service');
// We don't need the actual provider here, just the service
// const GeminiProvider = require('../../src/providers/GeminiProvider');

// Mock the provider module path (if any module relies on it directly)
// jest.mock('../../src/providers/GeminiProvider');

// Mock file system and path utils
jest.mock('fs');
jest.mock('path');
jest.mock('pdf-parse');
jest.mock('mammoth');

describe('AI Service', () => {
  let mockProviderInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a simple mock object conforming to the AIProvider interface
    mockProviderInstance = {
      initialize: jest.fn().mockResolvedValue(),
      sendMessage: jest.fn(),
      analyzeImage: jest.fn(),
      generateEmbeddings: jest.fn(),
      getCompletion: jest.fn(),
      // Mock the 'initialized' property the service checks
      initialized: true, 
    };

    // Inject the mock provider into the service before each test
    aiService.setAIProvider(mockProviderInstance);
  });

  afterEach(() => {
     // Reset provider after test
     aiService.setAIProvider(null);
  });

  it('sendMessage should delegate to the injected provider', async () => {
    const args = ['user1', 'session1', 'Hello', { option: 1 }];
    const expectedResult = { success: true, text: 'Mock Response' };
    mockProviderInstance.sendMessage.mockResolvedValue(expectedResult);

    const result = await aiService.sendMessage(...args);

    expect(mockProviderInstance.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockProviderInstance.sendMessage).toHaveBeenCalledWith(...args);
    expect(result).toEqual(expectedResult);
  });

  it('sendMessage should return error if provider not set/initialized', async () => {
      aiService.setAIProvider(null); // Ensure provider is not set
      const args = ['user1', 'session1', 'Hello', { option: 1 }];
      const expectedResult = { success: false, text: null, error: 'AI Service not initialized' };

      const result = await aiService.sendMessage(...args);

      // Provider method should not have been called
      expect(mockProviderInstance.sendMessage).not.toHaveBeenCalled(); 
      expect(result).toEqual(expectedResult);
  });

  // Add similar tests for other delegated methods (analyzeImage, etc.)
  it('analyzeImage should delegate to the injected provider', async () => {
    const params = { userId: 'u1', sessionId: 's1', file: {}, userMessage: 'hi' };
    const expectedResult = { success: true, text: 'Analyzed' };
    mockProviderInstance.analyzeImage.mockResolvedValue(expectedResult);

    const result = await aiService.analyzeImage(params);

    expect(mockProviderInstance.analyzeImage).toHaveBeenCalledTimes(1);
    expect(mockProviderInstance.analyzeImage).toHaveBeenCalledWith(params);
    expect(result).toEqual(expectedResult);
  });

  it('analyzeImage should return error if provider not set/initialized', async () => {
      aiService.setAIProvider(null);
      const params = { userId: 'u1', sessionId: 's1', file: {}, userMessage: 'hi' };
      const expectedResult = { success: false, text: null, error: 'AI Service not initialized' };

      const result = await aiService.analyzeImage(params);

      expect(mockProviderInstance.analyzeImage).not.toHaveBeenCalled();
      expect(result).toEqual(expectedResult);
  });

  it('generateEmbeddings should delegate to the injected provider', async () => {
    const content = ['text1', 'text2'];
    const expectedResult = [[0.1], [0.2]];
    mockProviderInstance.generateEmbeddings.mockResolvedValue(expectedResult);

    const result = await aiService.generateEmbeddings(content);

    expect(mockProviderInstance.generateEmbeddings).toHaveBeenCalledTimes(1);
    expect(mockProviderInstance.generateEmbeddings).toHaveBeenCalledWith(content);
    expect(result).toEqual(expectedResult);
  });

  it('generateEmbeddings should return null if provider not set/initialized', async () => {
      aiService.setAIProvider(null);
      const content = ['text1', 'text2'];

      const result = await aiService.generateEmbeddings(content);

      expect(mockProviderInstance.generateEmbeddings).not.toHaveBeenCalled();
      expect(result).toBeNull();
  });

  it('getCompletion should delegate to the injected provider', async () => {
    const prompt = 'Complete this';
    const expectedResult = 'Completed.';
    mockProviderInstance.getCompletion.mockResolvedValue(expectedResult);

    const result = await aiService.getCompletion(prompt);

    expect(mockProviderInstance.getCompletion).toHaveBeenCalledTimes(1);
    expect(mockProviderInstance.getCompletion).toHaveBeenCalledWith(prompt);
    expect(result).toEqual(expectedResult);
  });

  it('getCompletion should return null if provider not set/initialized', async () => {
      aiService.setAIProvider(null);
      const prompt = 'Complete this';

      const result = await aiService.getCompletion(prompt);

      expect(mockProviderInstance.getCompletion).not.toHaveBeenCalled();
      expect(result).toBeNull();
  });

  // TODO: Add tests for processFileContent

}); 