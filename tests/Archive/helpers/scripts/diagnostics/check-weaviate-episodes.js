// check-weaviate-episodes.js
// Script to check if episodes exist in Weaviate

const weaviateClientUtil = require('../../src/utils/weaviateClient');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Get command line arguments
const args = process.argv.slice(2);
const userId = args[0] || 'd9fe3dbe-bc25-4040-ac00-a835d418c5b4'; // Default to the qwe asd user

async function checkWeaviateEpisodes() {
  console.log('========================================');
  console.log('WEAVIATE EPISODE CHECK');
  console.log('========================================');
  console.log(`User ID: ${userId}`);
  
  try {
    // 1. First get episodes from the database
    const dbEpisodes = await prisma.episode.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    
    console.log(`\nFound ${dbEpisodes.length} episodes in database:`);
    dbEpisodes.forEach((ep, i) => {
      console.log(`[${i+1}] ID: ${ep.id}, Title: ${ep.title || 'Untitled'}`);
    });
    
    // 2. Check if Weaviate client is available
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('Error: Weaviate client not available');
      return;
    }
    
    console.log('\n----------------------------------------');
    console.log('CHECKING EPISODES IN WEAVIATE:');
    
    // 3. Query all episodes for this user in Weaviate
    const episodeResults = await client.graphql
      .get()
      .withClassName('EpisodeEmbedding')
      .withFields('episodeDbId title userId _additional { id vector }')
      .withWhere({
        operator: 'Equal',
        path: ['userId'],
        valueString: userId
      })
      .do();
    
    const weaviateEpisodes = episodeResults?.data?.Get?.EpisodeEmbedding || [];
    console.log(`\nFound ${weaviateEpisodes.length} episodes in Weaviate:`);
    
    if (weaviateEpisodes.length > 0) {
      weaviateEpisodes.forEach((ep, i) => {
        console.log(`[${i+1}] Weaviate ID: ${ep._additional.id}`);
        console.log(`    Database ID: ${ep.episodeDbId}`);
        console.log(`    Title: ${ep.title || 'Untitled'}`);
        console.log(`    Has vector: ${ep._additional.vector ? 'Yes' : 'No'}`);
        if (ep._additional.vector) {
          console.log(`    Vector length: ${ep._additional.vector.length}`);
        }
      });
    }
    
    // 4. Check for each database episode if it exists in Weaviate
    console.log('\n----------------------------------------');
    console.log('CHECKING INDIVIDUAL EPISODES:');
    
    for (const dbEp of dbEpisodes) {
      console.log(`\nChecking database episode: ${dbEp.id}`);
      
      try {
        const result = await client.graphql
          .get()
          .withClassName('EpisodeEmbedding')
          .withFields('episodeDbId title _additional { id vector }')
          .withWhere({
            operator: 'Equal',
            path: ['episodeDbId'],
            valueString: dbEp.id
          })
          .do();
        
        const matches = result?.data?.Get?.EpisodeEmbedding || [];
        
        if (matches.length > 0) {
          console.log(`✅ Found in Weaviate (${matches.length} matches)`);
          matches.forEach((match, i) => {
            console.log(`  Match ${i+1}: ${match._additional.id}`);
            console.log(`  Has vector: ${match._additional.vector ? 'Yes' : 'No'}`);
          });
        } else {
          console.log(`❌ NOT found in Weaviate`);
          
          // This episode exists in database but not in Weaviate
          // This is the root cause of our memory retrieval issue
        }
      } catch (error) {
        console.error(`Error querying Weaviate for episode ${dbEp.id}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('Error checking episodes:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the check
checkWeaviateEpisodes(); 