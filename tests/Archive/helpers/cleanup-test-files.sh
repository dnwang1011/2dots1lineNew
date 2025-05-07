#!/bin/bash

# Cleanup script for legacy test files
# Run this after verifying that the centralized test infrastructure works correctly

echo "WARNING: This script will remove legacy test files that have been migrated to the new test structure."
echo "Make sure you have verified that the new test structure works correctly before proceeding."
read -p "Do you want to continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "Cleanup canceled."
    exit 1
fi

echo "Starting cleanup..."

# Remove migrated test scripts
echo "Removing migrated test scripts..."
rm -v scripts/tests/test-episode-retrieval.js
rm -v scripts/tests/test-knowledge-node.js
rm -v scripts/tests/test-memory-retrieval.js
rm -v scripts/tests/test-weaviate-schema.js
rm -v scripts/tests/test-job.js
rm -v scripts/tests/test-redis-config.js

# Remove one-off test scripts
echo "Removing one-off test scripts..."
rm -v scripts/tests/create-test-chunk.js
rm -v scripts/tests/create-test-graphql.js
rm -v scripts/tests/test-episode-agent.js
rm -v scripts/tests/test-weaviate.js
rm -v scripts/memory-tools/create-test-data.js
rm -v scripts/memory-tools/create-test-episode.js

# Remove original setup script
echo "Removing original setup script..."
rm -v scripts/setup-test-db.js

# Keep only the redirect README in docs/testing
echo "Cleanup of docs/testing..."
rm -v docs/testing/TEST_SETUP.md

echo "Cleanup complete. If you encountered any errors, some files may have already been removed or had different paths."
echo "Check the tests/ directory for the centralized test infrastructure." 