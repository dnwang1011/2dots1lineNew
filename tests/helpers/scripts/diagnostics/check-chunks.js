const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const weaviateClientUtil = require('./src/utils/weaviateClient');

async function checkOrphanChunks() {
  try {
    const userId = '47f764c6-7b69-4c67-8ccf-60a42563e74a';

    // Get all chunks for the user
    const allChunks = await prisma.chunkEmbedding.findMany({
      where: {
        userId: userId,
      }
    });

    console.log(`Total chunks for user: ${allChunks.length}`);

    // Find all chunks that are already part of episodes
    const linkedChunkIds = await prisma.chunkEpisode.findMany({
      select: {
        chunkId: true
      },
    });

    const linkedIds = new Set(linkedChunkIds.map(link => link.chunkId));
    console.log(`Total linked chunks: ${linkedIds.size}`);

    // Filter to only orphaned chunks
    const orphaned = allChunks.filter(chunk => !linkedIds.has(chunk.id));
    console.log(`Total orphaned chunks: ${orphaned.length}`);

    // Now fetch vectors from Weaviate for some of these orphaned chunks
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('Weaviate client not available');
      return;
    }

    // Check a few chunks for vectors
    const sampleSize = Math.min(5, orphaned.length);
    console.log(`Checking vectors for ${sampleSize} sample chunks:`);
    
    for (let i = 0; i < sampleSize; i++) {
      const chunk = orphaned[i];
      try {
        const result = await client.graphql
          .get()
          .withClassName('ChunkEmbedding')
          .withFields('chunkDbId _additional { vector }')
          .withWhere({
            path: ['chunkDbId'],
            operator: 'Equal',
            valueString: chunk.id
          })
          .do();
        
        const objects = result?.data?.Get?.ChunkEmbedding;
        const hasVector = objects && objects.length > 0 && objects[0]._additional?.vector;
        
        console.log(`Chunk ${i+1} (${chunk.id.substring(0, 8)}...): ${hasVector ? 'Has vector' : 'NO VECTOR'}`);
      } catch (error) {
        console.error(`Error retrieving vector for chunk ${chunk.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the function
checkOrphanChunks(); 