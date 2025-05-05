# Memory System Migration Guide

This guide outlines the steps required to complete the migration to the new memory system architecture, which solves the Weaviate 422 error and implements the optimized schema design.

## Migration Steps

### 1. Install Dependencies

Ensure the required dependency for cosine similarity is installed:

```bash
npm i compute-cosine-similarity
```

### 2. Apply Schema Changes

Add unique constraints to the database pivot tables:

```bash
npx prisma migrate dev --name memory_v2_cleanup
```

### 3. Run Data Backfill (Optional but Recommended)

To migrate existing vector data from the old `Memory` class to the new `ChunkEmbedding` class, run the backfill script. This preserves user memory history.

```bash
node scripts/backfill-memory-v2.js
```

Monitor the script output for progress and any errors.

### 4. Restart the Backend

The changes to the following files (including fixes for Weaviate queries, Prisma singleton usage, and logging) will be automatically picked up:

- `src/db/prisma.js` - Refactored singleton with central disconnect
- `src/services/ai.service.js` - Updated Prisma import
- `src/services/episodeAgent.js` - Updated Prisma import, added cosine dependency
- `src/services/consolidationAgent.js` - Updated Prisma import
- `src/services/thoughtAgent.js` - Updated Prisma import
- `src/services/memoryManager.service.js` - Fixed Weaviate queries, reduced logging noise
- `src/utils/redisConfig.js` - Shared Redis configuration utility

```bash
npm run dev
```

### 5. Verify Success

After restarting, check the logs:
- No more Weaviate query errors related to incorrect field names.
- No more "Initializing new PrismaClient instance" messages.
- Semantic search (`retrieveMemories`) should return results based on the new classes.
- Weaviate health check logs should be less noisy.

### 6. Update Application Shutdown Logic

Ensure your main application shutdown sequence (e.g., in `index.js` or wherever you handle SIGTERM/SIGINT) calls the central Prisma disconnect function:

```javascript
const { disconnectPrisma } = require('./src/db/prisma');
// ... other agent shutdown calls

async function gracefulShutdown() {
  // await episodeAgent.shutdown();
  // await consolidationAgent.shutdown(); 
  // await thoughtAgent.shutdown();
  await disconnectPrisma(); // Call the central disconnect
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

### 7. Delete Old Memory Class (Optional)

Once you've confirmed the system and backfill are working correctly, you can delete the old `Memory` class from Weaviate. Uncomment the deletion code in the `checkWeaviateSchema` function in `memoryManager.service.js` if you want to automate this on next boot, or delete it manually via Weaviate console/API.

## Technical Details

### Fixed Issues

1.  **Weaviate Schema Mismatches**: Updated all GraphQL queries in `retrieveMemories` to use the correct V2 class fields (`episodeDbId`, `chunkDbId`, `thoughtDbId`, `text`, `name`, etc.).
2.  **Prisma Client Leakage**: Ensured all services use the `prisma` singleton exported from `src/db/prisma.js`. Removed confusing initialization logs.
3.  **Missing Dependency**: Added `compute-cosine-similarity` to `package.json`.
4.  **Centralized Disconnect**: Added `disconnectPrisma` for graceful shutdown.
5.  **Logging Noise**: Reduced frequency of Weaviate health check logs.
6.  **Data Migration**: Provided `scripts/backfill-memory-v2.js` script.

### New Property Names & Classes

-   **ChunkEmbedding**: `chunkDbId`, `text`, `rawDataId`, `importance`, `userId`
-   **EpisodeEmbedding**: `episodeDbId`, `title`, `userId`
-   **ThoughtEmbedding**: `thoughtDbId`, `name`, `userId` 