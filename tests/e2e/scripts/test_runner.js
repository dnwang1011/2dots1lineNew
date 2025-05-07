// tests/e2e/scripts/test_runner.js
// Script to run test scenarios and analyze database results

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const { resetDatabase, seedDatabase } = require('./reset_and_seed');
const logger = require('../../../src/utils/logger').childLogger('E2ETestRunner');
const weaviateClientUtil = require('../../../src/utils/weaviateClient');
const readline = require('readline');

// Initialize Prisma client
const prisma = new PrismaClient();

// Test user constants
const TEST_USER_ID = process.env.TEST_USER_ID || 'e2e-test-user';
const TEST_SESSION_ID = process.env.TEST_SESSION_ID || 'e2e-test-session';

/**
 * Analyze the status of the memory pipeline
 */
async function analyzeMemoryPipeline() {
  logger.info('Analyzing memory pipeline status...');
  
  try {
    // Get counts of various entities
    const rawDataCount = await prisma.rawData.count({
      where: { userId: TEST_USER_ID }
    });
    
    const chunkCount = await prisma.chunkEmbedding.count({
      where: { userId: TEST_USER_ID }
    });
    
    const episodeCount = await prisma.episode.count({
      where: { userId: TEST_USER_ID }
    });
    
    const thoughtCount = await prisma.thought.count({
      where: { userId: TEST_USER_ID }
    });
    
    // Get processing status counts
    const rawDataStatusCounts = await prisma.rawData.groupBy({
      by: ['processingStatus'],
      where: { userId: TEST_USER_ID },
      _count: true
    });
    
    const chunkStatusCounts = await prisma.chunkEmbedding.groupBy({
      by: ['processingStatus'],
      where: { userId: TEST_USER_ID },
      _count: true
    });
    
    // Get stats on importance scores
    const importanceStats = await prisma.$queryRaw`
      SELECT 
        MIN("importanceScore") as min, 
        MAX("importanceScore") as max, 
        AVG("importanceScore") as avg
      FROM "ChunkEmbedding"
      WHERE "userId" = ${TEST_USER_ID}
    `;
    
    // Check if chunks are attached to episodes
    const orphanChunks = await prisma.chunkEmbedding.count({
      where: {
        userId: TEST_USER_ID,
        ChunkEpisode: { none: {} }
      }
    });
    
    const attachedChunks = chunkCount - orphanChunks;
    
    // Prepare results
    const results = {
      entityCounts: {
        rawDataCount,
        chunkCount,
        episodeCount,
        thoughtCount
      },
      processingStatus: {
        rawData: rawDataStatusCounts,
        chunks: chunkStatusCounts
      },
      importanceStats: importanceStats[0],
      chunkAttachment: {
        orphanChunks,
        attachedChunks,
        attachmentRate: chunkCount > 0 ? attachedChunks / chunkCount : 0
      }
    };
    
    logger.info('Memory pipeline analysis complete:');
    console.log(JSON.stringify(results, null, 2));
    
    // Create report file
    const reportPath = path.join(__dirname, '../reports', `pipeline_analysis_${new Date().toISOString().replace(/:/g, '-')}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    logger.info(`Report saved to ${reportPath}`);
    
    return results;
  } catch (error) {
    logger.error('Error analyzing memory pipeline:', { error });
    throw error;
  }
}

/**
 * Verify vector embeddings in Weaviate
 */
async function verifyVectorEmbeddings() {
  logger.info('Verifying vector embeddings in Weaviate...');
  
  try {
    const client = weaviateClientUtil.getClient();
    if (!client) {
      logger.error('Weaviate client not available');
      return { available: false };
    }
    
    // Check chunks
    const chunkResults = await client.graphql
      .get()
      .withClassName('ChunkEmbedding')
      .withFields('chunkDbId _additional { id vector }')
      .withWhere({
        path: ['userId'],
        operator: 'Equal',
        valueString: TEST_USER_ID
      })
      .withLimit(100)
      .do();
    
    const chunkVectors = chunkResults?.data?.Get?.ChunkEmbedding || [];
    
    // Check episodes
    const episodeResults = await client.graphql
      .get()
      .withClassName('EpisodeEmbedding')
      .withFields('episodeDbId _additional { id vector }')
      .withWhere({
        path: ['userId'],
        operator: 'Equal',
        valueString: TEST_USER_ID
      })
      .withLimit(100)
      .do();
    
    const episodeVectors = episodeResults?.data?.Get?.EpisodeEmbedding || [];
    
    // Check thoughts
    const thoughtResults = await client.graphql
      .get()
      .withClassName('ThoughtEmbedding')
      .withFields('thoughtDbId _additional { id vector }')
      .withWhere({
        path: ['userId'],
        operator: 'Equal',
        valueString: TEST_USER_ID
      })
      .withLimit(100)
      .do();
    
    const thoughtVectors = thoughtResults?.data?.Get?.ThoughtEmbedding || [];
    
    const results = {
      available: true,
      counts: {
        chunks: chunkVectors.length,
        episodes: episodeVectors.length,
        thoughts: thoughtVectors.length
      },
      sampleVectorDimensions: {
        chunks: chunkVectors.length > 0 ? chunkVectors[0]._additional.vector.length : null,
        episodes: episodeVectors.length > 0 ? episodeVectors[0]._additional.vector.length : null,
        thoughts: thoughtVectors.length > 0 ? thoughtVectors[0]._additional.vector.length : null
      }
    };
    
    logger.info('Vector embeddings verification complete:');
    console.log(JSON.stringify(results, null, 2));
    
    return results;
  } catch (error) {
    logger.error('Error verifying vector embeddings:', { error });
    return { available: false, error: error.message };
  }
}

/**
 * Prompt user to run test cases
 */
async function promptForTestCases() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  console.log('\n\n==============================================================');
  console.log('TEST SCENARIO INSTRUCTIONS');
  console.log('==============================================================');
  console.log('1. Open the Dot chat interface in your browser');
  console.log('2. Open the test scenarios from: tests/e2e/chat_scenarios/');
  console.log('3. Copy and paste each test message into the chat UI');
  console.log('4. After completing a scenario, return here and press Enter');
  console.log('==============================================================\n');
  
  await new Promise(resolve => {
    rl.question('Press Enter when ready to continue with the analysis...', resolve);
  });
  
  rl.close();
}

/**
 * Main function to run the tests
 */
async function main() {
  try {
    logger.info('Starting E2E test run');
    
    // Reset and seed the database
    await resetDatabase();
    await seedDatabase();
    
    // Prompt user to run test cases
    await promptForTestCases();
    
    // Analyze results
    await analyzeMemoryPipeline();
    await verifyVectorEmbeddings();
    
    logger.info('E2E test run complete');
  } catch (error) {
    logger.error('Error during E2E test run:', { error });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

module.exports = { analyzeMemoryPipeline, verifyVectorEmbeddings, main }; 