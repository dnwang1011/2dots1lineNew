// src/services/episodeAgent.js
// Agent for processing chunks and attaching them to episodes

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

// Configuration parameters
const EPISODE_TIME_WINDOW = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const SIMILARITY_THRESHOLD = 0.75; // Minimum cosine similarity to attach chunk to episode (Increased from 0.7)
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
  if (!orphanQueue) {
    logger.error('[EpisodeAgent] Orphan queue not initialized. Cannot process chunk.');
    return;
  }

  logger.info(`[EpisodeAgent] Processing chunk ${chunkId} for user ${userId}`); // Log entry

  try {
    // Fetch the chunk and its vector
    const chunk = await prisma.chunkEmbedding.findUnique({
      where: { id: chunkId },
    });

    if (!chunk || !chunk.vector || chunk.vector.length === 0) {
      logger.warn(`[EpisodeAgent] Chunk ${chunkId} not found or has no vector. Skipping.`);
      return;
    }

    logger.debug(`[EpisodeAgent] Chunk ${chunkId} vector dimension: ${chunk.vector.length}`);

    // Find candidate episodes (recent ones for the user)
    const candidateEpisodes = await prisma.episode.findMany({
      where: {
        userId: userId,
        // Filter out episodes without valid vectors or dimensions
        centroidDim: { gt: 0 },
        NOT: { centroidVec: { equals: [] } } // Ensure vector is not empty
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_CANDIDATE_EPISODES,
    });

    logger.info(`[EpisodeAgent] Found ${candidateEpisodes.length} candidate episodes for chunk ${chunkId}`);

    let bestMatch = null;
    let bestSimilarity = -1;

    // Calculate similarity between the chunk and candidate episodes
    for (const episode of candidateEpisodes) {
      // Ensure dimensions match before calculating similarity
      if (chunk.vector.length !== episode.centroidDim) {
        logger.warn(`[EpisodeAgent] Dimension mismatch between chunk ${chunkId} (${chunk.vector.length}) and episode ${episode.id} (${episode.centroidDim}). Skipping episode.`);
        continue;
      }

      const similarity = cosine(chunk.vector, episode.centroidVec);
      logger.debug(`[EpisodeAgent] Similarity between chunk ${chunkId} and episode ${episode.id}: ${similarity.toFixed(4)}`);

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = episode;
      }
    }

    // Decide whether to add to existing episode or mark as orphan
    if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
      logger.info(`[EpisodeAgent] Found good match for chunk ${chunkId}: Episode ${bestMatch.id} (Similarity: ${bestSimilarity.toFixed(4)}). Linking chunk to episode.`);
      // Link the chunk to the best matching episode
      await prisma.chunkEpisode.create({
        data: {
          chunkId: chunkId,
          episodeId: bestMatch.id,
        },
      });
      // Optional: Recalculate episode centroid? (Could be computationally expensive)
      // await updateEpisodeCentroid(bestMatch.id);
      logger.info(`[EpisodeAgent] Successfully linked chunk ${chunkId} to episode ${bestMatch.id}`);
    } else {
      logger.info(`[EpisodeAgent] No suitable episode found for chunk ${chunkId} (Best similarity: ${bestSimilarity.toFixed(4)}). Adding job to orphan queue for user ${userId}.`);
      // Add job to the orphan queue to trigger consolidation later
      try {
        const jobData = { userId: userId, triggerChunkId: chunkId }; // Include chunk ID for traceability
        logger.debug(`[EpisodeAgent] Adding job to orphan queue with data: ${JSON.stringify(jobData)}`);
        await orphanQueue.add(`consolidate-${userId}`, jobData, {
             removeOnComplete: true, // Keep queue clean
             removeOnFail: 50,       // Keep failed jobs for inspection
             attempts: 3,            // Retry failed jobs
             backoff: { type: 'exponential', delay: 1000 } // Exponential backoff
         });
        logger.info(`[EpisodeAgent] Successfully added job to orphan queue for user ${userId} (triggered by chunk ${chunkId})`);
      } catch (queueError) {
          logger.error(`[EpisodeAgent] Failed to add job to orphan queue for user ${userId}:`, { error: queueError});
          // Decide how to handle this - maybe retry later? For now, just log.
      }
    }
  } catch (error) {
    logger.error(`[EpisodeAgent] Error processing chunk ${chunkId}:`, { error });
  }
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
    await orphanQueue.add('orphan-chunk', {
      chunkId: chunk.id,
      userId: chunk.userId,
      vector: chunk.vector,
      importance: chunk.importance,
      createdAt: chunk.createdAt.toISOString(),
    });
    
    logger.info(`[EpisodeAgent] Added chunk ${chunk.id} to orphan queue`);
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
  shutdown
}; 