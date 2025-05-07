const chatService = require('../../src/services/chat.service');
const rawDataRepository = require('../../src/repositories/rawData.repository');
const memoryManager = require('../../src/services/memoryManager.service');
const aiService = require('../../src/services/ai.service');
const logger = require('../../src/utils/logger');
// Mock the entire module
const { ServiceError, handleServiceError } = require('../../src/utils/errorHandler');
const memoryConfig = require('../../config/memory.config');

// Mock dependencies
jest.mock('../../src/repositories/rawData.repository');
jest.mock('../../src/services/memoryManager.service', () => ({
    retrieveMemories: jest.fn(),
    processMemoryPipeline: jest.fn().mockResolvedValue(undefined), // Mock background task
}));
jest.mock('../../src/services/ai.service', () => ({
    sendMessage: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => {
    const actualLogger = jest.requireActual('../../src/utils/logger');
    const childLoggerMock = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
    return {
        ...actualLogger,
        childLogger: jest.fn().mockImplementation((name) => {
            if (name === 'ChatService') {
                return childLoggerMock;
            }
            return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        }),
        _mockChildLogger: childLoggerMock,
    };
});

describe('Chat Service', () => {
    let userId;
    let sessionId;
    let message;
    let mockUserRawData;
    let mockAiRawData;

    beforeEach(() => {
        jest.clearAllMocks();

        userId = 'user123';
        sessionId = 'session456';
        message = 'Hello, Dot!';

        mockUserRawData = { id: 'userRawData789', content: message };
        mockAiRawData = { id: 'aiRawData101', content: 'Hello, User!' };

        // Default successful mock implementations
        rawDataRepository.create.mockImplementation(async (data) => {
            if (data.contentType === 'user_chat') return { ...mockUserRawData, ...data };
            if (data.contentType === 'ai_response') return { ...mockAiRawData, ...data };
            return { id: `other_${Math.random()}`, ...data };
        });
        memoryManager.retrieveMemories.mockResolvedValue([]); // Default no memories
        aiService.sendMessage.mockResolvedValue({ success: true, text: mockAiRawData.content });
    });

    describe('processUserMessage', () => {
        it('should process a message, retrieve no memories, get AI response, and record data', async () => {
            const result = await chatService.processUserMessage(userId, sessionId, message);

            // 1. Record user message
            expect(rawDataRepository.create).toHaveBeenCalledWith(expect.objectContaining({
                content: message,
                contentType: 'user_chat',
                userId: userId,
                sessionId: sessionId,
                importanceScore: null // Initially null
            }));

            // 2. Retrieve memories
            expect(memoryManager.retrieveMemories).toHaveBeenCalledWith(message, userId, expect.any(Object));
            expect(logger._mockChildLogger.info).toHaveBeenCalledWith('No relevant memories found for context.');

            // 3. Format context (should be empty)

            // 4. Get AI response (without extra context)
            expect(aiService.sendMessage).toHaveBeenCalledWith(userId, sessionId, message, {});

            // 5. Record AI response
            expect(rawDataRepository.create).toHaveBeenCalledWith(expect.objectContaining({
                content: mockAiRawData.content,
                contentType: 'ai_response',
                userId: userId,
                sessionId: sessionId,
                importanceScore: null // Initially null
            }));

            // 6. Trigger background processing (allow time for promises)
            await new Promise(process.nextTick); // Ensure async calls within the function have a chance to start
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2); // Once for user, once for AI
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: mockUserRawData.id }));
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: mockAiRawData.id }));

            // 7. Return AI response
            expect(result).toEqual({ text: mockAiRawData.content });
        });

        it('should include memory context when memories are retrieved', async () => {
            const mockMemories = [
                { type: 'episode', title: 'Past Trip', id: 'ep1', similarity: 0.9 },
                { type: 'chunk', text: 'Planned activities...', id: 'ch1', similarity: 0.8 }
            ];
            memoryManager.retrieveMemories.mockResolvedValue(mockMemories);

            await chatService.processUserMessage(userId, sessionId, message);

            expect(memoryManager.retrieveMemories).toHaveBeenCalledTimes(1);
            expect(logger._mockChildLogger.info).toHaveBeenCalledWith(`Found ${mockMemories.length} relevant memories.`);
            expect(aiService.sendMessage).toHaveBeenCalledWith(
                userId,
                sessionId,
                message,
                expect.objectContaining({
                    additionalContext: expect.stringContaining('RELEVANT CONTEXT FROM MEMORY:')
                })
            );
             expect(aiService.sendMessage.mock.calls[0][3].additionalContext).toContain('[Episode] Past Trip');
             expect(aiService.sendMessage.mock.calls[0][3].additionalContext).toContain('[Fragment] Planned activities');
        });

        it('should throw ServiceError if aiService.sendMessage fails', async () => {
            const aiErrorMsg = 'AI service unavailable';
            aiService.sendMessage.mockResolvedValue({ success: false, error: aiErrorMsg });

            try {
                await chatService.processUserMessage(userId, sessionId, message);
                // If it doesn't throw, fail the test
                throw new Error('Expected processUserMessage to throw, but it did not.');
            } catch (error) {
                // Check for ServiceError properties instead of instanceof
                expect(error.name).toBe('ServiceError'); 
                expect(error.statusCode).toBe(500);
                // Expect the message wrapped by the final catch block
                expect(error.message).toBe(`Failed to process message: ${aiErrorMsg}`); 
            }

            // Ensure background processing for user message is still triggered on error
             await new Promise(process.nextTick);
             // Ensure rawDataRepository.create was called for the user message before the AI call
             expect(rawDataRepository.create).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'user_chat' }));
             expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(1);
             expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: mockUserRawData.id }));

             // Should not attempt to record AI response
             expect(rawDataRepository.create).not.toHaveBeenCalledWith(expect.objectContaining({ contentType: 'ai_response' }));
        });

         it('should throw ServiceError if recording user message fails', async () => {
            const dbError = new Error('Database connection failed');
            // Make the first call to create throw the error
            rawDataRepository.create.mockImplementationOnce(async () => { throw dbError; }); 

             try {
                 await chatService.processUserMessage(userId, sessionId, message);
                 throw new Error('Expected processUserMessage to throw, but it did not.');
             } catch (error) {
                 // Check for ServiceError properties instead of instanceof
                 expect(error.name).toBe('ServiceError');
                 expect(error.statusCode).toBe(500);
                 // Check that the original error message is wrapped
                 expect(error.message).toBe(`Failed to process message: ${dbError.message}`);
             }

            // Should not proceed further
            expect(memoryManager.retrieveMemories).not.toHaveBeenCalled();
            expect(aiService.sendMessage).not.toHaveBeenCalled();
            expect(memoryManager.processMemoryPipeline).not.toHaveBeenCalled();
             // Ensure create was called once (the one that failed)
             expect(rawDataRepository.create).toHaveBeenCalledTimes(1);
        });

         it('should handle errors during background memory processing without failing the main request', async () => {
             const backgroundError = new Error('Background task failed');
             memoryManager.processMemoryPipeline.mockRejectedValue(backgroundError);

             // The main function should still succeed
             const result = await chatService.processUserMessage(userId, sessionId, message);
             expect(result).toEqual({ text: mockAiRawData.content });

             // Ensure pipeline was called
             await new Promise(process.nextTick);
             expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2);

             // Check if the error was logged (or handled by handleServiceError which should log)
             // We can't directly test handleServiceError without more complex mocking, 
             // but we can check if the logger was called by the catch block.
             // Note: Direct check on logger might be brittle depending on handleServiceError implementation
             // This relies on the catch block logging before re-throwing (which it shouldn't do here)
             // or handleServiceError logging.
             // Assuming handleServiceError logs:
             // expect(logger._mockChildLogger.error).toHaveBeenCalledWith(expect.stringContaining('background processing'), expect.anything());
             // TODO: Verify logging based on actual handleServiceError behavior
         });
    });
}); 