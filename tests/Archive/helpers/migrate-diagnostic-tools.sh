#!/bin/bash

# Script to migrate diagnostic tools to the tests directory
# This will move relevant diagnostic scripts from scripts/diagnostics to tests/helpers/scripts
# It will also clean up any remaining test files

echo "Starting migration of diagnostic tools..."

# Create the target directory if it doesn't exist
mkdir -p tests/helpers/scripts/diagnostics

# Copy relevant diagnostic scripts to the tests directory
echo "Copying diagnostic scripts..."
cp -v scripts/diagnostics/check-memory-retrieval.js tests/helpers/scripts/diagnostics/
cp -v scripts/diagnostics/check-weaviate-schema.js tests/helpers/scripts/diagnostics/
cp -v scripts/diagnostics/check-weaviate-episodes.js tests/helpers/scripts/diagnostics/
cp -v scripts/diagnostics/check-chunks.js tests/helpers/scripts/diagnostics/
cp -v scripts/diagnostics/check-env.js tests/helpers/scripts/diagnostics/
cp -v scripts/diagnostics/check-episodes.js tests/helpers/scripts/diagnostics/
cp -v scripts/diagnostics/check-prisma-model.js tests/helpers/scripts/diagnostics/
cp -v scripts/diagnostics/check-qwe-episodes.js tests/helpers/scripts/diagnostics/
cp -v scripts/diagnostics/check-users-chunks.js tests/helpers/scripts/diagnostics/

# Copy any relevant memory tools
echo "Copying memory tools..."
cp -v scripts/memory-tools/find-user.js tests/helpers/scripts/

# Remove the original .env.test files (now moved to tests/env/)
echo "Removing original .env.test files..."
rm -vf .env.test 2>/dev/null || true
rm -vf prisma/.env.test 2>/dev/null || true

# Remove the old test documentation files
echo "Removing old test documentation files..."
rm -vf tests/TESTING.md 2>/dev/null || true
rm -vf tests/TEST_SETUP.md 2>/dev/null || true

# Remove duplicate documentation in docs/testing
echo "Cleaning up docs/testing directory..."
if [ -d "docs/testing" ]; then
  rm -rf docs/testing
fi

# Remove original diagnostic scripts
echo "Removing original diagnostic scripts..."
if [ -d "scripts/diagnostics" ]; then
  rm -rf scripts/diagnostics
fi

echo "Migration complete!"
echo "All relevant diagnostic tools have been moved to tests/helpers/scripts/diagnostics/"
echo "Test environment files have been moved to tests/env/"
echo "All test documentation has been consolidated in tests/README.md" 