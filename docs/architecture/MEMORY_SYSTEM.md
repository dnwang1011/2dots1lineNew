# 2dots1line Memory System

## Overview

The 2dots1line memory system allows the Dot chatbot to remember and retrieve past conversations and experiences. It uses a two-tier approach:

1. **Database (PostgreSQL/Prisma)**: Stores raw data, chunks, episodes, and their relationships
2. **Vector Database (Weaviate)**: Stores vector embeddings for semantic search and retrieval

## Architecture

### Components

- **Memory Manager**: Centralizes memory operations (processing, storage, retrieval)
- **Weaviate Client**: Handles interactions with vector database
- **AI Service**: Generates embeddings for vector search
- **Episode Agent**: Creates higher-level memories (episodes) from related chunks
- **Consolidation Agent**: Processes and organizes memory chunks

### Memory Classes

- **ChunkEmbedding**: Individual memory fragments (768-dimension vectors)
- **EpisodeEmbedding**: Collections of related chunks (1536-dimension vectors)
- **ThoughtEmbedding**: AI-generated insights from memories
- **KnowledgeNode**: Structured knowledge entities
- **Relationship**: Connections between knowledge nodes

## Recent Fixes

### Vector Dimension Mismatch Fix

We identified and resolved a critical issue with vector dimensions:

1. ChunkEmbedding uses 768-dimension vectors (from Gemini embeddings)
2. EpisodeEmbedding uses 1536-dimension vectors (expanded from chunk vectors)

Problem: Query vectors (768) didn't match episode vectors (1536), preventing retrieval.

Solution: Added vector dimension conversion that expands query vectors from 768 to 1536 dimensions during retrieval.

### Database Access Fix

Issue: After refactoring from direct Prisma usage to repositories, some code still used the original `prisma` variable.

Solution: Re-imported PrismaClient in the memory manager to maintain compatibility with existing code.

## Monitoring Tools

### Memory System Health Monitor

The `monitor-memory-system.js` script checks:

- Database connectivity
- Vector database connectivity
- Vector dimensions
- Memory counts in both databases
- Vector search functionality

Run regularly to ensure system health:

```bash
node monitor-memory-system.js
```

### Diagnostic Scripts

- `check-weaviate-schema.js`: Verifies vector database schema configuration
- `check-weaviate-episodes.js`: Checks if episodes exist in the vector database
- `test-memory-retrieval.js`: Tests memory retrieval for a user with a specific query
- `fix-episode-embedding.js`: Fixes episode embeddings in Weaviate
- `fix-memory-retrieval.js`: Adds vector dimension handling for memory retrieval

## Memory Retrieval Process

1. Generate embeddings for the query (768 dimensions)
2. Expand vector dimensions to match EpisodeEmbedding (1536 dimensions)
3. Search for relevant episodes by vector similarity
4. Retrieve full episode details from the database
5. Search for relevant standalone chunks
6. Search for relevant thoughts
7. Format retrieved memories for chat context

## Monitoring and Maintenance

### Regular Health Checks

Run the monitoring script weekly:

```bash
node monitor-memory-system.js
```

### After Major Updates

1. Verify schema integrity:
```bash
node check-weaviate-schema.js
```

2. Test memory retrieval:
```bash
node test-memory-retrieval.js <user-id> "test query"
```

### When Adding New Episodes

If episodes aren't appearing in memories, verify they're in Weaviate:

```bash
node check-weaviate-episodes.js <user-id>
```

If missing, run the fix script:

```bash
node fix-episode-embedding.js <user-id>
```

## Key Learning Points

1. Vector databases require exact dimension matching between queries and stored vectors
2. Memory retrieval is a multi-stage process requiring coordination between regular and vector databases
3. Vector dimension conversion must maintain vector properties (normalization)
4. Having proper diagnostics and monitoring is essential for complex memory systems
5. Update all database access when refactoring from direct client to repositories

## Future Improvements

1. Implement repositories for all database access
2. Add more robust error handling for memory retrieval failures
3. Create automatic health check monitoring with alerts
4. Optimize vector search parameters for better recall and precision
5. Add caching for frequently accessed memories 