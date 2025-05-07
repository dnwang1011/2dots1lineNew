const chatController = require('../../src/controllers/chat.controller');
const chatService = require('../../src/services/chat.service');
const fileUploadService = require('../../src/services/fileUpload.service');
const logger = require('../../src/utils/logger');
const { ServiceError } = require('../../src/utils/errorHandler');
const fileUploadMiddleware = require('../../src/middleware/fileUpload.middleware');

// Mock services and utilities
jest.mock('../../src/services/chat.service');
jest.mock('../../src/services/fileUpload.service');
jest.mock('../../src/utils/logger', () => ({
    childLogger: jest.fn().mockReturnThis(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));
// Mock the actual ServiceError class for instanceof checks if needed elsewhere,
// but primarily rely on checking properties from service mocks.
// jest.mock('../../src/utils/errorHandler'); 

// Mock the file upload middleware
jest.mock('../../src/middleware/fileUpload.middleware', () => ({
    // Mock the function called by the controller
    uploadSingleFile: jest.fn((req, res, callback) => {
        // Default: Immediately call the callback simulating success
        // Tests can override this mock implementation for error cases
        callback(null); 
    }),
}));

describe('Chat Controller', () => {
    let mockReq, mockRes, mockNext;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {
            body: {}, // Populated in tests
            params: {},
            file: null, 
            user: { id: 'user-test-id' }, 
            session: {}, // Controller uses session_id from body
        };
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            send: jest.fn(),
        };
        mockNext = jest.fn();
    });

    // --- sendMessage Tests ---
    describe('sendMessage', () => {
        // Test 1: Fix body structure & response check
        it('should call chatService.processUserMessage and return 200 on success', async () => {
            const messageContent = 'Hello there!';
            const sessionId = 'session-123';
            mockReq.body = {
                session_id: sessionId,
                message_type: 'user_chat',
                raw_data: { message: messageContent }
            };
            const serviceResponse = { success: true, text: 'Hi back!' };
            chatService.processUserMessage.mockResolvedValue(serviceResponse);

            await chatController.sendMessage(mockReq, mockRes, mockNext);

            expect(chatService.processUserMessage).toHaveBeenCalledWith(mockReq.user.id, sessionId, messageContent);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                session_id: sessionId,
                response: { text: serviceResponse.text }
            });
            expect(mockNext).not.toHaveBeenCalled();
        });

        // Test 2: Fix body structure
        it('should call next with error if chatService throws ServiceError', async () => {
             const messageContent = 'Test message';
             const sessionId = 'session-err';
             mockReq.body = {
                 session_id: sessionId,
                 message_type: 'user_chat',
                 raw_data: { message: messageContent }
             };
            const serviceError = new ServiceError('Service failure', 503);
            chatService.processUserMessage.mockRejectedValue(serviceError);

            await chatController.sendMessage(mockReq, mockRes, mockNext);

            expect(chatService.processUserMessage).toHaveBeenCalledWith(mockReq.user.id, sessionId, messageContent);
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockRes.json).not.toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalledWith(serviceError);
        });

        // Test 3: Fix body structure
        it('should call next with generic error if chatService throws non-ServiceError', async () => {
             const messageContent = 'Another message';
             const sessionId = 'session-gen-err';
             mockReq.body = {
                 session_id: sessionId,
                 message_type: 'user_chat',
                 raw_data: { message: messageContent }
             };
            const genericError = new Error('Something unexpected happened');
            chatService.processUserMessage.mockRejectedValue(genericError);

            await chatController.sendMessage(mockReq, mockRes, mockNext);

            expect(chatService.processUserMessage).toHaveBeenCalledWith(mockReq.user.id, sessionId, messageContent);
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockRes.json).not.toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalledWith(genericError); 
        });

         // Test 4: Fix assertion message and check for ServiceError
         it('should call next with validation error if required fields are missing', async () => {
             mockReq.body = { raw_data: {} }; 
            await chatController.sendMessage(mockReq, mockRes, mockNext);

            expect(chatService.processUserMessage).not.toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalledWith(expect.any(ServiceError)); // Controller should throw ServiceError
            expect(mockNext.mock.calls[0][0].message).toBe('Missing required fields: session_id, message_type, raw_data.message');
            expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
        });
    });

    // --- uploadFile Tests ---
    describe('uploadFile', () => {
        beforeEach(() => {
            mockReq.body.session_id = 'session-upload-test'; 
            mockReq.file = { 
                originalname: 'test-image.png',
                mimetype: 'image/png',
                size: 1024,
                path: '/tmp/test-image-123' 
            };
            // Reset middleware mock implementation before each upload test
            fileUploadMiddleware.uploadSingleFile.mockImplementation((req, res, callback) => callback(null));
        });

        // Test 5
        it('should call fileUploadService.processUploadedFile and return 200 on success', async () => {
            mockReq.body.message = 'Analyze this image'; 
            const serviceResponse = { success: true, text: 'Image analysis done.' }; // Service returns text
            fileUploadService.processUploadedFile.mockResolvedValue(serviceResponse);

            await chatController.uploadFile(mockReq, mockRes, mockNext); 

            expect(fileUploadMiddleware.uploadSingleFile).toHaveBeenCalled(); 
            expect(fileUploadService.processUploadedFile).toHaveBeenCalledWith(mockReq.user.id, mockReq.body.session_id, mockReq.file, mockReq.body.message);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                aiResponse: { text: serviceResponse.text }
            }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        // Test 6
        it('should call fileUploadService without message if not provided', async () => {
            const serviceResponse = { success: true, text: 'Generic analysis.' };
            fileUploadService.processUploadedFile.mockResolvedValue(serviceResponse);

            await chatController.uploadFile(mockReq, mockRes, mockNext);

            expect(fileUploadMiddleware.uploadSingleFile).toHaveBeenCalled();
            expect(fileUploadService.processUploadedFile).toHaveBeenCalledWith(mockReq.user.id, mockReq.body.session_id, mockReq.file, undefined);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ 
                success: true,
                aiResponse: { text: serviceResponse.text }
             }));
            expect(mockNext).not.toHaveBeenCalled();
        });

        // Test 7
        it('should call next with error if fileUploadService throws ServiceError', async () => {
            const serviceError = new ServiceError('Upload processing failed', 500);
            fileUploadService.processUploadedFile.mockRejectedValue(serviceError);

            await chatController.uploadFile(mockReq, mockRes, mockNext);

            expect(fileUploadMiddleware.uploadSingleFile).toHaveBeenCalled();
            expect(fileUploadService.processUploadedFile).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalledWith(serviceError);
        });

        // Test 8
        it('should call next with error if middleware callback provides error', async () => {
            const middlewareError = new Error('Multer disk error');
            fileUploadMiddleware.uploadSingleFile.mockImplementation((req, res, callback) => {
                callback(middlewareError); 
            });

            await chatController.uploadFile(mockReq, mockRes, mockNext);

            expect(fileUploadMiddleware.uploadSingleFile).toHaveBeenCalled();
            expect(fileUploadService.processUploadedFile).not.toHaveBeenCalled(); 
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalledWith(middlewareError);
        });

        // Test 9 
        it('should call next with validation error if req.file is missing (after middleware)', async () => {
            fileUploadMiddleware.uploadSingleFile.mockImplementation((req, res, callback) => {
                req.file = null; 
                callback(null); 
            });

            await chatController.uploadFile(mockReq, mockRes, mockNext);

            expect(fileUploadMiddleware.uploadSingleFile).toHaveBeenCalled();
            expect(fileUploadService.processUploadedFile).not.toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalledWith(expect.any(ServiceError));
            expect(mockNext.mock.calls[0][0].message).toContain('No file provided or file rejected');
            expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
        });

         // Test 10
         it('should call next with validation error if session_id is missing', async () => {
            mockReq.body.session_id = undefined; 

            await chatController.uploadFile(mockReq, mockRes, mockNext);

            expect(fileUploadMiddleware.uploadSingleFile).toHaveBeenCalled();
            expect(fileUploadService.processUploadedFile).not.toHaveBeenCalled();
            expect(mockNext).toHaveBeenCalledWith(expect.any(ServiceError));
            expect(mockNext.mock.calls[0][0].message).toContain('Session ID is required');
            expect(mockNext.mock.calls[0][0].statusCode).toBe(400);
        });
    });
}); 