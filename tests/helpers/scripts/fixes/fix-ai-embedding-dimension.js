// fix-ai-embedding-dimension.js
// Script to update AI service configuration to use correct embedding dimensions

const path = require('path');
const fs = require('fs');
const aiService = require('./src/services/ai.service');
const weaviateClientUtil = require('./src/utils/weaviateClient');

async function fixAIEmbeddingDimension() {
  console.log('========================================');
  console.log('FIX AI EMBEDDING DIMENSION');
  console.log('========================================');
  
  try {
    // 1. Check Weaviate schema dimensions
    console.log('Checking Weaviate schema dimensions...');
    
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('Error: Weaviate client not available');
      return;
    }
    
    // Check dimensions for classes
    const dimensions = {};
    
    try {
      // Get the current dimensions from actual objects in each class
      const classes = ['ChunkEmbedding', 'EpisodeEmbedding'];
      
      for (const className of classes) {
        const result = await client.graphql
          .get()
          .withClassName(className)
          .withFields('_additional { id vector }')
          .withLimit(1)
          .do();
        
        const objects = result?.data?.Get?.[className] || [];
        if (objects.length > 0 && objects[0]._additional?.vector) {
          dimensions[className] = objects[0]._additional.vector.length;
          console.log(`Class ${className}: Vector dimension = ${dimensions[className]}`);
        } else {
          console.log(`Class ${className}: No objects with vectors found`);
        }
      }
    } catch (error) {
      console.error('Error getting vector dimensions:', error.message);
    }
    
    if (!dimensions.EpisodeEmbedding) {
      console.log('Could not determine EpisodeEmbedding dimension. Using default 1536.');
      dimensions.EpisodeEmbedding = 1536;
    }
    
    // 2. Initialize AI service to check current configuration
    console.log('\nInitializing AI service...');
    aiService.initializeAIService();
    
    // 3. Test vector generation to see current dimensions
    console.log('Testing current embedding generation...');
    const testText = 'This is a test of the embedding system';
    
    const embeddings = await aiService.generateEmbeddings(testText);
    if (!embeddings || embeddings.length === 0) {
      console.error('Failed to generate test embedding.');
      return;
    }
    
    const currentDimension = embeddings[0].length;
    console.log(`Current AI service generates ${currentDimension}-dimension vectors`);
    console.log(`Required dimension for EpisodeEmbedding: ${dimensions.EpisodeEmbedding}`);
    
    if (currentDimension === dimensions.EpisodeEmbedding) {
      console.log('\nGood news! AI service is already generating vectors with the correct dimension.');
      console.log('No fixes needed.');
      return;
    }
    
    // 4. Look for memory retrieval service
    console.log('\nLooking for memory retrieval service file...');
    
    const memoryServicePath = path.join(__dirname, 'src', 'services', 'memory.service.js');
    
    if (!fs.existsSync(memoryServicePath)) {
      console.error(`Could not find memory service at ${memoryServicePath}`);
      return;
    }
    
    console.log(`Found memory service at ${memoryServicePath}`);
    
    // 5. Read the file and look for vector dimension handling
    const memoryService = fs.readFileSync(memoryServicePath, 'utf8');
    
    // Check if the file has vector dimension handling for queries
    if (memoryService.includes('vector dimension') || 
        memoryService.includes('expandVector') || 
        memoryService.includes('convertDimensions')) {
      console.log('Found existing vector dimension handling in memory service.');
    } else {
      console.log('\nTo fix this issue, update src/services/memory.service.js to include vector dimension conversion.');
      console.log('Add a utility function like this:');
      console.log(`
/**
 * Expands a vector to the target dimension by duplicating values
 * @param {number[]} vector - Original vector
 * @param {number} targetDim - Target dimension
 * @returns {number[]} - Expanded vector
 */
function expandVector(vector, targetDim) {
  if (vector.length === targetDim) return vector;
  
  if (vector.length > targetDim) {
    // Truncate if vector is too long
    return vector.slice(0, targetDim);
  }
  
  // Expand by duplicating values
  const expandedVector = new Array(targetDim).fill(0);
  
  // Copy original values
  for (let i = 0; i < vector.length; i++) {
    expandedVector[i] = vector[i];
  }
  
  // Fill remaining positions
  for (let i = vector.length; i < targetDim; i++) {
    expandedVector[i] = vector[i % vector.length];
  }
  
  // Normalize to maintain unit length
  const magnitude = Math.sqrt(expandedVector.reduce((sum, val) => sum + val * val, 0));
  return expandedVector.map(val => val / magnitude);
}`);
      
      console.log('\nThen modify the getNearestEpisodes and getNearestChunks methods to convert vector dimensions');
      console.log('before sending the query to Weaviate.');
    }
    
    console.log('\n========================================');
    console.log('DONE');
    
  } catch (error) {
    console.error('Error fixing AI embedding dimensions:', error);
  }
}

// Run the fix
fixAIEmbeddingDimension(); 