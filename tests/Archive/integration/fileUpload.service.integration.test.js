const dotenv = require('dotenv');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const memoryManager = require('../../src/services/memoryManager.service');

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

// Set NODE_ENV to test *before* importing modules that might check it
process.env.NODE_ENV = 'test';

const fileUploadService = require('../../src/services/fileUpload.service');
const aiService = require('../../src/services/ai.service');
const { prisma, disconnectPrisma } = require('../../src/db/prisma'); 
const MockAIProvider = require('../mocks/MockAIProvider');
const { ServiceError } = require('../../src/utils/errorHandler');
const aiConfig = require('../../config/ai.config'); // Needed for generic doc prompt


describe('FileUpload Service Integration Tests', () => {
    let mockProvider;
    const testUserId = uuidv4();
    let testSessionId; 
    let mockFile; // Declare mockFile here

    // Helper to create mock file object for tests (Ensure this is defined within describe)
    const createMockFile = (filename, mimetype, size = 1024, path = null) => ({
        originalname: filename,
        mimetype: mimetype,
        size: size,
        path: path || `/tmp/test-upload-${uuidv4()}`, // Use unique paths
    });

    beforeAll(async () => {
        // ... (beforeAll setup remains the same)
        if (process.env.NODE_ENV !== 'test') {
            throw new Error('NODE_ENV must be set to test for integration tests.');
        }
        mockProvider = new MockAIProvider();
        aiService.setAIProviderInstanceForTesting(mockProvider); 
        console.log('Using Prisma instance connected to test database defined in .env.test');
        try {
            await prisma.$queryRaw`SELECT 1`; 
            console.log('Test database connection successful.');
            console.log(`Ensuring test user exists: ${testUserId}`);
            await prisma.user.upsert({
                where: { id: testUserId },
                update: {},
                create: {
                    id: testUserId,
                    email: `test-upload-${testUserId}@example.com`,
                    firstName: 'Upload',
                    lastName: 'Test User',
                    passwordHash: 'dummy-hash-for-integration-test-upload',
                }
            });
            console.log('Test user ensured.');
        } catch (err) {
            console.error('Failed to connect to test database or ensure user:', err);
            throw err;
        }
    });

    beforeEach(async () => {
        // ... (beforeEach setup remains the same)
        testSessionId = uuidv4(); 
        console.log(`Using Session ID: ${testSessionId}`);
        console.log('Clearing RawData table...');
        await prisma.rawData.deleteMany({}); 
        console.log('RawData table cleared.');
        mockProvider.clearCalls();
        mockProvider.clearMockFailures();
        jest.spyOn(memoryManager, 'processMemoryPipeline').mockResolvedValue(undefined);
    });

    afterEach(() => {
        // Restore mocks
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        // ... (afterAll cleanup remains the same)
        try {
            if (prisma) {
                console.log(`Deleting RawData for test user: ${testUserId}`);
                await prisma.rawData.deleteMany({ where: { userId: testUserId } });
                console.log('RawData for test user deleted.');
                console.log(`Deleting test user: ${testUserId}`);
                await prisma.user.delete({ where: { id: testUserId } });
                console.log('Test user deleted.');
            }
        } catch (err) {
            console.error('Error cleaning up test data:', err);
        }
        await disconnectPrisma();
        console.log('Test database connection closed.');
    });

    // --- Test Cases ---

    it('should process image upload with message', async () => {
        // Test setup
        const message = "What kind of cat is this?";
        mockFile = createMockFile('cat.jpg', 'image/jpeg'); // Now createMockFile is accessible
        // ... rest of test setup and assertions ...
        const mockImageData = Buffer.from('fake-cat-image-data');
        const expectedAnalysis = 'This appears to be a tabby cat.';
        const expectedFileEventContentType = 'uploaded_file_event';
        const expectedAnalysisContentType = 'image_analysis';

        const readFileSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockImageData);
        const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
        mockProvider.setMockResult('analyzeImage', { success: true, text: expectedAnalysis });

        const result = await fileUploadService.processUploadedFile(testUserId, testSessionId, mockFile, message);

        const records = await prisma.rawData.findMany({ where: { sessionId: testSessionId }, orderBy: { createdAt: 'asc' } });
        expect(records).toHaveLength(2);
        const eventRecord = records[0];
        const analysisRecord = records[1];
        expect(eventRecord.contentType).toBe(expectedFileEventContentType);
        expect(eventRecord.content).toContain(mockFile.originalname);
        expect(eventRecord.metadata.userMessage).toBe(message);
        expect(eventRecord.userId).toBe(testUserId);
        expect(analysisRecord.contentType).toBe(expectedAnalysisContentType);
        expect(analysisRecord.content).toBe(expectedAnalysis);
        expect(analysisRecord.metadata.fileEventRawDataId).toBe(eventRecord.id);
        expect(analysisRecord.userId).toBe(testUserId);

        const analyzeCalls = mockProvider.getCalls('analyzeImage');
        expect(analyzeCalls).toHaveLength(1);
        expect(analyzeCalls[0].userId).toBe(testUserId);
        expect(analyzeCalls[0].sessionId).toBe(testSessionId);
        expect(analyzeCalls[0].mimeType).toBe(mockFile.mimetype);
        expect(analyzeCalls[0].userMessage).toBe(message);
        expect(mockProvider.getCalls('sendMessage')).toHaveLength(0);

        expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2);
        expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: eventRecord.id }));
        expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: analysisRecord.id }));

        expect(readFileSpy).toHaveBeenCalledWith(mockFile.path);
        expect(unlinkSpy).toHaveBeenCalledWith(mockFile.path);

        expect(result).toEqual({
            success: true,
            message: expectedAnalysis,
            fileEventRawDataId: eventRecord.id,
            analysisRawDataId: analysisRecord.id
        });

        readFileSpy.mockRestore();
        unlinkSpy.mockRestore();
    });

    // ... (other successful tests: WITHOUT message, doc WITH message, doc WITHOUT message)
    it('should process image upload WITHOUT message', async () => {
        mockFile = createMockFile('dog.png', 'image/png');
        const mockImageData = Buffer.from('fake-dog-image-data');
        const expectedAnalysis = 'Generic dog analysis.';

        const readFileSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(mockImageData);
        const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
        mockProvider.setMockResult('analyzeImage', { success: true, text: expectedAnalysis });

        const result = await fileUploadService.processUploadedFile(testUserId, testSessionId, mockFile, null); // No message

        const records = await prisma.rawData.findMany({ where: { sessionId: testSessionId }, orderBy: { createdAt: 'asc' } });
        expect(records).toHaveLength(2);
        expect(records[0].contentType).toBe('uploaded_file_event');
        expect(records[1].contentType).toBe('image_analysis');

        const analyzeCalls = mockProvider.getCalls('analyzeImage');
        expect(analyzeCalls).toHaveLength(1);
        expect(analyzeCalls[0].userMessage).toBeNull(); // Check message was null
        expect(mockProvider.getCalls('sendMessage')).toHaveLength(0);

        expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2);
        expect(readFileSpy).toHaveBeenCalledWith(mockFile.path);
        expect(unlinkSpy).toHaveBeenCalledWith(mockFile.path);
        expect(result.success).toBe(true);
        expect(result.message).toBe(expectedAnalysis);

        readFileSpy.mockRestore();
        unlinkSpy.mockRestore();
    });

    it('should process document upload WITH message', async () => {
        const message = "Summarize this meeting notes.";
        mockFile = createMockFile('notes.txt', 'text/plain');
        const mockDocContent = 'Meeting notes content here.';
        const expectedResponse = 'Summary based on notes and query.';
        const expectedAnalysisContentType = 'document_analysis';

        const processFileContentSpy = jest.spyOn(aiService, 'processFileContent').mockResolvedValue({ success: true, text: mockDocContent, isImage: false });
        const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
        mockProvider.setMockResult('sendMessage', { success: true, text: expectedResponse });

        const result = await fileUploadService.processUploadedFile(testUserId, testSessionId, mockFile, message);

        const records = await prisma.rawData.findMany({ where: { sessionId: testSessionId }, orderBy: { createdAt: 'asc' } });
        expect(records).toHaveLength(2);
        expect(records[0].contentType).toBe('uploaded_file_event');
        expect(records[1].contentType).toBe(expectedAnalysisContentType);
        expect(records[1].content).toBe(expectedResponse);

        expect(processFileContentSpy).toHaveBeenCalledWith(mockFile.path);
        const sendCalls = mockProvider.getCalls('sendMessage');
        expect(sendCalls).toHaveLength(1);
        expect(sendCalls[0].message).toBe(message);
        expect(sendCalls[0].options.additionalContext.content).toBe(mockDocContent);
        expect(mockProvider.getCalls('analyzeImage')).toHaveLength(0);

        expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2);
        expect(unlinkSpy).toHaveBeenCalledWith(mockFile.path);
        expect(result.success).toBe(true);
        expect(result.message).toBe(expectedResponse);

        processFileContentSpy.mockRestore(); // Clean up spy
        unlinkSpy.mockRestore();
    });

    it('should process document upload WITHOUT message (generic prompt)', async () => {
        mockFile = createMockFile('report.pdf', 'application/pdf');
        const mockDocContent = 'Very important report content.';
        const expectedResponse = 'Generic summary of the report.';
        const expectedPrompt = aiConfig.defaultDocumentAnalysisPrompt.replace('{DOCUMENT_CONTENT}', mockDocContent);

        const processFileContentSpy = jest.spyOn(aiService, 'processFileContent').mockResolvedValue({ success: true, text: mockDocContent, isImage: false });
        const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
        mockProvider.setMockResult('sendMessage', { success: true, text: expectedResponse });

        const result = await fileUploadService.processUploadedFile(testUserId, testSessionId, mockFile, null);

        const records = await prisma.rawData.findMany({ where: { sessionId: testSessionId }, orderBy: { createdAt: 'asc' } });
        expect(records).toHaveLength(2);
        expect(records[0].contentType).toBe('uploaded_file_event');
        expect(records[1].contentType).toBe('document_analysis');

        expect(processFileContentSpy).toHaveBeenCalledWith(mockFile.path);
        const sendCalls = mockProvider.getCalls('sendMessage');
        expect(sendCalls).toHaveLength(1);
        expect(sendCalls[0].message).toBe(expectedPrompt); 
        expect(sendCalls[0].options).toEqual({}); 
        expect(mockProvider.getCalls('analyzeImage')).toHaveLength(0);

        expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2);
        expect(unlinkSpy).toHaveBeenCalledWith(mockFile.path);
        expect(result.success).toBe(true);
        expect(result.message).toBe(expectedResponse);

        processFileContentSpy.mockRestore();
        unlinkSpy.mockRestore();
    });


    // --- Error Handling Tests (using try/catch, call service ONCE) ---

    it('should handle AI analysis failure', async () => {
        // Test setup
        mockFile = createMockFile('blurry.png', 'image/png');
        const expectedErrorMsg = 'Could not analyze blurry image.';
        mockProvider.setMockFailure('analyzeImage', new Error(expectedErrorMsg));
        const readFileSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('fake-data'));
        const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

        // --- Execute & Assert Error ---
        let caughtError = null;
        try {
             // Call the service function ONCE
             await fileUploadService.processUploadedFile(testUserId, testSessionId, mockFile, 'analyze this');
        } catch (error) {
            caughtError = error; // Catch the error
        }
        // Assertions on the caught error
        expect(caughtError).not.toBeNull(); // Ensure an error was actually caught
        expect(caughtError).toBeInstanceOf(ServiceError); 
        expect(caughtError.message).toContain('Failed to process image file'); // Check wrapped message
        expect(caughtError.message).toContain(expectedErrorMsg); // Check original message inclusion
        expect(caughtError.statusCode).toBe(500);

        // --- Assertions AFTER error ---
        // Check DB - only event record should exist
        const records = await prisma.rawData.findMany({ where: { sessionId: testSessionId } });
        expect(records).toHaveLength(1); // Expect only ONE record 
        expect(records[0].contentType).toBe('uploaded_file_event');

        // Check AI calls
        const analyzeCalls = mockProvider.getCalls('analyzeImage');
        expect(analyzeCalls.length).toBeLessThanOrEqual(1); 
        expect(mockProvider.getCalls('sendMessage')).toHaveLength(0);

        // Check Memory Manager calls (only for the event record after error)
        expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(1);
        if (records.length === 1) { 
             expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: records[0].id }));
        }

        // Check FS calls
        expect(readFileSpy).toHaveBeenCalledWith(mockFile.path);
        expect(unlinkSpy).toHaveBeenCalledWith(mockFile.path); 

        // Restore mocks used in this test
        readFileSpy.mockRestore();
        unlinkSpy.mockRestore();
    });

    it('should handle document processing failure', async () => {
        // Test setup
        mockFile = createMockFile('corrupt.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        const expectedErrorMsg = 'Failed to extract text from corrupt docx.';
        // Mock aiService.processFileContent to fail
        const processFileContentSpy = jest.spyOn(aiService, 'processFileContent').mockRejectedValue(new Error(expectedErrorMsg));
        const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);

         // --- Execute & Assert Error ---
        let caughtError = null;
        try {
            await fileUploadService.processUploadedFile(testUserId, testSessionId, mockFile, 'summarize this');
        } catch (error) {
            caughtError = error;
        }
        expect(caughtError).not.toBeNull();
        expect(caughtError).toBeInstanceOf(ServiceError);
        expect(caughtError.message).toContain('Failed to process document file');
        expect(caughtError.message).toContain(expectedErrorMsg);
        expect(caughtError.statusCode).toBe(500);

         // --- Assertions AFTER error ---
         const records = await prisma.rawData.findMany({ where: { sessionId: testSessionId } });
         expect(records).toHaveLength(1);
         expect(records[0].contentType).toBe('uploaded_file_event');

         expect(processFileContentSpy).toHaveBeenCalledWith(mockFile.path);
         expect(mockProvider.getCalls('sendMessage')).toHaveLength(0);

         // Check Memory Manager calls (only for the event record after error)
         expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(1);
         if (records.length === 1) {
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: records[0].id }));
         }

         expect(unlinkSpy).toHaveBeenCalledWith(mockFile.path);

         // Restore mocks
         processFileContentSpy.mockRestore();
         unlinkSpy.mockRestore();
     });

    it('should handle FS readFile failure', async () => {
        // Test setup
        mockFile = createMockFile('missing.jpg', 'image/jpeg');
        const expectedErrorMsg = 'ENOENT: no such file or directory';
        const readFileSpy = jest.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error(expectedErrorMsg));
        const unlinkSpy = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined); // Should still attempt unlink

         // --- Execute & Assert Error ---
        let caughtError = null;
        try {
            await fileUploadService.processUploadedFile(testUserId, testSessionId, mockFile, 'find this');
        } catch (error) {
            caughtError = error;
        }
        expect(caughtError).not.toBeNull();
        expect(caughtError).toBeInstanceOf(ServiceError);
        expect(caughtError.message).toContain('Failed to process image file');
        expect(caughtError.message).toContain(expectedErrorMsg);
        expect(caughtError.statusCode).toBe(500);

         // --- Assertions AFTER error ---
         const records = await prisma.rawData.findMany({ where: { sessionId: testSessionId } });
         expect(records).toHaveLength(1);
         expect(records[0].contentType).toBe('uploaded_file_event');

         expect(mockProvider.getCalls('analyzeImage')).toHaveLength(0);

         // Check Memory Manager calls (only for the event record after error)
         expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(1);
         if (records.length === 1) {
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith(expect.objectContaining({ id: records[0].id }));
         }

         expect(readFileSpy).toHaveBeenCalledWith(mockFile.path);
         expect(unlinkSpy).toHaveBeenCalledWith(mockFile.path);

         // Restore mocks
         readFileSpy.mockRestore();
         unlinkSpy.mockRestore();
     });

}); // End of describe block 