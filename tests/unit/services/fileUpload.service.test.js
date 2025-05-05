const fileUploadService = require('../../src/services/fileUpload.service');
const rawDataRepository = require('../../src/repositories/rawData.repository');
const memoryManager = require('../../src/services/memoryManager.service');
const aiService = require('../../src/services/ai.service');
const fileUploadMiddleware = require('../../src/middleware/fileUpload.middleware');
const logger = require('../../src/utils/logger');
const memoryConfig = require('../../config/memory.config');
const aiConfig = require('../../config/ai.config');
const fs = require('fs');
// Import the ACTUAL ServiceError for instanceof checks, and the module for mocking handleServiceError if needed
const { ServiceError: ActualServiceError } = jest.requireActual('../../src/utils/errorHandler');
const errorHandler = require('../../src/utils/errorHandler');

// Mock dependencies
jest.mock('../../src/repositories/rawData.repository');
jest.mock('../../src/services/memoryManager.service', () => ({
    processMemoryPipeline: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/services/ai.service', () => ({
    analyzeImage: jest.fn(),
    processFileContent: jest.fn(),
    sendMessage: jest.fn(),
}));
jest.mock('../../src/middleware/fileUpload.middleware', () => ({
    allowedMimeTypes: {
        image: ['image/jpeg', 'image/png'],
        document: ['application/pdf', 'text/plain'],
    },
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
            if (name === 'FileUploadService') {
                return childLoggerMock;
            }
            return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        }),
        _mockChildLogger: childLoggerMock,
    };
});
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        unlink: jest.fn().mockResolvedValue(undefined),
    },
    existsSync: jest.fn().mockReturnValue(true),
    constants: jest.requireActual('fs').constants 
}));
// Mock consolidationAgent if it's used
jest.mock('../../src/services/consolidationAgent', () => ({
    processOrphanChunks: jest.fn(),
}), { virtual: true });

describe('FileUpload Service', () => {
    let userId, sessionId, mockFile, mockAccompanyingMessage;
    let mockFileEventRawData, mockDocContentRawData, mockAnalysisRawData;

    beforeEach(() => {
        jest.clearAllMocks();

        userId = 'user-upload-1';
        sessionId = 'session-upload-1';
        mockAccompanyingMessage = 'Analyze this file please.';

        // Common mock raw data IDs
        mockFileEventRawData = { id: 'raw-event-1' };
        mockDocContentRawData = { id: 'raw-doc-content-1' };
        mockAnalysisRawData = { id: 'raw-analysis-1' };

        // Default mock implementations for dependencies
        rawDataRepository.create.mockImplementation(async (data) => {
            if (data.contentType === 'uploaded_file_event') return { ...mockFileEventRawData, ...data };
            if (data.contentType === 'uploaded_document_content') return { ...mockDocContentRawData, ...data };
            if (data.contentType === 'ai_response') return { ...mockAnalysisRawData, ...data };
            return { id: `other_${Math.random()}`, ...data };
        });
        aiService.analyzeImage.mockResolvedValue({ success: true, text: 'Image analysis result.' });
        aiService.processFileContent.mockResolvedValue({ success: true, text: 'Document text content.', isImage: false });
        aiService.sendMessage.mockResolvedValue({ success: true, text: 'AI response based on doc.' });
        fs.promises.readFile.mockResolvedValue(Buffer.from('fake file data'));
        fs.promises.unlink.mockResolvedValue(undefined);
    });

    // Helper function
    const createMockFile = (filename, mimetype, size = 1024, path = null) => ({
        filename: filename, // Keep filename for potential use?
        originalname: filename, // Use filename as originalname for consistency in tests
        mimetype: mimetype,
        size: size,
        // Use provided path or default temp path structure
        path: path || `/tmp/${filename.split('.')[0]}`, 
    });

    describe('processUploadedFile', () => {
        it('should process an image upload with an accompanying message', async () => {
            userId = 'user-upload-1';
            sessionId = 'session-upload-1';
            message = 'Analyze this file please.';
            mockFile = createMockFile('cat-photo.png', 'image/png');
            const expectedAnalysis = 'Specific image analysis based on message.';
            aiService.analyzeImage.mockResolvedValue({ success: true, text: expectedAnalysis });
            const expectedFileEventId = 'raw-event-1';
            const expectedAnalysisId = 'raw-analysis-1';
            rawDataRepository.create
                .mockResolvedValueOnce({ id: expectedFileEventId }) // Mock return for event
                .mockResolvedValueOnce({ id: expectedAnalysisId }); // Mock return for analysis

            const result = await fileUploadService.processUploadedFile(userId, sessionId, mockFile, message);

            // 1. Record file event (check relevant fields, ignore importanceScore)
            expect(rawDataRepository.create).toHaveBeenCalledWith(expect.objectContaining({
                contentType: 'uploaded_file_event',
                userId: userId,
                content: expect.stringContaining(mockFile.originalname),
                metadata: expect.objectContaining({ userMessage: message })
            }));
            // 2. Read image file
            expect(fs.promises.readFile).toHaveBeenCalledWith(mockFile.path);
            // 3. Call AI analyzeImage
            expect(aiService.analyzeImage).toHaveBeenCalledWith(userId, sessionId, expect.any(String), mockFile.mimetype, message);
            // 4. Record AI analysis result
            expect(rawDataRepository.create).toHaveBeenCalledWith(expect.objectContaining({
                contentType: 'image_analysis',
                userId: userId,
                content: expectedAnalysis,
                metadata: expect.objectContaining({ fileEventRawDataId: expectedFileEventId })
            }));
            // 5. Trigger memory processing twice
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(2);
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith({ id: expectedFileEventId });
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledWith({ id: expectedAnalysisId });
            // 6. Check return value
            expect(result).toEqual({ success: true, message: expectedAnalysis, fileEventRawDataId: expectedFileEventId, analysisRawDataId: expectedAnalysisId });
            // 7. Check unlink
            expect(fs.promises.unlink).toHaveBeenCalledWith(mockFile.path);
        });

        it('should process an image upload without an accompanying message (generic analysis)', async () => {
            userId = 'user-img-no-msg';
            sessionId = 'session-img-no-msg';
            mockFile = createMockFile('dog.jpeg', 'image/jpeg');
            const genericAnalysis = 'Generic image analysis.';
            aiService.analyzeImage.mockResolvedValue({ success: true, text: genericAnalysis });
            rawDataRepository.create.mockResolvedValue({ id: 'some-id' }); // Simplified return

            await fileUploadService.processUploadedFile(userId, sessionId, mockFile, null); // No message

            // Check analyzeImage call specifically for null message
            expect(aiService.analyzeImage).toHaveBeenCalledWith(
                userId, 
                sessionId, 
                expect.any(String), // base64 data
                mockFile.mimetype, 
                null // Ensure message is null
            );
             expect(rawDataRepository.create).toHaveBeenCalledTimes(2); // Event + AI Response
             expect(fs.promises.unlink).toHaveBeenCalledWith(mockFile.path);
        });

        it('should process a document upload with an accompanying message', async () => {
            userId = 'user-doc-msg';
            sessionId = 'session-doc-msg';
            message = 'Summarize this document.';
            mockFile = createMockFile('notes.txt', 'text/plain');
            const docContent = 'These are notes from the meeting.';
            const aiSummary = 'Summary based on notes and query.';
            aiService.processFileContent.mockResolvedValue({ success: true, text: docContent });
            aiService.sendMessage.mockResolvedValue({ success: true, text: aiSummary });
            rawDataRepository.create.mockResolvedValue({ id: 'some-id' });

            await fileUploadService.processUploadedFile(userId, sessionId, mockFile, message);

            // Check processFileContent call uses path
            expect(aiService.processFileContent).toHaveBeenCalledWith(mockFile.path); 
            expect(aiService.analyzeImage).not.toHaveBeenCalled();
            
            // Check sendMessage call
            expect(aiService.sendMessage).toHaveBeenCalledWith(userId, sessionId, message, expect.objectContaining({ 
                additionalContext: { type: 'document', content: docContent }
             }));
             expect(rawDataRepository.create).toHaveBeenCalledTimes(2); // Event + AI Response
             expect(fs.promises.unlink).toHaveBeenCalledWith(mockFile.path);
        });

        it('should process a document upload without an accompanying message (generic summary)', async () => {
            userId = 'user-doc-no-msg';
            sessionId = 'session-doc-no-msg';
            mockFile = createMockFile('report.pdf', 'application/pdf');
            const docContent = 'Report details.';
            const genericSummary = 'Generic summary of report.';
            aiService.processFileContent.mockResolvedValue({ success: true, text: docContent });
            aiService.sendMessage.mockResolvedValue({ success: true, text: genericSummary });
            // Mock config for the generic prompt
            aiConfig.defaultDocumentAnalysisPrompt = 'Summarize: {DOCUMENT_CONTENT}';
            const expectedPrompt = `Summarize: ${docContent}`;
            rawDataRepository.create.mockResolvedValue({ id: 'some-id' });

            await fileUploadService.processUploadedFile(userId, sessionId, mockFile, null); // No message

            expect(aiService.processFileContent).toHaveBeenCalledWith(mockFile.path); // Check path
            // Check generic prompt call
            expect(aiService.sendMessage).toHaveBeenCalledWith(userId, sessionId, expectedPrompt); // Check the exact prompt used
            expect(rawDataRepository.create).toHaveBeenCalledTimes(2); // Event + AI Response
            expect(fs.promises.unlink).toHaveBeenCalledWith(mockFile.path);
        });

        it('should throw ServiceError if file object is missing', async () => {
            await expect(fileUploadService.processUploadedFile(userId, sessionId, null, mockAccompanyingMessage))
                .rejects.toThrow(ActualServiceError);
            await expect(fileUploadService.processUploadedFile(userId, sessionId, null, mockAccompanyingMessage))
                .rejects.toHaveProperty('message', 'No file provided for upload.');
        });

        it('should throw ServiceError if reading image file fails', async () => {
             userId = 'user-read-fail';
             sessionId = 'session-read-fail';
             mockFile = createMockFile('corrupt.gif', 'image/gif');
             const readError = new Error('EACCES: permission denied');
             fs.promises.readFile.mockRejectedValueOnce(readError);
 
             try {
                await fileUploadService.processUploadedFile(userId, sessionId, mockFile, 'test');
                throw new Error('Expected function to throw');
             } catch (error) {
                 expect(error.name).toBe('ServiceError');
                 expect(error.statusCode).toBe(500); 
                 expect(error.message).toContain('Failed to process image file');
             }
 
             // Ensure only file event was recorded
             expect(rawDataRepository.create).toHaveBeenCalledTimes(1);
             expect(rawDataRepository.create).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'uploaded_file_event' }));
             expect(aiService.analyzeImage).not.toHaveBeenCalled();
             expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(1); // Only called for event
             expect(fs.promises.unlink).toHaveBeenCalledWith(mockFile.path); // Should still attempt unlink
         });
 
        it('should throw ServiceError if processing document content fails', async () => {
             userId = 'user-proc-fail';
             sessionId = 'session-proc-fail';
             mockFile = createMockFile('locked.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
             const processErrorMsg = 'Could not open document.';
             aiService.processFileContent.mockResolvedValueOnce({ success: false, error: processErrorMsg });
 
             try {
                 await fileUploadService.processUploadedFile(userId, sessionId, mockFile, 'test');
                  throw new Error('Expected function to throw');
             } catch (error) {
                  expect(error.name).toBe('ServiceError');
                  expect(error.statusCode).toBe(500);
                  // Check the message generated by the inner catch block wrapping the original error
                  expect(error.message).toContain(`Failed to process document file: ${processErrorMsg}`);
             }
 
             expect(rawDataRepository.create).toHaveBeenCalledTimes(1); // Only event
             expect(aiService.sendMessage).not.toHaveBeenCalled();
             expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(1); // Only called for event
             expect(fs.promises.unlink).toHaveBeenCalledWith(mockFile.path);
         });
 
        it('should return error from AI service if analysis fails', async () => {
             userId = 'user-ai-fail';
             sessionId = 'session-ai-fail';
             mockFile = createMockFile('weird.png', 'image/png');
             const aiErrorMsg = 'Unsuitable content detected';
             aiService.analyzeImage.mockResolvedValueOnce({ success: false, error: aiErrorMsg });
 
             try {
                  await fileUploadService.processUploadedFile(userId, sessionId, mockFile, 'test');
                  throw new Error('Expected function to throw');
             } catch (error) {
                 expect(error.name).toBe('ServiceError');
                 expect(error.statusCode).toBe(500);
                 // This error comes from the check *after* the image/doc branches
                 // The handleServiceError wraps the original error string
                 expect(error.message).toBe(aiErrorMsg); 
             }

            expect(rawDataRepository.create).toHaveBeenCalledTimes(1); // Only event
            expect(memoryManager.processMemoryPipeline).toHaveBeenCalledTimes(1); // Only called for event
            expect(fs.promises.unlink).toHaveBeenCalledWith(mockFile.path);
         });
    });
}); 