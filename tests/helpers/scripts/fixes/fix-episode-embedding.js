// fix-episode-embedding.js
// Script to fix missing episode embeddings in Weaviate

const weaviateClientUtil = require('../../src/utils/weaviateClient');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
const aiService = require('../../src/services/ai.service');
const prisma = new PrismaClient();

// Get command line arguments
const args = process.argv.slice(2);
const userId = args[0] || 'd9fe3dbe-bc25-4040-ac00-a835d418c5b4'; // Default to the qwe asd user

async function fixEpisodeEmbedding() {
  console.log('========================================');
  console.log('FIX EPISODE EMBEDDING');
  console.log('========================================');
  console.log(`User ID: ${userId}`);
  
  try {
    // 1. First get episodes from the database
    const dbEpisodes = await prisma.episode.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        chunks: {
          include: {
            chunk: true
          }
        }
      }
    });
    
    if (dbEpisodes.length === 0) {
      console.log('No episodes found for this user.');
      return;
    }
    
    console.log(`\nFound ${dbEpisodes.length} episodes in database.`);
    
    // 2. Check if Weaviate client is available
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('Error: Weaviate client not available');
      return;
    }
    
    // 3. Check specifically for EpisodeEmbedding dimensions
    console.log('\nChecking EpisodeEmbedding class dimensions...');
    
    let requiredDimension = 1536; // From our schema check, we know this is the required dimension
    
    try {
      // Check if there are any existing EpisodeEmbedding objects
      const episodeResult = await client.graphql
        .get()
        .withClassName('EpisodeEmbedding')
        .withFields('_additional { id vector }')
        .withLimit(1)
        .do();
      
      const existingEpisodes = episodeResult?.data?.Get?.EpisodeEmbedding || [];
      if (existingEpisodes.length > 0 && existingEpisodes[0]._additional?.vector) {
        requiredDimension = existingEpisodes[0]._additional.vector.length;
        console.log(`Found existing EpisodeEmbedding with dimension: ${requiredDimension}`);
      } else {
        console.log(`No existing EpisodeEmbedding objects. Using default dimension: ${requiredDimension}`);
      }
    } catch (error) {
      console.error('Error checking EpisodeEmbedding dimensions:', error.message);
    }
    
    // Initialize AI service for generating embeddings
    console.log('\nInitializing AI service...');
    aiService.initializeAIService();
    
    // 4. Process each episode
    for (const episode of dbEpisodes) {
      console.log(`\n----------------------------------------`);
      console.log(`Processing episode: ${episode.id} - ${episode.title || 'Untitled'}`);
      
      // Check if episode already exists in Weaviate
      const exists = await checkEpisodeInWeaviate(client, episode.id);
      
      if (exists) {
        console.log('Episode already exists in Weaviate. Skipping.');
        continue;
      }
      
      console.log('Episode not found in Weaviate. Creating embedding...');
      
      // Generate a text representation of the episode for embedding
      let episodeText = episode.title || 'Untitled Episode';
      
      // Add narrative if available
      if (episode.narrative) {
        episodeText += ` - ${episode.narrative}`;
      }
      
      // Add chunks text
      if (episode.chunks && episode.chunks.length > 0) {
        const chunkTexts = episode.chunks
          .map(c => c.chunk?.text || '')
          .filter(t => t.length > 0)
          .join(' ');
        
        if (chunkTexts.length > 0) {
          episodeText += ` - ${chunkTexts}`;
        }
      }
      
      console.log(`Generating embedding for episode text (length: ${episodeText.length})...`);
      
      try {
        // 5. Generate embedding
        console.log('Generating new embedding...');
        const embeddings = await aiService.generateEmbeddings(episodeText);
        
        if (!embeddings || embeddings.length === 0) {
          console.error('Failed to generate embedding for episode.');
          continue;
        }
        
        const originalVector = embeddings[0];
        console.log(`Generated vector of length ${originalVector.length}`);
        
        // 6. IMPORTANT: Handle dimension mismatch by expanding or padding the vector
        let finalVector;
        if (originalVector.length !== requiredDimension) {
          console.log(`Vector dimension mismatch. Need to convert from ${originalVector.length} to ${requiredDimension} dimensions.`);
          
          if (originalVector.length > requiredDimension) {
            // Truncate the vector if it's too long
            finalVector = originalVector.slice(0, requiredDimension);
            console.log(`Truncated vector to ${finalVector.length} dimensions.`);
          } else {
            // Padding strategy: Duplicate the vector values to reach required dimension
            finalVector = new Array(requiredDimension).fill(0);
            
            // First copy all original values
            for (let i = 0; i < originalVector.length; i++) {
              finalVector[i] = originalVector[i];
            }
            
            // Then fill remaining positions by repeating values
            for (let i = originalVector.length; i < requiredDimension; i++) {
              finalVector[i] = originalVector[i % originalVector.length];
            }
            
            // Normalize the vector to maintain unit length
            const magnitude = Math.sqrt(finalVector.reduce((sum, val) => sum + val * val, 0));
            finalVector = finalVector.map(val => val / magnitude);
            
            console.log(`Expanded vector to ${finalVector.length} dimensions.`);
          }
        } else {
          finalVector = originalVector;
          console.log(`Vector dimensions already match (${finalVector.length}).`);
        }
        
        // 7. Update the centroid vector in the database
        await prisma.episode.update({
          where: { id: episode.id },
          data: {
            centroidVec: finalVector,
            centroidDim: finalVector.length
          }
        });
        console.log('Updated centroid vector in database.');
        
        // 8. Create the episode in Weaviate
        try {
          // Prepare the object to insert into Weaviate
          const weaviateObj = {
            class: 'EpisodeEmbedding',
            id: uuidv4(),
            properties: {
              episodeDbId: episode.id,
              title: episode.title || 'Untitled Episode',
              userId: episode.userId
            },
            vector: finalVector
          };
          
          console.log('Importing episode to Weaviate...');
          
          // Create the object in Weaviate
          const result = await client.data
            .creator()
            .withClassName('EpisodeEmbedding')
            .withId(weaviateObj.id)
            .withProperties(weaviateObj.properties)
            .withVector(weaviateObj.vector)
            .do();
          
          console.log(`✅ Successfully created episode in Weaviate with ID: ${weaviateObj.id}`);
        } catch (error) {
          console.error('Error creating episode in Weaviate:', error.message);
        }
      } catch (error) {
        console.error('Error generating embedding:', error.message);
        continue;
      }
    }
    
    console.log('\n========================================');
    console.log('DONE');
    
  } catch (error) {
    console.error('Error fixing episode embeddings:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function checkEpisodeInWeaviate(client, episodeDbId) {
  try {
    const result = await client.graphql
      .get()
      .withClassName('EpisodeEmbedding')
      .withFields('episodeDbId')
      .withWhere({
        operator: 'Equal',
        path: ['episodeDbId'],
        valueString: episodeDbId
      })
      .do();
    
    const matches = result?.data?.Get?.EpisodeEmbedding || [];
    return matches.length > 0;
  } catch (error) {
    console.error(`Error checking if episode exists in Weaviate:`, error.message);
    return false;
  }
}

// Run the fix
fixEpisodeEmbedding(); 