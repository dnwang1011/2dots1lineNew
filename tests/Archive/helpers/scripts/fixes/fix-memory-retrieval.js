// fix-memory-retrieval.js
// Script to fix the memory retrieval by adding vector dimension handling

const fs = require('fs');
const path = require('path');
const memoryManagerPath = path.join(__dirname, 'src', 'services', 'memoryManager.service.js');

async function fixMemoryRetrieval() {
  console.log('========================================');
  console.log('FIX MEMORY RETRIEVAL');
  console.log('========================================');
  
  try {
    // Check if the file exists
    if (!fs.existsSync(memoryManagerPath)) {
      console.error(`Memory manager file not found at ${memoryManagerPath}`);
      return;
    }
    
    console.log(`Found memory manager at ${memoryManagerPath}`);
    
    // Read the file content
    const fileContent = fs.readFileSync(memoryManagerPath, 'utf8');
    
    // Check if the fix is already implemented
    if (fileContent.includes('expandVector') || fileContent.includes('convertVectorDimension')) {
      console.log('Vector dimension conversion is already implemented in the file.');
      console.log('No changes needed.');
      return;
    }
    
    console.log('Adding vector dimension conversion function...');
    
    // Find the right location to insert the function
    // We'll add it right before the MemoryManager class definition
    const classIndex = fileContent.indexOf('class MemoryManager {');
    
    if (classIndex === -1) {
      console.error('Could not find MemoryManager class definition in the file.');
      return;
    }
    
    // Create the function to insert
    const functionToInsert = `
/**
 * Expands a vector to the target dimension by duplicating values
 * @param {number[]} vector - Original vector
 * @param {number} targetDim - Target dimension
 * @returns {number[]} - Expanded vector
 */
async function expandVector(vector, targetDim) {
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
}

`;
    
    // Insert the function before the class definition
    const newContent = fileContent.substring(0, classIndex) + functionToInsert + fileContent.substring(classIndex);
    
    // Now modify the retrieveMemories method to use the function
    // Find the retrieveMemories method
    const retrieveMemoriesIndex = newContent.indexOf('async retrieveMemories(query, userId, options = {})');
    
    if (retrieveMemoriesIndex === -1) {
      console.error('Could not find retrieveMemories method in the file.');
      return;
    }
    
    // Find the code that uses the query vector
    const queryVectorLine = 'const queryVector = queryEmbedding[0];';
    const queryVectorIndex = newContent.indexOf(queryVectorLine, retrieveMemoriesIndex);
    
    if (queryVectorIndex === -1) {
      console.error('Could not find query vector assignment in retrieveMemories method.');
      return;
    }
    
    // Replace the line with the new code that expands the vector
    const newQueryVectorCode = `const originalQueryVector = queryEmbedding[0]; // generateEmbeddings returns array of vectors
      
      // Check vector dimensions and expand if needed
      let queryVector;
      try {
        // For EpisodeEmbedding, we need 1536 dimensions
        const episodeClassDimension = 1536;
        
        if (originalQueryVector.length !== episodeClassDimension) {
          logger.info(\`[MemoryManager] Expanding query vector from \${originalQueryVector.length} to \${episodeClassDimension} dimensions for EpisodeEmbedding search\`);
          queryVector = await expandVector(originalQueryVector, episodeClassDimension);
        } else {
          queryVector = originalQueryVector;
        }
      } catch (dimensionError) {
        logger.error(\`[MemoryManager] Error expanding vector dimensions: \${dimensionError.message}\`);
        queryVector = originalQueryVector; // Fallback to original vector
      }`;
    
    // Replace the line
    const contentWithExpandedVector = newContent.substring(0, queryVectorIndex) + 
                                     newQueryVectorCode + 
                                     newContent.substring(queryVectorIndex + queryVectorLine.length);
    
    // Now update the file
    console.log('Writing updated file...');
    fs.writeFileSync(memoryManagerPath, contentWithExpandedVector, 'utf8');
    
    console.log('✅ Successfully updated memoryManager.service.js with vector dimension handling!');
    console.log('The memory retrieval should now work properly with different vector dimensions.');
    
  } catch (error) {
    console.error('Error fixing memory retrieval:', error);
  }
}

// Run the fix
fixMemoryRetrieval(); 