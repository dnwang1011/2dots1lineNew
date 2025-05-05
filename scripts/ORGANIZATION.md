# Codebase Organization Summary

## Overview

This document summarizes the cleanup and organization of the 2dots1line codebase, focusing particularly on the debugging tools and scripts created during the memory system development and troubleshooting process.

## Directory Structure

The `scripts` directory has been organized into the following subdirectories:

- **monitoring/**: Health monitoring tools for the memory system
- **diagnostics/**: Tools for diagnosing memory system issues
- **fixes/**: One-time fix scripts that resolved specific issues
- **memory-tools/**: Utilities for creating test data and managing memory
- **tests/**: Test scripts for various memory system components
- **schemas/**: Schema definitions and GraphQL files
- **logs/**: Log files from various components
- **reference/**: Reference materials and documentation
- **docs/**: Technical specifications and migration documentation
- **archive/**: Historical scripts kept for reference

## Key Scripts

### Memory Monitoring

- **monitor-memory-system.js**: Comprehensive health check of the memory system

### Diagnostics

- **check-weaviate-schema.js**: Verifies vector database schema configuration
- **check-weaviate-episodes.js**: Checks if episodes exist in Weaviate
- **check-chunks.js**: Examines chunks in the database
- **check-episodes.js**: Examines episodes in the database

### Fixes

- **fix-episode-embedding.js**: Fixes missing episode embeddings in Weaviate
- **fix-memory-retrieval.js**: Adds vector dimension handling for memory retrieval
- **fix-memory-manager-db.js**: Fixes database access in the memory manager
- **fix-ai-embedding-dimension.js**: Diagnoses AI embedding dimension issues

### Testing

- **test-memory-retrieval.js**: Tests memory retrieval functionality
- **test-episode-retrieval.js**: Tests episode retrieval functionality

## NPM Scripts

The following npm scripts have been added to `package.json` for easy access:

```bash
# Monitor memory system health
npm run memory:monitor

# Check episodes in Weaviate
npm run memory:check-episodes -- <user-id>

# Check Weaviate schema
npm run memory:check-schema

# Fix missing episodes in Weaviate
npm run memory:fix-episodes -- <user-id>

# Test memory retrieval
npm run memory:test -- <user-id> "<query-text>"

# Test episode retrieval
npm run memory:test-episodes -- <user-id>
```

## Documentation

Key documentation files are located in the docs directory:

- **docs/architecture/MEMORY_SYSTEM.md**: Comprehensive documentation of the memory system
- **docs/architecture/CODING_STANDARDS.md**: Coding standards and best practices
- **README.md**: Updated with memory system information

Additional technical documentation is stored in `scripts/docs/`.

## Ongoing Maintenance

For regular maintenance:

1. Run `npm run memory:monitor` weekly to check system health
2. After significant changes, run `npm run memory:check-schema` to verify the Weaviate configuration
3. Use `npm run memory:test` with appropriate parameters to test memory retrieval

## Full Codebase Organization

As part of our comprehensive code organization, we've restructured the entire codebase:

### Key Directories

1. **docs/** - Comprehensive documentation
   - Architecture documentation
   - Migration plans and logs
   - Technical specifications
   - Testing guides

2. **data/** - Data files and backups
   - Database and vector DB backups
   - Test data
   - Reports from tests and monitoring

3. **scripts/** - Utility scripts organized by function
   - Diagnostic tools
   - Monitoring tools
   - Fix scripts
   - Test utilities

### Key Scripts

- **backup-system.js**: Added a comprehensive backup system for both database and Weaviate
- **monitor-memory-system.js**: Full health check of the memory system

### NPM Utility Commands

```bash
# Run a full system backup
npm run backup

# Monitor memory system health
npm run memory:monitor

# Test memory retrieval
npm run memory:test -- <user-id> "<query-text>"
```

### Documentation

Documentation is now organized in a structured hierarchy:

1. **docs/architecture/** - System architecture documentation
2. **docs/migrations/** - Migration plans and logs
3. **docs/specs/** - Technical specifications
4. **docs/testing/** - Testing guides

The main entry point is **docs/README.md**, which provides a comprehensive guide to the documentation structure.

## Conclusion

This organization provides a clean, structured approach to managing the codebase, making it easier to maintain the memory system and troubleshoot any future issues that may arise. 