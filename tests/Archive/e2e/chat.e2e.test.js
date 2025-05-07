const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// --- Application and DB Setup ---
// We need to import the app *after* setting NODE_ENV potentially
process.env.NODE_ENV = 'test'; // Ensure test environment

const app = require('../../src/index'); // Assuming src/index.js exports the app or starts the server
const { prisma, disconnectPrisma } = require('../../../src/db/prisma');
const setupTestDb = require('../../scripts/setup-test-db'); // Helper to setup db

// --- Mock AI Provider ---
// We still need to mock the AI provider to avoid real calls
const aiService = require('../../../src/services/ai.service');
const MockAIProvider = require('../mocks/MockAIProvider');

// --- Test Data ---
let testUserId;
let testSessionId;
let authToken;
let server; // To hold the server instance for supertest

// --- Helper Functions ---
// Function to get a valid auth token for the test user
const getAuthToken = async (userId) => {
    // This assumes you have an endpoint to log in or a utility to generate tokens.
    // For simplicity, let's assume a direct JWT generation (requires JWT secret)
    const jwt = require('jsonwebtoken');
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET must be set in .env.test for E2E tests');
    }
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

describe('Chat API E2E Tests', () => {

    beforeAll(async () => {
        // 1. Start the server
        // Instead of app.listen, we might need to export the server from index.js
        // Or modify index.js to export app without listening if in test mode.
        // For now, let's assume app is the express instance:
        // server = app.listen(SOME_TEST_PORT); // This might conflict if index.js also listens
        // *** Correction: Supertest works directly with the app instance ***
        // No need to explicitly listen here if index.js handles it or exports app.

        // 2. Setup Test Database & User
        // We need the user ID created by the setup script
        const setupResult = await setupTestDb.runSetup(); // Assuming runSetup returns the created user ID
        testUserId = setupResult.userId;
        if (!testUserId) {
            throw new Error('Failed to get test user ID from setup script');
        }
        console.log(`E2E tests using Test User ID: ${testUserId}`);

        // 3. Get Auth Token
        authToken = await getAuthToken(testUserId);

        // 4. Setup Mock AI Provider
        const mockProvider = new MockAIProvider();
        aiService.setAIProviderInstanceForTesting(mockProvider);

    }, 30000); // Increase timeout for potentially slow setup

    beforeEach(async () => {
        // Reset session ID and clear relevant DB tables for isolation
        testSessionId = uuidv4();
        await prisma.rawData.deleteMany({ where: { userId: testUserId } });

        // Reset mock provider calls/results if needed (handled per test for now)
        aiService.getProvider().clearCalls();
        aiService.getProvider().clearMockFailures();
        aiService.getProvider().setMockResult('sendMessage', { success: true, text: 'Mock AI response' });
        aiService.getProvider().setMockResult('analyzeImage', { success: true, text: 'Mock image analysis' });
        aiService.getProvider().setMockResult('processFileContent', { success: true, text: 'Mock document content', isImage: false });
    });

    afterAll(async () => {
        // Cleanup: Delete user, close DB connection, close server
        try {
            if (testUserId) {
                await prisma.rawData.deleteMany({ where: { userId: testUserId } });
                await prisma.user.delete({ where: { id: testUserId } });
            }
        } catch (err) {
            console.error('E2E afterAll cleanup error:', err);
        }
        await disconnectPrisma();
        // if (server) {
        //     server.close(); // Close server if we started it explicitly
        // }
    });

    // --- Test Cases ---

    describe('POST /api/chat', () => {
        it('should send a message and receive a standardized AI response', async () => {
            const message = 'Hello, this is an E2E test message.';
            const response = await request(app) // Use supertest
                .post('/api/chat')
                .set('Authorization', `Bearer ${authToken}`) // Set auth header
                .send({
                    session_id: testSessionId,
                    message_type: 'text',
                    raw_data: {
                        message: message
                    }
                })
                .expect(200) // Expect HTTP status 200
                .expect('Content-Type', /json/); // Expect JSON response

            // Verify standardized success structure
            expect(response.body).toEqual({
                success: true,
                data: {
                    session_id: testSessionId,
                    text: expect.any(String) // Check for the presence of AI text
                }
            });
            expect(response.body.data.text).toContain('Mock AI'); // Check content from mock

            // Optional: Verify DB records
            const records = await prisma.rawData.findMany({ where: { sessionId: testSessionId } });
            expect(records.length).toBeGreaterThanOrEqual(1); // User message should be there
            // Queue worker runs async, so AI response record might not be instant
        });

        it('should return 400 for missing session_id', async () => {
             const message = 'Another test message.';
            const response = await request(app)
                .post('/api/chat')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ // Missing session_id
                    message_type: 'text',
                    raw_data: {
                        message: message
                    }
                })
                .expect(400)
                .expect('Content-Type', /json/);

            // Verify standardized error structure
            expect(response.body).toEqual({
                success: false,
                error: {
                    code: 'REQUEST_ERROR', // Default code for 4xx
                    message: expect.stringContaining('Missing required fields')
                }
            });
        });

        it('should return 401 for missing auth token', async () => {
            const response = await request(app)
                .post('/api/chat')
                // No Auth Token
                .send({
                    session_id: testSessionId,
                    message_type: 'text',
                    raw_data: { message: 'test' }
                })
                .expect(401)
                .expect('Content-Type', /json/);

            expect(response.body).toEqual({
                success: false,
                error: {
                    code: 'REQUEST_ERROR', // Default code for 4xx
                    message: 'No token provided' // Assuming this is the auth middleware message
                }
            });
        });
    });

    describe('POST /api/chat/upload', () => {
        const testFilePath = path.join(__dirname, 'test-image.png');
        const testDocumentPath = path.join(__dirname, 'test-document.pdf');

        beforeAll(() => {
            // Create dummy files for upload tests
            fs.writeFileSync(testFilePath, 'dummy image data');
            fs.writeFileSync(testDocumentPath, 'dummy document content');
        });

        afterAll(() => {
            // Clean up the dummy files
            fs.unlinkSync(testFilePath);
            fs.unlinkSync(testDocumentPath);
        });

        it('should upload an image with a message and receive a standardized response', async () => {
            const message = 'Analyze this test image';
            const response = await request(app)
                .post('/api/chat/upload')
                .set('Authorization', `Bearer ${authToken}`)
                .field('session_id', testSessionId)
                .field('message', message)
                .attach('file', testFilePath) // Attach the dummy file
                .expect(200)
                .expect('Content-Type', /json/);

            expect(response.body).toEqual({
                success: true,
                data: {
                    message: 'File processed successfully',
                    fileInfo: {
                        originalname: 'test-image.png',
                        mimetype: 'image/png', // Supertest infers this
                        size: 16 // Size of "dummy image data"
                    },
                    analysisText: 'Mock image analysis' // From mock AI provider
                }
            });

             // Optional: Verify DB records (File event should exist)
             const records = await prisma.rawData.findMany({
                where: { sessionId: testSessionId, contentType: 'uploaded_file_event' }
            });
            expect(records.length).toBe(1);
            expect(records[0].metadata?.originalFilename).toBe('test-image.png');
        });

        it('should upload a document with a message and receive a standardized response', async () => {
            const message = 'Analyze this test document';
            const response = await request(app)
                .post('/api/chat/upload')
                .set('Authorization', `Bearer ${authToken}`)
                .field('session_id', testSessionId)
                .field('message', message)
                .attach('file', testDocumentPath) // Attach the dummy document
                .expect(200)
                .expect('Content-Type', /json/);

            expect(response.body).toEqual({
                success: true,
                data: {
                    message: 'File processed successfully',
                    fileInfo: {
                        originalname: 'test-document.pdf',
                        mimetype: 'application/pdf', // Supertest infers this
                        size: expect.any(Number)
                    },
                    analysisText: 'Mock document content' // From mock AI provider
                }
            });

            // Verify DB records (Document event should exist)
            const records = await prisma.rawData.findMany({
                where: { sessionId: testSessionId, contentType: 'uploaded_file_event' }
            });
            expect(records.length).toBe(2); // Previous image test + this document
            expect(records.some(record => record.metadata?.originalFilename === 'test-document.pdf')).toBe(true);
        });

        it('should return 400 if no file is attached', async () => {
            const response = await request(app)
                .post('/api/chat/upload')
                .set('Authorization', `Bearer ${authToken}`)
                .field('session_id', testSessionId)
                // No file attached
                .expect(400)
                .expect('Content-Type', /json/);

            expect(response.body).toEqual({
                success: false,
                error: {
                    code: 'REQUEST_ERROR',
                    message: 'No file provided or file rejected by filter.'
                }
            });
        });

        it('should return 400 if session_id is missing', async () => {
            const response = await request(app)
                .post('/api/chat/upload')
                .set('Authorization', `Bearer ${authToken}`)
                .attach('file', testFilePath)
                // No session_id field
                .expect(400)
                .expect('Content-Type', /json/);

            expect(response.body).toEqual({
                success: false,
                error: {
                    code: 'REQUEST_ERROR',
                    message: expect.stringContaining('Session ID is required')
                }
            });
        });
    });

    describe('GET /api/chat/history', () => {
        beforeEach(async () => {
            // Seed some messages for history tests
            const userMessage1 = 'Test user message 1';
            const aiResponse1 = 'Test AI response 1';
            const userMessage2 = 'Test user message 2';
            const aiResponse2 = 'Test AI response 2';
            
            // Create RawData entries directly via repository or DAL
            await prisma.rawData.createMany({
                data: [
                    {
                        userId: testUserId,
                        sessionId: testSessionId,
                        contentType: 'user_chat',
                        content: userMessage1,
                        createdAt: new Date(Date.now() - 4000) // 4 seconds ago
                    },
                    {
                        userId: testUserId,
                        sessionId: testSessionId,
                        contentType: 'ai_response',
                        content: aiResponse1,
                        createdAt: new Date(Date.now() - 3000) // 3 seconds ago
                    },
                    {
                        userId: testUserId,
                        sessionId: testSessionId,
                        contentType: 'user_chat',
                        content: userMessage2,
                        createdAt: new Date(Date.now() - 2000) // 2 seconds ago
                    },
                    {
                        userId: testUserId,
                        sessionId: testSessionId,
                        contentType: 'ai_response',
                        content: aiResponse2,
                        createdAt: new Date(Date.now() - 1000) // 1 second ago
                    }
                ]
            });
        });
        
        it('should retrieve chat history for a valid session_id', async () => {
            const response = await request(app)
                .get(`/api/chat/history?session_id=${testSessionId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect('Content-Type', /json/);
                
            // Verify the standardized response structure
            expect(response.body).toEqual({
                success: true,
                data: {
                    session_id: testSessionId,
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            role: 'user',
                            content: expect.any(String),
                            timestamp: expect.any(String)
                        }),
                        expect.objectContaining({
                            role: 'ai',
                            content: expect.any(String),
                            timestamp: expect.any(String)
                        })
                    ])
                }
            });
            
            // Verify message count and order
            expect(response.body.data.messages.length).toBe(4);
            
            // Check chronological order
            const timestamps = response.body.data.messages.map(msg => new Date(msg.timestamp).getTime());
            for (let i = 1; i < timestamps.length; i++) {
                expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i-1]);
            }
            
            // Verify content
            const userMessages = response.body.data.messages.filter(msg => msg.role === 'user');
            const aiMessages = response.body.data.messages.filter(msg => msg.role === 'ai');
            expect(userMessages.length).toBe(2);
            expect(aiMessages.length).toBe(2);
        });
        
        it('should return 400 if session_id is missing', async () => {
            const response = await request(app)
                .get('/api/chat/history') // No session_id query param
                .set('Authorization', `Bearer ${authToken}`)
                .expect(400)
                .expect('Content-Type', /json/);
                
            expect(response.body).toEqual({
                success: false,
                error: {
                    code: 'REQUEST_ERROR',
                    message: expect.stringContaining('Session ID is required')
                }
            });
        });
        
        it('should return empty messages array for non-existent session', async () => {
            const nonExistentSessionId = uuidv4();
            const response = await request(app)
                .get(`/api/chat/history?session_id=${nonExistentSessionId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect('Content-Type', /json/);
                
            expect(response.body).toEqual({
                success: true,
                data: {
                    session_id: nonExistentSessionId,
                    messages: [] // Empty array for non-existent session
                }
            });
        });
        
        it('should return 401 for missing auth token', async () => {
            const response = await request(app)
                .get(`/api/chat/history?session_id=${testSessionId}`)
                // No auth token
                .expect(401)
                .expect('Content-Type', /json/);
                
            expect(response.body).toEqual({
                success: false,
                error: {
                    code: 'REQUEST_ERROR',
                    message: expect.stringContaining('No token provided')
                }
            });
        });
    });

    describe('POST /api/chat/upload/async', () => {
        const testFilePath = path.join(__dirname, 'test-async-image.png');

        beforeAll(() => {
            // Create a dummy file for async upload tests
            fs.writeFileSync(testFilePath, 'dummy async image data');
        });

        afterAll(() => {
            // Clean up the dummy file
            fs.unlinkSync(testFilePath);
        });

        it('should accept an async file upload and return a job ID with 202 status', async () => {
            const message = 'Analyze this asynchronously';
            const response = await request(app)
                .post('/api/chat/upload/async')
                .set('Authorization', `Bearer ${authToken}`)
                .field('session_id', testSessionId)
                .field('message', message)
                .attach('file', testFilePath)
                .expect(202) // Expect 202 Accepted
                .expect('Content-Type', /json/);

            // Verify standardized response with job ID
            expect(response.body).toEqual({
                success: true,
                data: {
                    message: 'File upload accepted for processing',
                    jobId: expect.any(String),
                    status: 'PENDING',
                    statusUrl: expect.stringMatching(/\/api\/chat\/upload\/status\/[a-f0-9-]+/)
                }
            });

            // Store job ID for status check test
            const jobId = response.body.data.jobId;

            // Verify job record exists
            const job = await prisma.fileUploadJob.findUnique({
                where: { id: jobId }
            });
            expect(job).toBeTruthy();
            expect(job.status).toBe('PENDING');
            expect(job.userId).toBe(testUserId);
            expect(job.sessionId).toBe(testSessionId);
            
            // Optional: Wait briefly for job to start processing
            // This part is a bit tricky in testing as the job processes asynchronously
            // In a real test, we might mock the processor or add a timeout
            // For simplicity, we'll just wait a small amount of time
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check job status (it may or may not have changed depending on timing)
            const updatedJob = await prisma.fileUploadJob.findUnique({
                where: { id: jobId }
            });
            console.log(`Job status after waiting: ${updatedJob.status}`);
            
            // Now try the status endpoint
            const statusResponse = await request(app)
                .get(`/api/chat/upload/status/${jobId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200)
                .expect('Content-Type', /json/);
                
            // Verify status response
            expect(statusResponse.body).toEqual({
                success: true,
                data: {
                    jobId,
                    status: expect.stringMatching(/^(PENDING|PROCESSING|COMPLETED|FAILED)$/),
                    fileInfo: {
                        originalname: 'test-async-image.png',
                        mimetype: 'image/png',
                        size: expect.any(Number)
                    },
                    createdAt: expect.any(String)
                }
            });
            
            // If job completed, verify it has results
            if (statusResponse.body.data.status === 'COMPLETED') {
                expect(statusResponse.body.data.result).toBeTruthy();
                expect(statusResponse.body.data.result.analysisText).toBeTruthy();
            }
        });
        
        it('should return 401 for unauthorized access to job status', async () => {
            // Create a job for a different user
            const jobId = 'unauthorized-test-job-id';
            
            // Mock a job record that belongs to different userId
            await prisma.fileUploadJob.create({
                data: {
                    id: jobId,
                    userId: 'different-user-id',
                    sessionId: 'different-session-id',
                    filename: 'test.png',
                    filePath: '/tmp/test.png',
                    fileSize: 100,
                    mimeType: 'image/png',
                    status: 'PENDING'
                }
            });
            
            // Try to access with current authToken (different userId)
            const response = await request(app)
                .get(`/api/chat/upload/status/${jobId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(403) // Unauthorized access to someone else's job
                .expect('Content-Type', /json/);
                
            expect(response.body.success).toBe(false);
            expect(response.body.error.message).toContain('Unauthorized');
            
            // Clean up
            await prisma.fileUploadJob.delete({
                where: { id: jobId }
            });
        });
    });
}); 