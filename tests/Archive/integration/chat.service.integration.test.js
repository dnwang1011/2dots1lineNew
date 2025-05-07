const dotenv = require('dotenv');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const memoryManager = require('../../../src/services/memoryManager.service');

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

// Set NODE_ENV to test *before* importing modules that might check it
process.env.NODE_ENV = 'test';

const chatService = require('../../../src/services/chat.service');
const aiService = require('../../../src/services/ai.service');
// Import prisma instance and disconnect function directly
const { prisma, disconnectPrisma } = require('../../../src/db/prisma'); 
const rawDataRepository = require('../../../src/repositories/rawData.repository'); 
const MockAIProvider = require('../mocks/MockAIProvider');
// Import ServiceError for the error test assertion
const { ServiceError } = require('../../../src/utils/errorHandler');

describe('Chat Service Integration Tests', () => {
    let mockProvider;
    const testUserId = uuidv4();
    const testSessionId = uuidv4();

    beforeAll(async () => {
        // Ensure NODE_ENV is test (redundant but safe)
        if (process.env.NODE_ENV !== 'test') {
            throw new Error('NODE_ENV must be set to test for integration tests.');
        }

        // Initialize AI Service with Mock Provider
        mockProvider = new MockAIProvider();
        aiService.setAIProviderInstanceForTesting(mockProvider); 

        // Prisma is already initialized by the import, just log
        console.log('Using Prisma instance connected to test database defined in .env.test');
        // Optional: Ping DB to ensure connection
        try {
            // Use the imported prisma instance
            await prisma.$queryRaw`SELECT 1`; 
            console.log('Test database connection successful.');

            // Ensure the test user exists
            console.log(`Ensuring test user exists: ${testUserId}`);
            await prisma.user.upsert({
                where: { id: testUserId },
                update: {}, // No update needed if exists
                create: {
                    id: testUserId,
                    email: `test-user-${testUserId}@example.com`, // Dummy email
                    firstName: 'Integration', // Use firstName
                    lastName: 'Test User', // Use lastName
                    passwordHash: 'dummy-hash-for-integration-test', // Add dummy hash
                    // Add other required fields for User model if any
                }
            });
            console.log('Test user ensured.');

        } catch (err) {
            console.error('Failed to connect to test database or ensure user:', err);
            throw err;
        }
    });

    beforeEach(async () => {
        // Clear relevant tables before each test
        console.log('Clearing RawData table...');
        // Use the imported prisma instance
        await prisma.rawData.deleteMany({}); 
        console.log('RawData table cleared.');

        // Reset mock provider calls and failures
        mockProvider.clearCalls();
        mockProvider.clearMockFailures();

        // Mock memoryManager pipeline to prevent background errors/side effects
        jest.spyOn(memoryManager, 'processMemoryPipeline').mockResolvedValue(undefined);
    });

    afterEach(() => {
        // Restore mocks created with spyOn
        memoryManager.processMemoryPipeline.mockRestore();
    });

    afterAll(async () => {
        // Delete the test user before disconnecting
        try {
            // Delete dependent RawData records first
            if (prisma) {
                console.log(`Deleting RawData for test user: ${testUserId}`);
                await prisma.rawData.deleteMany({ where: { userId: testUserId } });
                console.log('RawData for test user deleted.');
            }
            if (prisma) { // Ensure prisma is available
                console.log(`Deleting test user: ${testUserId}`);
                await prisma.user.delete({ where: { id: testUserId } });
                console.log('Test user deleted.');
            }
        } catch (err) {
            // Log error but don't prevent disconnect
            console.error('Error deleting test user:', err);
        }

        // Use the exported disconnect function
        await disconnectPrisma();
        console.log('Test database connection closed.');
    });

    describe('processUserMessage', () => {
        it('should record user message, call AI, record AI response, and trigger memory pipeline', async () => {
            const userMessage = 'Hello AI, this is an integration test.';
            const aiResponseText = 'Acknowledged, integration test message received.';

            // Configure mock AI response
            mockProvider.setMockResult('sendMessage', { success: true, text: aiResponseText });

            // --- Execute --- 
            const result = await chatService.processUserMessage(testUserId, testSessionId, userMessage);

            // --- Assertions --- 

            // 1. AI Service call
            const aiCalls = mockProvider.getCalls('sendMessage');
            expect(aiCalls).toHaveLength(1);
            expect(aiCalls[0]).toEqual({
                userId: testUserId,
                sessionId: testSessionId,
                message: userMessage,
                options: {}
            });

            // 2. Database Records 
            const rawDataRecords = await prisma.rawData.findMany({
                where: { userId: testUserId, sessionId: testSessionId },
                orderBy: { createdAt: 'asc' }
            });
            expect(rawDataRecords).toHaveLength(2);

            // Check user message record
            const userRecord = rawDataRecords[0];
            expect(userRecord.contentType).toBe('user_chat');
            expect(userRecord.content).toBe(userMessage);
            expect(userRecord.userId).toBe(testUserId);
            expect(userRecord.sessionId).toBe(testSessionId);
            expect(userRecord.processingStatus).toBe('pending'); // Check actual default status

            // Check AI response record
            const aiRecord = rawDataRecords[1];
            expect(aiRecord.contentType).toBe('ai_response');
            expect(aiRecord.content).toBe(aiResponseText);
            expect(aiRecord.userId).toBe(testUserId);
            expect(aiRecord.sessionId).toBe(testSessionId);
            expect(aiRecord.processingStatus).toBe('pending'); // Check actual default status

            // 3. Memory Pipeline Trigger (We need to mock memoryManager.processMemoryPipeline for this)
            // Since memoryManager is complex, let's just mock its trigger method for this test.
            // We'll need to adjust imports and setup if we do this.
            // For now, we'll skip this assertion, assuming unit tests cover the trigger.
            // expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2);

            // 4. Return value
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
            expect(result.text).toBe(aiResponseText);
            expect(result.userRawDataId).toBe(userRecord.id);
            expect(result.aiRawDataId).toBe(aiRecord.id);

            // Ensure memory pipeline was triggered (mocked)
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2);
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: userRecord.id }));
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: aiRecord.id }));
        });

        it('should handle AI service failure gracefully', async () => {
            const userMessage = 'Test AI failure path.';
            const aiFailureError = new Error('AI service unavailable');

            // Configure mock AI failure
            mockProvider.setMockFailure('sendMessage', aiFailureError);
            // Mock memoryManager.processMemoryPipeline to avoid side effects in failure test
            // const memoryManager = require('../../src/services/memoryManager.service'); // No longer need this require here
            // jest.spyOn(memoryManager, 'processMemoryPipeline').mockResolvedValue(undefined); // Moved to beforeEach

            // --- Execute & Assert Error ---
            // Assert that the service call rejects with a ServiceError containing the original message
            await expect(chatService.processUserMessage(testUserId, testSessionId, userMessage))
                .rejects.toThrow(ServiceError);

            // --- Assertions --- 

            // 1. AI Service call
            const aiCalls = mockProvider.getCalls('sendMessage');
            // IMPORTANT: Since the call rejects, the mock might register the call initiation.
            // Depending on mock implementation detail, it might be 1 or 0 if error happens before registration.
            // MockAIProvider registers calls immediately, so it should be 1.
            expect(aiCalls).toHaveLength(1); 

            // 2. Database Records (Only user message should exist - use imported prisma)
            const rawDataRecords = await prisma.rawData.findMany({
                where: { userId: testUserId, sessionId: testSessionId }
            });
            expect(rawDataRecords).toHaveLength(1);
            expect(rawDataRecords[0].contentType).toBe('user_chat');
            expect(rawDataRecords[0].content).toBe(userMessage);
            
            // 3. Memory Pipeline Trigger (Should be called once for the user message - mocked)
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(1);
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: rawDataRecords[0].id }));

             // Restore memoryManager mock
             // memoryManager.processMemoryPipeline.mockRestore(); // Moved to afterEach
        });

        // Add more integration tests: e.g., repository failures (might need to mock repo methods 
        // within the test, which blurs line with unit tests), different message types, etc.
    });
}); 