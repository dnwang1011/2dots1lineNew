// src/services/memoryManager.service.js
// Service for managing the memory processing pipeline

const { PrismaClient } = require('@prisma/client');
// Replace local Prisma instance with singleton
// const prisma = new PrismaClient();
const { prisma } = require('../db/prisma'); // Use the singleton instance
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

  logger.info('[MemoryManager] Checking Weaviate schema for V2 memory models...');
  
  // Add diagnostics
  await inspectWeaviateSchema(client);
  
  try {
    // Get the schema and check for required classes
    const schema = await client.schema.getter().do();
    const existingClasses = schema.classes?.map(c => c.class) || [];
    
    logger.info(`[MemoryManager] Found existing classes: ${existingClasses.join(', ') || 'none'}`);
    
    // --- V1 Cleanup Start ---
    // Attempt to delete the legacy Memory class if it exists
    if (existingClasses.includes('Memory')) {
        logger.info('[MemoryManager] Attempting to delete legacy Memory class...');
        try {
            await client.schema.classDeleter().withClassName('Memory').do();
            logger.info('[MemoryManager] Successfully deleted legacy Memory class.');
            // Remove 'Memory' from existingClasses array if deletion was successful
            const index = existingClasses.indexOf('Memory');
            if (index > -1) {
                existingClasses.splice(index, 1);
            }
        } catch (deleteError) {
            // We expect 404 if it's already gone, log other errors
            if (deleteError.statusCode !== 404) {
                logger.error('[MemoryManager] Failed to delete legacy Memory class:', { error: deleteError });
                // Decide if this is critical. For now, we'll proceed.
            } else {
                logger.info('[MemoryManager] Legacy Memory class not found or already deleted.');
            }
        }
    } else {
        logger.info('[MemoryManager] Legacy Memory class not found.');
    }
    // --- V1 Cleanup End ---
    
    // Check for new V2 classes
    let needToCreateChunkEmbeddingClass = !existingClasses.includes('ChunkEmbedding');
    let needToCreateEpisodeEmbeddingClass = !existingClasses.includes('EpisodeEmbedding');
    let needToCreateThoughtEmbeddingClass = !existingClasses.includes('ThoughtEmbedding');
    
    // Create any missing classes
    if (needToCreateChunkEmbeddingClass) {
      logger.info('[MemoryManager] ChunkEmbedding class not found, creating it...');
      await createChunkEmbeddingClass(client);
    } else {
      logger.info('[MemoryManager] ChunkEmbedding class exists.');
      // Check if any properties are missing and add them
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
    
    // Update checking for KnowledgeNode/Relationship to also standardize vector config
    let needToCreateKnowledgeNodeClass = !existingClasses.includes('KnowledgeNode');
    let needToCreateRelationshipClass = !existingClasses.includes('Relationship');
    
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
    logger.info('[MemoryManager] Creating ChunkEmbedding class with properties: chunkDbId, text, rawDataId, importance, userId');
    
    const classObj = {
      class: 'ChunkEmbedding',
      description: 'A memory chunk with its associated embedding vector',
      vectorizer: 'none', // Set vectorizer to none as we provide vectors manually
      vectorIndexType: 'hnsw', // Explicitly setting to match Memory class
      vectorIndexConfig: {
        distance: 'cosine', // Using cosine similarity like Memory class has
      },
      properties: [
        {
          name: 'chunkDbId',
          description: 'ID of the ChunkEmbedding in the database',
          dataType: ['text'],
        },
        {
          name: 'text',
          description: 'The full text content of the chunk',
          dataType: ['text'],
        },
        {
          name: 'rawDataId',
          description: 'ID of the source raw data',
          dataType: ['text']
        },
        {
          name: 'importance',
          description: 'Importance score of the memory (0-1)',
          dataType: ['number']
        },
        {
          name: 'userId',
          description: 'ID of the user this memory belongs to',
          dataType: ['text']
        }
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
      
      // Check if this content is flagged as forceImportant (from document upload)
      const forceImportant = !!rawData.forceImportant;
      if (forceImportant) {
        logger.info(`[MemoryManager] Raw data ${rawData.id} is flagged as forceImportant, will keep all chunks`);
      }
      
      // Step 1: Evaluate importance
      const importanceScore = await this.evaluateImportance(content, type, metadata);
      
      // Update raw data with importance score
      await prisma.rawData.update({
        where: { id: rawData.id },
        data: { importanceScore }
      });
      
      // Skip further processing if below importance threshold AND not forceImportant
      if (importanceScore < DEFAULT_IMPORTANCE_THRESHOLD && !forceImportant) {
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
         rawDataId: rawData.id,
         forceImportant: forceImportant // Pass the forceImportant flag to chunking
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
    if (sourceType === 'uploaded_file') {
      score += 0.4; // Increased boost for file uploads
    }
    
    // Longer content might be more important (up to a point)
    const length = content.length;
    if (length > 200) score += 0.1;
    
    // Questions might be important (less likely in file uploads)
    if (sourceType !== 'uploaded_file' && content.includes('?')) score += 0.1;
    
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
    const contentSampleLength = (type === 'uploaded_file' || type === 'document') ? 1000 : 500;
    
    return `
You are an importance evaluator for a personal memory system. Your task is to assign an importance score 
between 0 and 1 to the given content. Consider these factors:

1.  **High Importance (0.7-0.9)**:
    *   Personal information: Specific names, dates, locations, contact info, preferences, experiences.
    *   Emotional content: Strong emotions, significant life events mentioned.
    *   Actionable information: Tasks, deadlines, commitments, plans.
    *   Unique or rare information: Uncommon facts, specialized knowledge, key insights.
    *   **Uploaded File/Document Content**: Content originating from files ('uploaded_file') or documents, especially if it contains detailed information, profiles, reports, or structured data. Assign higher scores if the content seems comprehensive or like a reference document.
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
      logger.warn('[MemoryManager] Cannot chunk empty or non-string content');
      return [];
    }

    // Check if this content is flagged as forceImportant (for document uploads)
    const forceImportant = !!metadata.forceImportant;
    if (forceImportant) {
      logger.info(`[MemoryManager] Content is flagged as forceImportant, all chunks will be kept`);
    }

    logger.info(`[MemoryManager] Chunking content: ${content.length} characters`);
    
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
            metadata: { ...metadata, forceImportant } // Include forceImportant flag
          });
        } else {
          // If too large, split by paragraphs or just characters
          const paragraphs = content.split(/\n\s*\n/);
          if (paragraphs.length > 1) {
            for (const paragraph of paragraphs) {
              if (paragraph.trim().length > 0) {
                chunks.push({
                  text: paragraph.trim(),
                  metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
                  metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
              metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
                  metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
              metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
              metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
            metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
          tokenCount: countTokens(chunk.text),
          forceImportant: forceImportant // Ensure forceImportant is set
        };
      });
      
      logger.info(`[MemoryManager] Created ${chunks.length} chunks from content`);
      return chunks;
    } catch (error) {
      logger.error(`[MemoryManager] Error chunking content: ${error.message}`, { error });
      // Fallback to basic chunking
      if (content.length <= MAX_CHUNK_SIZE) {
        return [{
          text: content,
          metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
              metadata: { ...metadata, forceImportant } // Include forceImportant flag
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
        
        // Check if this chunk is flagged as forceImportant
        const forceImportant = chunk.metadata?.forceImportant || false;
        
        // Generate embedding using AI service
        const vector = await aiService.generateEmbedding(chunk.text);
        
        if (!vector || vector.length === 0) {
          logger.warn(`[MemoryManager] Failed to generate embedding for chunk from rawData ${rawData.id}`);
          continue;
        }

        // Use the new ChunkEmbedding model instead of SemanticChunk + Embedding
        const chunkRow = await prisma.chunkEmbedding.create({
          data: {
            rawDataId: rawData.id,
            text: chunk.text,
            summary: chunk.summary ?? null,
            vector: vector,
            dimension: vector.length,
            importance: chunk.importance || 0.5,
            userId: rawData.userId,
            // Include metadata in JSON format 
            metadata: JSON.stringify({
              ...chunk.metadata,
              forceImportant: forceImportant
            })
          }
        });
        
        // Log whether this chunk was forcibly kept
        if (forceImportant) {
          logger.info(`[MemoryManager] Stored ChunkEmbedding ${chunkRow.id} (index: ${i}) with forceImportant=true for rawData ${rawData.id}`);
        } else {
          logger.info(`[MemoryManager] Stored ChunkEmbedding ${chunkRow.id} (index: ${i}) for rawData ${rawData.id}`);
        }
        
        // Emit event for chunk.added with chunkRow.id (to trigger episodeAgent processing)
        try {
          // Import episodeAgent
          const episodeAgent = require('./episodeAgent');
          // Process the new chunk to find matching episodes
          await episodeAgent.processChunk(chunkRow.id, rawData.userId);
          logger.info(`[MemoryManager] Triggered episodeAgent for ChunkEmbedding ${chunkRow.id}`);
        } catch (agentError) {
          // Log but don't fail the storage process
          logger.error(`[MemoryManager] Failed to trigger episodeAgent: ${agentError.message}`);
        }

        // Add database ID and other relevant info to the result
        storedChunks.push({
          ...chunkRow, // Include all fields from the created record
        });
      }
      
      return storedChunks;
    } catch (error) {
      logger.error(`[MemoryManager] Error storing chunks for rawData ${rawData.id}:`, { error });
      // Throw the error so processRawData catch block handles DB state update
      throw error; 
    }
  }

  /**
   * Prepare and store chunks in Weaviate
   * @param {Array} chunks - Array of ChunkEmbedding objects (already stored in DB)
   * @param {Object} rawData - The raw data record
   * @param {boolean} isWeaviateAvailable - Flag indicating if Weaviate is up
   * @returns {Promise<Array>} - Array of objects ready for Weaviate import
   */
  async generateAndStoreEmbeddings(chunks, rawData, isWeaviateAvailable) {
    if (!chunks || chunks.length === 0) {
      logger.info('[MemoryManager] No chunks to process for Weaviate');
      return [];
    }

    logger.info(`[MemoryManager] Preparing ${chunks.length} ChunkEmbeddings for Weaviate`);
    
    const weaviateObjects = [];

    try {
      // Process each ChunkEmbedding - vectors are already generated and stored
      for (const chunk of chunks) {
        try {
          // No need to generate embeddings or create Embedding records
          // as vectors are already part of ChunkEmbedding
          
          // Only prepare Weaviate object if available
          if (isWeaviateAvailable) {
              const weaviateUuid = uuidv4();
              const weaviateObject = {
                id: weaviateUuid,
                properties: {
                  chunkDbId: chunk.id, // Store the ChunkEmbedding ID from Prisma using the correct property name
                  text: chunk.text,
                  rawDataId: rawData.id,
                  importance: chunk.importance,
                  userId: chunk.userId
                },
                vector: chunk.vector
              };
              weaviateObjects.push(weaviateObject);
          } else {
              logger.warn(`[MemoryManager] Skipping Weaviate object preparation for ChunkEmbedding ${chunk.id} as Weaviate is not available.`);
          }

        } catch (error) {
          logger.error(`[MemoryManager] Error processing Weaviate object for ChunkEmbedding ${chunk?.id}:`, { error });
        }
      }
      
      // Only import if Weaviate is available and objects exist
      if (isWeaviateAvailable && weaviateObjects.length > 0) {
        await this.batchImportToWeaviate(weaviateObjects, 'ChunkEmbedding'); // Updated class name
      } else if (weaviateObjects.length > 0) {
         logger.warn('[MemoryManager] Skipping Weaviate import as client is not available.');
      }
      
      return weaviateObjects;
    } catch (error) {
      logger.error(`[MemoryManager] Error in importChunksToWeaviate for rawData ${rawData?.id}:`, { error });
      return []; 
    }
  }

  /**
   * Batch imports objects to Weaviate
   * @param {Array} objects - Array of objects to import
   * @param {string} className - Name of the class to import into
   * @returns {Promise<boolean>} - Success status
   */
  async batchImportToWeaviate(objects, className = 'ChunkEmbedding') {
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
      
      // Log status changes only, or use debug level for constant checks
      if (wasAvailable && !this.weaviateAvailable) {
        logger.error('[MemoryManager] Weaviate connection lost');
      } else if (!wasAvailable && this.weaviateAvailable) {
        logger.info('[MemoryManager] Weaviate connection restored');
        // Reinitialize schema when connection is restored
        await checkWeaviateSchema(); // Make sure schema check is awaited
      } else {
        // Optional: Log successful periodic checks at debug level
        // logger.debug('[MemoryManager] Periodic Weaviate connection check successful');
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Retrieves memories similar to the provided query using 3-stage search
   * @param {string} query - The search query 
   * @param {string} userId - User ID to filter results
   * @param {Object} options - Search options
   * @param {number} options.limit - Maximum number of results to return (default: 10)
   * @param {number} options.minImportance - Minimum importance score threshold (default: 0.3)
   * @param {number} options.certainty - Minimum similarity score (default: 0.7)
   * @param {string} options.dataType - Filter by data type (optional)
   * @returns {Promise<Array>} - Array of memory objects with similarity scores
   */
  async retrieveMemories(query, userId, options = {}) {
    const client = weaviateClientUtil.getClient();
    if (!client) {
      logger.error('[MemoryManager] Cannot retrieve memories: Weaviate client is unavailable.');
      return [];
    }
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      logger.error('[MemoryManager] Cannot retrieve memories: Invalid query provided.');
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
      const queryEmbedding = await aiService.generateEmbedding(query);
      if (!queryEmbedding || !Array.isArray(queryEmbedding)) {
        logger.error('[MemoryManager] Failed to generate embedding for query');
        return [];
      }

      // ---- STAGE 1: Search EpisodeEmbedding by centroid vectors ----
      logger.info('[MemoryManager] Stage 1: Searching EpisodeEmbedding by centroid vectors');
      
      // Try to find episodes similar to the query
      let episodeResults = [];
      try {
        const episodeQuery = client.graphql
          .get()
          .withClassName('EpisodeEmbedding')
          // Use correct fields for EpisodeEmbedding: episodeDbId, title, userId
          .withFields('episodeDbId title userId _additional { certainty }')
          .withNearVector({
            vector: queryEmbedding,
            certainty: certainty * 0.8 // Slightly lower threshold for episodes
          })
          .withWhere({
            operator: 'Equal',
            path: ['userId'],
            valueString: userId
          })
          .withLimit(5) // Retrieve top episodes
          .do();
        
        const episodeData = await episodeQuery;
        
        if (episodeData?.data?.Get?.EpisodeEmbedding) {
          episodeResults = episodeData.data.Get.EpisodeEmbedding.map(ep => ({
            ...ep,
            id: ep.episodeDbId, // Map back to standard property for application use
            similarity: ep._additional.certainty,
            _additional: undefined,
            type: 'episode'
          }));
          logger.info(`[MemoryManager] Found ${episodeResults.length} relevant episodes`);
        }
      } catch (error) {
        logger.error('[MemoryManager] Error searching EpisodeEmbedding:', { error });
        // Continue with direct chunk search if episode search fails
      }
      
      // ---- STAGE 2: Collect linked ChunkEmbedding ids from episodes + direct search ----
      logger.info('[MemoryManager] Stage 2: Collecting linked chunks and direct chunk search');
      
      let chunkIds = [];
      let directChunkResults = [];
      let linkedChunks = [];
      
      // 2a: Get chunks from episodes if any were found
      if (episodeResults.length > 0) {
        try {
          const episodeIds = episodeResults.map(ep => ep.episodeDbId || ep.id);
          linkedChunks = await prisma.chunkEpisode.findMany({
            where: {
              episodeId: { in: episodeIds }
            },
            select: {
              chunkId: true,
              episode: { select: { id: true } }
            }
          });
          
          chunkIds = linkedChunks.map(link => link.chunkId);
          logger.info(`[MemoryManager] Found ${chunkIds.length} chunks linked to episodes`);
        } catch (error) {
          logger.error('[MemoryManager] Error fetching linked chunk IDs from DB:', { 
            errorMessage: error.message, 
            errorStack: error.stack, 
            errorCode: error.code, // Include Prisma error code if available
            errorMeta: error.meta // Include Prisma error meta if available
          });
        }
      }

      // 2b: Direct chunk search (as fallback or complement)
      try {
        // Only search chunks directly if we didn't find enough through episodes
        if (chunkIds.length < limit) {
          const directChunkLimit = limit - chunkIds.length;
          
          const chunkQuery = client.graphql
            .get()
            .withClassName('ChunkEmbedding')
            // Use correct fields for ChunkEmbedding: chunkDbId, text, rawDataId, importance, userId
            .withFields('chunkDbId text rawDataId importance userId _additional { certainty }')
            .withNearVector({
              vector: queryEmbedding,
              certainty: certainty
            })
            .withWhere({
              operator: 'And',
              operands: [
                {
                  path: ['userId'],
                  operator: 'Equal',
                  valueString: userId
                },
                {
                  path: ['importance'],
                  operator: 'GreaterThanEqual',
                  valueNumber: minImportance
                }
              ]
            })
            .withLimit(directChunkLimit)
            .do();
          
          const chunkData = await chunkQuery;
          
          if (chunkData?.data?.Get?.ChunkEmbedding) {
            directChunkResults = chunkData.data.Get.ChunkEmbedding.map(chunk => ({
              ...chunk,
              id: chunk.chunkDbId, // Map back to standard property for application use
              similarity: chunk._additional.certainty,
              _additional: undefined,
              type: 'chunk'
            }));
            logger.info(`[MemoryManager] Found ${directChunkResults.length} directly relevant chunks`);
          }
        }
      } catch (error) {
        logger.error('[MemoryManager] Error in direct chunk search:', { error });
      }
      
      // 2c: Fetch the full chunk data for episode-linked chunks
      let episodeLinkedChunks = [];
      if (chunkIds.length > 0) {
        try {
          // Fetch the actual chunk data from the database
          const chunkData = await prisma.chunkEmbedding.findMany({
            where: {
              id: { in: chunkIds }
            }
          });
          
          // Since we don't have similarity scores for these, estimate based on parent episode
          episodeLinkedChunks = chunkData.map(chunk => {
            // Try to find which episode this chunk came from
            const relevantEpisode = episodeResults.find(ep => {
              // Find the corresponding ChunkEpisode link to match chunkId and episodeId
              const link = linkedChunks.find(l => l.chunkId === chunk.id && l.episode.id === ep.id);
              return !!link;
            });
            
            return {
              ...chunk,
              type: 'chunk',
              fromEpisode: relevantEpisode?.id,
              episodeTitle: relevantEpisode?.title,
              // Use episode similarity as a proxy, with slight penalty
              similarity: relevantEpisode ? relevantEpisode.similarity * 0.9 : 0.7
            };
          });
        } catch (error) {
          logger.error('[MemoryManager] Error fetching episode-linked chunk data from DB:', { 
            errorMessage: error.message, 
            errorStack: error.stack,
            errorCode: error.code, // Include Prisma error code if available
            errorMeta: error.meta // Include Prisma error meta if available
          });
        }
      }
      
      // ---- STAGE 3: Overlay with Thought search for high-level insights ----
      logger.info('[MemoryManager] Stage 3: Searching for relevant thoughts');
      
      let thoughtResults = [];
      try {
        const thoughtQuery = client.graphql
          .get()
          .withClassName('ThoughtEmbedding')
          // Use correct fields for ThoughtEmbedding: thoughtDbId, name, userId
          .withFields('thoughtDbId name userId _additional { certainty }')
          .withNearVector({
            vector: queryEmbedding,
            certainty: certainty * 0.75 // Lower threshold for abstract thoughts
          })
          .withWhere({
            operator: 'Equal',
            path: ['userId'],
            valueString: userId
          })
          .withLimit(3) // Just a few high-level insights
          .do();
        
        const thoughtData = await thoughtQuery;
        
        if (thoughtData?.data?.Get?.ThoughtEmbedding) {
          thoughtResults = thoughtData.data.Get.ThoughtEmbedding.map(thought => ({
            ...thought,
            id: thought.thoughtDbId, // Map back to standard property for application use
            similarity: thought._additional.certainty,
            _additional: undefined,
            type: 'thought'
          }));
          logger.info(`[MemoryManager] Found ${thoughtResults.length} relevant thoughts`);
        }
      } catch (error) {
        logger.error('[MemoryManager] Error searching ThoughtEmbedding:', { error });
        // Continue without thoughts if this fails
      }
      
      // Combine all results
      const combinedResults = [
        ...episodeResults,
        ...episodeLinkedChunks,
        ...directChunkResults,
        ...thoughtResults
      ];
      
      // Sort by similarity and limit
      const finalResults = combinedResults
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
      
      logger.info(`[MemoryManager] Returning ${finalResults.length} total memories`);
      return finalResults;
    } catch (error) {
      logger.error('[MemoryManager] Error in retrieveMemories:', { error });
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