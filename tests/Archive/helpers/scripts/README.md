# Test Scripts

This directory contains essential test scripts that are used for testing specific components and integrations of the system. These scripts are valuable for debugging and validating critical functionality.

## Available Scripts

### Weaviate Test Scripts

1. **test-weaviate-schema.js** - Validates the Weaviate vector database schema
   - Usage: `node tests/helpers/scripts/test-weaviate-schema.js`
   - Purpose: Verifies that the Weaviate schema matches expected configuration for ChunkEmbedding, EpisodeEmbedding, and ThoughtEmbedding classes

2. **test-memory-retrieval.js** - Tests the memory retrieval functionality
   - Usage: `node tests/helpers/scripts/test-memory-retrieval.js`
   - Purpose: Validates that vector similarity search is working correctly

3. **test-episode-retrieval.js** - Tests episode retrieval functionality
   - Usage: `node tests/helpers/scripts/test-episode-retrieval.js`
   - Purpose: Validates that episode-based memory retrieval is working correctly

### Database Test Scripts

1. **test-knowledge-node.js** - Tests knowledge node creation and retrieval
   - Usage: `node tests/helpers/scripts/test-knowledge-node.js`
   - Purpose: Verifies proper operation of the knowledge graph

### Infrastructure Test Scripts

1. **test-job.js** - Tests the job queue system
   - Usage: `node tests/helpers/scripts/test-job.js`
   - Purpose: Verifies that the BullMQ job queue system is working correctly

2. **test-redis-config.js** - Tests Redis connection configuration
   - Usage: `node tests/helpers/scripts/test-redis-config.js`
   - Purpose: Validates that Redis connection settings are properly configured

## When to Use These Scripts

These scripts should be used in the following scenarios:

1. When debugging issues with memory retrieval or vector search
2. After updating or modifying the Weaviate schema
3. When validating that the memory system is functioning correctly after changes
4. During initial setup to verify components are working as expected
5. When troubleshooting job queue or Redis connection issues

## Notes

- These scripts are not automated tests run as part of CI/CD pipelines
- They require a running Weaviate instance with the appropriate schema already defined
- Some scripts may create test data that should be cleaned up afterwards 