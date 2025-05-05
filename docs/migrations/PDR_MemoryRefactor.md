# Product Development Requirements: Memory System Refactor (v2)

**Version:** 1.0
**Date:** 2024-05-16
**Author:** AI Assistant (Gemini)
**Status:** Draft

## 1. Introduction & Goal

This document outlines the requirements and implementation plan for refactoring Dot's memory system. The primary goal is to transition from the current monolithic `memoryManager.service.js` to a more modular, scalable, and maintainable event-driven architecture based on four specialized agents, as detailed in `NewMemorySpec.md` (v2).

This refactor aims to improve:
*   **Scalability:** Allow independent scaling of different memory processing tasks (ingestion, consolidation, etc.).
*   **Maintainability:** Simplify code ownership and reduce complexity within a single service.
*   **Reliability:** Isolate failures within specific agents and leverage robust queueing mechanisms.
*   **Clarity:** Provide a clear, event-based flow for memory processing.

## 2. High-Level Changes Summary

*   **Agent Architecture:** Replace `memoryManager.service.js` with four distinct agents: `ingestionAgent`, `episodeAgent`, `consolidationAgent`, `thoughtAgent`.
*   **Event Bus:** Implement BullMQ (Redis-backed) for inter-agent communication via defined job queues (`ingestion`, `chunk`, `orphan`, `episode`, `thought`) and event types (`chunk.added`, `chunk.orphan`, `upload.boost`, `episode.updated`, `episode.created`, `thought.created`).
*   **Database Schema:** Update Prisma schema (PostgreSQL) and Weaviate schema according to `NewMemorySpec.md` (v2), including simplified `ChunkEmbedding`, M:N relations, and dedicated Weaviate classes.
*   **Embedding Strategy:** Implement distinct embedding generation for Chunks (content), Episodes (narrative summary), and Thoughts (name + description).
*   **Retrieval Logic:** Enhance `retrieveMemories` function to query across Episode, Thought, and Chunk embedding layers.
*   **Special Modes:** Implement handling for Onboarding (`forceImportant`) and Crash-Course Uploads (`upload.boost`).
*   **KG Integration:** Integrate Knowledge Graph extraction within the `consolidationAgent` and leverage it in the `thoughtAgent`.
*   **Data Migration:** Assume starting with a fresh memory state (no backward data migration required).

## 3. Detailed Implementation Plan

This plan follows the phased rollout described in `NewMemorySpec.md`.

### Phase 1: Foundational Setup

1.  **Update Prisma Schema:**
    *   Modify `prisma/schema.prisma` to match the specification in `NewMemorySpec.md` Section 1.2.1.
    *   Key changes: Update `ChunkEmbedding` (remove unused fields), `Episode` (add optional `perspectiveOwner`, `subject`), `Thought`, define M:N relations (`ChunkEpisodes`, `EpisodeThoughts`).
    *   Ensure cascading deletes are appropriately configured (e.g., deleting a `User` removes their associated data).
2.  **Database Migration:**
    *   Generate migration files: `npx prisma migrate dev --name memory_refactor_v2`
    *   Review generated SQL.
    *   Apply migration to development database.
3.  **Setup Weaviate Schema:**
    *   Implement logic (e.g., in an initialization script or service) to check for and create the `ChunkEmbedding`, `EpisodeEmbedding`, and `ThoughtEmbedding` classes in Weaviate on application startup, matching the schemas in `NewMemorySpec.md` Section 1.2.2.
    *   Ensure `vectorizer` is set to `none`.
4.  **Implement BullMQ Infrastructure:**
    *   Install `bullmq`.
    *   Configure Redis connection.
    *   Define and instantiate queues: `ingestion`, `chunk`, `orphan`, `episode`, `thought`.
    *   Create basic worker shell files for each agent (`src/agents/ingestionAgent.js`, `src/agents/episodeAgent.js`, etc.) with initial BullMQ worker setup listening to the appropriate queue.
5.  **Utility Services:**
    *   Ensure core services (`embeddingService`, `kgService`, `llmService`) are accessible or refactored as needed for use by the new agents.

### Phase 2: Ingestion & Embedding Logic

1.  **Implement `ingestionAgent`:**
    *   Extract/implement logic for:
        *   Loading `RawData`.
        *   Evaluating importance (`evaluateImportance`).
        *   Handling `forceImportant` flag (from onboarding).
        *   Chunking content (`chunkContent` - initially 1 chunk per `RawData`).
        *   Generating chunk embedding (`embeddingService.generateEmbedding`).
        *   Storing vector in Weaviate (`ChunkEmbedding` class, properties: `chunkId`, `userId`, `rawDataId`, `createdAt`).
        *   Creating `ChunkEmbedding` record in PostgreSQL (linking `rawDataId`, storing `vectorId`).
        *   Updating `RawData.processed` flag.
    *   Implement BullMQ worker logic to process `ingestion` queue jobs.
    *   On success, add `chunk.added` job to `chunk` queue with `{ chunkId, userId }`.
    *   Implement error handling (logging, BullMQ retries/dead-letter).
2.  **Wire API Controller:**
    *   Modify controllers (e.g., `chat.controller.js`, `fileUpload.service.js`) to add jobs to the `ingestion` queue upon `RawData` creation, passing `{ rawDataId }` and potentially the `forceImportant` flag.

### Phase 3: Episode Attachment Logic

1.  **Implement `episodeAgent`:**
    *   Implement BullMQ worker logic to process `chunk.added` jobs from the `chunk` queue.
    *   Logic:
        *   Fetch `ChunkEmbedding` vector from Weaviate.
        *   Search `EpisodeEmbedding` centroids (`nearVector`, filter by `userId`).
        *   **If match ≥ 0.82:**
            *   Link `ChunkEmbedding` and `Episode` via `_ChunkEpisodes`.
            *   Update `Episode.narrative` (e.g., call `llmService.summarize(old_narrative + new_chunk_content)`).
            *   Generate new embedding for the updated narrative (`embeddingService.generateEmbedding`).
            *   Update vector in Weaviate (`EpisodeEmbedding` class).
            *   Update `Episode.centroidVectorId` and `updatedAt` in PostgreSQL.
            *   Add `episode.updated` job to `episode` queue with `{ episodeId, userId }`.
        *   **If no match:**
            *   Add `chunk.orphan` job to `orphan` queue with `{ chunkId, userId }`.
    *   Implement error handling.

### Phase 4: Consolidation Engine

1.  **Implement `consolidationAgent` Triggers:**
    *   Set up Cron job (e.g., using `node-cron` or system cron calling a script) to periodically trigger the agent (e.g., add a job to `orphan` queue with a specific type like `cron_consolidation`).
    *   Ensure `fileUpload.service` adds `upload.boost` job to `orphan` queue after queuing all chunks for an upload.
    *   (Optional) Implement logic to check orphan count periodically and trigger if threshold (e.g., 200) is met.
2.  **Implement `consolidationAgent` Worker:**
    *   Implement BullMQ worker logic for the `orphan` queue, handling different job types (`chunk.orphan`, `cron_consolidation`, `upload.boost`).
    *   Logic:
        *   Fetch relevant orphaned `ChunkEmbedding` records (based on job type/user).
        *   Fetch corresponding vectors from Weaviate.
        *   Perform DBSCAN clustering (using cosine distance, eps ≈ 0.6-0.65, minPts = 3-5).
        *   For each cluster:
            *   Generate narrative (`llmService.summarize`).
            *   Generate narrative embedding (`embeddingService.generateEmbedding`) -> `centroidVector`.
            *   **(Optional Merge Check):** Search `EpisodeEmbedding` centroids; if close match found, merge chunks into existing episode (update narrative/centroid as in Phase 3).
            *   **If creating new Episode:**
                *   Create `Episode` record (title, narrative).
                *   Store `centroidVector` in Weaviate/PostgreSQL.
                *   Assign `emotionTags` (`llmService.classifyEmotions`).
                *   Extract KG entities (`llmService.extractEntities`).
                *   Write KG nodes/edges (`kgService.writeNodesAndEdges`), linking to `episodeId`.
                *   Link `ChunkEmbedding` records via `_ChunkEpisodes`.
                *   Add `episode.created` job to `episode` queue with `{ episodeId, userId }`.
    *   Implement error handling.

### Phase 5: Thought Synthesis

1.  **Implement `thoughtAgent` Triggers:**
    *   Set up Cron job (e.g., daily 4 AM).
    *   (Optional) Implement logic to monitor `episode.updated`/`created` jobs and trigger if threshold (e.g., 10 in 24h) is met for a user.
2.  **Implement `thoughtAgent` Worker:**
    *   Implement BullMQ worker logic (triggered by cron or threshold check).
    *   Logic:
        *   Fetch recent `Episode`s and associated KG data for active users.
        *   Analyze KG for patterns (co-occurrence, community detection).
        *   Identify new `Thought` candidates not already present.
        *   For each new Thought:
            *   Generate details (`type`, `name`, `description`, `modelConfidence`).
            *   Create `Thought` record in PostgreSQL.
            *   Link contributing `Episode`s via `_EpisodeThoughts`.
            *   Generate embedding for `name + description`.
            *   Store embedding in Weaviate (`ThoughtEmbedding` class) / PostgreSQL (`vectorId`).
            *   Add `thought.created` job to `thought` queue with `{ thoughtId, userId }`.
    *   Implement error handling.

### Phase 6: Retrieval & Final Integration

1.  **Refactor `retrieveMemories`:**
    *   Implement the multi-level search logic as described in `NewMemorySpec.md` Section 1.5:
        *   Query `EpisodeEmbedding`.
        *   Optionally query `ThoughtEmbedding`.
        *   Optionally query `ChunkEmbedding` (filtered by episode context).
2.  **Implement `MemoryHints` Generation:**
    *   Structure the results from `retrieveMemories` into the specified `MemoryHint` format.
3.  **Integrate Special Modes:**
    *   Ensure `forceImportant` (onboarding) and `upload.boost` (uploads) flags/triggers are correctly handled throughout the agent pipeline.
4.  **Testing & Refinement:**
    *   Execute Unit, Integration, and E2E tests as defined in `NewMemorySpec.md` Section 2.
    *   Monitor performance and resource usage.
    *   Refine agent logic, queue settings, and configurations based on testing results.
    *   Add monitoring and alerting (e.g., using Sentry, Datadog, Prometheus/Grafana with BullMQ exporters).

## 4. Schema Details

*   **Prisma:** See `NewMemorySpec.md` Section 1.2.1.
*   **Weaviate:** See `NewMemorySpec.md` Section 1.2.2 (Classes: `ChunkEmbedding`, `EpisodeEmbedding`, `ThoughtEmbedding`).

## 5. Key Technologies & Parameters

*   **Queueing:** BullMQ (backed by Redis)
*   **Database:** PostgreSQL (via Prisma)
*   **Vector DB:** Weaviate
*   **Clustering:** DBSCAN (Algorithm)
    *   Metric: Cosine Distance (`1 - cosine_similarity`)
    *   `eps`: ~0.6 - 0.65 (equivalent to similarity ~0.35-0.4)
    *   `minPts`: 3-5
*   **Episode Centroid:** Embedding of `Episode.narrative` summary.
*   **Error Handling:** BullMQ Retries, Dead-Letter Queues, Logging (e.g., Sentry).

## 6. Testing Strategy

*   Follow Unit, Integration, and E2E testing plans outlined in `NewMemorySpec.md` Section 2.
*   Focus on testing the event flow between agents and the correctness of data at each stage (DB records, Weaviate vectors).
*   Mock external dependencies (LLM, Weaviate, KG) for unit and integration tests where appropriate.

## 7. Data Migration

*   No backward data migration is planned. The deployment assumes starting with a fresh memory state for users in the new system. Existing data managed by the old `memoryManager` will not be automatically converted.

## 8. Open Questions / Future Considerations

*   **Chunking Strategy:** Currently assumes 1 chunk per `RawData`. Plan for future extension to support multi-chunking if needed (requires schema adjustment in `ChunkEmbedding` - add `chunkIndex`, `content`).
*   **Merge Check:** The merge check in `consolidationAgent` is recommended but marked optional initially. Decide on implementation priority.
*   **Orphan Count Trigger:** Determine the precise mechanism and frequency for checking the orphan count threshold for `consolidationAgent`.
*   **Thought Agent Trigger:** Finalize the threshold and mechanism for triggering `thoughtAgent` based on `episode` activity.
*   **Scalability Tuning:** Monitor queue lengths, worker performance, and database load under production-like conditions to tune worker counts, DB resources, and potentially queue priorities. 