// src/routes/chat.routes.js
// Chat routes for sending and receiving messages

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All chat routes require authentication
router.use(authMiddleware.verifyToken);

// POST /api/chat - Send a message to AI and get response
router.post('/', chatController.sendMessage);

// GET /api/chat/history - Get chat history for current session
router.get('/history', chatController.getChatHistory);

// POST /api/chat/upload - Upload a file for analysis
router.post('/upload', chatController.uploadFile);

// New async file processing routes
// POST /api/chat/upload/async - Upload a file asynchronously
router.post('/upload/async', chatController.uploadFileAsync);

// GET /api/chat/upload/status/:jobId - Get status of async file processing
router.get('/upload/status/:jobId', chatController.getUploadStatus);

module.exports = router; 