# Memory System Implementation Roadmap

## Overview

This document outlines the implementation plan for transitioning to the new memory system architecture outlined in `NewMemorySpec.md`. The new system features:

- Four specialized agents handling different aspects of memory processing
- An event-driven architecture using BullMQ for asynchronous processing
- A consolidated database schema with improved relations
- Enhanced embedding infrastructure

## 1. Database Schema Migration

### Current Schema

The current schema includes:
- `RawData`: Stores raw user inputs
- `SemanticChunk`: Contains chunks of raw data
- `Embedding`: Stores vectors for various entities
- `Episode`: Higher-level narrative memories
- `Thought`: Insights and reflections

### New Schema Changes

1. **Create new consolidated models:**
   ```prisma
   model ChunkEmbedding {
     id                 String   @id @default(cuid())
     content            String
     summary            String?
     vector             Float[]
     dimension          Int
     rawDataId          String
     chunkIndex         Int
     importanceScore    Float
     modelConfidence    Float    @default(1.0)
     vectorId           String
     createdAt          DateTime @default(now())
     processedAt        DateTime @default(now())
     userId             String   @db.Uuid
     perspectiveOwnerId String   @db.Uuid
     subjectId          String?  @db.Uuid
     
     rawData            RawData  @relation(fields: [rawDataId], references: [id], onDelete: Cascade)
     user               User     @relation(fields: [userId], references: [id])
     
     @@unique([rawDataId, chunkIndex])
     @@index([perspectiveOwnerId])
     @@index([createdAt])
   }
   ```

2. **Add processing state fields to existing models:**
   ```prisma
   model Episode {
     // existing fields
     processedAt DateTime?
     processingStatus String @default("pending")
     // new relations for the agent system
   }
   
   model Thought {
     // existing fields
     processedAt DateTime?
     processingStatus String @default("pending")
     // new relations for the agent system
   }
   ```

3. **Create queue models for event processing:**
   ```prisma
   model MemoryQueue {
     id              String   @id @default(cuid())
     queueName       String
     jobId           String
     status          String
     payload         Json
     result          Json?
     error           String?
     createdAt       DateTime @default(now())
     processedAt     DateTime?
     
     @@index([queueName, status])
     @@index([jobId])
   }
   ```

## 2. Agent Implementation

### Agent Files Structure

```
src/
├─ agents/
│  ├─ ingestionAgent.js
│  ├─ episodeAgent.js
│  ├─ consolidationAgent.js
│  ├─ thoughtAgent.js
│  └─ shared/
│     ├─ queueHelpers.js
│     └─ embeddingHelpers.js
```

### Implementation Plan for Each Agent

#### 2.1 Ingestion Agent

```javascript
// src/agents/ingestionAgent.js

const { Queue, Worker } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const { processChunks, generateEmbeddings } = require('./shared/embeddingHelpers');
const logger = require('../utils/logger').childLogger('IngestionAgent');

const prisma = new PrismaClient();
const INGESTION_QUEUE = 'ingestion-queue';
const EPISODE_QUEUE = 'episode-queue';

// Initialize queue
const ingestionQueue = new Queue(INGESTION_QUEUE, { connection: redisConnection });
const episodeQueue = new Queue(EPISODE_QUEUE, { connection: redisConnection });

// Worker implementation
const worker = new Worker(INGESTION_QUEUE, async job => {
  const { rawDataId } = job.data;
  logger.info(`Processing rawData: ${rawDataId}`);
  
  try {
    // 1. Get the raw data
    const rawData = await prisma.rawData.findUnique({ where: { id: rawDataId } });
    if (!rawData) throw new Error(`RawData ${rawDataId} not found`);
    
    // 2. Chunk content and create ChunkEmbeddings
    const chunks = await processChunks(rawData.content, rawData.contentType);
    const chunkEmbeddings = await Promise.all(chunks.map(async (chunk, index) => {
      const embedding = await generateEmbeddings(chunk.text);
      
      return prisma.chunkEmbedding.create({
        data: {
          content: chunk.text,
          summary: chunk.summary,
          vector: embedding.vector,
          dimension: embedding.dimension,
          rawDataId: rawData.id,
          chunkIndex: index,
          importanceScore: chunk.importanceScore || 0.5,
          modelConfidence: 1.0,
          vectorId: `${rawData.id}-${index}`,
          userId: rawData.userId,
          perspectiveOwnerId: rawData.perspectiveOwnerId,
          subjectId: rawData.subjectId
        }
      });
    }));
    
    // 3. Update raw data as processed
    await prisma.rawData.update({
      where: { id: rawDataId },
      data: { 
        processingStatus: 'completed',
        processedAt: new Date()
      }
    });
    
    // 4. Add to episode queue for the next stage
    await episodeQueue.add('create-episode', { 
      rawDataId, 
      chunkIds: chunkEmbeddings.map(c => c.id)
    });
    
    return { success: true, chunkCount: chunkEmbeddings.length };
  } catch (error) {
    logger.error(`Error processing rawData ${rawDataId}:`, error);
    
    // Update raw data with error
    await prisma.rawData.update({
      where: { id: rawDataId },
      data: { 
        processingStatus: 'error',
        processingError: error.message
      }
    });
    
    throw error;
  }
});

// Error handling
worker.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed with error: ${err.message}`);
});

module.exports = {
  addToQueue: async (rawDataId) => {
    return await ingestionQueue.add('process-raw-data', { rawDataId });
  }
};
```

#### 2.2 Episode Agent

Similar implementation focusing on episode creation with functions for:
- Narrative generation from chunks
- Emotion detection
- Episode importance calculation
- Adding to the consolidation queue

#### 2.3 Consolidation Agent

Implementation with focus on:
- Merging related episodes
- Updating embeddings for related episodes
- Creating connections between episodes
- Adding to thought queue for reflective analysis

#### 2.4 Thought Agent

Implementation with focus on:
- Generating insights from episodes
- Creating thought embeddings
- Linking thoughts to entities and knowledge nodes

## 3. Event-Driven Architecture Setup

### BullMQ Queue Setup

```javascript
// src/config/queueConfig.js

const { Queue } = require('bullmq');
const Redis = require('ioredis');

// Redis connection
const redisConnection = new Redis(process.env.REDIS_URL);

// Define queues
const QUEUES = {
  INGESTION: 'ingestion-queue',
  EPISODE: 'episode-queue',
  CONSOLIDATION: 'consolidation-queue',
  THOUGHT: 'thought-queue'
};

// Create queue instances
const queues = {
  ingestion: new Queue(QUEUES.INGESTION, { connection: redisConnection }),
  episode: new Queue(QUEUES.EPISODE, { connection: redisConnection }),
  consolidation: new Queue(QUEUES.CONSOLIDATION, { connection: redisConnection }),
  thought: new Queue(QUEUES.THOUGHT, { connection: redisConnection })
};

module.exports = {
  QUEUES,
  queues,
  redisConnection
};
```

## 4. Controller Integration

### API Controller Updates

Update existing controllers to use the new event-driven architecture:

```javascript
// src/controllers/memories.controller.js

const { queues } = require('../config/queueConfig');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create a new memory (raw data)
exports.createMemory = async (req, res) => {
  try {
    const { content, contentType, sessionId } = req.body;
    const userId = req.user.id;
    
    // Create raw data entry
    const rawData = await prisma.rawData.create({
      data: {
        content,
        contentType,
        sessionId,
        userId,
        perspectiveOwnerId: userId,
        processingStatus: 'pending'
      }
    });
    
    // Add to ingestion queue
    await queues.ingestion.add('process-raw-data', { 
      rawDataId: rawData.id 
    });
    
    res.status(201).json({
      success: true,
      data: rawData,
      message: 'Memory creation initiated'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Other controller functions...
```

## 5. Retrieval Agent Enhancements

### Implement new retrieval patterns:

```javascript
// src/services/retrievalService.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const weaviateClient = require('../utils/weaviateClient');

// Multi-stage retrieval with episodes and thoughts
async function retrieveMemories(query, userId, options = {}) {
  // Stage 1: Get relevant chunks
  const chunks = await retrieveChunks(query, userId, options);
  
  // Stage 2: Get related episodes
  const episodeIds = [...new Set(chunks.map(c => c.episodeId).filter(Boolean))];
  const episodes = await prisma.episode.findMany({
    where: { id: { in: episodeIds } }
  });
  
  // Stage 3: Get related thoughts
  const thoughtIds = [...new Set(chunks.map(c => c.thoughtId).filter(Boolean))];
  const thoughts = await prisma.thought.findMany({
    where: { id: { in: thoughtIds } }
  });
  
  return { chunks, episodes, thoughts };
}

// Other retrieval methods...
```

## 6. Implementation Timeline

### Phase 1: Infrastructure (Weeks 1-2)
- Set up BullMQ and Redis
- Create database migrations
- Implement shared agent utilities

### Phase 2: Core Agents (Weeks 3-4)
- Implement ingestionAgent
- Implement episodeAgent
- Create test pipeline with these two agents

### Phase 3: Advanced Agents (Weeks 5-6)
- Implement consolidationAgent
- Implement thoughtAgent
- Complete the full pipeline

### Phase 4: Retrieval & UI (Weeks 7-8)
- Enhance retrieval service
- Update UI components to use new memory structure
- Add visualizations for episode connections

### Phase 5: Testing & Optimization (Weeks 9-10)
- Performance testing
- Optimizing vector operations
- Fine-tuning importance scores and thresholds

## 7. Testing Strategy

### Unit Tests
Create specific tests for each agent and their components.

### Integration Tests
Test the full pipeline from raw data to thoughts.

### Performance Tests
Assess system under load with varying data volumes.

## 8. Monitoring Plan

Implement monitoring using:
- Queue metrics (job counts, processing times)
- Database metrics (record counts, query times)
- Vector database performance metrics

## 9. Rollout Strategy

1. Deploy in shadow mode alongside existing system
2. Compare results for quality and performance
3. Gradually shift traffic to new system
4. Complete switchover after validation 