// src/services/consolidationAgent.js
// Agent for consolidating orphan chunks into episodes

const { PrismaClient } = require('@prisma/client');
// Replace local Prisma instance with singleton
// const prisma = new PrismaClient();
const { prisma } = require('../db/prisma'); // Use the singleton instance
const logger = require('../utils/logger').childLogger('ConsolidationAgent');
const weaviateClientUtil = require('../utils/weaviateClient');
const { Worker, Queue } = require('bullmq');
// const config = require('../config'); // Removed unused config import
const redisConfig = require('../utils/redisConfig');
const aiService = require('./ai.service'); // For generating narratives
const dbscan = require('density-clustering').DBSCAN; // For clustering
const { v4: uuidv4 } = require('uuid'); // Import uuid
const aiConfig = require('../../config/ai.config'); // Import aiConfig

// Configuration parameters
const ORPHAN_QUEUE_NAME = 'orphan-chunks';
const CONSOLIDATION_THRESHOLD = 2; // Min number of orphan chunks to trigger consolidation
const DBSCAN_EPSILON = 0.30; // DBSCAN distance threshold (1 - cosine similarity)
const DBSCAN_MIN_POINTS = 2; // DBSCAN minimum points to form a cluster
const MAX_CHUNKS_PER_EPISODE = 30; // Maximum number of chunks to include in a single episode

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
  logger.info('[ConsolidationAgent] Connected to orphan chunk queue');
} catch (error) {
  logger.error('[ConsolidationAgent] Failed to connect to orphan chunk queue:', { error });
}

/**
 * Calculate cosine distance (1 - similarity) between two vectors.
 * Handles validation and normalization.
 * @param {Array<number>} a - First vector
 * @param {Array<number>} b - Second vector
 * @returns {number} Distance (0.0 to 2.0, typically 0.0 to 1.0 after clamping similarity)
 */
function calculateCosineDistance(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    // Ensure vectors are valid and have the same length
    if (!a || !b || !Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
        logger.warn('[ConsolidationAgent] Invalid vectors for distance calculation.', { aLength: a?.length, bLength: b?.length });
        return 1.0; // Max distance if invalid
    }
    for (let i = 0; i < a.length; i++) {
        // Check for non-numeric values
        if (typeof a[i] !== 'number' || typeof b[i] !== 'number') {
             logger.warn('[ConsolidationAgent] Non-numeric value found in vectors.', { index: i, valA: a[i], valB: b[i] });
             return 1.0; // Max distance
        }
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    // Handle zero vectors
    if (normA === 0 || normB === 0) {
         logger.warn('[ConsolidationAgent] Zero vector encountered in distance calculation.');
         return 1.0; // Max distance
    }
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    // Clamp similarity to avoid potential floating point issues leading to negative distance
    const clampedSimilarity = Math.max(-1, Math.min(1, similarity)); // Clamp between -1 and 1 before distance calc
    return 1.0 - clampedSimilarity; // Distance is 1 minus similarity
}

/**
 * Process orphan chunks to form new episodes
 * @param {string} userId - The user ID to process orphans for
 * @param {string} triggerChunkId - The ID of the chunk that triggered this job (for logging)
 */
async function processOrphanChunks(userId, triggerChunkId) {
  try {
    logger.info(`[ConsolidationAgent] Worker processing job for user ${userId} (triggered by chunk ${triggerChunkId || 'unknown'})`);
    
    // Get all orphaned chunks for the user
    const orphanedChunksRaw = await getOrphanedChunks(userId);

    // We now expect objects with at least id and vector from getOrphanedChunks
    const orphanedChunks = orphanedChunksRaw.filter(chunk => chunk.vector && Array.isArray(chunk.vector) && chunk.vector.length > 0);
    if (orphanedChunks.length !== orphanedChunksRaw.length) {
        logger.warn(`[ConsolidationAgent] User ${userId}: Filtered out ${orphanedChunksRaw.length - orphanedChunks.length} orphaned chunks due to missing or invalid vectors post-fetch.`);
    }
    
    if (orphanedChunks.length < CONSOLIDATION_THRESHOLD) {
      logger.info(`[ConsolidationAgent] User ${userId}: Not enough orphaned chunks with vectors (${orphanedChunks.length}) < threshold (${CONSOLIDATION_THRESHOLD}). Skipping consolidation.`);
      return;
    }
    
    logger.info(`[ConsolidationAgent] User ${userId}: Found ${orphanedChunks.length} orphaned chunks with vectors. Preparing for DBSCAN.`);
    logger.info(`[ConsolidationAgent] User ${userId}: DBSCAN Params: Epsilon=${DBSCAN_EPSILON}, MinPoints=${DBSCAN_MIN_POINTS}`); // Log params

    // Prepare the chunks for clustering by extracting vectors
    const vectors = orphanedChunks.map(chunk => chunk.vector);
    const chunkIds = orphanedChunks.map(chunk => chunk.id);
    logger.info(`[ConsolidationAgent] User ${userId}: Orphaned Chunk IDs being processed: ${chunkIds.join(', ')}`); // Log IDs

    // *** DEBUG: Log pairwise distances ***
    logger.info(`[ConsolidationAgent] User ${userId}: Calculating pairwise distances...`);
    let potentialNeighborsCount = 0;
    for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
            const distance = calculateCosineDistance(vectors[i], vectors[j]);
            let neighborIndicator = "";
            if (distance <= DBSCAN_EPSILON) {
                neighborIndicator = " <-- NEIGHBOR!";
                potentialNeighborsCount++;
            }
             // Log first few distances for brevity, or log all if needed for deep debug
            if (i < 5 && j < 10) { // Limit logging if too many chunks
                 logger.info(`[ConsolidationAgent] -> Distance(${chunkIds[i].substring(0, 6)}... vs ${chunkIds[j].substring(0, 6)}...): ${distance.toFixed(4)}${neighborIndicator}`);
            } else if (neighborIndicator) { // Always log neighbors
                 logger.info(`[ConsolidationAgent] -> Distance(${chunkIds[i].substring(0, 6)}... vs ${chunkIds[j].substring(0, 6)}...): ${distance.toFixed(4)}${neighborIndicator}`);
            }
        }
    }
    logger.info(`[ConsolidationAgent] User ${userId}: Found ${potentialNeighborsCount} potential neighbor pairs based on epsilon.`);
    // *** END DEBUG ***

    // Run DBSCAN to find clusters of related chunks
    const dbscanInstance = new dbscan();
    
    // Note: DBSCAN expects a distance function, but our vectors use cosine similarity
    // So we need to convert cosine similarity (1.0 = identical) to distance (0.0 = identical)
    let clusters = [];
    let noise = []; // Capture noise points
    try {
        // Pass our pre-defined distance function
        clusters = dbscanInstance.run(vectors, DBSCAN_EPSILON, DBSCAN_MIN_POINTS, calculateCosineDistance);
        noise = dbscanInstance.noise; // Get noise indices
        // *** DEBUG: Log raw DBSCAN result ***
        logger.info(`[ConsolidationAgent] User ${userId}: DBSCAN raw result: clusters=${JSON.stringify(clusters)}, noise=${JSON.stringify(noise)}`);
        // *** END DEBUG ***
        logger.info(`[ConsolidationAgent] User ${userId}: DBSCAN completed. Found ${clusters.length} clusters. Noise points: ${noise.length}.`);
    } catch (dbscanError) {
        logger.error(`[ConsolidationAgent] User ${userId}: DBSCAN clustering failed:`, { error: dbscanError });
        return; // Stop processing if clustering fails
    }
    
    // Process each cluster to create an episode
    let episodesCreated = 0;
    for (let i = 0; i < clusters.length; i++) {
      const clusterIndices = clusters[i];
      logger.debug(`[ConsolidationAgent] User ${userId}: Processing cluster ${i} with ${clusterIndices.length} chunks.`);
      
      // Skip small clusters
      if (clusterIndices.length < DBSCAN_MIN_POINTS) {
        logger.debug(`[ConsolidationAgent] User ${userId}: Cluster ${i} is too small (${clusterIndices.length} < ${DBSCAN_MIN_POINTS}). Skipping.`);
        continue;
      }
      
      // Limit the number of chunks per episode
      const limitedIndices = clusterIndices.slice(0, MAX_CHUNKS_PER_EPISODE);
      logger.debug(`[ConsolidationAgent] User ${userId}: Cluster ${i} limited to ${limitedIndices.length} chunks.`);
      
      // Get the chunk IDs and vectors for this cluster
      const clusterChunkIds = limitedIndices.map(idx => chunkIds[idx]);
      const clusterVectors = limitedIndices.map(idx => vectors[idx]);
      
      // Calculate the centroid vector (average of all vectors in the cluster)
      const centroidVector = calculateCentroid(clusterVectors);
      if (!centroidVector || centroidVector.length === 0) {
          logger.warn(`[ConsolidationAgent] User ${userId}: Failed to calculate centroid for cluster ${i}. Skipping cluster.`);
          continue;
      }
      
      // Fetch the full chunks for narrative generation
      logger.debug(`[ConsolidationAgent] User ${userId}: Fetching full chunk data for cluster ${i}`);
      const clusterChunks = await prisma.chunkEmbedding.findMany({
        where: {
          id: { in: clusterChunkIds }
        }
      });
      
      // Generate a narrative for the episode using AI
      logger.debug(`[ConsolidationAgent] User ${userId}: Generating narrative for cluster ${i}`);
      const { title, narrative } = await generateEpisodeNarrative(clusterChunks);
      logger.debug(`[ConsolidationAgent] User ${userId}: Generated narrative for cluster ${i}: Title="${title}"`);
      
      // Create the episode
      try {
          const episode = await prisma.episode.create({
            data: {
              title,
              narrative,
              centroidVec: centroidVector,
              centroidDim: centroidVector.length,
              userId: userId,
              createdAt: new Date(), // Ensure createdAt is set
            }
          });
          episodesCreated++;
          logger.info(`[ConsolidationAgent] User ${userId}: Created episode "${title}" (${episode.id}) from cluster ${i} with ${limitedIndices.length} chunks.`);
          
          // Create ChunkEpisode entries for each chunk in the cluster
          logger.debug(`[ConsolidationAgent] User ${userId}: Linking ${clusterChunkIds.length} chunks to episode ${episode.id}`);
          // Use createMany for efficiency if supported and desired, otherwise loop
          for (const chunkId of clusterChunkIds) {
            await prisma.chunkEpisode.create({
              data: {
                chunkId,
                episodeId: episode.id,
              }
            });
          }
          logger.debug(`[ConsolidationAgent] User ${userId}: Finished linking chunks for episode ${episode.id}`);
          
          // Store the episode in Weaviate
          logger.debug(`[ConsolidationAgent] User ${userId}: Storing episode ${episode.id} in Weaviate`);
          await storeEpisodeInWeaviate(episode); // Ensure this logs errors internally
          logger.debug(`[ConsolidationAgent] User ${userId}: Finished storing episode ${episode.id} in Weaviate`);
          
      } catch(episodeCreateError) {
          logger.error(`[ConsolidationAgent] User ${userId}: Failed to create episode or link chunks for cluster ${i}:`, { error: episodeCreateError });
          // Continue to next cluster
      }
    }
    
    // Clean up the processed chunks from the orphan queue
    // (In a production system, we might want to be more selective about which chunks we've processed)
    // await cleanupProcessedChunks(userId, chunkIds); // Commented out as per original code
    
    logger.info(`[ConsolidationAgent] User ${userId}: Completed processing job. Created ${episodesCreated} episodes.`);
  } catch (error) {
    logger.error(`[ConsolidationAgent] User ${userId}: Unhandled error processing orphan chunks (triggered by ${triggerChunkId || 'unknown'}):`, { error });
    throw error; // Re-throw error so BullMQ knows the job failed
  }
}

/**
 * Get orphaned chunks for a user (chunks not linked to any episode)
 * @param {string} userId - User ID to get orphans for
 * @returns {Promise<Array<{id: string, vector: Array<number>}>>} Array of orphaned chunk objects with id and vector
 */
async function getOrphanedChunks(userId) {
  logger.debug(`[ConsolidationAgent] Fetching orphaned chunks for user ${userId}...`);
  // Find all chunks for the user (fetch full objects)
  const allChunks = await prisma.chunkEmbedding.findMany({
    where: {
      userId: userId,
    }
    // NO SELECT clause here - fetch full object initially
  });

  // Find all chunks that are already part of episodes
  const linkedChunkIds = await prisma.chunkEpisode.findMany({
    select: {
      chunkId: true
    },
  });

  const linkedIds = new Set(linkedChunkIds.map(link => link.chunkId));

  // Filter to only orphaned chunks
  const orphaned = allChunks.filter(chunk => !linkedIds.has(chunk.id));
  logger.debug(`[ConsolidationAgent] Found ${allChunks.length} total chunks, ${linkedChunkIds.length} linked chunks, resulting in ${orphaned.length} orphans for user ${userId}.`);

  // Now fetch vectors from Weaviate for these orphaned chunks
  const orphanedWithVectors = [];
  for (const chunk of orphaned) {
    try {
      // Get the vector from Weaviate
      const vector = await getChunkVectorFromWeaviate(chunk.id);
      if (vector && vector.length > 0) {
        orphanedWithVectors.push({
          id: chunk.id,
          vector: vector
        });
      } else {
        logger.warn(`[ConsolidationAgent] User ${userId}: Chunk ${chunk.id} missing vector in Weaviate`);
      }
    } catch (error) {
      logger.error(`[ConsolidationAgent] Error getting vector for chunk ${chunk.id}: ${error.message}`);
    }
  }

  // Log diagnostics about missing vectors
  const chunksWithoutVectors = orphaned.length - orphanedWithVectors.length;
  if (chunksWithoutVectors > 0) {
    logger.warn(`[ConsolidationAgent] User ${userId}: Found ${chunksWithoutVectors} orphaned chunks MISSING vectors after Weaviate fetch (out of ${orphaned.length} total orphans)`);
  }

  return orphanedWithVectors;
}

/**
 * Retrieve a chunk's vector from Weaviate
 * @param {string} chunkId - The ID of the chunk to retrieve the vector for
 * @returns {Promise<Array<number>|null>} The vector array or null if not found
 */
async function getChunkVectorFromWeaviate(chunkId) {
  const client = weaviateClientUtil.getClient();
  if (!client) {
    logger.error('[ConsolidationAgent] Weaviate client not available');
    return null;
  }
  
  // Retry configuration
  const maxRetries = 3;
  const baseDelay = 2000; // 2 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`[ConsolidationAgent] Retrieving vector for chunk ${chunkId} from Weaviate (attempt ${attempt}/${maxRetries})`);
      
      // Use GraphQL API to retrieve the vector
      const result = await client.graphql
        .get()
        .withClassName('ChunkEmbedding')
        .withFields('chunkDbId _additional { vector }')
        .withWhere({
          path: ['chunkDbId'],
          operator: 'Equal',
          valueString: chunkId
        })
        .do();
      
      // Check if we got a valid result
      const objects = result?.data?.Get?.ChunkEmbedding;
      if (objects && objects.length > 0 && objects[0]._additional?.vector) {
        logger.debug(`[ConsolidationAgent] Successfully retrieved vector for chunk ${chunkId} on attempt ${attempt}`);
        return objects[0]._additional.vector;
      } else {
        logger.warn(`[ConsolidationAgent] No vector found for chunk ${chunkId} in Weaviate on attempt ${attempt}`);
        
        // If this is not the last attempt, delay before retrying
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
          logger.debug(`[ConsolidationAgent] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    } catch (error) {
      logger.error(`[ConsolidationAgent] Error retrieving vector from Weaviate: ${error.message}`);
      
      // If this is not the last attempt, delay before retrying
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        logger.debug(`[ConsolidationAgent] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // If we get here, all attempts failed
  logger.error(`[ConsolidationAgent] Failed to retrieve vector for chunk ${chunkId} after ${maxRetries} attempts`);
  return null;
}

/**
 * Calculate the centroid vector for a cluster
 * @param {Array} vectors - Array of chunk vectors
 * @returns {Array} Centroid vector
 */
function calculateCentroid(vectors) {
  if (!vectors || vectors.length === 0) {
    return [];
  }
  
  const dimensions = vectors[0].length;
  const centroid = new Array(dimensions).fill(0);
  
  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += vector[i];
    }
  }
  
  // Calculate the average
  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= vectors.length;
  }
  
  return centroid;
}

/**
 * Generate a title and narrative for an episode based on its chunks
 * @param {Array} chunks - Array of ChunkEmbedding objects
 * @returns {Promise<Object>} Object with title and narrative
 */
async function generateEpisodeNarrative(chunks) {
  try {
    // Combine chunk texts for context
    const MAX_NARRATIVE_INPUT_CHARS = 8000; // Increased limit
    const chunksText = chunks
      .map(chunk => chunk.text)
      .join("\n\n")
      .substring(0, MAX_NARRATIVE_INPUT_CHARS); 
    
    logger.debug(`[ConsolidationAgent] Combined chunk text length for narrative generation: ${chunksText.length} chars`);
    
    // Use the centralized prompt from the config file
    const prompt = aiConfig.episodeNarrativePrompt.replace('{CONTENT}', chunksText);
    
    logger.debug('[ConsolidationAgent] Sending prompt for episode narrative generation');
    
    const responseText = await aiService.getCompletion(prompt);
    
    let title = 'Untitled Episode';
    let narrative = 'No description available.';
    
    if (responseText) {
      // Extract title
      const titleMatch = responseText.match(/Title:\s*(.+?)(?:\n|$)/);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].trim();
      }
      
      // Extract summary/narrative
      const summaryMatch = responseText.match(/Summary:\s*([\s\S]+)$/);
      if (summaryMatch && summaryMatch[1]) {
        narrative = summaryMatch[1].trim();
      }
    }
    
    return { title, narrative };
  } catch (error) {
    logger.error('[ConsolidationAgent] Error generating episode narrative:', { error });
    return { 
      title: 'Untitled Episode', 
      narrative: 'This episode was automatically generated from related content.'
    };
  }
}

/**
 * Store an episode in Weaviate for retrieval
 * @param {Object} episode - The episode to store
 */
async function storeEpisodeInWeaviate(episode) {
  const client = weaviateClientUtil.getClient();
  if (!client) {
    logger.warn('[ConsolidationAgent] Weaviate client not available, skipping episode import');
    return;
  }
  
  try {
    logger.debug(`[ConsolidationAgent] Attempting to store episode ${episode.id} in Weaviate with title: ${episode.title}`);
    
    // Generate UUID for Weaviate
    const weaviateUuid = uuidv4(); 
    logger.debug(`[ConsolidationAgent] Using Weaviate ID ${weaviateUuid} for DB Episode ${episode.id}`);
    
    // Expand vector to 1536 dimensions to match existing episode vectors
    const targetDimension = aiConfig.embeddingDimension || 1536;
    let vectorToStore = episode.centroidVec;
    
    if (vectorToStore.length !== targetDimension) {
      logger.info(`[ConsolidationAgent] Expanding episode centroid vector from ${vectorToStore.length} to ${targetDimension} dimensions`);
      const { expandVector } = require('./memoryManager.service');
      vectorToStore = await expandVector(vectorToStore, targetDimension);
    }
    
    // Store the episode in Weaviate
    await client.data
      .creator()
      .withClassName('EpisodeEmbedding')
      .withId(weaviateUuid)
      .withProperties({
        episodeDbId: episode.id,
        title: episode.title || 'Untitled Episode',
        userId: episode.userId
      })
      .withVector(vectorToStore)
      .do();
    
    logger.info(`[ConsolidationAgent] Successfully stored episode ${episode.id} in Weaviate with ID ${weaviateUuid}`);
    
    // Update the Postgres episode record with centroidDim
    await prisma.episode.update({
      where: { id: episode.id },
      data: { 
        centroidDim: targetDimension,
        centroidVec: vectorToStore // Store the expanded vector in the database as well
      }
    });
    
    return weaviateUuid;
  } catch (error) {
    logger.error(`[ConsolidationAgent] Error storing episode ${episode.id} in Weaviate: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Start the consolidation process as a recurring job
 */
function startConsolidationWorker() {
  if (!orphanQueue) {
    logger.error('[ConsolidationAgent] Cannot start worker: orphan queue is not initialized');
    return;
  }
  
  // Get shared Redis config
  const redisConnection = redisConfig.getRedisConfig();
  if (!redisConnection) {
    logger.error('[ConsolidationAgent] Cannot start worker: Redis configuration is invalid');
    return;
  }
  
  logger.info('[ConsolidationAgent] Initializing consolidation worker...'); // Log worker init
  
  let worker;
  try {
    worker = new Worker(ORPHAN_QUEUE_NAME, async job => {
      logger.info(`[ConsolidationAgent] Worker callback entered for job ${job?.id || 'unknown'}. Validating job data...`); 
      logger.info(`[ConsolidationAgent] Worker received job ${job.id}`); // Log job received
      // Validate job data
      if (!job.data || !job.data.userId) {
        logger.warn(`[ConsolidationAgent] Worker received job ${job.id} without userId. Skipping.`);
        return; // Or throw error? For now, skip.
      }
      
      const { userId, triggerChunkId } = job.data;
      logger.info(`[ConsolidationAgent] Worker starting processing for userId: ${userId} (Job ID: ${job.id}, Trigger Chunk: ${triggerChunkId || 'N/A'})`);
      
      await processOrphanChunks(userId, triggerChunkId); // Pass triggerChunkId for logging
      
      logger.info(`[ConsolidationAgent] Worker finished processing for userId: ${userId} (Job ID: ${job.id})`);
      
    }, {
      connection: redisConnection,
      concurrency: 1 // Process one job at a time for stability/debugging
    });
    
    worker.on('completed', job => {
      logger.info(`[ConsolidationAgent] Completed job ${job.id} for user ${job.data?.userId}`); // Include userId
    });
    
    worker.on('failed', (job, err) => {
      // Check if job is defined before accessing its properties
      const jobId = job?.id || 'unknown';
      const userId = job?.data?.userId || 'unknown';
      logger.error(`[ConsolidationAgent] Failed job ${jobId} for user ${userId}:`, { error: err });
    });

    worker.on('error', err => {
       logger.error(`[ConsolidationAgent] Worker encountered an error:`, { error: err });
    });
    
    logger.info('[ConsolidationAgent] Started consolidation worker successfully.'); // Log successful start
  } catch (workerInitError) {
      logger.error(`[ConsolidationAgent] CRITICAL: Failed to initialize BullMQ Worker:`, { error: workerInitError });
      // Optionally, you might want to exit the process or implement retry logic here
      // For now, just logging the critical failure.
  }
}

/**
 * Gracefully shut down connections
 */
async function shutdown() {
  try {
    logger.info('[ConsolidationAgent] Shutting down gracefully');
    
    if (orphanQueue) {
      await orphanQueue.close();
      logger.info('[ConsolidationAgent] Closed orphan queue');
    }
    
    // Note: Don't disconnect Prisma here as it's a singleton and other services might still be using it
    
    logger.info('[ConsolidationAgent] Graceful shutdown complete');
  } catch (error) {
    logger.error('[ConsolidationAgent] Error during graceful shutdown:', { error });
  }
}

// Export the functions
module.exports = {
  processOrphanChunks,
  startConsolidationWorker,
  shutdown
}; 