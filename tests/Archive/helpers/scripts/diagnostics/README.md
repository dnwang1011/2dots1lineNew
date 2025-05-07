# Diagnostic Tools

This directory contains diagnostic tools that are used to check the health and state of various components of the 2dots1line system.

## Available Diagnostic Tools

### Weaviate Diagnostic Tools

1. **check-weaviate-schema.js** - Verifies the Weaviate schema configuration
   - Usage: `node tests/helpers/scripts/diagnostics/check-weaviate-schema.js`
   - Purpose: Confirms that the Weaviate schema has the expected classes and properties

2. **check-weaviate-episodes.js** - Checks episode data in Weaviate
   - Usage: `node tests/helpers/scripts/diagnostics/check-weaviate-episodes.js`
   - Purpose: Verifies that episode data is properly stored in Weaviate

3. **check-episodes.js** - Analyzes episode data across database and vector store
   - Usage: `node tests/helpers/scripts/diagnostics/check-episodes.js`
   - Purpose: Ensures consistency between the database and vector store for episodes

### Memory System Diagnostics

1. **check-memory-retrieval.js** - Tests memory retrieval functionality
   - Usage: `node tests/helpers/scripts/diagnostics/check-memory-retrieval.js`
   - Purpose: Verifies that vector similarity search is working correctly

2. **check-chunks.js** - Analyzes chunk data in the database
   - Usage: `node tests/helpers/scripts/diagnostics/check-chunks.js`
   - Purpose: Checks for consistency and completeness of chunk data

3. **check-users-chunks.js** - Examines chunks by user
   - Usage: `node tests/helpers/scripts/diagnostics/check-users-chunks.js`
   - Purpose: Analyzes the distribution and quality of chunks by user

### Other Diagnostic Tools

1. **check-env.js** - Validates environment configuration
   - Usage: `node tests/helpers/scripts/diagnostics/check-env.js`
   - Purpose: Ensures all required environment variables are properly set

2. **check-prisma-model.js** - Verifies Prisma model structure
   - Usage: `node tests/helpers/scripts/diagnostics/check-prisma-model.js`
   - Purpose: Confirms that the Prisma model matches expected schema

3. **check-qwe-episodes.js** - Legacy tool for QWE episode analysis
   - Usage: `node tests/helpers/scripts/diagnostics/check-qwe-episodes.js`
   - Purpose: Special-purpose tool for analyzing QWE episode data

## Using the Diagnostic Tools

These diagnostic tools can be run directly using Node.js or through the npm scripts defined in `package.json`:

```bash
# Run directly
node tests/helpers/scripts/diagnostics/check-weaviate-schema.js

# Or use the npm script
npm run memory:check-schema
```

Most diagnostic tools will output information to the console that can help diagnose issues with the system.

## When to Use These Tools

Use these diagnostic tools when:

1. Troubleshooting issues with the memory system
2. Verifying that the system is configured correctly
3. Checking data consistency after migrations or updates
4. Diagnosing performance issues

## Environment Configuration

The diagnostic tools use the test environment configuration from `tests/env/.env.test`. 