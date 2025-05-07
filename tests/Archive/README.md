# 2dots1line Testing Documentation

## Overview

This document provides a comprehensive guide to the testing infrastructure for the 2dots1line application. The test suite is designed to provide coverage at multiple levels: unit tests, integration tests, and end-to-end tests.

## Test Structure

```
tests/
├── README.md                       # This file - comprehensive test documentation
├── env/                            # Test environment configuration
│   └── .env.test                   # Test environment variables
├── unit/                           # Unit tests for individual components
│   ├── services/                   # Tests for service layer
│   ├── repositories/               # Tests for data access layer
│   └── controllers/                # Tests for controller layer
├── integration/                    # Integration tests for component interactions
├── e2e/                            # End-to-end tests for complete flows
├── mocks/                          # Mock implementations for testing
│   └── MockAIProvider.js           # Mock implementation of AI providers
└── helpers/                        # Test helpers and utilities
    ├── jest.setup.js               # Jest configuration for all tests
    ├── setup-test-db.js            # Script to set up test database
    └── scripts/                    # Utility test scripts
        ├── test-weaviate-schema.js # Tests Weaviate schema configuration
        ├── test-memory-retrieval.js # Tests memory retrieval
        ├── test-episode-retrieval.js # Tests episode retrieval
        ├── test-knowledge-node.js  # Tests knowledge node operations
        ├── test-job.js             # Tests job queue system
        └── test-redis-config.js    # Tests Redis configuration
```

## Test Types

### Unit Tests

Unit tests focus on testing individual functions and classes in isolation. External dependencies are mocked to isolate the code being tested.

**Command to run unit tests:**
```bash
npm run test:unit
```

**Example unit test files:**
- `unit/services/memoryManager.service.test.js` - Tests the memory manager service
- `unit/repositories/rawData.repository.test.js` - Tests the raw data repository
- `unit/controllers/chat.controller.test.js` - Tests the chat controller

### Integration Tests

Integration tests verify the interactions between multiple components, such as services, repositories, and external systems.

**Command to run integration tests:**
```bash
npm run test:integration
```

**Example integration test files:**
- `integration/chat.service.integration.test.js` - Tests the chat service with real repositories
- `integration/fileUpload.service.integration.test.js` - Tests the file upload service with real dependencies

### End-to-End Tests

E2E tests validate complete application flows from the API level to the database and back.

**Command to run E2E tests:**
```bash
npm run test:e2e
```

**Example E2E test files:**
- `e2e/chat.e2e.test.js` - Tests the complete chat flow from API request to database and response

## Test Setup

### Environment Requirements

1. PostgreSQL database for tests
2. Node.js and npm
3. Redis server (for queue tests)

### Environment Setup

Tests require a separate database and configuration. The setup process is automated:

1. Create test database:
```sql
CREATE USER test_user WITH PASSWORD 'test_password';
CREATE DATABASE test_db;
GRANT ALL PRIVILEGES ON DATABASE test_db TO test_user;
```

2. Run the setup script that creates the `.env.test` file and initializes the test database:
```bash
npm run test:setup
```

This script:
- Creates the appropriate test environment files in `tests/env/.env.test`
- Sets up a test database with the required schema
- Creates a test user and session for testing

3. Apply Prisma migrations to the test database:
```bash
npx dotenv -e tests/env/.env.test -- npx prisma migrate deploy
```

### Jest Configuration

Tests use Jest as the testing framework. The configuration is in `config/jest.config.js`, which defines:

- Test environment (Node.js)
- Test matching patterns
- Coverage configurations
- Setup files

## Utility Test Scripts

In addition to the automated tests, the project includes utility scripts for testing specific components:

- **Weaviate Schema Test**: `npm run test:weaviate`
- **Memory Retrieval Test**: `npm run test:memory`
- **Episode Retrieval Test**: `npm run test:episodes`
- **Knowledge Node Test**: `npm run test:knowledge`
- **Job Queue Test**: `npm run test:job`
- **Redis Configuration Test**: `npm run test:redis`

These scripts are useful for:
- Debugging specific components
- Verifying infrastructure is working correctly
- Testing integration with external systems like Weaviate and Redis
- Validating job queue functionality

## Test Mocks

The `mocks/` directory contains mock implementations used in tests:

- `MockAIProvider.js` - Mocks AI provider responses for testing

## CI/CD Integration

Tests are configured to run in CI/CD pipelines. The typical workflow is:

1. Run linting (`npm run lint`)
2. Run unit tests (`npm run test:unit`)
3. Run integration tests (`npm run test:integration`)
4. Run E2E tests (`npm run test:e2e`)

## Best Practices

When writing tests for the 2dots1line codebase, follow these best practices:

1. **Isolation**: Each test should be independent
2. **Clean Setup/Teardown**: Tests should clean up after themselves
3. **Meaningful Assertions**: Test important behaviors, not implementation details
4. **Test Coverage**: Aim for good coverage of critical paths
5. **Mock External Dependencies**: Use mocks for external services and APIs
6. **Clear Test Names**: Use descriptive test names that indicate what is being tested

## Debugging Tests

When tests fail, here are strategies for debugging:

1. Run the specific failing test with more output:
```bash
npx jest tests/unit/services/memoryManager.service.test.js --verbose
```

2. Use the debug scripts:
```bash
npm run test:weaviate
```

3. Check the database state:
```bash
psql test_db -c "SELECT * FROM \"RawData\" LIMIT 5;"
```

## Diagnostic Tools

The project includes several diagnostic tools that can be used to debug issues:

- `tests/helpers/scripts/test-weaviate-schema.js` - Checks Weaviate schema configuration
- `tests/helpers/scripts/test-memory-retrieval.js` - Tests memory retrieval functionality
- `tests/helpers/scripts/test-episode-retrieval.js` - Tests episode retrieval functionality
- `tests/helpers/scripts/test-knowledge-node.js` - Tests knowledge graph operations
- `tests/helpers/scripts/test-job.js` - Tests job queue system
- `tests/helpers/scripts/test-redis-config.js` - Tests Redis configuration 