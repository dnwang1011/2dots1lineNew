// src/services/thoughtAgent.js
// Agent for generating high-level thoughts from related episodes

const { PrismaClient } = require('@prisma/client');
// Replace local Prisma instance with singleton
// const prisma = new PrismaClient();
const { prisma } = require('../db/prisma'); // Use the singleton instance
const logger = require('../utils/logger').childLogger('ThoughtAgent');
const weaviateClientUtil = require('../utils/weaviateClient');
const aiService = require('./ai.service'); // For generating thoughts
const schedule = require('node-schedule');
const episodicConfig = require('../../config/episodic.config'); // Import episodic config

// Import configuration parameters from centralized config
const MIN_EPISODES_FOR_THOUGHT = episodicConfig.thought.minEpisodesForThought;
const MIN_EPISODE_SIMILARITY = episodicConfig.thought.minEpisodeSimilarity;
const MIN_THOUGHT_IMPORTANCE = episodicConfig.thought.minImportance;

/**
 * Generate thoughts for a user by analyzing their episodes
 * @param {string} userId - ID of the user to generate thoughts for
 */
async function generateThoughtsForUser(userId) {
  try {
    logger.info(`[ThoughtAgent] Starting thought generation process for user ${userId}`);
    
    // Get all episodes for the user
    const episodes = await prisma.episode.findMany({
      where: {
        userId: userId
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 50 // Limit to 50 most recent episodes for performance
    });
    
    logger.info(`[ThoughtAgent] User ${userId}: Found ${episodes.length} episodes. Checking threshold (${MIN_EPISODES_FOR_THOUGHT}).`);
    
    if (episodes.length < MIN_EPISODES_FOR_THOUGHT) {
      logger.info(`[ThoughtAgent] User ${userId}: Not enough episodes (${episodes.length}) to generate thoughts. Skipping.`);
      return;
    }
    
    // Find related episode clusters using cosine similarity between centroid vectors
    logger.debug(`[ThoughtAgent] User ${userId}: Finding related episode clusters...`);
    const relatedEpisodeClusters = findRelatedEpisodes(episodes);
    
    logger.info(`[ThoughtAgent] User ${userId}: Found ${relatedEpisodeClusters.length} related episode clusters.`);
    
    // Generate a thought for each cluster of related episodes
    let thoughtsGenerated = 0;
    for (const cluster of relatedEpisodeClusters) {
      const clusterEpisodeIds = cluster; // Assuming cluster is an array of IDs
      logger.debug(`[ThoughtAgent] User ${userId}: Processing cluster with ${clusterEpisodeIds.length} episodes.`);
      
      if (cluster.length < MIN_EPISODES_FOR_THOUGHT) {
        logger.debug(`[ThoughtAgent] User ${userId}: Cluster too small (${clusterEpisodeIds.length} < ${MIN_EPISODES_FOR_THOUGHT}). Skipping.`);
        continue;
      }
      
      // Get full episodes for the cluster
      logger.debug(`[ThoughtAgent] User ${userId}: Fetching full episode data for cluster.`);
      const clusterEpisodes = episodes.filter(ep => 
        clusterEpisodeIds.includes(ep.id)
      );
      
      // Generate the thought
      logger.debug(`[ThoughtAgent] User ${userId}: Generating thought from ${clusterEpisodes.length} episodes in cluster.`);
      const thought = await generateThoughtFromEpisodes(clusterEpisodes, userId);
      
      // Store the thought and connect it to episodes
      if (thought) {
        logger.info(`[ThoughtAgent] User ${userId}: Successfully generated thought candidate: "${thought.name}"`);
        const createdThought = await storeThought(thought, clusterEpisodes);
        thoughtsGenerated++;
        logger.info(`[ThoughtAgent] User ${userId}: Successfully stored thought "${createdThought.name}" (${createdThought.id}) connected to ${clusterEpisodes.length} episodes.`);
      } else {
        logger.info(`[ThoughtAgent] User ${userId}: Thought generation skipped or failed for cluster (check previous logs).`);
      }
    }
    
    logger.info(`[ThoughtAgent] Completed thought generation process for user ${userId}. Generated ${thoughtsGenerated} thoughts.`);
  } catch (error) {
    logger.error(`[ThoughtAgent] Error generating thoughts for user ${userId}:`, { error });
  }
}

/**
 * Find clusters of related episodes based on centroid vector similarity
 * @param {Array} episodes - Array of episode objects with centroid vectors
 * @returns {Array} Array of arrays, each containing IDs of related episodes
 */
function findRelatedEpisodes(episodes) {
  const clusters = [];
  const processedEpisodes = new Set();
  
  // Filter to episodes with valid centroid vectors
  const validEpisodes = episodes.filter(ep => 
    ep.centroidVec && 
    ep.centroidVec.length > 0 && 
    ep.centroidDim > 0
  );
  
  // For each episode, find related episodes
  for (let i = 0; i < validEpisodes.length; i++) {
    const episode = validEpisodes[i];
    
    // Skip if already in a cluster
    if (processedEpisodes.has(episode.id)) {
      continue;
    }
    
    const relatedIds = [episode.id];
    processedEpisodes.add(episode.id);
    
    // Compare with all other episodes
    for (let j = 0; j < validEpisodes.length; j++) {
      if (i === j) continue;
      
      const otherEpisode = validEpisodes[j];
      
      // Skip if already in a cluster
      if (processedEpisodes.has(otherEpisode.id)) {
        continue;
      }
      
      // Check for dimension match
      if (episode.centroidDim !== otherEpisode.centroidDim) {
        continue;
      }
      
      // Calculate cosine similarity
      const similarity = calculateCosineSimilarity(
        episode.centroidVec,
        otherEpisode.centroidVec
      );
      
      // If similar enough, add to cluster
      if (similarity >= MIN_EPISODE_SIMILARITY) {
        relatedIds.push(otherEpisode.id);
        processedEpisodes.add(otherEpisode.id);
      }
    }
    
    // Add cluster if it has enough episodes
    if (relatedIds.length >= MIN_EPISODES_FOR_THOUGHT) {
      clusters.push(relatedIds);
    }
  }
  
  return clusters;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {Array} vecA - First vector
 * @param {Array} vecB - Second vector
 * @returns {number} Cosine similarity (0-1)
 */
function calculateCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generate a thought from a cluster of related episodes
 * @param {Array} episodes - Array of related episode objects
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Thought object or null if generation failed
 */
async function generateThoughtFromEpisodes(episodes, userId) {
  try {
    // Extract content from episodes
    const episodeContent = episodes.map(ep => ({
      title: ep.title,
      narrative: ep.narrative,
    }));
    
    // Create prompt for the AI
    const prompt = `
I have several related memory episodes that seem to be connected. Please analyze them and identify a high-level insight, pattern, or thought that connects them.

Episodes:
${episodeContent.map((ep, idx) => `
Episode ${idx + 1}: ${ep.title}
${ep.narrative}
`).join('\n')}

Please identify a meaningful insight or pattern that connects these episodes, and provide:
1. A short, memorable name for this insight (5-7 words)
2. A detailed description of the insight (150-200 words)
3. An importance score between 0 and 1 indicating how significant this insight is (where 1 is extremely important)

Format your response as:
NAME: [name of the insight]
DESCRIPTION: [detailed description]
IMPORTANCE: [score between 0 and 1]

The response should only contain these three elements with no additional text.`;

    // Generate the thought using AI
    const aiResponse = await aiService.getAiCompletion(prompt);
    if (!aiResponse || !aiResponse.text) {
      logger.error('[ThoughtAgent] Failed to generate thought: empty AI response');
      return null;
    }
    
    // Parse the AI response
    const responseText = aiResponse.text;
    const nameMatch = responseText.match(/NAME:\s*(.+?)(?:\n|$)/);
    const descriptionMatch = responseText.match(/DESCRIPTION:\s*([\s\S]+?)(?:\n*IMPORTANCE:|$)/);
    const importanceMatch = responseText.match(/IMPORTANCE:\s*([\d.]+)/);
    
    if (!nameMatch || !descriptionMatch) {
      logger.error('[ThoughtAgent] Failed to parse thought from AI response', { responseText });
      return null;
    }
    
    const name = nameMatch[1].trim();
    const description = descriptionMatch[1].trim();
    const importance = importanceMatch ? parseFloat(importanceMatch[1]) : 0.5;
    
    // Validate importance
    if (isNaN(importance) || importance < 0 || importance > 1) {
      logger.warn('[ThoughtAgent] Invalid importance score, using default', { importance });
      importance = 0.5;
    }
    
    // Skip if below importance threshold
    if (importance < MIN_THOUGHT_IMPORTANCE) {
      logger.info(`[ThoughtAgent] Thought "${name}" below importance threshold (${importance}), skipping`);
      return null;
    }
    
    // Generate an embedding for the thought
    const thoughtText = `${name}: ${description}`;
    const vector = await aiService.generateEmbedding(thoughtText);
    
    if (!vector || vector.length === 0) {
      logger.error('[ThoughtAgent] Failed to generate embedding for thought');
      return null;
    }
    
    return {
      name,
      description,
      userId,
      vector,
      dimension: vector.length,
      episodeIds: episodes.map(ep => ep.id)
    };
  } catch (error) {
    logger.error('[ThoughtAgent] Error generating thought from episodes:', { error });
    return null;
  }
}

/**
 * Store a thought in the database and connect it to episodes
 * @param {Object} thought - Thought object with name, description, userId, vector, dimension, episodeIds
 * @param {Array} relatedEpisodes - Array of related episode objects
 * @returns {Promise<Object>} Created thought object
 */
async function storeThought(thought, relatedEpisodes) {
  try {
    // Create the thought
    const createdThought = await prisma.thought.create({
      data: {
        name: thought.name,
        description: thought.description,
        userId: thought.userId,
        vector: thought.vector,
        dimension: thought.dimension
      }
    });
    
    // Connect the thought to episodes through the pivot table
    for (const episode of relatedEpisodes) {
      // Calculate a relevance weight based on the cosine similarity between
      // the thought vector and the episode centroid vector
      let weight = 0.5; // Default weight
      
      if (episode.centroidVec && episode.centroidVec.length > 0 && 
          thought.vector.length === episode.centroidVec.length) {
        weight = calculateCosineSimilarity(thought.vector, episode.centroidVec);
      }
      
      await prisma.episodeThought.create({
        data: {
          episodeId: episode.id,
          thoughtId: createdThought.id,
          weight: weight
        }
      });
    }
    
    // Store in Weaviate
    await storeThoughtInWeaviate(createdThought);
    
    return createdThought;
  } catch (error) {
    logger.error('[ThoughtAgent] Error storing thought:', { error });
    throw error;
  }
}

/**
 * Store a thought in Weaviate for retrieval
 * @param {Object} thought - The thought to store
 */
async function storeThoughtInWeaviate(thought) {
  const client = weaviateClientUtil.getClient();
  if (!client) {
    logger.warn('[ThoughtAgent] Weaviate client not available, skipping thought import');
    return;
  }
  
  try {
    // Create a Weaviate object for the thought
    await client.data
      .creator()
      .withClassName('ThoughtEmbedding')
      .withId(thought.id)
      .withProperties({
        thoughtDbId: thought.id,
        name: thought.name,
        description: thought.description,
        createdAt: thought.createdAt.toISOString(),
        userId: thought.userId
      })
      .withVector(thought.vector)
      .do();
    
    logger.info(`[ThoughtAgent] Stored thought ${thought.id} in Weaviate`);
  } catch (error) {
    logger.error(`[ThoughtAgent] Error storing thought ${thought.id} in Weaviate:`, { error });
  }
}

/**
 * Schedule nightly thought generation for all users
 */
function scheduleNightlyThoughtGeneration() {
  // Schedule to run at 3:00 AM every day
  logger.info('[ThoughtAgent] Scheduling nightly thought generation for 3:00 AM daily'); // Added more specific info
  const job = schedule.scheduleJob('0 3 * * *', async () => {
    logger.info('[ThoughtAgent] Starting scheduled nightly thought generation run...'); // Log job start
    try {
      logger.info('[ThoughtAgent] Starting nightly thought generation');
      
      // Get all users
      logger.debug('[ThoughtAgent] Fetching all users...');
      const users = await prisma.user.findMany({
        select: { id: true }
      });
      
      logger.info(`[ThoughtAgent] Found ${users.length} users for nightly thought generation.`);
      
      // Process each user sequentially
      for (const user of users) {
        logger.info(`[ThoughtAgent] Starting thought generation for user ${user.id}`); // Log per-user start
        await generateThoughtsForUser(user.id);
        logger.info(`[ThoughtAgent] Completed thought generation for user ${user.id}`); // Log per-user end
      }
      
      logger.info('[ThoughtAgent] Completed nightly thought generation for all users.');
    } catch (error) {
      logger.error('[ThoughtAgent] Error in nightly thought generation:', { error });
    }
    logger.info('[ThoughtAgent] Finished scheduled nightly thought generation run.'); // Log job end
  });
  
  logger.info('[ThoughtAgent] Scheduled nightly thought generation');
  return job;
}

/**
 * Gracefully shut down connections
 */
async function shutdown() {
  try {
    logger.info('[ThoughtAgent] Shutting down gracefully');
    
    // Note: Don't disconnect Prisma here as it's a singleton and other services might still be using it
    
    logger.info('[ThoughtAgent] Graceful shutdown complete');
  } catch (error) {
    logger.error('[ThoughtAgent] Error during graceful shutdown:', { error });
  }
}

// Export the functions
module.exports = {
  generateThoughtsForUser,
  scheduleNightlyThoughtGeneration,
  shutdown
}; 