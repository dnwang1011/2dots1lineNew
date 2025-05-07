# Configuration Management

This directory contains centralized configuration for all aspects of the 2dots1line system. The configuration is organized into logical modules based on functionality.

## Configuration Modules

### AI Configuration (`ai.config.js`)
- **Purpose**: Controls AI behavior, model settings, prompts, and generation parameters
- **Key Parameters**: Model names, prompt templates, generation settings, embedding dimensions
- **Used By**: ai.service.js, memoryManager.service.js, consolidationAgent.js

### Memory Configuration (`memory.config.js`)
- **Purpose**: Controls memory pipeline parameters and thresholds
- **Key Parameters**: Importance thresholds, chunk sizes, retrieval limits, batch sizes
- **Used By**: memoryManager.service.js, chat.service.js

### Episodic Configuration (`episodic.config.js`)
- **Purpose**: Controls episodic memory formation, clustering, and thought generation.
- **Key Parameters**: 
  - `consolidationThreshold`: Minimum orphan chunks to trigger consolidation.
  - `orphanClusterCreationThreshold`: Fallback similarity for creating new episodes from orphans if DBSCAN doesn't yield clusters.
  - `dbscan.epsilon`, `dbscan.minPoints`: Parameters for DBSCAN clustering of orphan chunks.
  - `similarityThreshold`: Primary similarity score needed to attach a chunk to its most relevant existing episode.
  - `multipleAttachmentSimilarityThreshold`: Lower similarity score allowing a chunk to be attached to *additional* relevant episodes.
  - `newEpisodeSeedThreshold`: If a chunk's similarity to all existing episodes is below this, it (if important) can seed a new episode.
  - `maxChunksPerEpisode`, `maxCandidateEpisodes`, `episodeTimeWindowMs`: General episode behavior parameters.
- **Used By**: consolidationAgent.js, episodeAgent.js, thoughtAgent.js

### Queue Configuration (`queue.config.js`)
- **Purpose**: Centralizes queue names and job processing parameters
- **Key Parameters**: Queue names, concurrency settings, retry strategies, job retention
- **Used By**: BullMQ workers, agents, job scheduling services

### Service Configuration (`service.config.js`)
- **Purpose**: Cross-cutting service settings and environment-specific configuration
- **Key Parameters**: Default providers, health check intervals, server settings, security
- **Used By**: ai.service.js, memoryManager.service.js, server setup

## Environment Variables

All configuration values can be overridden using environment variables. See `.env.example` for available overrides.

## Best Practices

1. **Never hardcode configuration values in services**:
   - Always import from the appropriate config module
   - Use sensible defaults within the config files

2. **Document config parameters**:
   - Comment each parameter with a description
   - Note which services depend on each parameter

3. **Adding new config**:
   - Place in the most appropriate config module based on functionality
   - Avoid creating new config files unless there's a clear category separation
   - Add environment variable overrides for all new configuration values

4. **Changing existing config**:
   - Make sure changes are backward compatible when possible
   - Update all services that depend on changed parameters
   - Test changes with unit tests

## Configuration Loading

Configuration is loaded at startup and cached. Environment variable overrides are applied at load time. Changes to environment variables require an application restart to take effect. 