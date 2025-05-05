// src/services/memoryManager.service.js
// Service for managing the memory processing pipeline

// Import PrismaClient for memory retrieval
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();


// Remove direct PrismaClient import
// const { PrismaClient } = require('@prisma/client');
// const { prisma } = require('../db/prisma'); // Remove direct prisma import
const rawDataRepository = require('../repositories/rawData.repository'); // Import RawData repository
const chunkRepository = require('../repositories/chunk.repository'); // Import Chunk repository
const weaviateClientUtil = require('../utils/weaviateClient'); // Import centralized client utility
const { encode } = require('gpt-tokenizer'); // For semantic chunking - Keep for now
const aiService = require('./ai.service'); // For embedding generation
const { v4: uuidv4 } = require('uuid');
const { createHash } = require('crypto');
const logger = require('../utils/logger').childLogger('MemoryManager'); // Import and create child logger
const memoryConfig = require('../../config/memory.config'); // Import memory config
const aiConfig = require('../../config/ai.config'); // Import AI config for prompts
const { addMemoryJob, addEpisodeAgentJob } = require('../utils/queues'); // Import the new queue helper

// --- Weaviate Schema Checking Functions ---
// (Keep these as they interact with Weaviate client, not Prisma directly)
async function inspectWeaviateSchema(client) {
  if (!client) {
    logger.warn('No client available for inspectWeaviateSchema');
    return;
  }
  
  try {
    logger.info('[Debug] Running detailed Weaviate schema inspection');
    
    // Get full schema
    const fullSchema = await client.schema.getter().do();
    if (!fullSchema?.classes?.length) {
      logger.info('[Debug] No classes found in Weaviate schema');
      return;
    }
    
    // Check API version
    try {
      const meta = await client.misc.metaGetter().do();
      logger.info(`[Debug] Weaviate API version: ${meta.version}`);
    } catch (err) {
      logger.error(`[Debug] Failed to get Weaviate version: ${err.message}`);
    }
    
    // Look for Memory class since we know it works
    const memoryClass = fullSchema.classes.find(c => c.class === 'Memory');
    if (memoryClass) {
      logger.info(`[Debug] Found Memory class with properties: ${JSON.stringify(memoryClass)}`);
      // Check if it has vectorIndexConfig
      if (memoryClass.vectorIndexConfig) {
        logger.info(`[Debug] Memory class vectorIndexConfig: ${JSON.stringify(memoryClass.vectorIndexConfig)}`);
      } else {
        logger.info('[Debug] Memory class has NO vectorIndexConfig defined');
      }
    } else {
      logger.info('[Debug] Memory class not found');
    }
    
    // Try to create a minimal test class
    try {
      const testClassName = 'WeaviateTestClass';
      // Check if test class exists
      const existingClasses = fullSchema.classes.map(c => c.class);
      if (existingClasses.includes(testClassName)) {
        // Delete it first
        await client.schema.classDeleter().withClassName(testClassName).do();
        logger.info(`[Debug] Deleted existing ${testClassName}`);
      }
      
      // Create minimal test class
      const minimalClassObj = {
        class: testClassName,
        description: 'Test class for diagnostics',
        vectorizer: 'none',
        properties: [
          {
            name: 'testProp',
            description: 'Test property',
            dataType: ['text']
          }
        ]
      };
      
      await client.schema.classCreator().withClass(minimalClassObj).do();
      logger.info(`[Debug] Successfully created ${testClassName}`);
      
      // Clean up 
      await client.schema.classDeleter().withClassName(testClassName).do();
      logger.info(`[Debug] Cleaned up ${testClassName}`);
    } catch (e) {
      logger.error(`[Debug] Test class creation failed: ${e.message}`);
    }
    
  } catch (error) {
    logger.error(`[Debug] Schema inspection failed: ${error.message}`);
  }
}

async function checkWeaviateSchema() {
  const client = weaviateClientUtil.getClient(); // Get client from utility
  if (!client) {
    logger.warn('[MemoryManager] Weaviate client not available. Skipping schema check.');
    return false;
  }

  logger.info('[MemoryManager] Checking Weaviate schema for memory models...');
  
  // Add diagnostics
  // await inspectWeaviateSchema(client); // Keep commented out unless needed for debug
  
  try {
    // Get the schema and check for required classes
    const schema = await client.schema.getter().do();
    const existingClasses = schema.classes?.map(c => c.class) || [];
    
    logger.info(`[MemoryManager] Found existing classes: ${existingClasses.join(', ') || 'none'}`);
    
    // Check for memory classes
    let needToCreateChunkEmbeddingClass = !existingClasses.includes('ChunkEmbedding');
    let needToCreateEpisodeEmbeddingClass = !existingClasses.includes('EpisodeEmbedding');
    let needToCreateThoughtEmbeddingClass = !existingClasses.includes('ThoughtEmbedding');
    let needToCreateKnowledgeNodeClass = !existingClasses.includes('KnowledgeNode');
    let needToCreateRelationshipClass = !existingClasses.includes('Relationship');
    
    // Create any missing classes
    if (needToCreateChunkEmbeddingClass) {
      logger.info('[MemoryManager] ChunkEmbedding class not found, creating it...');
      await createChunkEmbeddingClass(client);
    } else {
      logger.info('[MemoryManager] ChunkEmbedding class exists.');
      await checkMissingProperties(client, 'ChunkEmbedding', existingClasses);
    }
    
    if (needToCreateEpisodeEmbeddingClass) {
      logger.info('[MemoryManager] EpisodeEmbedding class not found, creating it...');
      await createEpisodeEmbeddingClass(client);
    } else {
      logger.info('[MemoryManager] EpisodeEmbedding class exists.');
      await checkMissingProperties(client, 'EpisodeEmbedding', existingClasses);
    }
    
    if (needToCreateThoughtEmbeddingClass) {
      logger.info('[MemoryManager] ThoughtEmbedding class not found, creating it...');
      await createThoughtEmbeddingClass(client);
    } else {
      logger.info('[MemoryManager] ThoughtEmbedding class exists.');
      await checkMissingProperties(client, 'ThoughtEmbedding', existingClasses);
    }
    
    if (needToCreateKnowledgeNodeClass) {
      logger.info('[MemoryManager] KnowledgeNode class not found, creating it...');
      await createKnowledgeNodeClass(client);
    } else {
      logger.info('[MemoryManager] KnowledgeNode class exists.');
      await checkMissingProperties(client, 'KnowledgeNode', existingClasses);
    }
    
    if (needToCreateRelationshipClass) {
      logger.info('[MemoryManager] Relationship class not found, creating it...');
      await createRelationshipClass(client);
    } else {
      logger.info('[MemoryManager] Relationship class exists.');
      await checkMissingProperties(client, 'Relationship', existingClasses);
    }
    
    logger.info('[MemoryManager] Weaviate schema check completed successfully');
    return true;
  } catch (error) {
    // If the error is a 404, it likely means the schema doesn't exist yet
    if (error.statusCode === 404) {
      logger.info('[MemoryManager] Schema not found, creating full schema...');
      
      try {
        await createChunkEmbeddingClass(client);
        await createEpisodeEmbeddingClass(client);
        await createThoughtEmbeddingClass(client);
        await createKnowledgeNodeClass(client);
        await createRelationshipClass(client);
        logger.info('[MemoryManager] Full schema created successfully');
        return true;
      } catch (createError) {
        logger.error(`[MemoryManager] Failed to create schema: ${createError.message}`, { error: createError });
        return false;
      }
    }
    
    logger.error(`[MemoryManager] Error checking Weaviate schema: ${error.message}`, { error });
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
      } else if (className === 'ChunkEmbedding') {
         requiredProperties = ['chunkDbId', 'text', 'rawDataId', 'importance', 'userId'];
      } else if (className === 'EpisodeEmbedding') {
         requiredProperties = ['episodeDbId', 'title', 'userId'];
      } else if (className === 'ThoughtEmbedding') {
         requiredProperties = ['thoughtDbId', 'name', 'userId'];
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
      // Common properties
      case 'userId': propertyConfig = { name: propName, dataType: ['text'], description: 'ID of the user this memory belongs to' }; break;
      case 'importance': propertyConfig = { name: propName, dataType: ['number'], description: 'Importance score (0-1)' }; break;
      case 'createdAt': propertyConfig = { name: propName, dataType: ['date'] }; break;
      
      // Memory class properties
      case 'content': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'rawDataId': propertyConfig = { name: propName, dataType: ['text'] }; break; // Use text
      case 'chunkId': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'dataType': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'metadata': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'contextBefore': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'contextAfter': propertyConfig = { name: propName, dataType: ['text'] }; break;
      
      // KnowledgeNode props
      case 'entity': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'type': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'description': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'sourceIds': propertyConfig = { name: propName, dataType: ['text[]'] }; break;
      case 'updatedAt': propertyConfig = { name: propName, dataType: ['date'] }; break;
      
      // Relationship props
      case 'relationType': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'sourceNodeId': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'targetNodeId': propertyConfig = { name: propName, dataType: ['text'] }; break;
      case 'confidence': propertyConfig = { name: propName, dataType: ['number'] }; break;
      
      // ChunkEmbedding props
      case 'chunkDbId': propertyConfig = { name: propName, dataType: ['text'], description: 'ID of the ChunkEmbedding in the database' }; break;
      case 'text': propertyConfig = { name: propName, dataType: ['text'], description: 'The full text content of the chunk' }; break;
      
      // EpisodeEmbedding props
      case 'episodeDbId': propertyConfig = { name: propName, dataType: ['text'], description: 'ID of the Episode in the database' }; break;
      case 'title': propertyConfig = { name: propName, dataType: ['text'], description: 'Title of the episode' }; break;
      case 'narrative': propertyConfig = { name: propName, dataType: ['text'], description: 'Narrative description of the episode' }; break;
      case 'occurredAt': propertyConfig = { name: propName, dataType: ['date'], description: 'When the episode occurred' }; break;
      
      // ThoughtEmbedding props
      case 'thoughtDbId': propertyConfig = { name: propName, dataType: ['text'], description: 'ID of the Thought in the database' }; break;
      case 'name': propertyConfig = { name: propName, dataType: ['text'], description: 'Short label for the thought' }; break;

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
      vectorIndexType: 'hnsw', // Standardized with other classes
      vectorIndexConfig: {
        distance: 'cosine' // Standardized distance metric
      },
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
      vectorIndexType: 'hnsw', // Standardized with other classes
      vectorIndexConfig: {
        distance: 'cosine' // Standardized distance metric
      },
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

/**
 * Creates the ChunkEmbedding class in Weaviate
 * @param {Object} client - Weaviate client instance
 */
async function createChunkEmbeddingClass(client) {
  if (!client) {
    logger.error('Weaviate client not available in createChunkEmbeddingClass');
    throw new Error('Weaviate client is required to create class');
  }
  try {
    logger.info('[MemoryManager] Creating ChunkEmbedding class with properties: chunkDbId, text, rawDataId, importance, userId, sessionId, chunkIndex, tokenCount, contentType, sourceCreatedAt, perspectiveOwnerId, subjectId, topicKey, skipImportanceCheck');
    
    const classObj = {
      class: 'ChunkEmbedding',
      description: 'A memory chunk with its associated embedding vector',
      vectorizer: 'none', 
      vectorIndexType: 'hnsw', 
      vectorIndexConfig: { distance: 'cosine' },
      properties: [
        { name: 'chunkDbId', description: 'ID of the ChunkEmbedding in the database', dataType: ['text'] },
        { name: 'text', description: 'The full text content of the chunk', dataType: ['text'] },
        { name: 'rawDataId', description: 'ID of the source raw data', dataType: ['text'] },
        { name: 'importance', description: 'Importance score of the memory (0-1)', dataType: ['number'] },
        { name: 'userId', description: 'ID of the user this memory belongs to', dataType: ['text'] },
        { name: 'sessionId', description: 'Session ID associated with this chunk', dataType: ['text'] },
        { name: 'chunkIndex', description: 'Index of this chunk within the original content', dataType: ['int'] },
        { name: 'tokenCount', description: 'Number of tokens in the chunk text', dataType: ['int'] },
        { name: 'contentType', description: 'Type of the original raw data', dataType: ['text'] },
        { name: 'sourceCreatedAt', description: 'Creation timestamp of the original raw data', dataType: ['date'] },
        { name: 'perspectiveOwnerId', description: 'Perspective owner ID from raw data', dataType: ['text'] },
        { name: 'subjectId', description: 'Subject ID from raw data', dataType: ['text'] },
        { name: 'topicKey', description: 'Topic key from raw data', dataType: ['text'] },
        { name: 'skipImportanceCheck', description: 'Flag indicating if importance check was skipped', dataType: ['boolean'] },
      ]
    };
    
    logger.info(`[MemoryManager] Calling Weaviate schema.classCreator() for ChunkEmbedding`);
    
    try {
      const result = await client.schema.classCreator().withClass(classObj).do();
      logger.info('[MemoryManager] Created ChunkEmbedding class in Weaviate successfully:', result);
    } catch (innerError) {
      logger.error(`[MemoryManager] Weaviate API error creating ChunkEmbedding class: ${innerError.message}`);
      if (innerError.response) {
        logger.error(`[MemoryManager] Status: ${innerError.response.status}, Response body: ${JSON.stringify(innerError.response.data || {})}`);
      }
      throw innerError;
    }
  } catch (error) {
    logger.error(`[MemoryManager] Error creating ChunkEmbedding class: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Creates the EpisodeEmbedding class in Weaviate
 * @param {Object} client - Weaviate client instance
 */
async function createEpisodeEmbeddingClass(client) {
  if (!client) {
    logger.error('Weaviate client not available in createEpisodeEmbeddingClass');
    throw new Error('Weaviate client is required to create class');
  }
  try {
    logger.info('[MemoryManager] Creating EpisodeEmbedding class with properties: episodeDbId, title, userId');
    
    const classObj = {
      class: 'EpisodeEmbedding',
      description: 'An episode with its centroid vector',
      vectorizer: 'none', // Set vectorizer to none as we provide vectors manually
      vectorIndexType: 'hnsw', // Explicitly setting to match Memory class
      vectorIndexConfig: {
        distance: 'cosine', // Using cosine similarity like Memory class has
      },
      properties: [
        {
          name: 'episodeDbId',
          description: 'ID of the Episode in the database',
          dataType: ['text'],
        },
        {
          name: 'title',
          description: 'Title of the episode',
          dataType: ['text'],
        },
        {
          name: 'userId',
          description: 'ID of the user this episode belongs to',
          dataType: ['text']
        }
      ]
    };
    
    logger.info(`[MemoryManager] Calling Weaviate schema.classCreator() for EpisodeEmbedding`);
    
    try {
      const result = await client.schema.classCreator().withClass(classObj).do();
      logger.info('[MemoryManager] Created EpisodeEmbedding class in Weaviate successfully:', result);
    } catch (innerError) {
      logger.error(`[MemoryManager] Weaviate API error creating EpisodeEmbedding class: ${innerError.message}`);
      if (innerError.response) {
        logger.error(`[MemoryManager] Status: ${innerError.response.status}, Response body: ${JSON.stringify(innerError.response.data || {})}`);
      }
      throw innerError;
    }
  } catch (error) {
    logger.error(`[MemoryManager] Error creating EpisodeEmbedding class: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Creates the ThoughtEmbedding class in Weaviate
 * @param {Object} client - Weaviate client instance
 */
async function createThoughtEmbeddingClass(client) {
  if (!client) {
    logger.error('Weaviate client not available in createThoughtEmbeddingClass');
    throw new Error('Weaviate client is required to create class');
  }
  try {
    logger.info('[MemoryManager] Creating ThoughtEmbedding class with properties: thoughtDbId, name, userId');
    
    const classObj = {
      class: 'ThoughtEmbedding',
      description: 'A thought insight with its vector',
      vectorizer: 'none', // Set vectorizer to none as we provide vectors manually
      vectorIndexType: 'hnsw', // Explicitly setting to match Memory class
      vectorIndexConfig: {
        distance: 'cosine', // Using cosine similarity like Memory class has
      },
      properties: [
        {
          name: 'thoughtDbId',
          description: 'ID of the Thought in the database',
          dataType: ['text'],
        },
        {
          name: 'name',
          description: 'Short label for the thought',
          dataType: ['text'],
        },
        {
          name: 'userId',
          description: 'ID of the user this thought belongs to',
          dataType: ['text']
        }
      ]
    };
    
    logger.info(`[MemoryManager] Calling Weaviate schema.classCreator() for ThoughtEmbedding`);
    
    try {
      const result = await client.schema.classCreator().withClass(classObj).do();
      logger.info('[MemoryManager] Created ThoughtEmbedding class in Weaviate successfully:', result);
    } catch (innerError) {
      logger.error(`[MemoryManager] Weaviate API error creating ThoughtEmbedding class: ${innerError.message}`);
      if (innerError.response) {
        logger.error(`[MemoryManager] Status: ${innerError.response.status}, Response body: ${JSON.stringify(innerError.response.data || {})}`);
      }
      throw innerError;
    }
  } catch (error) {
    logger.error(`[MemoryManager] Error creating ThoughtEmbedding class: ${error.message}`, { error });
    throw error;
  }
}

// --- Memory Manager Class ---

/**
 * Expands a vector to the target dimension by duplicating values
 * @param {number[]} vector - Original vector
 * @param {number} targetDim - Target dimension
 * @returns {number[]} - Expanded vector
 */
async function expandVector(vector, targetDim) {
  if (vector.length === targetDim) return vector;
  
  if (vector.length > targetDim) {
    // Truncate if vector is too long
    return vector.slice(0, targetDim);
  }
  
  // Expand by duplicating values
  const expandedVector = new Array(targetDim).fill(0);
  
  // Copy original values
  for (let i = 0; i < vector.length; i++) {
    expandedVector[i] = vector[i];
  }
  
  // Fill remaining positions
  for (let i = vector.length; i < targetDim; i++) {
    expandedVector[i] = vector[i % vector.length];
  }
  
  // Normalize to maintain unit length
  const magnitude = Math.sqrt(expandedVector.reduce((sum, val) => sum + val * val, 0));
  return expandedVector.map(val => val / magnitude);
}

class MemoryManager {
  constructor() {
    this.isWeaviateAvailable = false;
    this.weaviateCheckInterval = null;
    this.importanceCache = new Map();
  }

  async initialize() {
    logger.info('[MemoryManager] Initializing...');
    this.isWeaviateAvailable = await checkWeaviateSchema();
    logger.info(`[MemoryManager] Weaviate availability status: ${this.isWeaviateAvailable}`);
    // this.startPeriodicWeaviateCheck();
  }

  async processMemoryPipeline(rawData) {
    if (!rawData || !rawData.content) {
      logger.warn('[MemoryManager] Skipping processing due to invalid rawData object or empty content.', { rawDataId: rawData?.id });
      return;
    }

    try {
      logger.info(`[MemoryManager] Processing raw data ${rawData.id}`);

      // 1. Evaluate Importance
      const importanceScore = rawData.importanceScore ?? await this.evaluateImportance(
        rawData.content,
        rawData.contentType,
        { userId: rawData.userId, sessionId: rawData.sessionId }
      );

      // Update rawData with the evaluated score if it wasn't set before
      if (rawData.importanceScore === null && importanceScore !== null) {
        try {
          // Use repository
          await rawDataRepository.update(rawData.id, { importanceScore });
          logger.info(`[MemoryManager] Updated rawData ${rawData.id} with importance score: ${importanceScore}`);
        } catch (updateError) {
          logger.error(`[MemoryManager] Failed to update importance score for rawData ${rawData.id}: ${updateError.message}`);
        }
      }

      // Use configured threshold
      if (importanceScore === null || (importanceScore < memoryConfig.defaultImportanceThreshold && !rawData.skipImportanceCheck)) {
        logger.info(`[MemoryManager] RawData ${rawData.id} did not pass importance threshold (Score: ${importanceScore}, Threshold: ${memoryConfig.defaultImportanceThreshold}, Skip check: ${!!rawData.skipImportanceCheck}). Skipping chunking.`);
        // Use repository
        await rawDataRepository.update(rawData.id, { processingStatus: 'processed' });
        return;
      }
      logger.info(`[MemoryManager] RawData ${rawData.id} passed importance check (Score: ${importanceScore}, Skip check: ${!!rawData.skipImportanceCheck})`);

      // 2. Chunk Content
      const chunks = await this.chunkContent(rawData.content, { sourceType: rawData.contentType });
      if (!chunks || chunks.length === 0) {
        logger.warn(`[MemoryManager] No chunks generated for rawData ${rawData.id}.`);
        await rawDataRepository.update(rawData.id, { processingStatus: 'processed' });
        return;
      }
      logger.info(`[MemoryManager] Generated ${chunks.length} chunks for rawData ${rawData.id}`);

      // 3. Store Chunks in Prisma
      const storedChunks = await this.storeChunksWithRepo(rawData, chunks, importanceScore);
      if (!storedChunks || storedChunks.length === 0) {
        logger.error(`[MemoryManager] Failed to store any chunks for rawData ${rawData.id}.`);
        await rawDataRepository.update(rawData.id, { processingStatus: 'error' });
        return; // Ensure exit here if storing fails
      }

      // 4. Generate & Store Embeddings - Pass storedChunks directly
      const embeddingSuccessful = await this.generateAndStoreEmbeddings(storedChunks, rawData, this.isWeaviateAvailable);

      // 5. Update RawData status ONLY if embeddings were successful
      if (embeddingSuccessful) {
        await rawDataRepository.update(rawData.id, { processingStatus: 'processed' });
        logger.info(`[MemoryManager] Successfully processed raw data ${rawData.id} through memory pipeline`);
      } else {
        // If embeddings failed, the rawData status remains 'pending' or becomes 'error' if chunk storage failed earlier.
        // The chunk status would be 'embedding_error' or 'pending_weaviate'.
        logger.warn(`[MemoryManager] Finished processing raw data ${rawData.id} with embedding failure.`);
      }

    } catch (error) {
      logger.error(`[MemoryManager] Error processing memory pipeline for rawData ${rawData.id}: ${error.message}`, { stack: error.stack });
      try {
        // Use repository
        await rawDataRepository.update(rawData.id, { processingStatus: 'error' });
      } catch (updateError) {
        logger.error(`[MemoryManager] Failed to update rawData ${rawData.id} status to error: ${updateError.message}`);
      }
    }
  }

  /**
   * Evaluates the importance of a piece of content.
   * Uses a simple cache to avoid re-evaluating identical content quickly.
   * @param {string} content - The text content.
   * @param {string} type - The type of content (e.g., 'user_chat', 'ai_response').
   * @param {object} metadata - Additional context (userId, sessionId).
   * @returns {Promise<number|null>} Importance score (0-1) or null on error.
   */
  async evaluateImportance(content, type, metadata = {}) {
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return 0; // Assign 0 importance to empty content
    }

    const contentHash = createHash('md5').update(content).digest('hex');
    if (this.importanceCache.has(contentHash)) {
      logger.debug(`[MemoryManager] Using cached importance score for content hash ${contentHash}`);
      return this.importanceCache.get(contentHash);
    }

    logger.info(`[MemoryManager] Evaluating importance for content (type: ${type})`);
    const prompt = this.createImportanceEvaluationPrompt(type, content, metadata);

    try {
      const completion = await aiService.getCompletion(prompt);
      if (!completion) {
        logger.error('[MemoryManager] Failed to get completion for importance evaluation.');
        return null;
      }

      // Flexible parsing: Trim whitespace and try to parse any number
      const cleanedCompletion = completion.trim();
      const score = parseFloat(cleanedCompletion);

      if (!isNaN(score) && score >= 0 && score <= 1) {
        logger.info(`[MemoryManager] Importance score: ${score.toFixed(2)}`);
        this.importanceCache.set(contentHash, score);
        // Keep original cache timeout
        setTimeout(() => this.importanceCache.delete(contentHash), 5 * 60 * 1000); 
        return score;
      }

      logger.warn('[MemoryManager] Could not parse importance score from completion:', { completion });
      return null; // Return null if parsing failed
    } catch (error) {
      logger.error(`[MemoryManager] Error during importance evaluation: ${error.message}`);
      return null;
    }
  }

  /**
   * Creates the prompt for the AI importance evaluation task using config templates.
   */
  createImportanceEvaluationPrompt(type, content, metadata) {
    const basePrompt = aiConfig.importanceEvaluationBasePrompt;
    const guidance = aiConfig.importanceGuidance[type] || aiConfig.importanceGuidance.default;

    let prompt = basePrompt
        .replace('{CONTENT_TYPE}', type || 'unknown')
        .replace('{USER_ID}', metadata.userId || 'N/A')
        .replace('{SESSION_ID}', metadata.sessionId || 'N/A')
        .replace('{CONTENT}', content)
        .replace('{TYPE_SPECIFIC_GUIDANCE}', guidance);

    return prompt;
  }

  /**
   * Heuristic importance evaluation (Fallback or potential alternative)
   * @param {string} content
   * @param {string} sourceType
   * @returns {number} Heuristic importance score
   */
  heuristicImportanceEvaluation(content, sourceType) {
    let score = 0.5; // Base score
    const length = content.length;

    // Length bonus/penalty
    if (length > 500) score += 0.2;
    if (length < 50) score -= 0.2;

    // Keyword check (example keywords)
    const keywords = ['important', 'remember', 'goal', 'plan', 'deadline', 'project', 'idea', 'insight', 'feeling', 'realized'];
    if (keywords.some(kw => content.toLowerCase().includes(kw))) {
      score += 0.3;
    }

    // Source type bonus
    if (sourceType === 'user_reflection' || sourceType === 'uploaded_document_content') {
        score += 0.1;
    }
    if (sourceType === 'ai_summary' || sourceType === 'ai_insight') {
        score += 0.15;
    }

    // Clamp score between 0.1 and 1.0
    return Math.max(0.1, Math.min(1.0, score));
  }

  /**
   * Chunks content semantically based on token limits.
   * @param {string} content - The text content to chunk.
   * @param {object} metadata - Additional metadata (e.g., sourceType).
   * @returns {Promise<Array<string>>} An array of text chunks.
   */
  async chunkContent(content, metadata = {}) {
    if (!content || typeof content !== 'string') {
      logger.warn('[MemoryManager] Invalid content provided for chunking.');
      return [];
    }

    logger.info(`[MemoryManager] Chunking content: ${content.length} characters`);
    const tokens = encode(content);
    const tokenCount = tokens.length;
    logger.debug(`[MemoryManager] Total tokens: ${tokenCount}`);

    // Use configured chunk sizes
    const minSize = memoryConfig.minChunkSize;
    const maxSize = memoryConfig.maxChunkSize;
    const targetSize = memoryConfig.targetChunkSize;

    if (content.length <= maxSize) {
      logger.debug('[MemoryManager] Content is smaller than max chunk size, returning as single chunk.');
      return [content]; // Return as a single chunk if small enough
    }

    // Simple chunking strategy: split by paragraphs first, then sentences.
    // More sophisticated strategies (e.g., using token counts more directly)
    // could be implemented later.

    const chunks = [];
    let currentChunk = '';

    // Split by double newlines (paragraphs), then single newlines, then sentences.
    const potentialSeparators = ['\n\n', '\n', '. ', '? ', '! '];
    let segments = [content];

    // Iteratively split by separators
    potentialSeparators.forEach(separator => {
        if (segments.length === 1 && segments[0].length <= maxSize) return; // Stop if already small enough
        
        let newSegments = [];
        segments.forEach(segment => {
            // Only split further if the segment itself is too large
            if (segment.length > minSize) { 
                 newSegments.push(...segment.split(separator).map((s, i, arr) => i < arr.length - 1 ? s + separator.trimEnd() : s));
            } else {
                newSegments.push(segment);
            }
        });
        segments = newSegments.filter(s => s.trim().length > 0); // Remove empty segments
    });
    
    // Combine segments into chunks respecting MAX_CHUNK_SIZE
    segments.forEach(segment => {
        if (!segment || segment.trim().length === 0) return;

        const segmentLength = segment.length;
        const currentChunkLength = currentChunk.length;

        if (currentChunkLength === 0) {
            // Start a new chunk
            if (segmentLength <= maxSize) {
                currentChunk = segment;
            } else {
                // If a single segment exceeds maxSize, split it hard
                // This is a fallback, ideally semantic splitting prevents this.
                for (let i = 0; i < segmentLength; i += maxSize) {
                    chunks.push(segment.substring(i, i + maxSize));
                }
            }
        } else if (currentChunkLength + segmentLength <= maxSize) {
            // Add segment to the current chunk
            currentChunk += segment;
        } else {
            // Current chunk is full, push it and start a new one
            chunks.push(currentChunk);
            if (segmentLength <= maxSize) {
                 currentChunk = segment;
            } else {
                 // If the new segment exceeds maxSize, split it hard
                 for (let i = 0; i < segmentLength; i += maxSize) {
                     chunks.push(segment.substring(i, i + maxSize));
                 }
                 currentChunk = ''; // Reset chunk after hard split
            }
        }
    });

    // Add the last remaining chunk if it's not empty
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    // Post-processing: Ensure chunks meet minimum size (merge small ones)
    const mergedChunks = [];
    let tempChunk = '';
    chunks.forEach((chunk, index) => {
      if (chunk.length < minSize && index < chunks.length - 1) {
        // If chunk is too small and not the last one, merge with next
        tempChunk += chunk;
      } else {
        // Add tempChunk (if any) and the current chunk
        mergedChunks.push(tempChunk + chunk);
        tempChunk = ''; // Reset tempChunk
      }
    });
    // Handle potential remaining tempChunk if last chunk was small
    if (tempChunk.length > 0) {
         if (mergedChunks.length > 0) {
             mergedChunks[mergedChunks.length - 1] += tempChunk;
         } else {
             mergedChunks.push(tempChunk); // Should only happen if there was only one tiny chunk initially
         }
    }

    const finalChunks = mergedChunks.filter(chunk => chunk.trim().length > 0);
    logger.info(`[MemoryManager] Created ${finalChunks.length} chunks from content`);
    return finalChunks;

    // Helper function to count tokens (can be moved to utils)
    // const countTokens = (str) => encode(str).length;
  }

  /**
   * Stores chunked content using the Chunk repository.
   * @param {object} rawData - The original raw data record.
   * @param {Array<string>} chunks - Array of text chunks.
   * @param {number} importanceScore - The calculated importance score.
   * @returns {Promise<Array<object>>} Array of created Chunk records.
   */
  async storeChunksWithRepo(rawData, chunks, importanceScore) {
    if (!chunks || chunks.length === 0) return [];

    const createdChunks = [];
    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunkText = chunks[i];
        // Call repository create method
        const chunkRecord = await chunkRepository.create({
          rawDataId: rawData.id,
          userId: rawData.userId,
          sessionId: rawData.sessionId,
          text: chunkText,
          index: i,
          importanceScore: importanceScore,
          processingStatus: 'pending',
          metadata: { // Prepare metadata object
            contentType: rawData.contentType,
            sourceCreatedAt: rawData.createdAt,
            perspectiveOwnerId: rawData.perspectiveOwnerId,
            subjectId: rawData.subjectId,
            topicKey: rawData.topicKey
          }
        });
        createdChunks.push(chunkRecord);
      }
      logger.info(`[MemoryManager] Stored ${createdChunks.length} chunks via repository for rawData ${rawData.id}`);
      return createdChunks;
    } catch (error) {
      logger.error(`[MemoryManager] Error storing chunks via repository for rawData ${rawData.id}: ${error.message}`, { stack: error.stack });
      return createdChunks; // Return potentially partially created chunks
    }
  }

  /**
   * Generates embeddings for stored chunks and updates status using repositories.
   * Returns true if successful, false otherwise.
   */
  async generateAndStoreEmbeddings(storedChunks, rawData, isWeaviateAvailable) {
    if (!storedChunks || storedChunks.length === 0) return true; // No chunks, technically successful

    const chunkTexts = storedChunks.map(chunk => chunk.text);
    logger.info(`[MemoryManager] Generating embeddings for ${chunkTexts.length} stored chunks (rawData ${rawData.id})`);

    let embeddings;
    try {
        embeddings = await aiService.generateEmbeddings(chunkTexts);
    } catch (embeddingError) {
         logger.error(`[MemoryManager] AI Service error generating embeddings for rawData ${rawData.id}: ${embeddingError.message}`);
         embeddings = null; // Treat service error same as getting null/wrong count
    }

    if (!embeddings || embeddings.length !== storedChunks.length) {
      logger.error(`[MemoryManager] Failed to generate embeddings or mismatch in count for rawData ${rawData.id}. Expected ${storedChunks.length}, Got ${embeddings?.length}`);
      const chunkIds = storedChunks.map(c => c.id);
      try {
          await chunkRepository.updateMany({ where: { id: { in: chunkIds } }, data: { processingStatus: 'embedding_error' } });
      } catch (updateError) {
           logger.error(`[MemoryManager] Failed to update chunk status to embedding_error for rawData ${rawData.id}: ${updateError.message}`);
      }
      return false; // Signal failure
    }

    logger.info(`[MemoryManager] Successfully generated ${embeddings.length} embeddings.`);

    const weaviateObjects = [];
    const chunkIdsToUpdate = storedChunks.map(c => c.id);

    for (let i = 0; i < storedChunks.length; i++) {
      const chunk = storedChunks[i];
      const embedding = embeddings[i];

      // Prepare object for Weaviate if available
      if (isWeaviateAvailable) {
        // Debug log for mapping verification
        logger.debug(`[MemoryManager] Mapping chunk.id: ${chunk.id} to chunkDbId property`);
        weaviateObjects.push({
          class: 'ChunkEmbedding',
          id: uuidv4(), // Generate unique UUID for Weaviate object
          properties: {
            chunkDbId: chunk.id, // IMPORTANT: This is the key property for mapping to Prisma
            rawDataId: chunk.rawDataId,
            userId: chunk.userId,
            sessionId: chunk.sessionId,
            text: chunk.text,
            chunkIndex: chunk.index,
            tokenCount: chunk.tokenCount,
            importance: chunk.importanceScore,
            contentType: chunk.metadata?.contentType || rawData.contentType,
            sourceCreatedAt: chunk.metadata?.sourceCreatedAt || rawData.createdAt,
            perspectiveOwnerId: chunk.metadata?.perspectiveOwnerId || rawData.perspectiveOwnerId,
            subjectId: chunk.metadata?.subjectId || rawData.subjectId,
            topicKey: chunk.metadata?.topicKey || rawData.topicKey,
            skipImportanceCheck: !!rawData.skipImportanceCheck,
          },
          vector: embedding
        });
      }
    }

    // chunkIdsToUpdate was defined earlier using map
    logger.info(`[MemoryManager] Finished preparing ${weaviateObjects.length} Weaviate objects.`);

    // Batch update Prisma statuses
    const newStatus = isWeaviateAvailable ? 'processed' : 'pending_weaviate';
    try {
        await chunkRepository.updateMany({
            where: { id: { in: chunkIdsToUpdate } },
            data: { processingStatus: newStatus }
        });
        logger.info(`[MemoryManager] Updated status to '${newStatus}' for ${chunkIdsToUpdate.length} chunks in Prisma.`);
    } catch (updateError) {
        logger.error(`[MemoryManager] Failed to batch update chunk statuses to ${newStatus}: ${updateError.message}`, { stack: updateError.stack });
        return false; 
    }

    // Batch import to Weaviate
    let importAttempted = false;
    let importSuccess = false;
    try {
        if (isWeaviateAvailable && weaviateObjects.length > 0) {
          importAttempted = true;
          importSuccess = await this.batchImportToWeaviate(weaviateObjects, 'ChunkEmbedding');
          
          // ADD VERIFICATION STEP: Check if at least one chunk was properly imported
          if (importSuccess && weaviateObjects.length > 0) {
            try {
              const client = weaviateClientUtil.getClient();
              // Select the first chunk to verify
              const sampleChunk = weaviateObjects[0];
              const sampleChunkDbId = sampleChunk.properties.chunkDbId;
              
              // Wait a short time for indexing
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              // Verify the import with GraphQL
              logger.info(`[MemoryManager] Verifying import for chunk ${sampleChunkDbId}`);
              const verifyResult = await client.graphql
                .get()
                .withClassName('ChunkEmbedding')
                .withFields('chunkDbId _additional { id vector }')
                .withWhere({
                  path: ['chunkDbId'],
                  operator: 'Equal',
                  valueString: sampleChunkDbId
                })
                .do();
              
              const foundChunks = verifyResult?.data?.Get?.ChunkEmbedding || [];
              if (foundChunks.length > 0 && foundChunks[0]._additional?.vector) {
                logger.info(`[MemoryManager] Successfully verified vector in Weaviate for chunk ${sampleChunkDbId}`);
              } else {
                logger.warn(`[MemoryManager] Vector verification failed for chunk ${sampleChunkDbId}. Response: ${JSON.stringify(verifyResult?.data || {})}`);
                // Still consider success if the batch import reported success
              }
            } catch (verifyError) {
              logger.error(`[MemoryManager] Error verifying vector import: ${verifyError.message}`);
              // Continue despite verification error
            }
          }
           
           if (!importSuccess && newStatus === 'processed') {
              return false; // Signal overall failure due to Weaviate import issue
           } else if (!importSuccess) {
                 logger.warn(`[MemoryManager] Weaviate import failed for rawData ${rawData.id}. Chunks remain 'pending_weaviate'.`);
                 return false; // Signal failure
           }
        } else if (!isWeaviateAvailable) {
          logger.warn(`[MemoryManager] Weaviate not available. Skipping import.`);
          return true; // Return true because embedding itself was okay, just waiting for Weaviate
        }
    } catch (importError) {
        logger.error(`[MemoryManager] Error during Weaviate import process for rawData ${rawData.id}: ${importError.message}`, { stack: importError.stack });
        return false; // Fail if the import process itself throws an error
    }

    // --- Trigger Agent Processing --- 
    if (importSuccess) { // Only trigger if Weaviate import was successful
        const episodeAgentService = require('./episodeAgent'); 
        for (const chunk of storedChunks) {
            const delayMs = 7000; // Use a longer delay (7 seconds) to allow Weaviate indexing to complete
            logger.debug(`[MemoryManager->Timeout] Scheduling episodeAgent call for Chunk ID: ${chunk.id} in ${delayMs}ms`);
            setTimeout(() => {
                logger.info(`[MemoryManager->Timeout] Executing delayed call to episodeAgent for Chunk ID: ${chunk.id}`);
                try {
                    episodeAgentService.processChunk(chunk.id, chunk.userId);
                } catch (agentError) {
                    logger.error(`[MemoryManager->Timeout] Error calling episodeAgentService.processChunk for ${chunk.id}: ${agentError.message}`, { stack: agentError.stack });
                }
            }, delayMs);
        }
    } else {
        logger.warn(`[MemoryManager] Skipping EpisodeAgent trigger due to Weaviate import failure for rawData ${rawData.id}.`);
    }
    
    return true; // Signal success of this stage (embedding+import attempted)
  }

  /**
   * Batches object imports to Weaviate.
   * Returns true if batch completed (or no objects), false on error.
   */
  async batchImportToWeaviate(objects, className = 'ChunkEmbedding') {
    const client = weaviateClientUtil.getClient();
    if (!client || !this.isWeaviateAvailable) {
      logger.warn(`[MemoryManager] Weaviate client not available or not connected. Skipping batch import for ${className}.`);
      return true; // No objects, technically successful
    }
    if (!objects || objects.length === 0) {
      logger.info(`[MemoryManager] No objects provided for Weaviate batch import to ${className}.`);
      return true; // No objects, technically successful
    }

    // Use configured batch size
    const batchSize = memoryConfig.weaviateBatchSize;
    let batcher = client.batch.objectsBatcher();
    let counter = 0;
    let totalImported = 0;
    let importHasErrors = false;

    logger.info(`[MemoryManager] Preparing ${objects.length} objects for Weaviate batch import to class ${className}`);

    for (const obj of objects) {
      batcher = batcher.withObject(obj);

      if (++counter === batchSize) {
        try {
          logger.debug(`[MemoryManager] Executing Weaviate batch of ${counter} objects`);
          const results = await batcher.do();
          // Check for errors in results
          // --- Uncomment Enhanced Logging --- 
          logger.debug(`[MemoryManager] Weaviate Batch Result (partial batch): ${JSON.stringify(results, null, 2)}`);
          // --- End Uncomment --- 
          results.forEach(result => {
            if (result.result?.errors) {
              logger.error(`[MemoryManager] Error importing object ${result.id} to Weaviate:`, { errors: result.result.errors });
              importHasErrors = true; // Track if any object failed
            }
          });
          totalImported += counter; // Assume success if no specific error logged
          logger.debug(`[MemoryManager] Batch import successful. Total imported so far: ${totalImported}`);
        } catch (error) {
          logger.error(`[MemoryManager] Error during Weaviate batch import: ${error.message}`, { stack: error.stack });
          // Decide how to handle batch failure - retry? Mark chunks as pending?
        }
        // Reset batcher and counter
        batcher = client.batch.objectsBatcher();
        counter = 0;
      }
    }

    // Send the last remaining batch
    if (counter > 0) {
      try {
        logger.debug(`[MemoryManager] Executing final Weaviate batch of ${counter} objects`);
        const results = await batcher.do();
        // --- Uncomment Enhanced Logging --- 
        logger.debug(`[MemoryManager] Weaviate Batch Result (final batch): ${JSON.stringify(results, null, 2)}`);
        // --- End Uncomment --- 
        results.forEach(result => {
           if (result.result?.errors) {
             logger.error(`[MemoryManager] Error importing object ${result.id} to Weaviate:`, { errors: result.result.errors });
             importHasErrors = true; // Track if any object failed
           }
        });
        totalImported += counter;
      } catch (error) {
        logger.error(`[MemoryManager] Error during final Weaviate batch import: ${error.message}`, { stack: error.stack });
      }
    }

    logger.info(`[MemoryManager] Finished Weaviate batch import for ${totalImported} objects to class ${className}. Errors: ${importHasErrors}`);
    return !importHasErrors; // Return true only if NO errors occurred during import
  }

  /**
   * Starts a periodic check for Weaviate connection status.
   */
  startPeriodicWeaviateCheck() {
    if (this.weaviateCheckInterval) {
      clearInterval(this.weaviateCheckInterval);
    }
    // Check every 5 minutes (adjust interval as needed)
    this.weaviateCheckInterval = setInterval(async () => {
      const wasAvailable = this.isWeaviateAvailable;
      this.isWeaviateAvailable = await weaviateClientUtil.checkConnection();
      if (this.isWeaviateAvailable && !wasAvailable) {
        logger.info('[MemoryManager] Weaviate connection re-established. Processing pending chunks...');
        // Add logic here to find and process chunks with status 'pending_weaviate'
        this.processPendingWeaviateChunks();
      } else if (!this.isWeaviateAvailable && wasAvailable) {
        logger.warn('[MemoryManager] Weaviate connection lost.');
      }
    }, 5 * 60 * 1000);
  }

  /**
    * Finds chunks pending Weaviate import and processes them.
    */
  async processPendingWeaviateChunks() {
      if (!this.isWeaviateAvailable) return;

      logger.info('[MemoryManager] Checking for chunks pending Weaviate import...');
      try {
          // Use repository
          const pendingChunks = await chunkRepository.findMany({
              where: { processingStatus: 'pending_weaviate' },
              take: 100 // Process in batches
          });

          if (pendingChunks.length === 0) {
              logger.info('[MemoryManager] No chunks pending Weaviate import found.');
              return;
          }

          logger.info(`[MemoryManager] Found ${pendingChunks.length} chunks pending Weaviate import. Regenerating embeddings and importing...`);

          // Regenerate embeddings (as they weren't stored) and import
          await this.generateAndStoreEmbeddings(pendingChunks, { id: 'pending_processing' }, true);

          // Recursively call if more might be pending
          if (pendingChunks.length === 100) {
              this.processPendingWeaviateChunks();
          }

      } catch (error) {
          logger.error(`[MemoryManager] Error processing pending Weaviate chunks: ${error.message}`, { stack: error.stack });
      }
  }

  /**
   * Retrieves relevant memories based on a query.
   * @param {string} query - The query text.
   * @param {string} userId - The user ID.
   * @param {object} options - Retrieval options.
   * @param {number} [options.limit=memoryConfig.defaultRetrievalLimit] - Max memories to return.
   * @param {number} [options.minImportance=memoryConfig.defaultRetrievalMinImportance] - Min importance score.
   * @param {number} [options.certainty=memoryConfig.defaultRetrievalCertainty] - Min similarity/certainty.
   * @returns {Promise<Array<object>>} Array of relevant memories.
   */
  async retrieveMemories(query, userId, options = {}) {
    const client = weaviateClientUtil.getClient();
    if (!client) {
      logger.error('[MemoryManager] Weaviate client not available for memory retrieval.');
      return [];
    }

    const {
      limit = memoryConfig.defaultRetrievalLimit,
      minImportance = memoryConfig.defaultRetrievalMinImportance,
      certainty = memoryConfig.defaultRetrievalCertainty,
      includeEpisodes = true,
      includeChunks = true
    } = options;

    try {
      // 1. Generate query embedding
      const queryEmbedding = await aiService.generateEmbeddings(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        logger.error('[MemoryManager] Failed to generate embedding for retrieval query.');
        return [];
      }
      const originalQueryVector = queryEmbedding[0]; // generateEmbeddings returns array of vectors
      
      // Check vector dimensions and expand if needed
      let queryVector;
      try {
        // For EpisodeEmbedding, we need 1536 dimensions
        const episodeClassDimension = aiConfig.embeddingDimension || 1536;
        
        if (originalQueryVector.length !== episodeClassDimension) {
          logger.info(`[MemoryManager] Expanding query vector from ${originalQueryVector.length} to ${episodeClassDimension} dimensions for EpisodeEmbedding search`);
          queryVector = await expandVector(originalQueryVector, episodeClassDimension);
        } else {
          queryVector = originalQueryVector;
        }
      } catch (dimensionError) {
        logger.error(`[MemoryManager] Error expanding vector dimensions: ${dimensionError.message}`);
        queryVector = originalQueryVector; // Fallback to original vector
      }

      // --- Multi-Stage Retrieval --- 
      const retrievedMemories = [];
      const retrievedIds = new Set(); // Keep track of retrieved entity IDs

      // Stage 1: Search relevant Episodes by centroid vectors
      logger.info('[MemoryManager] Stage 1: Searching EpisodeEmbedding by centroid vectors');
      let episodeResults = [];
      
      if (includeEpisodes) {
        try {
          const episodeResponse = await client.graphql
            .get()
            .withClassName('EpisodeEmbedding')
            .withFields('episodeDbId title userId _additional { certainty }')
            .withNearVector({ vector: queryVector, certainty })
            .withWhere({
              operator: 'Equal',
              path: ['userId'],
              valueText: userId,
            })
            .withLimit(limit)
            .do();
            
          episodeResults = episodeResponse?.data?.Get?.EpisodeEmbedding || [];
          logger.info(`[MemoryManager] Found ${episodeResults.length} relevant episodes.`);
          
          // Fetch additional episode content from the database to enrich the episode data
          for (const ep of episodeResults) {
            if (!retrievedIds.has(ep.episodeDbId)) {
              // Fetch more detailed episode data from the database
              try {
                const episodeData = await prisma.episode.findUnique({
                  where: { id: ep.episodeDbId },
                  include: {
                    chunks: {
                      include: {
                        chunk: {
                          select: {
                            id: true,
                            text: true,
                            rawDataId: true
                          }
                        }
                      },
                      take: 10 // Increased limit for more chunks
                    }
                  }
                });
                
                if (episodeData) {
                  // Add to retrievedMemories with the narrative and linked chunks
                  retrievedMemories.push({
                    type: 'episode',
                    id: episodeData.id,
                    title: episodeData.title,
                    content: episodeData.narrative,
                    similarity: ep._additional.certainty,
                    chunks: episodeData.chunks.map(ce => ({
                      id: ce.chunk.id,
                      text: ce.chunk.text
                    }))
                  });
                  
                  // If we want to include chunks, add them as separate memories too
                  if (includeChunks && episodeData.chunks && episodeData.chunks.length > 0) {
                    for (const ce of episodeData.chunks) {
                      if (ce.chunk && ce.chunk.text && !retrievedIds.has(ce.chunk.id)) {
                        retrievedMemories.push({
                          type: 'chunk',
                          id: ce.chunk.id,
                          text: ce.chunk.text,
                          episodeId: episodeData.id,
                          episodeTitle: episodeData.title,
                          similarity: ep._additional.certainty * 0.9 // Slightly lower certainty
                        });
                        retrievedIds.add(ce.chunk.id);
                      }
                    }
                  }
                  
                  retrievedIds.add(ep.episodeDbId);
                }
              } catch (dbError) {
                logger.error(`[MemoryManager] Error fetching episode ${ep.episodeDbId} from database: ${dbError.message}`);
              }
            }
          }
        } catch (episodeError) {
          logger.error(`[MemoryManager] Error retrieving episodes: ${episodeError.message}`);
        }
      }
      
      // Stage 2: If we still need more results, search individual chunks
      if (includeChunks && retrievedMemories.length < limit) {
        try {
          // For ChunkEmbedding search, check if we need to adjust dimension
          let chunkQueryVector = originalQueryVector;
          const chunkClassDimension = 768; // ChunkEmbedding typically uses 768 dimensions
          
          if (originalQueryVector.length !== chunkClassDimension) {
            logger.info(`[MemoryManager] Adjusting query vector from ${originalQueryVector.length} to ${chunkClassDimension} dimensions for ChunkEmbedding search`);
            chunkQueryVector = await expandVector(originalQueryVector, chunkClassDimension);
          }
          
          logger.info('[MemoryManager] Stage 2: Searching ChunkEmbedding directly');
          
          const remainingLimit = limit - retrievedMemories.length;
          
          const chunkResponse = await client.graphql
            .get()
            .withClassName('ChunkEmbedding')
            .withFields('chunkDbId text importance userId _additional { certainty }')
            .withNearVector({ vector: chunkQueryVector, certainty })
            .withWhere({
              operator: 'And',
              operands: [
                {
                  operator: 'Equal',
                  path: ['userId'],
                  valueText: userId,
                },
                {
                  operator: 'GreaterThanEqual',
                  path: ['importance'],
                  valueNumber: minImportance,
                }
              ]
            })
            .withLimit(remainingLimit)
            .do();
            
          const chunkResults = chunkResponse?.data?.Get?.ChunkEmbedding || [];
          logger.info(`[MemoryManager] Found ${chunkResults.length} additional chunks.`);
          
          // Add chunks to retrievedMemories
          for (const chunk of chunkResults) {
            if (!retrievedIds.has(chunk.chunkDbId)) {
              retrievedMemories.push({
                type: 'chunk',
                id: chunk.chunkDbId,
                text: chunk.text,
                importance: chunk.importance,
                similarity: chunk._additional.certainty
              });
              retrievedIds.add(chunk.chunkDbId);
            }
          }
        } catch (chunkError) {
          logger.error(`[MemoryManager] Error retrieving chunks: ${chunkError.message}`);
        }
      }
      
      // Sort by similarity/certainty
      retrievedMemories.sort((a, b) => b.similarity - a.similarity);
      
      // Return the combined results
      return retrievedMemories;
    } catch (error) {
      logger.error(`[MemoryManager] Error during memory retrieval: ${error.message}`, { error });
      return [];
    }
  }
}

// --- Singleton Instance Creation & Export ---

// Create a single instance of the MemoryManager
const memoryManagerInstance = new MemoryManager();

// Initialize the instance (Consider moving this to a central app bootstrap if async issues arise)
// For now, we initialize it here. The initialize method itself logs progress/errors.
memoryManagerInstance.initialize(); 

// Export the singleton instance
module.exports = memoryManagerInstance;
module.exports.expandVector = expandVector; // Export the expandVector function