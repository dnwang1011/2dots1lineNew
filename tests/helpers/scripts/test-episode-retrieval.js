// test-episode-retrieval.js - Test episode retrieval functionality

const weaviateClientUtil = require('./src/utils/weaviateClient');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get command line arguments for user ID
const args = process.argv.slice(2);
const userId = args[0] || '4b84c387-ff6b-45d5-a25d-7f1d7905b951';  // Default to the test user

async function testEpisodeRetrieval() {
  try {
    console.log(`Testing episode retrieval for user: ${userId}`);
    
    // Check episodes in database
    console.log('\nChecking episodes in database:');
    const episodes = await prisma.episode.findMany({
      where: { userId },
      include: {
        chunks: true
      }
    });
    
    console.log(`Found ${episodes.length} episodes in database`);
    
    if (episodes.length > 0) {
      episodes.forEach((episode, i) => {
        console.log(`\nEpisode #${i + 1}:`);
        console.log(`  ID: ${episode.id}`);
        console.log(`  Title: ${episode.title || 'No title'}`);
        console.log(`  Created: ${episode.createdAt}`);
        console.log(`  Attached chunks: ${episode.chunks.length}`);
        if (episode.centroidVec && episode.centroidVec.length > 0) {
          console.log(`  Centroid vector length: ${episode.centroidVec.length}`);
        } else {
          console.log(`  No centroid vector found`);
        }
      });
    }
    
    // Check episodes in Weaviate
    console.log('\nChecking episodes in Weaviate:');
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('Weaviate client not available. Make sure Weaviate is running.');
      return;
    }
    
    try {
      const result = await client.graphql
        .get()
        .withClassName('EpisodeEmbedding')
        .withFields('episodeDbId title userId _additional { id vector }')
        .withWhere({
          path: ['userId'],
          operator: 'Equal',
          valueString: userId
        })
        .do();
      
      const weaviateEpisodes = result?.data?.Get?.EpisodeEmbedding || [];
      console.log(`Found ${weaviateEpisodes.length} episodes in Weaviate`);
      
      if (weaviateEpisodes.length > 0) {
        weaviateEpisodes.forEach((episode, i) => {
          console.log(`\nWeaviate Episode #${i + 1}:`);
          console.log(`  ID: ${episode._additional.id}`);
          console.log(`  Database ID: ${episode.episodeDbId}`);
          console.log(`  Title: ${episode.title || 'No title'}`);
          if (episode._additional.vector && episode._additional.vector.length > 0) {
            console.log(`  Vector length: ${episode._additional.vector.length}`);
          } else {
            console.log(`  No vector found`);
          }
        });
      }
      
      // Test vector search with a simple query
      if (weaviateEpisodes.length > 0 && weaviateEpisodes[0]._additional.vector) {
        console.log('\nTesting vector search with episode vector:');
        // Use the first episode's vector as a test search
        const testVector = weaviateEpisodes[0]._additional.vector;
        
        const searchResult = await client.graphql
          .get()
          .withClassName('EpisodeEmbedding')
          .withFields('episodeDbId title userId _additional { id certainty }')
          .withNearVector({ vector: testVector, certainty: 0.7 })
          .withLimit(5)
          .do();
        
        const similarEpisodes = searchResult?.data?.Get?.EpisodeEmbedding || [];
        console.log(`Found ${similarEpisodes.length} similar episodes`);
        
        if (similarEpisodes.length > 0) {
          similarEpisodes.forEach((episode, i) => {
            console.log(`  Similar Episode #${i + 1}:`);
            console.log(`    Database ID: ${episode.episodeDbId}`);
            console.log(`    Title: ${episode.title || 'No title'}`);
            console.log(`    Similarity: ${episode._additional.certainty.toFixed(4)}`);
          });
        }
      }
      
    } catch (error) {
      console.error('Error querying Weaviate:', error);
    }
    
  } catch (error) {
    console.error('Error testing episode retrieval:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testEpisodeRetrieval(); 