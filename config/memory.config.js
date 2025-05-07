// config/memory.config.js

module.exports = {
  // Importance evaluation
  // ADJUST THIS: Increase this value to be more selective about what memories are stored
  // Range: 0.0 - 1.0 (higher = more selective, fewer memories stored)
  defaultImportanceThreshold: 0.2, // Lowered from 0.4 to capture personal information like piano playing
  // Dependency: Used by MemoryManager service (processMemoryPipeline) to filter raw data for processing.
  defaultRawDataImportance: 0.5, // Default importance score assigned in controller if not evaluated
  // Dependency: Used by RawDataRepository (create) as a fallback importance for new records.
  defaultFileUploadEventImportance: 0.8, // Importance for the event of a file upload
  // Dependency: Used by RawDataRepository (create) for file upload event records.
  defaultDocumentContentImportance: 0.8, // Importance for extracted document content
  // Dependency: Used by RawDataRepository (create) for document content records.

  // Chunking parameters
  minChunkSize: 100, // Minimum characters for a chunk
  // Dependency: Used by MemoryManager service (chunkContent) during text splitting.
  maxChunkSize: 2000, // Maximum characters for a chunk
  // Dependency: Used by MemoryManager service (chunkContent) during text splitting.
  targetChunkSize: 800, // Ideal target characters for a chunk
  // Dependency: Used by MemoryManager service (chunkContent) as a guideline for chunk size.

  // Weaviate import batching
  weaviateBatchSize: 25,
  // Dependency: Used by MemoryManager service (batchImportToWeaviate) for optimizing imports to Weaviate.

  // Memory retrieval parameters
  // ADJUST THIS: Decrease this value to retrieve fewer, more relevant memories
  // Range: 1-10 (lower = fewer memories retrieved)
  defaultRetrievalLimit: 6, // Increased to provide more context
  // Dependency: Used by MemoryManager service (retrieveMemories) to limit the number of memories fetched.
  
  // ADJUST THIS: Increase this value to only retrieve more important memories
  // Range: 0.0 - 1.0 (higher = only retrieve more important memories)
  defaultRetrievalMinImportance: 0.6, // Lowered to include more memories in context
  // Dependency: Used by MemoryManager service (retrieveMemories) to filter memories by importance.
  
  // ADJUST THIS: Increase this value to require higher similarity for retrieval
  // Range: 0.0 - 1.0 (higher = require closer match to current context)
  defaultRetrievalCertainty: 0.85, // Lowered to allow more memories to be retrieved
  // Dependency: Used by MemoryManager service (retrieveMemories) to filter memories by similarity/certainty from Weaviate.

  // Other memory related constants
  chatHistoryRetrievalLimit: 200, // Max messages for getChatHistory endpoint
  // Dependency: Used by ChatController (getChatHistory) to limit fetched chat messages.
}; 