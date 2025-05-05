// monitor-memory-system.js
// Script to monitor the health of the memory system

const weaviateClientUtil = require('./src/utils/weaviateClient');
const { PrismaClient } = require('@prisma/client');
const aiService = require('./src/services/ai.service');
const prisma = new PrismaClient();

async function monitorMemorySystem() {
  console.log('========================================');
  console.log('MEMORY SYSTEM HEALTH MONITOR');
  console.log('========================================');
  console.log(`Run date: ${new Date().toISOString()}`);
  
  try {
    // 1. Check database connectivity
    console.log('\n--- DATABASE CONNECTIVITY ---');
    try {
      const userCount = await prisma.user.count();
      console.log(`✅ Database connected. System has ${userCount} users.`);
    } catch (dbError) {
      console.error(`❌ Database connection error: ${dbError.message}`);
    }
    
    // 2. Check Weaviate connectivity and classes
    console.log('\n--- VECTOR DATABASE CONNECTIVITY ---');
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('❌ Weaviate client not available');
      return;
    }
    
    try {
      const meta = await client.misc.metaGetter().do();
      console.log(`✅ Connected to Weaviate v${meta.version}`);
      
      // Get schema
      const schema = await client.schema.getter().do();
      const classes = schema.classes || [];
      console.log(`Found ${classes.length} classes in schema`);
      
      // Check required classes
      const requiredClasses = ['ChunkEmbedding', 'EpisodeEmbedding', 'ThoughtEmbedding'];
      for (const className of requiredClasses) {
        if (classes.some(c => c.class === className)) {
          console.log(`✅ ${className} class exists`);
        } else {
          console.error(`❌ ${className} class not found!`);
        }
      }
    } catch (weaviateError) {
      console.error(`❌ Weaviate connection error: ${weaviateError.message}`);
    }
    
    // 3. Check vector dimensions
    console.log('\n--- VECTOR DIMENSIONS ---');
    try {
      // Check dimensions for each class
      const classesToCheck = ['ChunkEmbedding', 'EpisodeEmbedding'];
      
      for (const className of classesToCheck) {
        const result = await client.graphql
          .get()
          .withClassName(className)
          .withFields('_additional { id vector }')
          .withLimit(1)
          .do();
        
        const objects = result?.data?.Get?.[className] || [];
        if (objects.length > 0 && objects[0]._additional?.vector) {
          const dimension = objects[0]._additional.vector.length;
          console.log(`✅ ${className}: Vector dimension = ${dimension}`);
          
          if (className === 'ChunkEmbedding' && dimension !== 768) {
            console.warn(`⚠️ ChunkEmbedding expected dimension is 768, found ${dimension}`);
          }
          
          if (className === 'EpisodeEmbedding' && dimension !== 1536) {
            console.warn(`⚠️ EpisodeEmbedding expected dimension is 1536, found ${dimension}`);
          }
        } else {
          console.log(`ℹ️ ${className}: No objects with vectors found`);
        }
      }
    } catch (error) {
      console.error(`❌ Error checking vector dimensions: ${error.message}`);
    }
    
    // 4. Check memory counts
    console.log('\n--- MEMORY COUNTS ---');
    try {
      // Get counts from database
      const chunkCount = await prisma.chunk.count();
      const episodeCount = await prisma.episode.count();
      
      console.log(`Database: ${chunkCount} chunks, ${episodeCount} episodes`);
      
      // Get counts from Weaviate using simple get request instead of aggregate
      try {
        const getChunkCount = async () => {
          const result = await client.graphql
            .get()
            .withClassName('ChunkEmbedding')
            .withFields('chunkDbId')
            .withLimit(1000) // Set a reasonable limit
            .do();
          
          const chunks = result?.data?.Get?.ChunkEmbedding || [];
          return chunks.length;
        };
        
        const getEpisodeCount = async () => {
          const result = await client.graphql
            .get()
            .withClassName('EpisodeEmbedding')
            .withFields('episodeDbId')
            .withLimit(100) // Set a reasonable limit
            .do();
          
          const episodes = result?.data?.Get?.EpisodeEmbedding || [];
          return episodes.length;
        };
        
        const weaviateChunkCount = await getChunkCount();
        const weaviateEpisodeCount = await getEpisodeCount();
        
        console.log(`Weaviate: ${weaviateChunkCount}+ chunks, ${weaviateEpisodeCount}+ episodes (limited by query size)`);
        
        // Check for discrepancies - only warn if Weaviate has fewer entries
        if (weaviateChunkCount < chunkCount) {
          console.warn(`⚠️ Possible chunk count mismatch: Database=${chunkCount}, Weaviate=${weaviateChunkCount}+`);
        }
        
        if (weaviateEpisodeCount < episodeCount) {
          console.warn(`⚠️ Possible episode count mismatch: Database=${episodeCount}, Weaviate=${weaviateEpisodeCount}+`);
        }
      } catch (weaviateError) {
        console.error(`❌ Error getting Weaviate counts: ${weaviateError.message}`);
      }
    } catch (countError) {
      console.error(`❌ Error getting memory counts: ${countError.message}`);
    }
    
    // 5. Test a simple query
    console.log('\n--- QUERY TEST ---');
    try {
      const testQuery = "debugging code";
      console.log(`Running test query: "${testQuery}"`);
      
      // Find a user to test with
      const testUser = await prisma.user.findFirst();
      if (!testUser) {
        console.log('ℹ️ No users available for testing query');
      } else {
        console.log(`Testing with user: ${testUser.name || testUser.id}`);
        
        // Initialize AI service for embeddings
        aiService.initializeAIService();
        
        // Generate embedding for the query
        const embeddings = await aiService.generateEmbeddings(testQuery);
        if (!embeddings || embeddings.length === 0) {
          console.error('❌ Failed to generate embedding for test query');
          return;
        }
        
        const originalVector = embeddings[0];
        console.log(`Generated vector of length ${originalVector.length}`);
        
        // Function to expand vector if needed
        const expandVector = (vector, targetDim) => {
          if (vector.length === targetDim) return vector;
          
          if (vector.length > targetDim) {
            return vector.slice(0, targetDim);
          }
          
          const expandedVector = new Array(targetDim).fill(0);
          
          for (let i = 0; i < vector.length; i++) {
            expandedVector[i] = vector[i];
          }
          
          for (let i = vector.length; i < targetDim; i++) {
            expandedVector[i] = vector[i % vector.length];
          }
          
          const magnitude = Math.sqrt(expandedVector.reduce((sum, val) => sum + val * val, 0));
          return expandedVector.map(val => val / magnitude);
        };
        
        // Expand vector for EpisodeEmbedding class (1536 dimensions)
        const queryVector = expandVector(originalVector, 1536);
        console.log(`Expanded vector to length ${queryVector.length}`);
        
        // Run the query using vector search
        const result = await client.graphql
          .get()
          .withClassName('EpisodeEmbedding')
          .withFields('episodeDbId title userId _additional { id certainty }')
          .withNearVector({
            vector: queryVector,
            certainty: 0.6
          })
          .withWhere({
            operator: 'Equal',
            path: ['userId'],
            valueString: testUser.id
          })
          .withLimit(1)
          .do();
        
        const episodes = result?.data?.Get?.EpisodeEmbedding || [];
        if (episodes.length > 0) {
          console.log(`✅ Query test successful. Found episode: ${episodes[0].title}`);
          console.log(`   Certainty: ${Math.round((episodes[0]._additional.certainty || 0) * 100)}%`);
        } else {
          console.log('ℹ️ No episodes found for test query.');
        }
      }
    } catch (queryError) {
      console.error(`❌ Error testing query: ${queryError.message}`);
    }
    
    console.log('\n========================================');
    console.log('MONITOR COMPLETE');
    console.log('----------------------------------------');
    console.log('Run this script periodically to ensure memory system health.');
    console.log('Consider scheduling it to run daily via cron or similar tool.');
    
  } catch (error) {
    console.error('Error in memory system monitor:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the monitor
monitorMemorySystem(); 