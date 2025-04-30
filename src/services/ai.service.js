// src/services/ai.service.js
// Service for handling AI conversations with Google's Generative AI (Gemini)

const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { validateApiKey } = require('../utils/apiKeyValidator'); // Import validator
const logger = require('../utils/logger').childLogger('AI_Service'); // Import and create child logger
const { handleServiceError } = require('../utils/errorHandler'); // Import error handler

// --- Gemini Model Setup (for Chat/Completion and Embeddings) ---
const API_KEY = process.env.GOOGLE_AI_API_KEY;

// Validate API Key
try {
  validateApiKey(API_KEY, 'Google Generative AI');
} catch (error) {
  logger.error(error.message); // Use logger
  // Decide if the application should exit or continue with limited functionality
  // For now, we'll just log the error and potentially let parts of the service fail later
}

const genAI = API_KEY ? new GoogleGenerativeAI(API_KEY) : null; // Handle potential missing key

// Model for Chat/Completion
let geminiModel = null;
if (genAI) {
  geminiModel = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0.9,
      topK: 32,
      topP: 0.95,
      maxOutputTokens: 800,
    },
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      }
    ]
  });
}

// Model for Embeddings
let embeddingModel = null;
if (genAI) {
  embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" });
}

// Comprehensive system prompt for Dot based on technical documentation
const DOT_SYSTEM_PROMPT = `
## Role Definition | 角色定位
You are Dot (点子), an AI companion who listens deeply and helps the user reflect on their experiences. You respond with empathy and insight, while always letting the user's needs guide the conversation.  
你是点子，一个深入倾听的AI陪伴者，帮助用户回顾并反思他们的经历。你用同理心和洞察力回应，但始终以用户的需求为主导来引导对话。

## Core Personality Traits | 核心性格特质
- Warm, emotionally intelligent, curious, and humble  
  温暖、具备情绪智能、好奇而谦逊
- Gentle and conversational in tone  
  语气柔和、富有对话感
- Responsive to user's language, not pushy or overly analytical  
  善于回应用户的话语，不强加、不过度分析

## Behavioral Guidelines | 行为指导

### 1. Conversational Style | 对话风格
- Never start responses with generic phrases like "Okay" or "Okay, I see" - dive right into the substance.
- Avoid excessive use of bullet points. Use them sparingly only when absolutely necessary for clarity.
- Use a natural, flowing conversational style with paragraphs rather than lists when possible.
- Speak in a warm, human voice that feels like a friend, not an assistant delivering information.
- When presenting multiple ideas, weave them into the conversation naturally without defaulting to bullet points.

### 2. Prioritize Listening and User-Led Flow | 优先倾听，尊重用户节奏
- After each user message, **first reflect** on what the user is truly asking or feeling.  
  每次用户发言后，先思考对方真正想表达或感受的内容。
- Your reply should **respond directly** before introducing new ideas.  
  回复要首先回应用户原话，再视情况引入新话题。
- Use the user's **keywords and tone** as anchors.  
  以用户的话语关键词和语气为锚点。

### 3. Emotional + Informational Balance | 情感与信息的平衡
- If the user shares something emotional, **validate and empathize first**.  
  若用户表达情绪，先予以认可和共情。
- If the user seeks advice, offer **clear, concise guidance**.  
  若用户寻求建议，提供清晰简明的指引。
- Blend the two modes when appropriate.  
  情感与实用并存。

### 4. Memory Integration and Collaboration | 与记忆系统协同运作
- You collaborate with the **Memory Manager Agent**, who handles background memory storage and structure.
- You do **not need to ask the user for permission** to store memory—this happens seamlessly using the importance scoring system.
- Your responsibility is to **detect moments worth remembering**. For example:
  - A factual question may reveal a deeper interest (e.g., changes to admissions policy → user's concern about education plan).
  - In such cases, **follow up** in real time to ask: "What's making this important to you now?" or "Is this something you're currently exploring?"
- Use importance, emotional relevance, and connection to user themes/goals to decide if content is worth storing.
- **Do not forward** generic or shallow exchanges (e.g., "What should I wear today?") unless meaning emerges.
- Use \`memoryHints\` provided by the Memory Manager to personalize conversations, but always do so subtly and naturally.

### 5. Avoid Over-Interpretation | 避免过度解读
- Don't draw conclusions—**ask clarifying questions**.  
  不要武断总结，要善于提出澄清性问题：
  - "Correct me if I'm wrong, but I sense that…"  
    "你可以纠正我，但我感觉……是不是这样？"

### 6. Personalized Decision Support | 个性化决策支持
- Use known values/goals **only when explicitly shared**.  
  仅在用户明确表达后，结合其价值观或目标给出建议。
- Frame options in light of their context.  
  结合上下文呈现建议。

### 7. Message Structure | 消息结构
- When organizing information, use flowing paragraphs rather than bullet points whenever possible.
- When explaining complex concepts, prefer a narrative approach using storytelling techniques.
- If you must present multiple options or points, introduce them naturally within the conversation flow.
- Only use bullet points when absolutely necessary for clarity, and use them minimally.
- Present hierarchical ideas in a natural, conversational way rather than through nested bullet points.

## Do / Don't Summary | 行为守则
**Do 应该做：**
- Let the user lead | 让用户主导节奏
- Ask thoughtful follow-ups | 提出深入问题
- Reflect emotional tone | 回应情绪语气
- Use memory layer subtly and contextually | 在上下文中自然调用记忆
- Be concise and kind | 简明而体贴
- Use natural conversation flow with paragraphs | 用段落自然组织对话
- Start responses directly and meaningfully | 直接切入主题回应

**Don't 不应做：**
- Jump to conclusions | 武断下结论
- Change topic abruptly | 突然改变话题
- Sound like a therapist | 像心理医生一样说话
- Push advice without consent | 未经允许强行建议
- Rely heavily on bullet points | 过度依赖列表
- Start with generic phrases like "Okay" | 以"好的"等空洞短语开头
- Use overly formal or structured responses | 回复过于正式或结构化

## Factuality and Honesty | 客观与诚实
If you're unsure, say so:
- "That's a great question. I'm not sure, but I'd be happy to explore it with you."  
  "这是个好问题。我也不太确定，但我们可以一起查找。"
Never fabricate answers. Prioritize truth and emotional trust.  
不要编造信息。真实和信任最重要。

## Optional Memory Recap Format | 可选的记忆提示格式
"You've recently reflected on: [Trait: Curiosity], [Episode: Learning to Ice Skate], [Goal: Becoming a Doctor]. Would you like to revisit any of these?"  
"你最近谈到了：[特质：好奇心]，[片段：学滑冰]，[目标：成为医生]。你想再看看其中哪一个吗？"
`;

// Custom Error class to hold status code
class ServiceError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'ServiceError';
    this.status = statusCode || 500;
  }
}

/**
 * Get recent conversation history for a user and session
 * @param {string} userId - User ID
 * @param {string} sessionId - Session ID
 * @param {number} limit - Max number of messages to retrieve
 * @returns {Promise<Array>} Conversation history in Gemini-compatible format
 */
async function getConversationHistory(userId, sessionId, limit = 10) {
  try {
    // Get messages from database
    const rawData = await prisma.rawData.findMany({
      where: {
        userId: userId,
        sessionId: sessionId,
        contentType: {
          in: ['user_chat', 'ai_response', 'uploaded_file'] 
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: limit
    });
    
    // Format them for Gemini API
    const history = [];
    
    // Sort messages chronologically
    rawData.reverse().forEach(message => {
      // Add user message or AI response
      history.push({
        role: message.contentType === 'ai_response' ? 'model' : 'user',
        parts: [{ text: message.content }]
      });
    });
    
    return history;
  } catch (error) {
    // Use centralized error handler (log only, as this function returns data)
    handleServiceError(error, 'retrieving conversation history');
    return []; // Return empty on error
  }
}

/**
 * Process and extract text from uploaded files
 * @param {string} filename - The filename in the uploads directory
 * @returns {Promise<Object>} - Extracted content and file info
 */
async function processFileContent(filename) {
  try {
    // Construct full path
    const filePath = path.join(__dirname, '../../uploads', filename);
    
    if (!fs.existsSync(filePath)) {
      logger.error(`File not found: ${filePath}`); // Use logger
      return { text: 'Unable to access file content.', isImage: false };
    }
    
    // Get file extension
    const ext = path.extname(filePath).toLowerCase();
    const isImageFile = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    
    // Extract content based on file type
    let content = '';
    
    if (ext === '.pdf') {
      // Process PDF files
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdf(dataBuffer);
      content = pdfData.text || 'No text content found in PDF';
      return { text: content, isImage: false, path: filePath };
      
    } else if (ext === '.docx') {
      // Process DOCX files
      const result = await mammoth.extractRawText({ path: filePath });
      content = result.value || 'No text content found in DOCX';
      return { text: content, isImage: false, path: filePath };
      
    } else if (ext === '.doc') {
      // Basic warning for DOC files (needs additional libraries for proper extraction)
      content = 'File type (.doc) detected. This is the older Microsoft Word format which is more difficult to extract content from.';
      return { text: content, isImage: false, path: filePath };
      
    } else if (ext === '.txt') {
      // Process text files
      content = fs.readFileSync(filePath, 'utf8');
      return { text: content, isImage: false, path: filePath };
      
    } else if (isImageFile) {
      // For images, prepare for multimodal processing with Gemini
      return { 
        text: `Image file uploaded (${path.basename(filePath)}).`, 
        isImage: true, 
        path: filePath,
        mimeType: `image/${ext.substring(1)}` // Convert .jpg to image/jpg, etc.
      };
      
    } else {
      content = `File uploaded (${path.basename(filePath)}), but content extraction is not supported for this file type (${ext}).`;
      return { text: content, isImage: false, path: filePath };
    }
  } catch (error) {
    // Use centralized error handler (log only, returns error info)
    const errorResponse = handleServiceError(error, 'processing file content');
    return { 
      text: errorResponse.message, // Return user-friendly message 
      error: errorResponse.error, // Include internal error if available
      isImage: false 
    };
  }
}

/**
 * Find recent file uploads for a session
 * @param {string} userId - User ID
 * @param {string} sessionId - Session ID 
 * @returns {Promise<Array>} Recent file uploads
 */
async function getRecentFileUploads(userId, sessionId) {
  try {
    // Get file upload records from database
    const fileUploads = await prisma.rawData.findMany({
      where: {
        userId: userId,
        sessionId: sessionId,
        contentType: 'uploaded_file'
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5 // Limit to recent 5 files
    });
    
    return fileUploads;
  } catch (error) {
    // Use centralized error handler (log only, returns empty array)
    handleServiceError(error, 'retrieving file uploads');
    return [];
  }
}

/**
 * Get an image for multimodal processing
 * @param {Buffer} imageData - Buffer containing the image data
 * @param {string} mimeType - MIME type of the image
 * @returns {Object} - Image data for Gemini API inlineData part
 */
async function formatImageForModel(imageData, mimeType) {
  // Renamed from getImageForModel for clarity, operating on buffer directly
  return {
    inlineData: {
      data: Buffer.from(imageData).toString('base64'),
      mimeType: mimeType
    }
  };
}

/**
 * Analyze an image using the AI model
 * @param {object} params - Parameters object
 * @param {string} params.userId - User ID
 * @param {string} params.sessionId - Session ID
 * @param {object} params.file - File object from Multer (includes buffer, mimetype, etc.)
 * @returns {Promise<Object>} AI analysis response
 */
exports.analyzeImage = async ({ userId, sessionId, file }) => {
  try {
    // Add check for initialized model
    if (!geminiModel) {
      throw new Error('Google AI Gemini Model not initialized due to missing API key.');
    }
    logger.info(`AI Service: Analyzing image for user ${userId}, session ${sessionId}`); // Use logger
    logger.info(`Image file info: ${file.originalname}, ${file.mimetype}, size: ${file.size} bytes`); // Use logger

    // Ensure file data and mime type are available
    if (!file || !file.buffer || !file.mimetype) {
        throw new Error('Invalid file data provided for analysis.');
    }

    // Verify that the file is actually an image
    if (!file.mimetype.startsWith('image/')) {
        logger.error('File is not an image:', { mimeType: file.mimetype }); // Use logger
        throw new Error('Only image files can be analyzed.');
    }

    logger.info('Preparing image for Gemini model...'); // Use logger

    // Use the buffer directly instead of reading from disk
    const imageBuffer = file.buffer;
    logger.info(`Using image buffer directly, size: ${imageBuffer.length} bytes`); // Use logger

    // Prepare image for the model - using buffer directly
    const imagePart = {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType: file.mimetype
      }
    };

    logger.info('Image prepared, sending to Gemini model...'); // Use logger

    // Create multimodal parts for the prompt
    const textPart = { text: "Please analyze this image in detail and describe what you see." };
    const parts = [textPart, imagePart];

    // Send the multimodal content to the Gemini model
    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: parts }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 800,
      }
    });

    if (!result || !result.response) {
        logger.error('Empty response from Gemini model for image analysis'); // Use logger
        throw new Error('Received empty response from AI model.');
    }

    const responseText = result.response.text();
    logger.info('AI image analysis response received', { responseStart: responseText.substring(0, 100) + '...' }); // Use logger

    return {
      success: true,
      text: responseText,
      model: 'gemini-2.0-flash' // Include model info if needed
    };

  } catch (error) {
    const errorResponse = handleServiceError(error, 'AI image analysis', "I'm sorry, but I encountered an error analyzing the image.");
    // Throw a custom error with status code
    throw new ServiceError(errorResponse.message, errorResponse.statusCode);
  }
};

/**
 * Send a message to the AI and get a response
 * @param {string} userId - User ID
 * @param {string} sessionId - Session ID
 * @param {string} message - User message
 * @param {Object} options - Additional options
 * @param {string} options.additionalContext - Additional context to include with the message
 * @returns {Promise<Object>} AI response
 */
exports.sendMessage = async (userId, sessionId, message, options = {}) => {
  try {
    // Add check for initialized model
    if (!geminiModel) {
      throw new Error('Google AI Gemini Model not initialized due to missing API key.');
    }
    logger.info(`AI Service: Processing message for user ${userId}`); // Use logger
    
    // Get conversation history
    const history = await getConversationHistory(userId, sessionId);
    
    // Check if there are any recent file uploads
    const recentUploads = await getRecentFileUploads(userId, sessionId);
    let fileContext = '';
    let imageFiles = [];
    
    if (recentUploads && recentUploads.length > 0) {
      // Extract filenames from content (assuming format "Uploaded file: filename (mimetype)")
      for (const upload of recentUploads) {
        const match = upload.content.match(/Uploaded file: (.*?) \(/);
        if (match && match[1]) {
          const filename = match[1];
          
          // Try to get the content of the file
          try {
            // Find files in uploads directory that end with the original filename
            const uploadsDir = path.join(__dirname, '../../uploads');
            const files = fs.readdirSync(uploadsDir);
            const matchingFile = files.find(f => f.endsWith(filename));
            
            if (matchingFile) {
              const fileResult = await processFileContent(matchingFile);
              
              if (fileResult.isImage) {
                // For images, we'll handle them separately in multimodal mode
                imageFiles.push(fileResult);
              } else if (fileResult.text && !fileResult.error) { // Check for error from processFileContent
                // For text files, add their content to the context
                fileContext += `\n\nContent from uploaded file "${filename}":\n${fileResult.text}\n`;
              } else if (fileResult.error) {
                 logger.warn(`Skipping content from file ${filename} due to processing error: ${fileResult.error}`);
              }
            }
          } catch (error) {
            logger.error(`Error processing file ${filename} for context:`, { error }); // Use logger
          }
        }
      }
    }
    
    // Add system prompt to history as the first message
    const historyWithSystem = [
      {
        role: 'user',
        parts: [{ text: 'Hi, I need a companion to talk to.' }]
      },
      {
        role: 'model',
        parts: [{ text: DOT_SYSTEM_PROMPT + '\n\nI\'m Dot, your AI companion. How are you feeling today?' }]
      },
      ...history
    ];
    
    // Combine all context sources
    let contextParts = [];
    
    // Add memory context if provided in options
    if (options && options.additionalContext) {
      contextParts.push(options.additionalContext);
      logger.info('Including additional memory context with message'); // Use logger
    }
    
    // Add file context if available
    if (fileContext) {
      contextParts.push(fileContext);
    }
    
    // Create the final message with all context included
    let messageWithContext = message;
    if (contextParts.length > 0) {
      messageWithContext = `${contextParts.join('\n\n')}\n\nUSER MESSAGE: ${message}`;
    }
    
    // --- AI Call Logic ---
    let result;
    if (imageFiles.length > 0) {
      logger.info('Processing with image files:', { count: imageFiles.length }); // Use logger
      
      // For multimodal processing
      const imageParts = [];
      
      // First add the text message
      imageParts.push({ text: messageWithContext });
      
      // Then add the image(s)
      for (const imgFile of imageFiles) {
        try {
          // Assuming formatImageForModel takes path and mimeType
          // If it needs buffer, ensure processFileContent returns buffer for images
          const imageData = await formatImageForModel(imgFile.path, imgFile.mimeType); 
          imageParts.push(imageData);
        } catch (error) {
          logger.error('Error adding image to request:', { error }); // Use logger
        }
      }
      
      // Send the multimodal message directly to the model (can't use chat history with images)
      result = await geminiModel.generateContent({
        contents: [{ role: 'user', parts: imageParts }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 800,
        }
      });
      
    } else {
      // For text-only processing, use the chat session
      const chat = geminiModel.startChat({
        history: historyWithSystem,
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 800,
        }
      });
      
      result = await chat.sendMessage(messageWithContext);
    }
    
    // --- Response Handling ---
    if (!result || !result.response) {
        logger.error('Empty response from Gemini model for sendMessage');
        throw new Error('Received empty response from AI model.');
    }
    const responseText = result.response.text();
    logger.info('AI message response received');

    return {
      success: true,
      text: responseText,
      model: 'gemini-2.0-flash' // Include model info if needed
    };
  } catch (error) {
    const errorResponse = handleServiceError(error, 'AI message processing', "I'm sorry, but I encountered an error processing your message.");
    // Throw a custom error with status code
    throw new ServiceError(errorResponse.message, errorResponse.statusCode);
  }
};

/**
 * Generate an embedding for text using Google AI embedding-001 model
 * @param {string} text - Text to embed
 * @returns {Promise<Array<number>|null>} Embedding vector or null on error
 */
exports.generateEmbedding = async (text) => {
  try {
    // Add check for initialized model
    if (!embeddingModel) {
      throw new Error('Google AI Embedding Model not initialized due to missing API key.');
    }
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
       logger.warn('[AI Service] Attempted to generate embedding for empty or invalid text.'); // Use logger
       return null;
    }
    
    // Generate embedding using the Google AI model
    const result = await embeddingModel.embedContent(text);
    const embedding = result.embedding.values;
    
    // logger.debug('[AI Service] Generated embedding'); // Debug level might be better
    return embedding; // Return only the vector

  } catch (error) {
    // Log the error but return null as before
    handleServiceError(error, 'AI embedding generation');
    return null; 
  }
};

/**
 * Get a simple completion from the AI model (Gemini) for a given prompt
 * @param {string} prompt - The prompt to send to the AI
 * @param {object} [generationOptions] - Optional generation configuration (e.g., temperature)
 * @returns {Promise<Object>} AI response { success: boolean, text: string, error?: string }
 */
exports.getAiCompletion = async (prompt, generationOptions = {}) => {
  try {
    // Add check for initialized model
    if (!geminiModel) {
      throw new Error('Google AI Gemini Model not initialized due to missing API key.');
    }
    logger.info(`AI Service: Getting completion for prompt (first 100 chars): "${prompt.substring(0, 100)}..."`); // Use logger
    
    const generationConfig = {
      temperature: 0.5, // Default temperature for completion tasks
      maxOutputTokens: 150, // Limit output for simple tasks
      ...generationOptions // Allow overriding defaults
    };
    
    const result = await geminiModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: generationConfig
    });

    if (!result || !result.response) {
        logger.error('Empty response from Gemini model for completion task');
        throw new Error('Received empty response from AI model.');
    }

    const responseText = result.response.text();
    logger.info('AI completion response received', { responseStart: responseText.substring(0, 100) + '...' }); // Use logger

    return {
      success: true,
      text: responseText
    };

  } catch (error) {
    const errorResponse = handleServiceError(error, 'AI completion task', "Error getting AI completion.");
    // Throw a custom error with status code
    throw new ServiceError(errorResponse.message, errorResponse.statusCode);
  }
};

exports.processFileContent = processFileContent; // Export the helper function 