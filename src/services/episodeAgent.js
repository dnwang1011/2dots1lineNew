// src/services/episodeAgent.js
// Agent for processing chunks and attaching them to episodes

// Version indicator for worker validation
const useGraphQL = true;

const { PrismaClient } = require('@prisma/client');
// Replace local Prisma instance with singleton
// const prisma = new PrismaClient();
const { prisma } = require('../db/prisma'); // Use the singleton instance
const logger = require('../utils/logger').childLogger('EpisodeAgent');
const weaviateClientUtil = require('../utils/weaviateClient');
const cosine = require('compute-cosine-similarity');
const { Queue } = require('bullmq');
// const config = require('../config'); // Removed unused config import
const redisConfig = require('../utils/redisConfig');
const { expandVector } = require('../services/memoryManager.service'); // Make sure expandVector is imported
const aiConfig = require('../../config/ai.config'); // Import aiConfig for target dimension

// Configuration parameters
const EPISODE_TIME_WINDOW = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds
const SIMILARITY_THRESHOLD = 0.65; // Minimum cosine similarity to attach chunk to episode (Increased from 0.7)
const ORPHAN_QUEUE_NAME = 'orphan-chunks';
const MAX_CANDIDATE_EPISODES = 5; // Limit how many episodes we check similarity against

// Initialize the queue for orphan chunks
let orphanQueue = null;
try {
  // Get shared Redis config with validation
  const redisConnection = redisConfig.getRedisConfig();
  if (!redisConnection) {
    throw new Error('Redis configuration missing or invalid. Queue initialization failed.');
  }
  
  orphanQueue = new Queue(ORPHAN_QUEUE_NAME, {
    connection: redisConnection
  });
  logger.info('[EpisodeAgent] Initialized orphan chunk queue');
} catch (error) {
  logger.error('[EpisodeAgent] Failed to initialize orphan chunk queue:', { error });
}

/**
 * Process a new chunk: Try to link it to an existing episode or add it to the orphan queue
 * @param {string} chunkId - The ID of the ChunkEmbedding record
 * @param {string} userId - The ID of the user
 */
async function processChunk(chunkId, userId) {
  try {
    logger.info(`[EpisodeAgent] Processing chunk ${chunkId} for user ${userId}`);
    
    // 1. Fetch the chunk details (optional, might only need ID and vector)
    const chunk = await prisma.chunkEmbedding.findUnique({ where: { id: chunkId } });
    if (!chunk) {
      logger.warn(`[EpisodeAgent] Chunk ${chunkId} not found in DB. Skipping.`);
      return; 
    }
    
    // 2. Get the chunk vector from Weaviate
    let chunkVector = await getChunkVector(chunkId);
    if (!chunkVector) {
      logger.error(`[EpisodeAgent] Failed to get vector for chunk ${chunkId}. Cannot process.`);
      // Optionally add to a retry queue or mark as failed
      return; 
    }

    // Define the target dimension (e.g., from config)
    const targetDimension = aiConfig.embeddingDimension || 1536;

    // Expand chunk vector *immediately* if needed
    if (chunkVector.length !== targetDimension) {
      logger.info(`[EpisodeAgent] Expanding chunk vector ${chunkId} from ${chunkVector.length} to ${targetDimension}`);
      chunkVector = await expandVector(chunkVector, targetDimension);
      if (!chunkVector || chunkVector.length !== targetDimension) {
         logger.error(`[EpisodeAgent] Failed to expand chunk vector ${chunkId} to target dimension ${targetDimension}. Aborting processing.`);
         return;
      }
    }
    
    // 3. Find candidate episodes for the user
    // Fetch episodes including their centroid and dimension
    const candidateEpisodes = await prisma.episode.findMany({
      where: { userId: userId },
      // Select centroidVec and centroidDim along with id
      select: { id: true, centroidVec: true, centroidDim: true }
    });
    logger.info(`[EpisodeAgent] Found ${candidateEpisodes.length} candidate episodes for chunk ${chunkId}`);

    let bestMatch = null;
    let bestSimilarity = -1;

    // 4. Calculate similarity using the fetched chunkVector
    for (const episode of candidateEpisodes) {
      if (!episode.centroidVec || episode.centroidVec.length === 0) {
        logger.warn(`[EpisodeAgent] Episode ${episode.id} has invalid centroid vector. Skipping.`);
        continue;
      }
      
      // Fetch the episode's vector and expand it if needed
      let episodeVector = episode.centroidVec;
      if (episodeVector.length !== targetDimension) {
        logger.info(`[EpisodeAgent] Expanding episode vector ${episode.id} from ${episodeVector.length} to ${targetDimension}`);
        episodeVector = await expandVector(episodeVector, targetDimension);
        if (!episodeVector || episodeVector.length !== targetDimension) {
           logger.warn(`[EpisodeAgent] Failed to expand episode vector ${episode.id} to target dimension ${targetDimension}. Skipping episode.`);
           continue; // Skip this episode if expansion failed
        }
      }

      const similarity = cosine(chunkVector, episodeVector);
      logger.debug(`[EpisodeAgent] Similarity between chunk ${chunkId} and episode ${episode.id}: ${similarity.toFixed(4)}`);

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = { ...episode, centroidVec: episodeVector }; // Store the potentially expanded vector
      }
    }

    // 5. If a good match is found, attach the chunk to it
    if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
      logger.info(`[EpisodeAgent] Attaching chunk ${chunkId} to episode ${bestMatch.id} (similarity: ${bestSimilarity.toFixed(4)})`)
      
      // Create association in the database
      await prisma.chunkEpisode.create({
        data: {
          chunkId: chunkId,
          episodeId: bestMatch.id
        }
      });

      // Update the episode's centroid to include the new chunk (averaging approach)
      logger.debug(`[EpisodeAgent] Updating episode centroid with new chunk vector`);
      
      // Both vectors should now be at the targetDimension
      const existingCentroid = bestMatch.centroidVec; 

      // Calculate the new centroid as a weighted average
      // Give more weight to the existing centroid because it represents multiple chunks already
      const chunkCount = await prisma.chunkEpisode.count({
        where: { episodeId: bestMatch.id }
      });
      
      const existingWeight = chunkCount -1; // Exclude the chunk we just added
      const newWeight = 1;
      const totalWeight = Math.max(1, existingWeight + newWeight); // Avoid division by zero
      
      // Calculate weighted average
      const newCentroid = existingCentroid.map((val, i) => 
        ((val * existingWeight) + (chunkVector[i] * newWeight)) / totalWeight
      );
      
      // Update the episode with the new centroid
      await prisma.episode.update({
        where: { id: bestMatch.id },
        data: { 
          centroidVec: newCentroid,
          centroidDim: newCentroid.length // Should be targetDimension
        }
      });
      
      logger.info(`[EpisodeAgent] Updated centroid for episode ${bestMatch.id}, now including ${chunkCount} chunks`);
      return { 
        success: true, 
        action: 'attached', 
        episodeId: bestMatch.id, 
        similarity: bestSimilarity 
      };
    } 
    // 6. Otherwise, add the chunk to the orphan queue for later consolidation
    else {
      logger.info(`[EpisodeAgent] No suitable episode found for chunk ${chunkId}. Best similarity: ${bestSimilarity.toFixed(4)}. Adding to orphan queue.`);
      
      // Add to orphan queue with vector (ensure it's the target dimension vector)
      await addToOrphanQueue({
        id: chunkId,
        userId: userId,
        vector: chunkVector, // Use the potentially expanded chunkVector
        importance: chunk.importanceScore || 0.5,
        createdAt: chunk.createdAt || new Date(),
      });
    }
    
    logger.info(`[EpisodeAgent] Successfully processed chunk ${chunkId}`);
  } catch (error) {
    logger.error(`[EpisodeAgent] Error processing chunk ${chunkId}:`, { error });
    // Re-throw to BullMQ can retry if needed
    throw error;
  }
}

/**
 * Get chunk vector from Weaviate with retry logic
 * @param {string} chunkId - The ID of the chunk to get vector for
 * @returns {Promise<Array|null>} - The vector array or null if not found
 */
async function getChunkVector(chunkId) {
  const client = weaviateClientUtil.getClient();
  if (!client) {
    logger.error('[EpisodeAgent] Weaviate client not available');
    return null;
  }
  
  // Retry configuration
  const maxRetries = 3;
  const baseDelay = 2000; // 2 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[EpisodeAgent] Retrieving vector for chunk ${chunkId} (attempt ${attempt}/${maxRetries})`);
      
      // Use GraphQL API to retrieve the vector
      const result = await client.graphql
        .get()
        .withClassName('ChunkEmbedding')
        .withFields('chunkDbId text _additional { id vector }')
        .withWhere({
          path: ['chunkDbId'],
          operator: 'Equal',
          valueString: chunkId
        })
        .do();
      
      // Enhanced debugging - log the full response structure on first attempt
      if (attempt === 1) {
        logger.debug(`[EpisodeAgent] Weaviate response structure: ${JSON.stringify(result?.data || {})}`);
      }
      
      // Check if we got any results
      const chunks = result?.data?.Get?.ChunkEmbedding || [];
      
      if (chunks.length > 0) {
        if (chunks[0]._additional?.vector) {
          logger.info(`[EpisodeAgent] Successfully retrieved vector for chunk ${chunkId} on attempt ${attempt}`);
          return chunks[0]._additional.vector;
        } else {
          logger.warn(`[EpisodeAgent] Found chunk ${chunkId} in Weaviate but vector is missing in response`);
        }
      } else {
        logger.warn(`[EpisodeAgent] No chunks found for chunkDbId ${chunkId} in Weaviate on attempt ${attempt}`);
      }
      
      // If no vector found and we have more retries, wait and try again
      if (attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = baseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random());
        logger.info(`[EpisodeAgent] Vector not found for chunk ${chunkId}. Waiting ${Math.round(delay)}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.error(`[EpisodeAgent] Vector not found for chunk ${chunkId} after ${maxRetries} attempts`);
        return null;
      }
    } catch (error) {
      // For other errors, if we have retries left, wait and try again
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random());
        logger.error(`[EpisodeAgent] Error retrieving vector for chunk ${chunkId}: ${error.message}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.error(`[EpisodeAgent] Failed to retrieve vector for chunk ${chunkId} after ${maxRetries} attempts:`, { error });
        return null;
      }
    }
  }
  
  return null; // If we get here, all retries failed
}

/**
 * Adds a chunk to the orphan queue for later consolidation
 * @param {Object} chunk - The ChunkEmbedding to add to the queue
 */
async function addToOrphanQueue(chunk) {
  if (!orphanQueue) {
    logger.warn(`[EpisodeAgent] Orphan queue not available, skipping chunk ${chunk.id}`);
    return;
  }
  
  try {
    // Create a unique job name to prevent duplicates
    const jobName = `orphan-chunk-${chunk.id}`;
    
    await orphanQueue.add(jobName, {
      chunkId: chunk.id,
      userId: chunk.userId,
      vector: chunk.vector, // Pass the vector if we have it
      importance: chunk.importance || 0.5,
      createdAt: chunk.createdAt instanceof Date ? chunk.createdAt.toISOString() : chunk.createdAt,
    }, {
      removeOnComplete: true, // Keep queue clean
      removeOnFail: 50,       // Keep failed jobs for inspection
      attempts: 3,            // Retry failed jobs
      backoff: { type: 'exponential', delay: 5000 }, // Exponential backoff
      jobId: `chunk-${chunk.id}` // Use a stable jobId to prevent duplicates
    });
    
    logger.info(`[EpisodeAgent] Added chunk ${chunk.id} to orphan queue for later processing`);
  } catch (error) {
    logger.error(`[EpisodeAgent] Error adding chunk ${chunk.id} to orphan queue:`, { error });
  }
}

/**
 * Gracefully shut down connections
 */
async function shutdown() {
  try {
    logger.info('[EpisodeAgent] Shutting down gracefully');
    
    if (orphanQueue) {
      await orphanQueue.close();
      logger.info('[EpisodeAgent] Closed orphan queue');
    }
    
    // Note: Don't disconnect Prisma here as it's a singleton and other services might still be using it
    
    logger.info('[EpisodeAgent] Graceful shutdown complete');
  } catch (error) {
    logger.error('[EpisodeAgent] Error during graceful shutdown:', { error });
  }
}

module.exports = {
  processChunk,
  addToOrphanQueue,
  shutdown,
  useGraphQL // Export the flag for the worker to check
};