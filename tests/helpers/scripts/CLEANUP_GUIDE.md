# Test Code Cleanup Guide

This document provides guidance on which test files from the original codebase can be safely removed now that we've consolidated the essential test code.

## Original Test Files

The following files and directories from the original codebase have been centralized and can now be safely removed:

### Already Migrated Scripts

These scripts have been migrated to the centralized `tests/helpers/scripts/` directory and can be removed from their original locations:

```
scripts/tests/test-episode-retrieval.js   → tests/helpers/scripts/test-episode-retrieval.js
scripts/tests/test-knowledge-node.js      → tests/helpers/scripts/test-knowledge-node.js
scripts/tests/test-memory-retrieval.js    → tests/helpers/scripts/test-memory-retrieval.js
scripts/tests/test-weaviate-schema.js     → tests/helpers/scripts/test-weaviate-schema.js
scripts/tests/test-job.js                 → tests/helpers/scripts/test-job.js
scripts/tests/test-redis-config.js        → tests/helpers/scripts/test-redis-config.js
```

### Test Files That Can Be Removed

These files appear to be one-off test or debugging scripts and are not essential for the core testing infrastructure:

```
scripts/tests/create-test-chunk.js       - One-off script for creating test data
scripts/tests/create-test-graphql.js     - One-off script for testing GraphQL
scripts/tests/test-episode-agent.js      - Superseded by unit tests
scripts/tests/test-weaviate.js           - Superseded by test-weaviate-schema.js
scripts/memory-tools/create-test-data.js - One-off script for creating test data
scripts/memory-tools/create-test-episode.js - One-off script for creating test episodes
```

### Redundant Documentation

The following documentation files are now redundant as they've been consolidated:

```
docs/testing/TEST_SETUP.md - Migrated to tests/README.md and tests/TESTING.md
```

## How to Clean Up

Once you've verified that the centralized test infrastructure is working correctly, you can remove the original files with:

```bash
# Remove migrated test scripts
rm scripts/tests/test-episode-retrieval.js
rm scripts/tests/test-knowledge-node.js
rm scripts/tests/test-memory-retrieval.js
rm scripts/tests/test-weaviate-schema.js
rm scripts/tests/test-job.js
rm scripts/tests/test-redis-config.js

# Remove one-off test scripts
rm scripts/tests/create-test-chunk.js
rm scripts/tests/create-test-graphql.js
rm scripts/tests/test-episode-agent.js
rm scripts/tests/test-weaviate.js
rm scripts/memory-tools/create-test-data.js
rm scripts/memory-tools/create-test-episode.js

# Remove original setup script (now in tests/helpers/)
rm scripts/setup-test-db.js
```

## Verification Before Removal

Before removing any files, verify that:

1. All automated tests still pass with the new structure
2. The utility test scripts run correctly from their new locations
3. Documentation is up-to-date and points to the correct paths

## Updating Imports

If any files in the codebase import or require the migrated test files, update those imports to point to the new locations. 