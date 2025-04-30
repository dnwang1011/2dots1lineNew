// src/services/memoryManager.service.js
// Service for managing the memory processing pipeline

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const weaviateClientUtil = require('../utils/weaviateClient'); // Import centralized client utility
const { encode, decode } = require('gpt-tokenizer'); // For semantic chunking
const aiService = require('./ai.service'); // For embedding generation
const { v4: uuidv4 } = require('uuid');
const { createHash } = require('crypto');
const logger = require('../utils/logger').childLogger('MemoryManager'); // Import and create child logger

// --- Configuration ---
const DEFAULT_IMPORTANCE_THRESHOLD = 0.5; // Minimum importance for memories to be stored
const MIN_CHUNK_SIZE = 100; // Minimum size of a chunk in characters
const MAX_CHUNK_SIZE = 2000; // Maximum size of a chunk in characters
const TARGET_CHUNK_SIZE = 800; // Target size for chunks
const WEAVIATE_BATCH_SIZE = 25; // Number of items to batch when importing to Weaviate

// --- Weaviate Client Initialization (Removed - using centralized client) ---
// let weaviateClient = null; // Removed
// function initWeaviateClient() { ... } // Removed
// async function checkWeaviateConnection() { ... } // Removed

/**
 * Checks if the Weaviate schema has the required classes and creates them if needed
 */
async function checkWeaviateSchema() {
  const client = weaviateClientUtil.getClient(); // Get client from utility
  if (!client) {
    logger.warn('[MemoryManager] Weaviate client not available. Skipping schema check.');
    return false;
  }

  logger.info('[MemoryManager] Checking Weaviate schema...');
  
  try {
    // Get the schema and check for required classes
    const schema = await client.schema.getter().do(); // Use client from utility
    const existingClasses = schema.classes?.map(c => c.class) || [];
    
    logger.info(`[MemoryManager] Found existing classes: ${existingClasses.join(', ') || 'none'}`);
    
    let needToCreateMemoryClass = !existingClasses.includes('Memory');
    let needToCreateKnowledgeNodeClass = !existingClasses.includes('KnowledgeNode');
    let needToCreateRelationshipClass = !existingClasses.includes('Relationship');
    
    // Create any missing classes
    if (needToCreateMemoryClass) {
      logger.info('[MemoryManager] Memory class not found, creating it...');
      await createMemoryClass(client); // Pass the client
    } else {
      logger.info('[MemoryManager] Memory class exists.');
      await checkMissingProperties(client, 'Memory', existingClasses); // Pass the client
    }
    
    if (needToCreateKnowledgeNodeClass) {
      logger.info('[MemoryManager] KnowledgeNode class not found, creating it...');
      await createKnowledgeNodeClass(client); // Pass the client
    } else {
      logger.info('[MemoryManager] KnowledgeNode class exists.');
      await checkMissingProperties(client, 'KnowledgeNode', existingClasses); // Pass the client
    }
    
    if (needToCreateRelationshipClass) {
      logger.info('[MemoryManager] Relationship class not found, creating it...');
      await createRelationshipClass(client); // Pass the client
    } else {
      logger.info('[MemoryManager] Relationship class exists.');
      await checkMissingProperties(client, 'Relationship', existingClasses); // Pass the client
    }
    
    logger.info('[MemoryManager] Weaviate schema check completed successfully');
    return true;
  } catch (error) {
    // If the error is a 404, it likely means the schema doesn't exist yet
    if (error.statusCode === 404) {
      logger.info('[MemoryManager] Schema not found, creating full schema...');
      
      try {
        await createMemoryClass(client); // Pass the client
        await createKnowledgeNodeClass(client); // Pass the client
        await createRelationshipClass(client); // Pass the client
        logger.info('[MemoryManager] Full schema created successfully');
        return true;
      } catch (createError) {
        logger.error('[MemoryManager] Failed to create schema:', { error: createError });
        return false;
      }
    }
    
    logger.error('[MemoryManager] Error checking Weaviate schema:', { error });
    return false;
  }
}

/**
 * Checks if any required properties are missing from a Weaviate class
 * @param {object} client - Weaviate client instance (passed in)
 * @param {string} className - Name of the class to check
 * @param {string[]} existingClasses - Array of existing class names
 */
async function checkMissingProperties(client, className, existingClasses) {
  if (!client) {
    logger.warn('Weaviate client not available in checkMissingProperties');
    return;
  }
  // Check if existingClasses is actually an array before using .includes()
  if (!Array.isArray(existingClasses)) {
     logger.error(`[MemoryManager] checkMissingProperties received invalid existingClasses: ${existingClasses}`); // Use logger
     return; // Exit early if the input is wrong
  }
  
  try {
    // Now it's safe to use .includes()
    if (existingClasses.includes(className)) {
      const classDefinition = await client.schema.classGetter().withClassName(className).do();
      const existingProps = classDefinition.properties?.map(p => p.name) || [];
      
      // Define required properties based on className
      let requiredProperties = [];
      if (className === 'Memory') {
         requiredProperties = ['content', 'rawDataId', 'chunkId', 'importance', 'dataType', 'metadata', 'createdAt', 'contextBefore', 'contextAfter', 'userId'];
      } else if (className === 'KnowledgeNode') {
         requiredProperties = ['entity', 'type', 'description', 'metadata', 'sourceIds', 'createdAt', 'updatedAt'];
      } else if (className === 'Relationship') {
         requiredProperties = ['relationType', 'sourceNodeId', 'targetNodeId', 'confidence', 'metadata', 'sourceIds', 'createdAt'];
      }
      
      const missingProps = requiredProperties.filter(prop => !existingProps.includes(prop));
      
      if (missingProps.length > 0) {
        logger.info(`[MemoryManager] Adding missing properties to ${className} class: ${missingProps.join(', ')}`); // Use logger
        for (const propName of missingProps) {
          // Pass the client instance to addPropertyToClass
          await addPropertyToClass(client, className, propName);
        }
      }
    }
  } catch (error) {
    logger.error(`[MemoryManager] Error checking/adding properties for class ${className}:`, { error }); // Use logger
  }
}

/**
 * Adds a property to a Weaviate class
 * @param {object} client - Weaviate client instance (passed in)
 * @param {string} className - Class to add property to
 * @param {string} propName - Name of the property to add
 */
async function addPropertyToClass(client, className, propName) {
  if (!client) {
    logger.warn('Weaviate client not available in addPropertyToClass');
    return;
  }
  try {
    let propertyConfig;
    
    // Define property configuration based on property name
    // (This switch statement needs to be comprehensive for all potential missing props)
    switch (propName) {
      case 'content': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'rawDataId': propertyConfig = { name: propName, dataType: ['text'] }; break; // Use text
      case 'chunkId': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'importance': propertyConfig = { name: propName, dataType: ['number'] }; break;
      case 'dataType': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'metadata': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'createdAt': propertyConfig = { name: propName, dataType: ['date'] }; break;
      case 'contextBefore': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'contextAfter': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'userId': propertyConfig = { name: propName, dataType: ['text'], description: 'ID of the user this memory belongs to' }; break;
      // Add cases for KnowledgeNode props
      case 'entity': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'type': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'description': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'sourceIds': propertyConfig = { name: propName, dataType: ['text[]'] }; break;
      case 'updatedAt': propertyConfig = { name: propName, dataType: ['date'] }; break;
      // Add cases for Relationship props
      case 'relationType': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'sourceNodeId': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'targetNodeId': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'confidence': propertyConfig = { name: propName, dataType: ['number'] }; break;

      default:
        logger.warn(`[MemoryManager] Unknown property ${propName} requested in addPropertyToClass, skipping`); // Use logger
        return;
    }
    
    // Use the passed client instance
    await client.schema.propertyCreator()
      .withClassName(className)
      .withProperty(propertyConfig)
      .do();
      
    logger.info(`[MemoryManager] Added property ${propName} to class ${className}`); // Use logger
  } catch (error) {
    logger.error(`[MemoryManager] Failed to add property ${propName} to class ${className}:`, { error }); // Use logger
  }
}

/**
 * Creates the Memory class in Weaviate
 * @param {Object} client - Weaviate client instance (passed in)
 */
async function createMemoryClass(client) {
  if (!client) {
      logger.error('Weaviate client not available in createMemoryClass');
      throw new Error('Weaviate client is required to create class');
  }
  try {
    const classObj = {
      class: 'Memory',
      description: 'A memory chunk from processed content with semantic meaning',
      vectorizer: 'none', // Set vectorizer to none as we provide vectors manually
      properties: [
        {
          name: 'content',
          description: 'The text content of the memory chunk',
          dataType: ['text'],
        },
        {
          name: 'rawDataId',
          description: 'ID of the source raw data',
          dataType: ['text'] // Changed from int to text for consistency
        },
        {
          name: 'chunkId',
          description: 'ID of the chunk in the database',
          dataType: ['text']
        },
        {
          name: 'importance',
          description: 'Importance score of the memory (0-1)',
          dataType: ['number']
        },
        {
          name: 'dataType',
          description: 'Type of data (message, image_analysis, document, etc.)',
          dataType: ['text']
        },
        {
          name: 'metadata',
          description: 'Additional metadata about the memory',
          dataType: ['text']
        },
        {
          name: 'createdAt',
          description: 'Timestamp when the memory was created',
          dataType: ['date']
        },
        {
          name: 'contextBefore',
          description: 'Content that came before this chunk (for context)',
          dataType: ['text']
        },
        {
          name: 'contextAfter',
          description: 'Content that came after this chunk (for context)',
          dataType: ['text']
        },
        {
          name: 'userId',
          description: 'ID of the user this memory belongs to',
          dataType: ['text']
        }
      ]
    };

    await client.schema.classCreator().withClass(classObj).do();
    logger.info('[MemoryManager] Successfully created Memory class in Weaviate'); // Use logger
    return true;
  } catch (error) {
    logger.error('[MemoryManager] Failed to create Memory class:', { error }); // Use logger
    throw error;
  }
}

/**
 * Creates the KnowledgeNode class in Weaviate
 * @param {Object} client - Weaviate client instance (passed in)
 */
async function createKnowledgeNodeClass(client) {
  if (!client) {
      logger.error('Weaviate client not available in createKnowledgeNodeClass');
      throw new Error('Weaviate client is required to create class');
  }
  try {
    const classObj = {
      class: 'KnowledgeNode',
      description: 'A node representing an entity or concept in the knowledge graph',
      vectorizer: 'none', // Set vectorizer to none
      properties: [
        {
          name: 'entity',
          description: 'The entity or concept name',
          dataType: ['text']
        },
        {
          name: 'type',
          description: 'The type of entity (person, place, concept, etc.)',
          dataType: ['text']
        },
        {
          name: 'description',
          description: 'Description of the entity or concept',
          dataType: ['text'],
        },
        {
          name: 'metadata',
          description: 'Additional metadata about the entity',
          dataType: ['text']
        },
        {
          name: 'sourceIds',
          description: 'IDs of source raw data that contributed to this node',
          dataType: ['text[]']
        },
        {
          name: 'createdAt',
          description: 'Timestamp when the node was created',
          dataType: ['date']
        },
        {
          name: 'updatedAt',
          description: 'Timestamp when the node was last updated',
          dataType: ['date']
        }
      ]
    };

    await client.schema.classCreator().withClass(classObj).do();
    logger.info('[MemoryManager] Successfully created KnowledgeNode class in Weaviate'); // Use logger
    return true;
  } catch (error) {
    logger.error('[MemoryManager] Failed to create KnowledgeNode class:', { error }); // Use logger
    throw error;
  }
}

/**
 * Creates the Relationship class in Weaviate
 * @param {Object} client - Weaviate client instance (passed in)
 */
async function createRelationshipClass(client) {
  if (!client) {
      logger.error('Weaviate client not available in createRelationshipClass');
      throw new Error('Weaviate client is required to create class');
  }
  try {
    const classObj = {
      class: 'Relationship',
      description: 'A relationship between two knowledge nodes in the graph',
      vectorizer: 'none', // Set vectorizer to none
      properties: [
        {
          name: 'relationType',
          description: 'The type of relationship (e.g., "works_at", "created_by", etc.)',
          dataType: ['text']
        },
        {
          name: 'sourceNodeId',
          description: 'The ID of the source node in the relationship',
          dataType: ['text']
        },
        {
          name: 'targetNodeId',
          description: 'The ID of the target node in the relationship',
          dataType: ['text']
        },
        {
          name: 'confidence',
          description: 'Confidence score for this relationship',
          dataType: ['number']
        },
        {
          name: 'metadata',
          description: 'Additional metadata about the relationship',
          dataType: ['text']
        },
        {
          name: 'sourceIds',
          description: 'IDs of source raw data that established this relationship',
          dataType: ['text[]']
        },
        {
          name: 'createdAt',
          description: 'Timestamp when the relationship was created',
          dataType: ['date']
        }
      ]
    };

    await client.schema.classCreator().withClass(classObj).do();
    logger.info('[MemoryManager] Successfully created Relationship class in Weaviate'); // Use logger
    return true;
  } catch (error) {
    logger.error('[MemoryManager] Failed to create Relationship class:', { error }); // Use logger
    throw error;
  }
}

// --- Memory Manager Class ---
class MemoryManager {
  constructor() {
    this.importanceThreshold = DEFAULT_IMPORTANCE_THRESHOLD;
    this.weaviateAvailable = false; // Initialize as false
    this.initialize();
    logger.info(`Memory Manager initialized with importance threshold: ${this.importanceThreshold}`);
  }

  async initialize() {
     // Check connection and schema during initialization
     const client = weaviateClientUtil.getClient();
     if (client) {
         this.weaviateAvailable = await weaviateClientUtil.checkConnection();
         if (this.weaviateAvailable) {
             await checkWeaviateSchema(); // Ensure schema is checked/created
         }
     } else {
         logger.warn('Weaviate client not available during MemoryManager initialization.');
     }
     // Start periodic check
     this.startPeriodicWeaviateCheck();
  }

  // Renamed from processRawData for clarity
  async processMemoryPipeline(rawData) {
    // --- DEBUGGING START ---
    logger.debug(`[MemoryManager Debug] processMemoryPipeline received argument: ${JSON.stringify(rawData, null, 2)}`);
    if (typeof rawData !== 'object' || rawData === null) {
      logger.error(`[MemoryManager Debug] processMemoryPipeline received invalid rawData type: ${typeof rawData}`);
      return;
    }
    logger.debug(`[MemoryManager Debug] rawData ID: ${rawData.id}, Content exists: ${!!rawData.content}`);
    // --- DEBUGGING END ---

    if (!rawData || !rawData.content) {
      logger.warn(`[MemoryManager] Cannot process raw data: missing or invalid rawData object or content for ID ${rawData?.id}`);
      return;
    }

    try {
      logger.info(`[MemoryManager] Processing raw data ${rawData.id}`);
      
      // Extract type, handle potentially missing source
      const type = rawData.contentType || 'unknown'; 
      const content = rawData.content;
      const metadata = {
        contentType: type,
        userId: rawData.userId,
        sessionId: rawData.sessionId, // Include sessionId
        timestamp: rawData.createdAt
      };
      
      // Step 1: Evaluate importance
      const importanceScore = await this.evaluateImportance(content, type, metadata);
      
      // Update raw data with importance score
      await prisma.rawData.update({
        where: { id: rawData.id },
        data: { importanceScore }
      });
      
      // Skip further processing if below importance threshold
      if (importanceScore < DEFAULT_IMPORTANCE_THRESHOLD) {
        logger.info(`Raw data ${rawData.id} below importance threshold (${importanceScore.toFixed(2)}), skipping further processing`);
        await prisma.rawData.update({
          where: { id: rawData.id },
          data: { 
            processingStatus: "skipped", // Mark as skipped due to low importance
            processedAt: new Date()
          }
        });
        return;
      }
      
      // Step 2: Create semantic chunks
      const chunks = await this.chunkContent(content, {
         ...metadata, // Pass metadata to chunking
         rawDataId: rawData.id
      });
      
      // Skip if no chunks were created
      if (!chunks || chunks.length === 0) {
        logger.warn(`No chunks created for raw data ${rawData.id}, skipping further processing`);
        await prisma.rawData.update({
          where: { id: rawData.id },
          data: { 
            processingStatus: "skipped", // Mark as skipped due to no chunks 
            processedAt: new Date()
          }
        });
        return;
      }
      
      // Step 3: Store chunks in database
      // Pass down importance score to chunks
      const chunksWithImportance = chunks.map(chunk => ({ ...chunk, importance: importanceScore }));
      const storedChunkResult = await this.storeChunks(rawData, chunksWithImportance);
      
      // Skip if no chunks were stored
      if (!storedChunkResult || storedChunkResult.length === 0) {
        logger.warn(`No chunks stored for raw data ${rawData.id}, skipping further processing`);
        await prisma.rawData.update({
          where: { id: rawData.id },
          data: { 
            processingStatus: "skipped", // Mark as skipped due to no stored chunks
            processedAt: new Date()
          }
        });
        return;
      }
      
      // Step 4: Generate embeddings and store in Weaviate
      // Pass the current availability status
      await this.generateAndStoreEmbeddings(storedChunkResult, rawData, this.weaviateAvailable);
      
      // Mark raw data as processed
      await prisma.rawData.update({
        where: { id: rawData.id },
        data: { 
          processingStatus: "processed", // Mark as successfully processed
          processedAt: new Date() 
        }
      });
      
      logger.info(`Successfully processed raw data ${rawData.id} through entire memory pipeline`);

    } catch (error) {
      logger.error(`Error processing raw data ${rawData?.id}: ${error.message}`, { error });
      
      // Update the raw data record to reflect the error
      if (rawData?.id) {
        try {
          await prisma.rawData.update({
            where: { id: rawData.id },
            data: { 
              processingError: error.message.substring(0, 1000), // Store truncated error
              processingStatus: "error", // Mark as error
              processedAt: new Date()
            }
          });
        } catch (updateError) {
          // Log error during the error-handling update itself
          logger.error(`Failed to update raw data ${rawData.id} status after processing error: ${updateError.message}`, { error: updateError });
        }
      }
    }
  }
  
  // Add the processRawData method back, calling the renamed pipeline method
  async processRawData(rawData) {
      await this.processMemoryPipeline(rawData);
  }

  /**
   * Evaluates the importance of content
   * @param {string} content - The content to evaluate
   * @param {string} type - The type of content (e.g., 'user_chat', 'ai_response')
   * @param {Object} metadata - Additional metadata about the content
   * @returns {Promise<number>} - Importance score between 0 and 1
   */
  async evaluateImportance(content, type, metadata = {}) {
    try {
      logger.info(`[MemoryManager] Evaluating importance for content (type: ${type})`); // Use logger
      
      // Create the prompt using the helper function
      const prompt = this.createImportanceEvaluationPrompt(type, content, metadata);
      
      // Use the new getAiCompletion service method
      const aiResponse = await aiService.getAiCompletion(prompt, { temperature: 0.3 });
      
      // Check if AI call was successful
      if (!aiResponse || !aiResponse.success) {
        logger.warn(`[MemoryManager] AI importance evaluation failed: ${aiResponse?.error || 'Unknown AI error'}. Falling back to heuristic.`); // Use logger
        return this.heuristicImportanceEvaluation(content, type);
      }
      
      // Extract the numeric score from the response
      // Look for a line starting with IMPORTANCE_SCORE:
      const match = aiResponse.text.match(/IMPORTANCE_SCORE:\s*([0-9.]+)/i);
      let importanceScore = NaN;
      
      if (match && match[1]) {
         importanceScore = parseFloat(match[1]);
      } else {
         // Fallback: Try parsing the entire response if the specific format isn't found
         importanceScore = parseFloat(aiResponse.text.trim());
      }
      
      // Validate the result
      if (isNaN(importanceScore) || importanceScore < 0 || importanceScore > 1) {
        logger.warn(`[MemoryManager] Invalid or unparsable importance score from AI: "${aiResponse.text}". Using heuristic.`); // Use logger
        importanceScore = this.heuristicImportanceEvaluation(content, type);
      }
      
      logger.info(`[MemoryManager] Importance score: ${importanceScore.toFixed(2)}`); // Use logger
      return importanceScore;
    } catch (error) {
      logger.error('[MemoryManager] Error evaluating importance:', { error }); // Use logger
      // Fallback to heuristic evaluation on any unexpected error
      return this.heuristicImportanceEvaluation(content, type);
    }
  }
  
  /**
   * Calculates importance score using heuristics as a backup method
   * @param {string} content - The content to evaluate
   * @param {Object} metadata - Additional metadata
   * @returns {number} Importance score between 0 and 1
   */
  heuristicImportanceEvaluation(content, sourceType) {
    // Simple heuristic based on content length, question marks, etc.
    let score = 0.3; // Base score
    
    // Give a significant boost if the source is a file upload
    if (sourceType === 'file_upload') {
      score += 0.4; // Increased boost for file uploads
    }
    
    // Longer content might be more important (up to a point)
    const length = content.length;
    if (length > 200) score += 0.1;
    
    // Questions might be important (less likely in file uploads)
    if (sourceType !== 'file_upload' && content.includes('?')) score += 0.1;
    
    // Content with dates, times, numbers might be important
    const hasNumbers = /\d+/.test(content);
    if (hasNumbers) score += 0.1;
    
    // Content with proper nouns might be important (simple check for capitalized words)
    const properNouns = content.match(/\b[A-Z][a-z]+\b/g);
    if (properNouns && properNouns.length > 0) {
      score += Math.min(0.2, properNouns.length * 0.05);
    }
    
    // Cap the score at 0.9 for heuristic evaluation, especially for files
    return Math.min(0.9, score);
  }

  /**
   * Creates a prompt for evaluating the importance of content
   * @param {string} type - The type of content
   * @param {string} content - The content to evaluate
   * @param {Object} metadata - Additional metadata
   * @returns {string} The prompt for the AI
   */
  createImportanceEvaluationPrompt(type, content, metadata) {
    // Use more content for file uploads/documents
    const contentSampleLength = (type === 'file_upload' || type === 'document') ? 1000 : 500;
    
    return `
You are an importance evaluator for a personal memory system. Your task is to assign an importance score 
between 0 and 1 to the given content. Consider these factors:

1.  **High Importance (0.7-0.9)**:
    *   Personal information: Specific names, dates, locations, contact info, preferences, experiences.
    *   Emotional content: Strong emotions, significant life events mentioned.
    *   Actionable information: Tasks, deadlines, commitments, plans.
    *   Unique or rare information: Uncommon facts, specialized knowledge, key insights.
    *   **File/Document Content**: Content originating from files or documents, especially if it contains detailed information, profiles, reports, or structured data. Assign higher scores if the content seems comprehensive or like a reference document.
2.  **Moderate Importance (0.5-0.7)**:
    *   Context: Content providing background or context for other memories.
    *   Developing ideas or discussions.
3.  **Low Importance (0.1-0.4)**:
    *   Repetitive or common information: Weather, greetings, small talk, common knowledge.
    *   Vague questions without context.
    *   **Simple AI responses**: If the AI is merely acknowledging, playing back the user's statement, or asking generic follow-up questions without adding substance.

Content Type: ${type}
Content (sample): "${content ? content.substring(0, contentSampleLength) : 'No content'}" 
Metadata: ${JSON.stringify(metadata || {})}

Analyze the content type and the sample provided. Think step by step about its potential long-term value for the user's memory. Provide only:
IMPORTANCE_SCORE: [decimal between 0 and 1]
    `;
  }

  /**
   * Chunk content into semantic chunks
   * @param {string} content - The content to chunk
   * @param {Object} metadata - Additional metadata about the content
   * @returns {Promise<Array>} - Array of chunks
   */
  async chunkContent(content, metadata = {}) {
    if (!content || typeof content !== 'string') {
      logger.warn('[MemoryManager] Cannot chunk empty or non-string content'); // Use logger
      return [];
    }

    logger.info(`[MemoryManager] Chunking content: ${content.length} characters`); // Use logger
    
    try {
      const chunks = [];
      
      // Split text into sentences using a regex pattern
      // This pattern handles common sentence endings and preserves the delimiter
      const sentencePattern = /([.!?])\s+(?=[A-Z])/g;
      const sentences = content.split(sentencePattern)
        .reduce((acc, curr, i, arr) => {
          if (i % 2 === 0) {
            const nextItem = arr[i + 1] || '';
            acc.push(curr + nextItem);
          }
          return acc;
        }, [])
        .filter(s => s.trim().length > 0);
      
      if (sentences.length === 0) {
        // If no sentences were detected, treat the whole content as one chunk
        // But only if it's not too large
        if (content.length <= MAX_CHUNK_SIZE) {
          chunks.push({
            text: content,
            metadata
          });
        } else {
          // If too large, split by paragraphs or just characters
          const paragraphs = content.split(/\n\s*\n/);
          if (paragraphs.length > 1) {
            for (const paragraph of paragraphs) {
              if (paragraph.trim().length > 0) {
                chunks.push({
                  text: paragraph.trim(),
                  metadata
                });
              }
            }
          } else {
            // Last resort: split by character count
            let i = 0;
            while (i < content.length) {
              const chunk = content.slice(i, i + TARGET_CHUNK_SIZE);
              if (chunk.trim().length > 0) {
                chunks.push({
                  text: chunk.trim(),
                  metadata
                });
              }
              i += TARGET_CHUNK_SIZE;
            }
          }
        }
        return chunks;
      }
      
      // Adaptive windowing algorithm for semantic chunking
      let currentChunk = '';
      let currentTokenCount = 0;
      
      // Function to count tokens in a string
      const countTokens = (str) => encode(str).length;
      
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const sentenceTokens = countTokens(sentence);
        
        // Skip empty sentences
        if (sentence.trim().length === 0) continue;
        
        // If a single sentence exceeds the max chunk size, we need to split it
        if (sentenceTokens > MAX_CHUNK_SIZE) {
          // If we have content in the current chunk, add it before processing the large sentence
          if (currentChunk.length > 0) {
            chunks.push({
              text: currentChunk.trim(),
              metadata
            });
            currentChunk = '';
            currentTokenCount = 0;
          }
          
          // Split the long sentence into smaller pieces
          let j = 0;
          const words = sentence.split(' ');
          let subChunk = '';
          let subChunkTokens = 0;
          
          for (const word of words) {
            const wordWithSpace = j > 0 ? ' ' + word : word;
            const wordTokens = countTokens(wordWithSpace);
            
            if (subChunkTokens + wordTokens <= TARGET_CHUNK_SIZE) {
              subChunk += wordWithSpace;
              subChunkTokens += wordTokens;
            } else {
              if (subChunk.length > 0) {
                chunks.push({
                  text: subChunk.trim(),
                  metadata
                });
              }
              subChunk = word;
              subChunkTokens = countTokens(word);
            }
            j++;
          }
          
          // Add any remaining content in the sub-chunk
          if (subChunk.length > 0) {
            chunks.push({
              text: subChunk.trim(),
              metadata
            });
          }
          continue;
        }
        
        // Check if adding this sentence would exceed TARGET_CHUNK_SIZE
        if (currentTokenCount + sentenceTokens > TARGET_CHUNK_SIZE) {
          // Save current chunk if it has content
          if (currentChunk.length > 0) {
            chunks.push({
              text: currentChunk.trim(),
              metadata
            });
          }
          
          // Start a new chunk with this sentence
          currentChunk = sentence;
          currentTokenCount = sentenceTokens;
        } else {
          // Add sentence to current chunk
          if (currentChunk.length > 0 && !currentChunk.endsWith(' ')) {
            currentChunk += ' ';
          }
          currentChunk += sentence;
          currentTokenCount += sentenceTokens;
        }
        
        // Check if we're at the last sentence
        if (i === sentences.length - 1 && currentChunk.length > 0) {
          chunks.push({
            text: currentChunk.trim(),
            metadata
          });
        }
      }
      
      // Add semantic information to each chunk
      chunks.forEach((chunk, index) => {
        // Add position information
        chunk.metadata = {
          ...chunk.metadata,
          position: index,
          totalChunks: chunks.length,
          charCount: chunk.text.length,
          tokenCount: countTokens(chunk.text)
        };
      });
      
      logger.info(`[MemoryManager] Created ${chunks.length} chunks from content`); // Use logger
      return chunks;
    } catch (error) {
      logger.error(`[MemoryManager] Error chunking content: ${error.message}`, { error }); // Use logger
      // Fallback to basic chunking
      if (content.length <= MAX_CHUNK_SIZE) {
        return [{
          text: content,
          metadata
        }];
      } else {
        // Simple chunk by character count as a last resort
        const simpleChunks = [];
        let i = 0;
        while (i < content.length) {
          const chunk = content.slice(i, i + TARGET_CHUNK_SIZE);
          if (chunk.trim().length > 0) {
            simpleChunks.push({
              text: chunk.trim(),
              metadata
            });
          }
          i += TARGET_CHUNK_SIZE;
        }
        return simpleChunks;
      }
    }
  }

  /**
   * Store chunks in database
   * @param {Object} rawData - The raw data record
   * @param {Array} chunks - Array of chunks to store (should include importance)
   * @returns {Promise<Array>} - Array of stored chunk objects (from DB)
   */
  async storeChunks(rawData, chunks) {
    try {
      const storedChunks = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        
        // Use the correct model name: prisma.semanticChunk
        const chunkRecord = await prisma.semanticChunk.create({
          data: {
            rawDataId: rawData.id,
            content: chunk.text,
            chunkIndex: i,
            // Use the importance passed down or default
            importanceScore: chunk.importance || 0.5, 
            // Assuming perspectiveOwnerId and subjectId come from rawData for now
            perspectiveOwnerId: rawData.perspectiveOwnerId,
            subjectId: rawData.subjectId,
            topicKey: rawData.topicKey, // Propagate topicKey
            // Add other fields if necessary based on your SemanticChunk model
          }
        });
        
        logger.info(`[MemoryManager] Stored chunk ${chunkRecord.id} (index: ${i}) for rawData ${rawData.id}`); // Use logger
        
        // Add database ID and other relevant info to the result
        storedChunks.push({
          ...chunkRecord, // Include all fields from the created record
          text: chunkRecord.content // Ensure 'text' field exists for generateAndStoreEmbeddings if needed
        });
      }
      
      return storedChunks;
    } catch (error) {
      logger.error(`[MemoryManager] Error storing chunks for rawData ${rawData.id}:`, { error }); // Use logger
      // Throw the error so processRawData catch block handles DB state update
      throw error; 
    }
  }

  /**
   * Generate embeddings for chunks and store in Weaviate
   * @param {Array} chunks - Array of chunks to process
   * @param {Object} rawData - The raw data record
   * @param {boolean} isWeaviateAvailable - Flag indicating if Weaviate is up
   * @returns {Promise<Array>} - Array of objects ready for Weaviate import
   */
  async generateAndStoreEmbeddings(chunks, rawData, isWeaviateAvailable) {
    if (!chunks || chunks.length === 0) {
      logger.info('[MemoryManager] No chunks to process for embeddings');
      return [];
    }

    logger.info(`[MemoryManager] Generating embeddings for ${chunks.length} chunks`);
    
    const weaviateObjects = [];

    try {
      // Process each chunk
      for (const chunk of chunks) {
        try {
          // Generate embedding using AI service
          const embedding = await aiService.generateEmbedding(chunk.text);
          
          if (!embedding || embedding.length === 0) {
            logger.warn(`[MemoryManager] Failed to generate embedding for chunk: ${chunk.id}`);
            continue;
          }

          // Save embedding metadata to PostgreSQL
          const embeddingRecord = await prisma.embedding.create({
            data: {
              chunkId: chunk.id,
              vector: embedding,
              dimension: embedding.length,
              embeddingType: 'google_embedding_001',
              vectorCollection: 'weaviate_memory',
              vectorId: chunk.id,
              perspectiveOwnerId: rawData.perspectiveOwnerId,
              content: chunk.text.substring(0, 200),
              summary: '',
              importanceScore: chunk.importance || 0.5,
              rawDataId: rawData.id,
              subjectId: rawData.subjectId,
            }
          });
          
          logger.info(`[MemoryManager] Created embedding record: ${embeddingRecord.id} for chunk ${chunk.id}`);
          
          // Only prepare Weaviate object if available
          if (isWeaviateAvailable) {
              const weaviateUuid = uuidv4(); 
              const weaviateObject = {
                id: weaviateUuid, 
                properties: {
                  content: chunk.text,
                  rawDataId: rawData.id,
                  chunkId: chunk.id, 
                  importance: chunk.importance || 0.5,
                  dataType: rawData.contentType,
                  metadata: JSON.stringify({ userId: rawData.userId, sessionId: rawData.sessionId }),
                  createdAt: chunk.createdAt?.toISOString() || new Date().toISOString(),
                  userId: rawData.userId // Add direct userId property
                },
                vector: embedding
              };
              weaviateObjects.push(weaviateObject);
          } else {
              logger.warn(`[MemoryManager] Skipping Weaviate object preparation for chunk ${chunk.id} as Weaviate is not available.`);
          }

        } catch (error) {
          logger.error(`[MemoryManager] Error processing embedding for chunk ${chunk?.id}:`, { error });
        }
      }
      
      // Only import if Weaviate is available and objects exist
      if (isWeaviateAvailable && weaviateObjects.length > 0) {
        await this.batchImportToWeaviate(weaviateObjects);
      } else if (weaviateObjects.length > 0) {
         logger.warn('[MemoryManager] Skipping Weaviate import as client is not available.');
      }
      
      return weaviateObjects;
    } catch (error) {
      logger.error(`[MemoryManager] Error in generateAndStoreEmbeddings main loop for rawData ${rawData?.id}:`, { error });
      return []; 
    }
  }

  /**
   * Batch imports objects to Weaviate
   * @param {Array} objects - Array of objects to import
   * @param {string} className - Name of the class to import into
   * @returns {Promise<boolean>} - Success status
   */
  async batchImportToWeaviate(objects, className = 'Memory') {
    const client = weaviateClientUtil.getClient(); // Get client from utility
    if (!client) {
      logger.warn('[MemoryManager] No Weaviate client available, skipping import');
      return false;
    }
    
    if (!objects || objects.length === 0) {
      logger.info('[MemoryManager] No objects to import to Weaviate');
      return true;
    }
    
    logger.info(`[MemoryManager] Batch importing ${objects.length} objects to Weaviate class ${className}`); // Use logger
    
    try {
      const batcher = client.batch.objectsBatcher();
      let count = 0;
      let batchSize = 0;
      const batchLimit = WEAVIATE_BATCH_SIZE || 100;

      for (const obj of objects) {
        if (!obj.vector || !Array.isArray(obj.vector)) {
          logger.warn(`[MemoryManager] Skipping Weaviate import for object without valid vector: ID ${obj.id}`); // Use logger
          continue;
        }

        // Properties are already prepared in generateAndStoreEmbeddings
        const propertiesForWeaviate = obj.properties;

        batcher.withObject({
          class: className,
          id: obj.id, // This is now the UUID generated in the previous step
          properties: propertiesForWeaviate,
          vector: obj.vector
        });

        batchSize++;
        count++;
        
        // Process in chunks
        if (batchSize >= batchLimit) {
          logger.info(`[MemoryManager] Executing Weaviate batch of ${batchSize} objects (${count}/${objects.length})`); // Use logger
          const batchResult = await batcher.do();
          // Optional: check batchResult for errors
          if (batchResult.some(item => item.result?.errors)) {
             logger.error('[MemoryManager] Errors occurred during Weaviate batch import:', { batchResult }); // Use logger
          }
          batchSize = 0;
        }
      }

      // Process remaining objects
      if (batchSize > 0) {
        logger.info(`[MemoryManager] Executing final Weaviate batch of ${batchSize} objects`); // Use logger
        const finalBatchResult = await batcher.do();
        if (finalBatchResult.some(item => item.result?.errors)) {
             logger.error('[MemoryManager] Errors occurred during final Weaviate batch import:', { finalBatchResult }); // Use logger
        }
      }

      logger.info(`[MemoryManager] Successfully attempted import of ${count} objects to Weaviate class ${className}`); // Use logger
      return true;
    } catch (error) {
      logger.error(`[MemoryManager] Error batch importing to Weaviate class ${className}:`, { error }); // Use logger
      return false;
    }
  }

  // Renamed from checkWeaviateAvailability
  startPeriodicWeaviateCheck() {
    // Initial check done in constructor
    
    // Schedule periodic checks (every 5 minutes)
    setInterval(async () => {
      const wasAvailable = this.weaviateAvailable;
      this.weaviateAvailable = await weaviateClientUtil.checkConnection(); // Use utility checker
      
      // Log status changes
      if (wasAvailable && !this.weaviateAvailable) {
        logger.error('[MemoryManager] Weaviate connection lost');
      } else if (!wasAvailable && this.weaviateAvailable) {
        logger.info('[MemoryManager] Weaviate connection restored');
        // Reinitialize schema when connection is restored
        await checkWeaviateSchema(); // Make sure schema check is awaited
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Retrieves memories similar to the provided query
   * @param {string} query - The search query 
   * @param {Object} options - Search options
   * @param {number} options.limit - Maximum number of results to return (default: 10)
   * @param {number} options.minImportance - Minimum importance score threshold (default: 0.3)
   * @param {number} options.certainty - Minimum similarity score (default: 0.7)
   * @param {string} options.dataType - Filter by data type (optional)
   * @returns {Promise<Array>} - Array of memory objects with similarity scores
   */
  async retrieveMemories(query, userId, options = {}) {
    const client = weaviateClientUtil.getClient(); // Get client from utility
    if (!client) {
       logger.error('[MemoryManager] Cannot retrieve memories: Weaviate client is unavailable.');
       return [];
    }
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      logger.error('[MemoryManager] Cannot retrieve memories: Invalid query provided.'); // Use logger
      return [];
    }

    if (!userId) {
        logger.error('[MemoryManager] Cannot retrieve memories: userId is required.');
        return [];
    }

    const {
      limit = 10,
      minImportance = 0.3,
      certainty = 0.7,
      dataType = null
    } = options;

    try {
      logger.info(`[MemoryManager] Retrieving memories for user ${userId} similar to: "${query.substring(0, 50)}..."`);
      
      // Generate embedding for the query
      const embedding = await aiService.generateEmbedding(query);
      if (!embedding || !Array.isArray(embedding)) {
        logger.error('[MemoryManager] Failed to generate embedding for query'); // Use logger
        return [];
      }

      // Build Weaviate query
      let weaviateQuery = client.graphql
        .get()
        .withClassName('Memory')
        .withFields('content rawDataId chunkId importance dataType metadata createdAt _additional { certainty }')
        .withNearVector({
          vector: embedding,
          certainty: certainty
        })
        .withLimit(limit);

      // Build the where filter with MANDATORY userId filter
      const filterOperands = [
          {
              path: ['userId'], // Filter by the new userId property
              operator: 'Equal',
              valueString: userId
          },
          {
            path: ['importance'],
            operator: 'GreaterThanEqual',
            valueNumber: minImportance
          }
      ];

      // Add dataType filter if specified
      if (dataType) {
        filterOperands.push({
          path: ['dataType'],
          operator: 'Equal',
          valueString: dataType
        });
      }
      
      const whereFilter = {
        operator: 'And',
        operands: filterOperands
      };

      weaviateQuery = weaviateQuery.withWhere(whereFilter);

      // Execute query
      const result = await weaviateQuery.do();
      
      // Process and return results
      if (result && result.data && result.data.Get && result.data.Get.Memory) {
        const memories = result.data.Get.Memory;
        
        logger.info(`[MemoryManager] Retrieved ${memories.length} memories`); // Use logger
        
        // Format results
        return memories.map(memory => ({
          ...memory,
          similarity: memory._additional.certainty,
          _additional: undefined // Remove _additional property
        }));
      }
      
      logger.info('[MemoryManager] No memories found matching the query'); // Use logger
      return [];
    } catch (error) {
      logger.error('[MemoryManager] Error retrieving memories:', { error }); // Use logger
      return [];
    }
  }
}

// Export a singleton instance
const memoryManager = new MemoryManager();
module.exports = memoryManager; 

/**
 * Helper function to count tokens in text
 * @param {string} text - Text to count tokens for
 * @returns {number} Number of tokens
 */
function countTokens(text) {
  if (!text) return 0;
  return encode(text).length;
} 