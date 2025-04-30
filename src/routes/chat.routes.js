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

module.exports = router; 