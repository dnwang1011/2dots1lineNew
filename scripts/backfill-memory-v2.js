// scripts/backfill-memory-v2.js
// Script to migrate data from legacy 'Memory' class to 'ChunkEmbedding' in Weaviate

const weaviateClientUtil = require('../src/utils/weaviateClient'); // Use the centralized client utility
const logger = require('../src/utils/logger').childLogger('BackfillV2');
const { v4: uuidv4 } = require('uuid');

const LEGACY_CLASS_NAME = 'Memory';
const NEW_CLASS_NAME = 'ChunkEmbedding';
const BATCH_SIZE = 50;

async function runBackfill() {
  logger.info(`Starting backfill from ${LEGACY_CLASS_NAME} to ${NEW_CLASS_NAME}`);
  
  const client = weaviateClientUtil.getClient();
  if (!client) {
    logger.error('Weaviate client not available. Exiting backfill.');
    return;
  }
  
  let cursor = null;
  let objectsProcessed = 0;
  let objectsImported = 0;
  
  try {
    while (true) {
      // Build query to get objects from the legacy Memory class
      let query = client.graphql
        .get()
        .withClassName(LEGACY_CLASS_NAME)
        .withFields('content rawDataId chunkId importance dataType metadata createdAt contextBefore contextAfter userId _additional { id vector }')
        .withLimit(BATCH_SIZE);
      
      // Add pagination if we have a cursor
      if (cursor) {
        query = query.withAfter(cursor);
      }
      
      const result = await query.do();
      const legacyObjects = result?.data?.Get?.[LEGACY_CLASS_NAME] || [];
      
      if (legacyObjects.length === 0) {
        logger.info('No more objects found in legacy class. Backfill complete.');
        break; // Exit loop when no more objects
      }
      
      logger.info(`Fetched ${legacyObjects.length} objects from ${LEGACY_CLASS_NAME}`);
      
      // Prepare batch for the new ChunkEmbedding class
      const batcher = client.batch.objectsBatcher();
      let currentBatchSize = 0;
      
      for (const obj of legacyObjects) {
        // Get the vector from additional properties
        const vector = obj._additional?.vector;
        const id = obj._additional?.id;
        
        if (!vector || !Array.isArray(vector)) {
          logger.warn(`Skipping object ${id || 'unknown'} due to missing vector`);
          continue;
        }
        
        // Map old properties to new schema
        const newProperties = {
          // Map 'chunkId' or 'id' from legacy object to 'chunkDbId'
          chunkDbId: obj.chunkId || id || uuidv4(), 
          text: obj.content || '', // Map 'content' to 'text'
          rawDataId: obj.rawDataId || '',
          importance: obj.importance || 0.5,
          userId: obj.userId || ''
        };
        
        // Generate a new UUID for the Weaviate object ID
        const weaviateUuid = uuidv4(); 

        batcher.withObject({
          class: NEW_CLASS_NAME,
          id: weaviateUuid,
          properties: newProperties,
          vector: vector
        });
        
        currentBatchSize++;
        // Update cursor for pagination
        cursor = id;
      }
      
      // Execute the batch import if there are objects
      if (currentBatchSize > 0) {
        const batchResult = await batcher.do();
        objectsImported += currentBatchSize;
        logger.info(`Imported batch of ${currentBatchSize} objects to ${NEW_CLASS_NAME}`);
        
        // Check for batch errors
        if (batchResult && batchResult.some(item => item.result?.errors)) {
          logger.error('Errors occurred during batch import:', { 
            errors: batchResult.filter(item => item.result?.errors).map(item => item.result?.errors)
          });
        }
      } else {
         logger.info('No objects in the current batch to import.');
      }
      
      objectsProcessed += legacyObjects.length;
      logger.info(`Total objects processed so far: ${objectsProcessed}`);
      
      // Small delay to avoid overwhelming Weaviate
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
  } catch (error) {
    logger.error(`Error during backfill process: ${error.message}`, { error });
    if (error.response) {
      logger.error(`API Error Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data || {})}`);
    }
  } finally {
    logger.info(`Backfill finished. Total objects processed: ${objectsProcessed}, Total objects imported: ${objectsImported}`);
  }
}

// Run the backfill
runBackfill()
  .then(() => {
    logger.info('Backfill script execution completed.');
    process.exit(0);
  })
  .catch(error => {
    logger.error(`Backfill script failed: ${error.message}`, { error });
    process.exit(1);
  }); 