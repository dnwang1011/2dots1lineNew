// src/services/episodeAgent.js
// Agent for processing chunks and attaching them to episodes

// Version indicator for worker validation
const useGraphQL = true;

const { PrismaClient } = require('@prisma/client');
// Replace local Prisma instance with singleton
// const prisma = new PrismaClient();
const { prisma } = require('../db/prisma'); // Use the singleton instance
const logger = require('../utils/logger').childLogger('EpisodeAgent');
const weaviateClientUtil = require('../utils/weaviateClient'); // No longer needed directly
const { storeObjectInWeaviate } = require('../utils/weaviateHelper'); // USE SHARED HELPER
const cosine = require('compute-cosine-similarity');
const { Queue } = require('bullmq');
const { generateTitleAndNarrative } = require('../utils/aiHelper'); // Assuming a helper for this
// const config = require('../config'); // Removed unused config import
const redisConfig = require('../utils/redisConfig');
const { expandVector } = require('../utils/vectorUtils'); // IMPORT FROM NEW UTILITY
const aiConfig = require('../../config/ai.config'); // Import aiConfig for target dimension
const episodicConfig = require('../../config/episodic.config'); // Import episodic config
const queueConfig = require('../../config/queue.config'); // Import queue config
const memoryConfig = require('../../config/memory.config'); // Import memory config for importance thresholds

// Import configuration parameters from centralized config files
const EPISODE_TIME_WINDOW = episodicConfig.episodeTimeWindowMs;
const SIMILARITY_THRESHOLD = episodicConfig.similarityThreshold; // Primary threshold for a good single match
const MULTIPLE_ATTACHMENT_SIMILARITY_THRESHOLD = episodicConfig.multipleAttachmentSimilarityThreshold;
const NEW_EPISODE_SEED_THRESHOLD = episodicConfig.newEpisodeSeedThreshold;
const ORPHAN_QUEUE_NAME = queueConfig.queues.orphanChunks;
const MAX_CANDIDATE_EPISODES = episodicConfig.maxCandidateEpisodes;

// Initialize the queue for orphan chunks
let orphanQueue = null;
try {
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
 * Process a new chunk: Try to link it to existing episodes, seed a new episode, or add to orphan queue.
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
      return { success: false, reason: 'Chunk not found' }; 
    }
    
    // 2. Get the chunk vector from Weaviate
    let chunkVector = await getChunkVector(chunkId);
    if (!chunkVector) {
      logger.error(`[EpisodeAgent] Failed to get vector for chunk ${chunkId}. Cannot process.`);
      return { success: false, reason: 'Failed to get chunk vector' }; 
    }

    // Define the target dimension (e.g., from config)
    const targetDimension = aiConfig.embeddingDimension || 1536;

    // Expand chunk vector *immediately* if needed
    if (chunkVector.length !== targetDimension) {
      logger.info(`[EpisodeAgent] Expanding chunk vector ${chunkId} from ${chunkVector.length} to ${targetDimension}`);
      chunkVector = await expandVector(chunkVector, targetDimension);
      if (!chunkVector || chunkVector.length !== targetDimension) {
         logger.error(`[EpisodeAgent] Failed to expand chunk vector ${chunkId}. Aborting.`);
         return { success: false, reason: 'Failed to expand chunk vector' };
      }
    }
    
    // 3. Find candidate episodes for the user
    // Fetch episodes including their centroid and dimension
    const candidateEpisodes = await prisma.episode.findMany({
      where: { userId: userId },
      select: { id: true, centroidVec: true, centroidDim: true },
      orderBy: { createdAt: 'desc' }, // Process more recent episodes first
      take: MAX_CANDIDATE_EPISODES
    });
    logger.info(`[EpisodeAgent] Found ${candidateEpisodes.length} candidate episodes for chunk ${chunkId}`);

    let bestOverallSimilarity = -1;
    let bestOverallMatchEpisode = null;
    const potentialAttachments = [];

    for (const episode of candidateEpisodes) {
      if (!episode.centroidVec || episode.centroidVec.length === 0) {
        logger.warn(`[EpisodeAgent] Episode ${episode.id} has invalid centroid. Skipping.`);
        continue;
      }
      
      // Fetch the episode's vector and expand it if needed
      let episodeVector = episode.centroidVec;
      if (episodeVector.length !== targetDimension) {
        logger.info(`[EpisodeAgent] Expanding episode vector ${episode.id} from ${episodeVector.length} to ${targetDimension}`);
        episodeVector = await expandVector(episodeVector, targetDimension);
        if (!episodeVector || episodeVector.length !== targetDimension) {
           logger.warn(`[EpisodeAgent] Failed to expand episode vector ${episode.id}. Skipping.`);
           continue;
        }
      }

      const similarity = cosine(chunkVector, episodeVector);
      logger.debug(`[EpisodeAgent] Similarity: chunk ${chunkId} to episode ${episode.id} = ${similarity.toFixed(4)}`);

      if (similarity > MULTIPLE_ATTACHMENT_SIMILARITY_THRESHOLD) {
        potentialAttachments.push({ episodeId: episode.id, similarity, episodeVector });
      }
      if (similarity > bestOverallSimilarity) {
        bestOverallSimilarity = similarity;
        bestOverallMatchEpisode = { ...episode, centroidVec: episodeVector };
      }
    }

    // Attach to multiple episodes if there are any potential attachments
    const attachedEpisodeIds = [];
    if (potentialAttachments.length > 0) {
      logger.info(`[EpisodeAgent] Chunk ${chunkId} has ${potentialAttachments.length} potential episode attachments meeting MULTIPLE_ATTACHMENT_SIMILARITY_THRESHOLD (${MULTIPLE_ATTACHMENT_SIMILARITY_THRESHOLD}).`);
      for (const attachment of potentialAttachments) {
        await linkChunkToEpisode(chunkId, attachment.episodeId, chunkVector, attachment.episodeVector, userId);
        attachedEpisodeIds.push(attachment.episodeId);
      }
      return {
        success: true,
        action: 'attached_multiple',
        episodeIds: attachedEpisodeIds,
        bestSimilarity: bestOverallSimilarity
      };
    }
    
    // If not attached to any episode yet, check if it's a strong primary match for the most similar one
    if (bestOverallMatchEpisode && bestOverallSimilarity >= SIMILARITY_THRESHOLD) {
        logger.info(`[EpisodeAgent] Attaching chunk ${chunkId} as primary to episode ${bestOverallMatchEpisode.id} (similarity: ${bestOverallSimilarity.toFixed(4)})`);
        await linkChunkToEpisode(chunkId, bestOverallMatchEpisode.id, chunkVector, bestOverallMatchEpisode.centroidVec, userId);
        return {
            success: true,
            action: 'attached_primary',
            episodeId: bestOverallMatchEpisode.id,
            similarity: bestOverallSimilarity
        };
    }

    // If not attached and not a strong primary match, consider seeding a new episode
    const chunkImportance = chunk.importanceScore || memoryConfig.defaultRawDataImportance;
    if (bestOverallSimilarity < NEW_EPISODE_SEED_THRESHOLD && chunkImportance >= memoryConfig.defaultImportanceThreshold) {
      logger.info(`[EpisodeAgent] Chunk ${chunkId} (importance: ${chunkImportance.toFixed(2)}) with best similarity ${bestOverallSimilarity.toFixed(4)} < NEW_EPISODE_SEED_THRESHOLD (${NEW_EPISODE_SEED_THRESHOLD}). Seeding new episode.`);
      const { title, narrative } = await generateTitleAndNarrative([chunk.text], 'New episode seeded by user query.');
      
      const newEpisode = await prisma.episode.create({
        data: {
          title: title || `New Episode from Chunk ${chunkId.substring(0,8)}`,
          narrative: narrative || chunk.text.substring(0, 200),
          centroidVec: chunkVector, // Initial centroid is the chunk's vector
          centroidDim: chunkVector.length,
          userId: userId,
          createdAt: new Date(),
        }
      });
      logger.info(`[EpisodeAgent] Created new episode ${newEpisode.id} for chunk ${chunkId}`);
      await linkChunkToEpisode(chunkId, newEpisode.id, chunkVector, chunkVector, userId);
      
      // Store newEpisode in Weaviate using the shared helper
      const weaviateProperties = {
        episodeDbId: newEpisode.id,
        title: newEpisode.title,
        narrative: newEpisode.narrative,
        userId: newEpisode.userId,
        createdAt: newEpisode.createdAt.toISOString(),
      };
      const weaviateId = await storeObjectInWeaviate('EpisodeEmbedding', weaviateProperties, newEpisode.centroidVec);
      if (weaviateId) {
        logger.info(`[EpisodeAgent] Stored newly seeded episode ${newEpisode.id} in Weaviate (Weaviate ID: ${weaviateId})`);
      } else {
        logger.warn(`[EpisodeAgent] Failed to store newly seeded episode ${newEpisode.id} in Weaviate.`);
        // Consider if this should impact the success of the operation or queue for retry
      }

      return {
        success: true,
        action: 'seeded_new_episode',
        episodeId: newEpisode.id
      };
    }
    
    logger.info(`[EpisodeAgent] No suitable episode found for chunk ${chunkId}. Best similarity: ${bestOverallSimilarity.toFixed(4)}. Adding to orphan queue.`);
    await addToOrphanQueue({
      id: chunkId,
      userId: userId,
      vector: chunkVector,
      importance: chunkImportance,
      createdAt: chunk.createdAt || new Date(),
    });
    return {
      success: true,
      action: 'orphaned',
      bestSimilarity: bestOverallSimilarity
    };

  } catch (error) {
    logger.error(`[EpisodeAgent] Error processing chunk ${chunkId}:`, { error });
    throw error; // Re-throw for BullMQ retry if configured
  }
}

/**
 * Helper function to link a chunk to an episode and update the episode's centroid.
 */
async function linkChunkToEpisode(chunkId, episodeId, chunkVector, episodeCentroidVec, userId) {
  await prisma.chunkEpisode.create({
    data: {
      chunkId: chunkId,
      episodeId: episodeId
    }
  });

  const chunkCountResult = await prisma.chunkEpisode.aggregate({
    _count: { chunkId: true },
    where: { episodeId: episodeId },
  });
  const chunkCount = chunkCountResult._count.chunkId;

  logger.debug(`[EpisodeAgent] Updating episode centroid for ${episodeId} with new chunk ${chunkId}. Current chunk count: ${chunkCount}`);
  
  let newCentroid;
  if (chunkCount === 1) { // This is the first chunk being added (or re-calculation with only this chunk)
    newCentroid = chunkVector;
  } else {
    const existingWeight = chunkCount - 1;
    const newWeight = 1;
    const totalWeight = existingWeight + newWeight;
    
    newCentroid = episodeCentroidVec.map((val, i) => 
      ((val * existingWeight) + (chunkVector[i] * newWeight)) / totalWeight
    );
  }
  
  await prisma.episode.update({
    where: { id: episodeId },
    data: { 
      centroidVec: newCentroid,
      centroidDim: newCentroid.length
    }
  });
  logger.info(`[EpisodeAgent] Updated centroid for episode ${episodeId}, now including ${chunkCount} chunks`);
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
  
  const maxRetries = 3;
  const baseDelay = 2000;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`[EpisodeAgent] Retrieving vector for chunk ${chunkId} (attempt ${attempt}/${maxRetries})`);
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
      
      if (attempt === 1) {
        logger.debug(`[EpisodeAgent] Weaviate response structure: ${JSON.stringify(result?.data || {})}`);
      }
      
      const chunks = result?.data?.Get?.ChunkEmbedding || [];
      
      if (chunks.length > 0) {
        if (chunks[0]._additional?.vector) {
          logger.info(`[EpisodeAgent] Successfully retrieved vector for chunk ${chunkId} on attempt ${attempt}`);
          return chunks[0]._additional.vector;
        } else {
          logger.warn(`[EpisodeAgent] Found chunk ${chunkId} in Weaviate but vector is missing`);
        }
      } else {
        logger.warn(`[EpisodeAgent] No chunks found for chunkDbId ${chunkId} in Weaviate on attempt ${attempt}`);
      }
      
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random());
        logger.info(`[EpisodeAgent] Vector not found for chunk ${chunkId}. Waiting ${Math.round(delay)}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.error(`[EpisodeAgent] Failed to retrieve vector for chunk ${chunkId} after ${maxRetries} attempts.`);
        return null;
      }
    } catch (error) {
      logger.error(`[EpisodeAgent] Error retrieving vector for chunk ${chunkId} (attempt ${attempt}):`, { error });
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random());
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        return null;
      }
    }
  }
  return null;
}

/**
 * Adds a chunk to the orphan queue for later consolidation
 * @param {Object} chunk - The ChunkEmbedding to add to the queue
 */
async function addToOrphanQueue(chunkData) {
  if (!orphanQueue) {
    logger.error("[EpisodeAgent] Orphan chunk queue not initialized. Cannot add chunk.");
    return;
  }
  try {
    // Ensure chunkData includes id, userId, vector, importance, createdAt
    if (!chunkData.id || !chunkData.userId || !chunkData.vector || chunkData.importance === undefined || !chunkData.createdAt) {
        logger.error("[EpisodeAgent] Invalid chunkData for orphan queue:", chunkData);
        return;
    }
    await orphanQueue.add('process-orphan', chunkData, {
      jobId: `orphan-${chunkData.id}`, // Ensure unique job ID
      attempts: 3, // Retry up to 3 times
      backoff: {
        type: 'exponential',
        delay: 5000, // 5 seconds initial delay
      }
    });
    logger.info(`[EpisodeAgent] Added chunk ${chunkData.id} to orphan queue for later processing`);
  } catch (error) {
    logger.error(`[EpisodeAgent] Failed to add chunk ${chunkData.id} to orphan queue:`, { error });
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