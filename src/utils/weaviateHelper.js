const weaviateClientUtil = require('./weaviateClient');
const logger = require('./logger').childLogger('WeaviateHelper');
const { v4: uuidv4 } = require('uuid');

/**
 * Stores a single object (chunk, episode, thought) in Weaviate.
 * @param {string} className - The Weaviate class name (e.g., 'ChunkEmbedding', 'EpisodeEmbedding').
 * @param {object} properties - The properties of the object to store.
 * @param {number[]} vector - The vector embedding for the object.
 * @param {string} [explicitId=null] - Optional explicit Weaviate ID to use. If null, a new UUID is generated.
 * @returns {Promise<string|null>} The Weaviate ID of the stored object, or null on failure.
 */
async function storeObjectInWeaviate(className, properties, vector, explicitId = null) {
  const client = weaviateClientUtil.getClient();
  if (!client) {
    logger.warn(`[WeaviateHelper] Weaviate client not available. Cannot store object in class ${className}.`);
    return null;
  }

  if (!className || !properties || !vector) {
    logger.error('[WeaviateHelper] Missing className, properties, or vector for storing object.', { className });
    return null;
  }

  const weaviateId = explicitId || uuidv4();

  try {
    const result = await client.data
      .creator()
      .withClassName(className)
      .withId(weaviateId)
      .withProperties(properties)
      .withVector(vector)
      .do();
    
    // Weaviate result object doesn't always have a clear success indicator in the top-level result itself for single creates,
    // but lack of error and presence of an ID (which we provide) is a good sign.
    // We rely on it throwing an error on failure.
    logger.info(`[WeaviateHelper] Successfully stored object in class ${className} with Weaviate ID ${weaviateId}. DB ID (if in props): ${properties.chunkDbId || properties.episodeDbId || properties.thoughtDbId}`);
    return weaviateId;
  } catch (error) {
    logger.error(`[WeaviateHelper] Error storing object in class ${className} (Weaviate ID: ${weaviateId}):`, { error: error.message, properties });
    return null;
  }
}

module.exports = {
  storeObjectInWeaviate,
}; 