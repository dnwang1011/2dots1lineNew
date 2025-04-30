// src/services/episodeAgent.js
// Agent for processing chunks and attaching them to episodes

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger').childLogger('EpisodeAgent');
const weaviateClientUtil = require('../utils/weaviateClient');
const cosine = require('compute-cosine-similarity');
const { Queue } = require('bullmq');
const config = require('../config');

// Configuration parameters
const EPISODE_TIME_WINDOW = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const SIMILARITY_THRESHOLD = 0.7; // Minimum cosine similarity to attach chunk to episode
const ORPHAN_QUEUE_NAME = 'orphan-chunks';

// Initialize the queue for orphan chunks
let orphanQueue = null;
try {
  orphanQueue = new Queue(ORPHAN_QUEUE_NAME, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
    },
  });
  logger.info('[EpisodeAgent] Initialized orphan chunk queue');
} catch (error) {
  logger.error('[EpisodeAgent] Failed to initialize orphan chunk queue:', { error });
}

/**
 * Processes a new chunk and either attaches it to an existing episode
 * or adds it to the orphan queue for consolidation
 * @param {string} chunkId - ID of the ChunkEmbedding to process
 * @param {string} userId - User ID for looking up candidate episodes
 */
async function processChunk(chunkId, userId) {
  try {
    logger.info(`[EpisodeAgent] Processing chunk ${chunkId} for user ${userId}`);
    
    // Fetch the chunk with its vector
    const chunk = await prisma.chunkEmbedding.findUnique({
      where: { id: chunkId },
    });
    
    if (!chunk) {
      logger.warn(`[EpisodeAgent] Chunk ${chunkId} not found`);
      return;
    }
    
    // Find candidate episodes within the time window
    const timeWindow = new Date(Date.now() - EPISODE_TIME_WINDOW);
    const candidateEpisodes = await prisma.episode.findMany({
      where: {
        userId: userId,
        createdAt: { gte: timeWindow },
      },
    });
    
    logger.info(`[EpisodeAgent] Found ${candidateEpisodes.length} candidate episodes`);
    
    // If no episodes found, add to orphan queue
    if (candidateEpisodes.length === 0) {
      await addToOrphanQueue(chunk);
      return;
    }
    
    // Calculate cosine similarity with each episode's centroid vector
    let bestMatch = null;
    let bestSimilarity = 0;
    
    for (const episode of candidateEpisodes) {
      // Skip episodes without centroid vectors
      if (!episode.centroidVec || episode.centroidVec.length === 0) {
        continue;
      }
      
      // Ensure vectors have the same dimension
      if (episode.centroidDim !== chunk.dimension) {
        logger.warn(`[EpisodeAgent] Dimension mismatch between episode ${episode.id} (${episode.centroidDim}) and chunk ${chunk.id} (${chunk.dimension})`);
        continue;
      }
      
      const similarity = cosine(episode.centroidVec, chunk.vector);
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = episode;
      }
    }
    
    // If we found a good match, attach to the episode
    if (bestMatch && bestSimilarity >= SIMILARITY_THRESHOLD) {
      await prisma.chunkEpisode.create({
        data: {
          chunkId: chunk.id,
          episodeId: bestMatch.id,
        },
      });
      
      logger.info(`[EpisodeAgent] Attached chunk ${chunk.id} to episode ${bestMatch.id} (similarity: ${bestSimilarity.toFixed(4)})`);
      
      // Update episode's centroid vector (weighted average with the new chunk)
      // This assumes centroidVec is a simple average; a more sophisticated approach might be implemented
      const episodeChunks = await prisma.chunkEpisode.count({
        where: { episodeId: bestMatch.id },
      });
      
      // Weight of the new chunk is 1/(n+1) and old centroid is n/(n+1)
      const oldWeight = episodeChunks / (episodeChunks + 1);
      const newWeight = 1 / (episodeChunks + 1);
      
      // Calculate new centroid
      const newCentroid = bestMatch.centroidVec.map((val, idx) => 
        val * oldWeight + chunk.vector[idx] * newWeight
      );
      
      // Update episode
      await prisma.episode.update({
        where: { id: bestMatch.id },
        data: {
          centroidVec: newCentroid,
        },
      });
      
      logger.info(`[EpisodeAgent] Updated centroid for episode ${bestMatch.id}`);
    } else {
      // Add to orphan queue for later consolidation
      await addToOrphanQueue(chunk);
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

module.exports = {
  processChunk,
  addToOrphanQueue,
}; 