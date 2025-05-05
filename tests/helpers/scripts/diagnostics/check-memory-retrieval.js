#!/usr/bin/env node

require('dotenv').config();
const { prisma } = require('../../src/db/prisma');
const { getClient } = require('../../src/utils/weaviateClient');
const { generateEmbeddings } = require('../../src/services/ai.service');
const logger = require('../../src/utils/logger');
const { expandVector } = require('../../src/services/memoryManager.service');
const memoryConfig = require('../../config/memory.config');
const aiConfig = require('../../config/ai.config');

// Initialize the AI service
const { initializeAIService } = require('../../src/services/ai.service');
initializeAIService(aiConfig.provider);

/**
 * Diagnose memory retrieval and check if chunks can be retrieved
 */
async function diagnoseMemoryRetrieval(userId, testQuery) {
  logger.info('=== Memory Retrieval Diagnostic Tool ===');
  logger.info(`Testing memory retrieval for user: ${userId}`);
  logger.info(`Test query: "${testQuery}"`);
  
  // Display current memory configuration
  logger.info('\n=== Memory Configuration Parameters ===');
  logger.info(`AI Embedding Model: ${aiConfig.embeddingModelName}`);
  logger.info(`Embedding Dimension: ${aiConfig.embeddingDimension || 1536}`);
  logger.info(`Retrieval Limit: ${memoryConfig.defaultRetrievalLimit}`);
  logger.info(`Min Importance: ${memoryConfig.defaultRetrievalMinImportance}`);
  logger.info(`Similarity Threshold: ${memoryConfig.defaultRetrievalCertainty}`);
  
  try {
    // Step 1: Test connection to Weaviate
    logger.info('\nTesting Weaviate connection...');
    const client = getClient();
    if (!client) {
      logger.error('Weaviate client not available!');
      return;
    }
    logger.info('Weaviate connection successful ✅');
    
    // Step 2: Generate embeddings for the test query
    logger.info('\nGenerating embeddings for test query...');
    const queryEmbedding = await generateEmbeddings(testQuery);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      logger.error('Failed to generate embedding for query!');
      return;
    }
    const originalQueryVector = queryEmbedding[0];
    logger.info(`Successfully generated embedding with dimension: ${originalQueryVector.length} ✅`);
    
    // Step 3: Test episode retrieval with the query embedding
    logger.info('\nTesting episode retrieval...');
    
    // Expand the vector to 1536 dimensions if needed
    const episodeClassDimension = aiConfig.embeddingDimension || 1536;
    let queryVector = originalQueryVector;
    
    if (originalQueryVector.length !== episodeClassDimension) {
      logger.info(`Expanding query vector from ${originalQueryVector.length} to ${episodeClassDimension} dimensions`);
      queryVector = await expandVector(originalQueryVector, episodeClassDimension);
    }
    
    try {
      const episodeResponse = await client.graphql
        .get()
        .withClassName('EpisodeEmbedding')
        .withFields('episodeDbId title userId _additional { certainty }')
        .withNearVector({ vector: queryVector, certainty: memoryConfig.defaultRetrievalCertainty })
        .withWhere({
          operator: 'Equal',
          path: ['userId'],
          valueText: userId,
        })
        .withLimit(10)
        .do();
      
      const episodes = episodeResponse?.data?.Get?.EpisodeEmbedding || [];
      logger.info(`Found ${episodes.length} episodes for the query.`);
      
      for (const ep of episodes) {
        logger.info(`Episode: ${ep.title} (${ep.episodeDbId}) - Certainty: ${ep._additional.certainty.toFixed(4)}`);
        
        // Get episode details from database
        const dbEpisode = await prisma.episode.findUnique({
          where: { id: ep.episodeDbId },
          include: {
            chunks: {
              include: {
                chunk: true
              }
            }
          }
        });
        
        if (dbEpisode) {
          logger.info(`  Episode in DB: ${dbEpisode.title}`);
          logger.info(`  Linked chunks: ${dbEpisode.chunks.length}`);
          logger.info(`  Vector dimension: ${dbEpisode.centroidDim}`);
          
          // Check if chunks exist
          if (dbEpisode.chunks.length === 0) {
            logger.warn(`  WARNING: Episode ${ep.episodeDbId} has no linked chunks!`);
          } else {
            logger.info(`  ✅ Episode has ${dbEpisode.chunks.length} chunks linked in the database`);
            logger.info(`  First chunk text: "${dbEpisode.chunks[0].chunk.text.substring(0, 100)}..."`);
          }
        } else {
          logger.error(`  ERROR: Episode ${ep.episodeDbId} exists in Weaviate but not in database!`);
        }
      }
    } catch (error) {
      logger.error(`Error retrieving episodes: ${error.message}`);
    }
    
    // Step 4: Try retrieving chunks directly
    logger.info('\nTrying to retrieve chunks directly...');
    try {
      // For ChunkEmbedding search, check if we need to adjust dimension
      let chunkQueryVector = originalQueryVector;
      const chunkClassDimension = 768; // ChunkEmbedding typically uses 768 dimensions
      
      if (originalQueryVector.length !== chunkClassDimension) {
        logger.info(`Adjusting query vector from ${originalQueryVector.length} to ${chunkClassDimension} dimensions for ChunkEmbedding search`);
        chunkQueryVector = await expandVector(originalQueryVector, chunkClassDimension);
      }
      
      const chunkResponse = await client.graphql
        .get()
        .withClassName('ChunkEmbedding')
        .withFields('chunkDbId text importance userId _additional { certainty }')
        .withNearVector({ vector: chunkQueryVector, certainty: memoryConfig.defaultRetrievalCertainty })
        .withWhere({
          operator: 'Equal',
          path: ['userId'],
          valueText: userId,
        })
        .withLimit(10)
        .do();
      
      const chunks = chunkResponse?.data?.Get?.ChunkEmbedding || [];
      logger.info(`Found ${chunks.length} chunks for the query.`);
      
      if (chunks.length > 0) {
        logger.info(`✅ Direct chunk retrieval is working!`);
        for (const chunk of chunks) {
          logger.info(`Chunk ${chunk.chunkDbId} - Certainty: ${chunk._additional.certainty.toFixed(4)}`);
          logger.info(`Text: "${chunk.text.substring(0, 100)}..."`);
        }
      } else {
        logger.warn(`No chunks found directly in Weaviate for this query.`);
      }
    } catch (error) {
      logger.error(`Error retrieving chunks: ${error.message}`);
    }
    
    // Step 5: Verify chunk-episode associations in database
    logger.info('\nVerifying chunk-episode associations in the database...');
    try {
      // Find all episodes for the user
      const dbEpisodes = await prisma.episode.findMany({
        where: { userId },
        include: {
          chunks: true
        }
      });
      
      logger.info(`Found ${dbEpisodes.length} episodes in the database for user ${userId}`);
      
      let totalLinkedChunks = 0;
      let episodeDetails = [];
      
      for (const episode of dbEpisodes) {
        const chunkCount = episode.chunks.length;
        totalLinkedChunks += chunkCount;
        episodeDetails.push({
          id: episode.id,
          title: episode.title,
          chunks: chunkCount,
          dimension: episode.centroidDim
        });
      }
      
      logger.info(`Total chunks linked to episodes: ${totalLinkedChunks}`);
      
      if (episodeDetails.length > 0) {
        logger.info('Episode details:');
        episodeDetails.sort((a, b) => b.chunks - a.chunks); // Sort by most chunks first
        
        for (const ep of episodeDetails) {
          logger.info(`  ${ep.title} (${ep.id}): ${ep.chunks} chunks, dimension: ${ep.dimension}`);
          if (ep.dimension !== (aiConfig.embeddingDimension || 1536)) {
            logger.warn(`  ⚠️ Episode has incorrect dimension ${ep.dimension}, should be ${aiConfig.embeddingDimension || 1536}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Error verifying chunk-episode associations: ${error.message}`);
    }
    
    logger.info('\n=== Diagnostic Complete ===');
  } catch (error) {
    logger.error(`Error in diagnostic: ${error.message}`, { error });
  } finally {
    await prisma.$disconnect();
  }
}

// Check if userId and query are provided as command line arguments
const userId = process.argv[2] || 'd9fe3dbe-bc25-4040-ac00-a835d418c5b4'; // Default user
const testQuery = process.argv[3] || 'late night debugging';

// Run the diagnostics
diagnoseMemoryRetrieval(userId, testQuery)
  .catch(error => {
    logger.error('Error in memory retrieval diagnostic:', error);
    process.exit(1);
  }); 