// src/services/consolidationAgent.js
// Agent for consolidating orphan chunks into episodes

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const logger = require('../utils/logger').childLogger('ConsolidationAgent');
const weaviateClientUtil = require('../utils/weaviateClient');
const { Worker, Queue } = require('bullmq');
const config = require('../config');
const aiService = require('./ai.service'); // For generating narratives
const dbscan = require('density-clustering').DBSCAN; // For clustering

// Configuration parameters
const ORPHAN_QUEUE_NAME = 'orphan-chunks';
const CONSOLIDATION_THRESHOLD = 20; // Min number of orphan chunks to trigger consolidation
const DBSCAN_EPSILON = 0.3; // DBSCAN distance threshold (1 - cosine similarity)
const DBSCAN_MIN_POINTS = 3; // DBSCAN minimum points to form a cluster
const MAX_CHUNKS_PER_EPISODE = 30; // Maximum number of chunks to include in a single episode

// Initialize the queue for orphan chunks
let orphanQueue = null;
try {
  orphanQueue = new Queue(ORPHAN_QUEUE_NAME, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
    },
  });
  logger.info('[ConsolidationAgent] Connected to orphan chunk queue');
} catch (error) {
  logger.error('[ConsolidationAgent] Failed to connect to orphan chunk queue:', { error });
}

/**
 * Process orphan chunks to form new episodes
 * @param {string} userId - The user ID to process orphans for
 */
async function processOrphanChunks(userId) {
  try {
    logger.info(`[ConsolidationAgent] Processing orphan chunks for user ${userId}`);
    
    // Get all orphaned chunks for the user
    // This could be optimized to use the queue instead if needed
    const orphanedChunks = await getOrphanedChunks(userId);
    
    if (orphanedChunks.length < CONSOLIDATION_THRESHOLD) {
      logger.info(`[ConsolidationAgent] Not enough orphaned chunks (${orphanedChunks.length}) to trigger consolidation`);
      return;
    }
    
    logger.info(`[ConsolidationAgent] Found ${orphanedChunks.length} orphaned chunks for user ${userId}`);
    
    // Prepare the chunks for clustering by extracting vectors
    const vectors = orphanedChunks.map(chunk => chunk.vector);
    const chunkIds = orphanedChunks.map(chunk => chunk.id);
    
    // Run DBSCAN to find clusters of related chunks
    const dbscanInstance = new dbscan();
    
    // Note: DBSCAN expects a distance function, but our vectors use cosine similarity
    // So we need to convert cosine similarity (1.0 = identical) to distance (0.0 = identical)
    const clusters = dbscanInstance.run(vectors, DBSCAN_EPSILON, DBSCAN_MIN_POINTS, 
      (a, b) => {
        // Calculate cosine similarity
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
          dotProduct += a[i] * b[i];
          normA += a[i] * a[i];
          normB += b[i] * b[i];
        }
        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        
        // Convert to distance (1.0 - similarity)
        return 1.0 - similarity;
      }
    );
    
    logger.info(`[ConsolidationAgent] DBSCAN found ${clusters.length} clusters`);
    
    // Process each cluster to create an episode
    for (let i = 0; i < clusters.length; i++) {
      const clusterIndices = clusters[i];
      
      // Skip small clusters
      if (clusterIndices.length < DBSCAN_MIN_POINTS) {
        continue;
      }
      
      // Limit the number of chunks per episode
      const limitedIndices = clusterIndices.slice(0, MAX_CHUNKS_PER_EPISODE);
      
      // Get the chunk IDs and vectors for this cluster
      const clusterChunkIds = limitedIndices.map(idx => chunkIds[idx]);
      const clusterVectors = limitedIndices.map(idx => vectors[idx]);
      
      // Calculate the centroid vector (average of all vectors in the cluster)
      const centroidVector = calculateCentroid(clusterVectors);
      
      // Fetch the full chunks for narrative generation
      const clusterChunks = await prisma.chunkEmbedding.findMany({
        where: {
          id: { in: clusterChunkIds }
        }
      });
      
      // Generate a narrative for the episode using AI
      const { title, narrative } = await generateEpisodeNarrative(clusterChunks);
      
      // Create the episode
      const episode = await prisma.episode.create({
        data: {
          title,
          narrative,
          centroidVec: centroidVector,
          centroidDim: centroidVector.length,
          userId: userId,
          createdAt: new Date(),
        }
      });
      
      logger.info(`[ConsolidationAgent] Created episode "${title}" (${episode.id}) with ${limitedIndices.length} chunks`);
      
      // Create ChunkEpisode entries for each chunk in the cluster
      for (const chunkId of clusterChunkIds) {
        await prisma.chunkEpisode.create({
          data: {
            chunkId,
            episodeId: episode.id,
          }
        });
      }
      
      // Store the episode in Weaviate
      await storeEpisodeInWeaviate(episode);
    }
    
    // Clean up the processed chunks from the orphan queue
    // (In a production system, we might want to be more selective about which chunks we've processed)
    // await cleanupProcessedChunks(userId, chunkIds);
    
    logger.info(`[ConsolidationAgent] Completed processing orphan chunks for user ${userId}`);
  } catch (error) {
    logger.error(`[ConsolidationAgent] Error processing orphan chunks:`, { error });
  }
}

/**
 * Get orphaned chunks for a user (chunks not linked to any episode)
 * @param {string} userId - User ID to get orphans for
 * @returns {Promise<Array>} Array of orphaned chunk objects
 */
async function getOrphanedChunks(userId) {
  // Find all chunks for the user
  const allChunks = await prisma.chunkEmbedding.findMany({
    where: {
      userId: userId
    }
  });
  
  // Find all chunks that are already part of episodes
  const linkedChunkIds = await prisma.chunkEpisode.findMany({
    select: {
      chunkId: true
    }
  });
  
  const linkedIds = new Set(linkedChunkIds.map(link => link.chunkId));
  
  // Filter to only orphaned chunks
  return allChunks.filter(chunk => !linkedIds.has(chunk.id));
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
    const chunksText = chunks
      .map(chunk => chunk.text)
      .join("\n\n")
      .substring(0, 3000); // Limit to 3000 chars to avoid token limits
    
    // Generate title and narrative
    const prompt = `I have the following related memories or content. 
    Please create a short title (max 50 characters) and summary (250-300 words) 
    that captures their essence as if they form a coherent episode or experience:
    
    ${chunksText}
    
    Format your response as:
    Title: [short memorable title]
    
    Summary: [narrative summary that captures the key themes and insights]`;
    
    const aiResponse = await aiService.generateText(prompt);
    
    // Parse the response
    let title = 'Untitled Episode';
    let narrative = 'No description available.';
    
    if (aiResponse) {
      // Extract title
      const titleMatch = aiResponse.match(/Title:\s*(.+?)(?:\n|$)/);
      if (titleMatch && titleMatch[1]) {
        title = titleMatch[1].trim();
      }
      
      // Extract summary/narrative
      const summaryMatch = aiResponse.match(/Summary:\s*([\s\S]+)$/);
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
    // Create a Weaviate object for the episode
    await client.data
      .creator()
      .withClassName('EpisodeEmbedding')
      .withId(episode.id)
      .withProperties({
        id: episode.id,
        title: episode.title,
        narrative: episode.narrative,
        occurredAt: episode.occurredAt ? episode.occurredAt.toISOString() : null,
        createdAt: episode.createdAt.toISOString(),
        userId: episode.userId
      })
      .withVector(episode.centroidVec)
      .do();
    
    logger.info(`[ConsolidationAgent] Stored episode ${episode.id} in Weaviate`);
  } catch (error) {
    logger.error(`[ConsolidationAgent] Error storing episode ${episode.id} in Weaviate:`, { error });
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
  
  const worker = new Worker(ORPHAN_QUEUE_NAME, async job => {
    const { userId } = job.data;
    
    if (!userId) {
      logger.warn('[ConsolidationAgent] Received job without userId, skipping');
      return;
    }
    
    await processOrphanChunks(userId);
  }, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
    },
  });
  
  worker.on('completed', job => {
    logger.info(`[ConsolidationAgent] Completed job ${job.id}`);
  });
  
  worker.on('failed', (job, err) => {
    logger.error(`[ConsolidationAgent] Failed job ${job?.id}:`, { error: err });
  });
  
  logger.info('[ConsolidationAgent] Started consolidation worker');
}

// Export the functions
module.exports = {
  processOrphanChunks,
  startConsolidationWorker,
}; 