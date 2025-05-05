// src/utils/verifyWeaviate.js
// Utility to verify Weaviate data integrity

const weaviateClientUtil = require('./weaviateClient');
const { prisma } = require('../db/prisma');
const logger = require('./logger').childLogger('WeaviateVerify');

/**
 * Verifies the data integrity between Prisma and Weaviate
 */
async function verifyWeaviateData() {
  try {
    logger.info('Starting Weaviate data verification...');
    
    // Get Weaviate client
    const client = weaviateClientUtil.getClient();
    if (!client) {
      logger.error('Weaviate client not available');
      return { status: 'error', message: 'Weaviate client not available' };
    }
    
    // 1. Check Weaviate schema
    try {
      const schema = await client.schema.getter().do();
      const classes = schema.classes?.map(c => c.class) || [];
      logger.info(`Found Weaviate schema classes: ${classes.join(', ')}`);
      
      if (!classes.includes('ChunkEmbedding')) {
        logger.error('ChunkEmbedding class not found in Weaviate schema');
        return { status: 'error', message: 'ChunkEmbedding class missing' };
      }
    } catch (schemaError) {
      logger.error(`Failed to get Weaviate schema: ${schemaError.message}`);
      return { status: 'error', message: 'Failed to get Weaviate schema' };
    }
    
    // 2. Get some processed chunks from Prisma for testing
    const prismaChunks = await prisma.chunkEmbedding.findMany({
      where: { processingStatus: 'processed' },
      take: 5,
      orderBy: { createdAt: 'desc' }
    });
    
    if (prismaChunks.length === 0) {
      logger.warn('No processed chunks found in Prisma');
      return { status: 'warning', message: 'No processed chunks to verify' };
    }
    
    logger.info(`Found ${prismaChunks.length} processed chunks in Prisma for verification`);
    
    // 3. Check each chunk in Weaviate
    const verificationResults = [];
    
    for (const chunk of prismaChunks) {
      try {
        // Query using GraphQL API
        const result = await client.graphql
          .get()
          .withClassName('ChunkEmbedding')
          .withFields('chunkDbId text _additional { id vector }')
          .withWhere({
            path: ['chunkDbId'],
            operator: 'Equal',
            valueString: chunk.id
          })
          .do();
        
        const chunks = result?.data?.Get?.ChunkEmbedding || [];
        
        if (chunks.length === 0) {
          logger.error(`Chunk ${chunk.id} not found in Weaviate`);
          verificationResults.push({
            chunkId: chunk.id,
            found: false,
            hasVector: false,
            message: 'Not found in Weaviate'
          });
        } else {
          const hasVector = chunks[0]._additional?.vector && chunks[0]._additional.vector.length > 0;
          logger.info(`Chunk ${chunk.id} found in Weaviate, has vector: ${hasVector}`);
          verificationResults.push({
            chunkId: chunk.id,
            found: true,
            hasVector,
            message: hasVector ? 'OK' : 'Missing vector',
            weaviateId: chunks[0]._additional.id
          });
        }
      } catch (error) {
        logger.error(`Error checking chunk ${chunk.id}: ${error.message}`);
        verificationResults.push({
          chunkId: chunk.id,
          found: false,
          hasVector: false,
          message: `Query error: ${error.message}`
        });
      }
    }
    
    // 4. Compare counts
    const prismaCount = await prisma.chunkEmbedding.count({
      where: { processingStatus: 'processed' }
    });
    
    let weaviateCount = 0;
    try {
      const aggregateResult = await client.graphql
        .aggregate()
        .withClassName('ChunkEmbedding')
        .withFields('meta { count }')
        .do();
      
      weaviateCount = aggregateResult?.data?.Aggregate?.ChunkEmbedding?.[0]?.meta?.count || 0;
    } catch (countError) {
      logger.error(`Error getting count from Weaviate: ${countError.message}`);
    }
    
    logger.info(`Total processed chunks in Prisma: ${prismaCount}`);
    logger.info(`Total objects in Weaviate ChunkEmbedding class: ${weaviateCount}`);
    
    const countMatch = prismaCount <= weaviateCount;
    if (!countMatch) {
      logger.warn(`Missing ${prismaCount - weaviateCount} chunks in Weaviate`);
    }
    
    // 5. Return comprehensive results
    return {
      status: verificationResults.every(r => r.found && r.hasVector) ? 'success' : 'warning',
      countMatch,
      prismaCount,
      weaviateCount,
      sampleResults: verificationResults,
      message: countMatch ? 'Count match OK' : `Count mismatch: ${prismaCount} in Prisma vs ${weaviateCount} in Weaviate`
    };
    
  } catch (error) {
    logger.error(`Error during Weaviate verification: ${error.message}`);
    return { status: 'error', message: `Verification failed: ${error.message}` };
  }
}

/**
 * Run a GraphQL query against ChunkEmbedding to get a list of objects
 */
async function listChunkEmbeddings(limit = 5) {
  try {
    const client = weaviateClientUtil.getClient();
    if (!client) {
      logger.error('Weaviate client not available');
      return { status: 'error', message: 'Weaviate client not available' };
    }
    
    const result = await client.graphql
      .get()
      .withClassName('ChunkEmbedding')
      .withFields('chunkDbId text rawDataId userId _additional { id }')
      .withLimit(limit)
      .do();
    
    const chunks = result?.data?.Get?.ChunkEmbedding || [];
    
    return {
      status: 'success',
      count: chunks.length,
      chunks: chunks.map(chunk => ({
        chunkDbId: chunk.chunkDbId,
        text: chunk.text ? (chunk.text.length > 100 ? chunk.text.substring(0, 100) + '...' : chunk.text) : null,
        rawDataId: chunk.rawDataId,
        userId: chunk.userId,
        weaviateId: chunk._additional.id
      }))
    };
  } catch (error) {
    logger.error(`Error listing chunk embeddings: ${error.message}`);
    return { status: 'error', message: `Query failed: ${error.message}` };
  }
}

// Export functions for command-line usage
module.exports = {
  verifyWeaviateData,
  listChunkEmbeddings
};

// Direct execution for CLI usage
if (require.main === module) {
  // Run both verification and listing when executed directly
  Promise.all([
    verifyWeaviateData(),
    listChunkEmbeddings(5)
  ]).then(([verifyResult, listResult]) => {
    console.log('\n=== VERIFICATION RESULTS ===');
    console.log(JSON.stringify(verifyResult, null, 2));
    
    console.log('\n=== SAMPLE CHUNKS ===');
    console.log(JSON.stringify(listResult, null, 2));
    
    // Exit the process
    process.exit(0);
  }).catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
} 