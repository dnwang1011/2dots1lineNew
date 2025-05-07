# 2dots1line

An AI-powered chat application with memory management and asynchronous file processing capabilities.

> **Note:** For detailed startup instructions, please see [STARTUP_INSTRUCTIONS.md](./docs/STARTUP_INSTRUCTIONS.md)

## Table of Contents
- [Introduction](#introduction)
- [Architecture Overview](#architecture-overview)
- [Data Flow](#data-flow)
- [Key Features](#key-features)
- [Dependencies](#dependencies)
- [Setup Instructions](#setup-instructions)
- [Starting the Application](#starting-the-application)
- [Environment Configuration](#environment-configuration)
- [Project Structure](#project-structure)
- [Memory System](#memory-system)
- [Scripts & Utilities](#scripts--utilities)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)

## Introduction

2dots1line is a hybrid AI system featuring a chat interface with advanced memory management. It processes user interactions and generates contextually relevant responses by leveraging a sophisticated memory system that maintains both short-term and long-term knowledge.

## Architecture Overview

2dots1line is structured as a modern Express.js application with a BullMQ-based job processing system. The application uses a multi-layer architecture:

### Backend Components

1. **API Layer** (`src/controllers/`, `src/routes/`)
   - REST API endpoints for user interaction
   - Authentication and authorization
   - Request validation and response formatting

2. **Service Layer** (`src/services/`)
   - Business logic implementation
   - AI service integration (Gemini AI)
   - Memory management services

3. **Data Access Layer** (`src/repositories/`, `src/db/`)
   - Database interactions via Prisma ORM
   - Vector search via Weaviate
   - Memory persistence and retrieval

4. **Background Processing** (`src/workers/`, `src/utils/queues.js`)
   - Asynchronous job processing with BullMQ
   - Memory processing pipeline
   - File upload processing

5. **Utilities** (`src/utils/`)
   - Logging with Winston
   - Error handling
   - Configuration management

### Frontend Components

1. **Static Files** (`public/`)
   - HTML, CSS, JavaScript for client interface
   - Chat UI implementation

2. **Client-Side Logic** (`public/js/`)
   - Chat message handling
   - File upload management
   - Session management
   - Authentication

### Database

- PostgreSQL (via Prisma ORM)
- Weaviate vector database for semantic memory search
- Redis for job queue management

### External Services

- Gemini AI for natural language processing
- Redis for job queue management

## Data Flow

### Chat Flow

1. User sends a message via frontend (`public/js/chat.js`)
2. Message is sent to `/api/chat` endpoint (`src/routes/chat.routes.js`)
3. Chat controller (`src/controllers/chat.controller.js`) processes the request
4. AI service (`src/services/ai.service.js`) generates a response
5. Memory manager (`src/services/memoryManager.service.js`) stores the conversation in the database
6. Response is sent back to the frontend
7. Frontend displays the response to the user

### Memory Processing Flow

1. Raw data is created in the database (`rawData` table)
2. Memory processing jobs are queued in BullMQ
3. Worker processes evaluate content importance
4. Content is chunked into semantic units
5. Embeddings are generated via AI service
6. Embeddings are stored in Weaviate for vector search
7. Memory is later retrieved via semantic search during chat

## Key Features

- **JWT Authentication**: Secure user authentication and session management
- **Memory Management**: Long-term memory storage and retrieval for AI conversations
- **Asynchronous Processing**: Background job processing for resource-intensive tasks
- **File Analysis**: Support for document and image analysis
- **Vector Search**: Semantic search capabilities for relevant memory retrieval
- **Scalable Architecture**: Separation of concerns for maintainability and scaling

## Dependencies

Main dependencies:
- Express.js - Web framework
- Prisma - ORM for PostgreSQL
- BullMQ - Queue for background jobs
- Redis - Queue management
- Weaviate - Vector database
- Gemini AI - AI service provider
- Winston - Logging

For a full list, see the `package.json` file.

## Setup Instructions

### Prerequisites

- Node.js (v16+)
- npm or yarn
- Redis server
- PostgreSQL database
- Weaviate server (optional, can use remote instance)

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/yourusername/2dots1line.git
   cd 2dots1line
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Create a `.env` file (See [Environment Configuration](#environment-configuration))

4. Initialize the database
   ```bash
   npx prisma migrate dev
   ```

5. Start required services (Redis, PostgreSQL, Weaviate)
   See detailed instructions in [STARTUP_INSTRUCTIONS.md](./docs/STARTUP_INSTRUCTIONS.md)

## Starting the Application

### Recommended Method

```bash
npm run start:all
```

This will start all three required components:
- Main server
- Memory processor worker
- Episode agent worker

### Manual Method (Separate Terminals)

```bash
# Terminal 1 - Main Server
npm start

# Terminal 2 - Memory Processor Worker
npm run worker:memory

# Terminal 3 - Episode Agent Worker
npm run worker:episode
```

For detailed startup and shutdown instructions, see [STARTUP_INSTRUCTIONS.md](./docs/STARTUP_INSTRUCTIONS.md)

## Environment Configuration

Create a `.env` file in the root directory with the following variables:

```
# API Settings
PORT=3002
NODE_ENV=development

# Database URL
DATABASE_URL="postgresql://username:password@localhost:5432/dbname"

# Authentication
JWT_SECRET=your_jwt_secret_key

# Redis Configuration (required for job queues)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional_password

# Weaviate Configuration
WEAVIATE_HOST=http://localhost:8080
WEAVIATE_API_KEY=optional_api_key

# Google AI API Key (for Gemini)
GOOGLE_AI_API_KEY=your_gemini_api_key
```

## Project Structure

```
/
├── config/              # Configuration files
│   ├── lint/            # Linting configuration
│   ├── ai.config.js     # AI service configuration
│   ├── jest.config.js   # Jest configuration
│   └── memory.config.js # Memory system configuration
├── data/                # Data files and backups
│   ├── backups/         # Database and vector DB backups
│   ├── reports/         # Test and monitoring reports
│   └── test-data/       # Test data files
├── docs/                # Comprehensive documentation
│   ├── architecture/    # Architecture documentation
│   ├── migrations/      # Migration plans and logs
│   ├── specs/           # Technical specifications
│   └── testing/         # Testing guides
├── prisma/              # Prisma database schema and migrations
├── public/              # Public static files for frontend
├── scripts/             # Utility scripts
│   ├── diagnostics/     # Diagnostic tools
│   ├── fixes/           # Fix scripts
│   ├── memory-tools/    # Memory system utilities
│   ├── monitoring/      # System monitoring tools
│   ├── startup/         # Application startup scripts
│   ├── tests/           # Test scripts
│   └── schemas/         # Schema definitions
├── src/                 # Source code
│   ├── controllers/     # API controllers
│   ├── models/          # Data models
│   ├── repositories/    # Data access layer
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── utils/           # Utility functions
│   └── workers/         # Background workers
├── tests/               # Test files
│   ├── e2e/             # End-to-end tests
│   ├── integration/     # Integration tests
│   └── services/        # Service tests
└── uploads/             # File upload directory
```

## Memory System

The 2dots1line application includes a sophisticated memory system that allows the Dot chatbot to remember past conversations and experiences. The memory system uses a two-tier approach:

1. **Database (PostgreSQL/Prisma)**: Stores raw data, chunks, episodes, and their relationships.
2. **Vector Database (Weaviate)**: Stores vector embeddings for semantic search and retrieval.

The system features dynamic episode creation, where new conversational themes can seed new episodes. Chunks of conversation can also be linked to multiple relevant episodes, allowing for a richer, more interconnected memory graph. Orphaned chunks are periodically reviewed and clustered to form new episodes or merge with existing ones.

For detailed information about the memory system, refer to [MEMORY_SYSTEM.md](docs/architecture/MEMORY_SYSTEM.md).

## Scripts & Utilities

The application includes various scripts for monitoring, diagnosing, and maintaining the memory system:

### Memory System Tools

```bash
# Monitor memory system health
npm run memory:monitor

# Check episodes in Weaviate for a specific user
npm run memory:check-episodes -- <user-id>

# Check Weaviate schema configuration
npm run memory:check-schema

# Fix missing episodes in Weaviate for a specific user
npm run memory:fix-episodes -- <user-id>

# Test memory retrieval
npm run memory:test -- <user-id> "<query-text>"

# Test episode retrieval
npm run memory:test-episodes -- <user-id>
```

### Database Management

```bash
# Generate Prisma client after schema changes
npx prisma generate

# Create a new migration
npx prisma migrate dev --name add_new_feature

# View database with Prisma Studio
npx prisma studio
```

## Development Workflow

### Running in Development Mode

```bash
# Start the server with hot reload
npm run dev

# Start all components in development mode
npm run start:all
```

### Code Quality Tools

```bash
# Run ESLint
npm run lint

# Run Prettier formatting
npm run format
```

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- tests/services/memoryManager.service.test.js

# Run End-to-End tests
npm run test:e2e
```

## Documentation

All documentation is maintained in the `docs` directory:

- [System Startup Guide](docs/SYSTEM_STARTUP_GUIDE.md) - Basic system startup guide
- [Startup Instructions](docs/STARTUP_INSTRUCTIONS.md) - Detailed application startup/shutdown 
- [Memory System](docs/architecture/MEMORY_SYSTEM.md) - Memory system architecture
- [Coding Standards](docs/architecture/CODING_STANDARDS.md) - Coding standards and best practices
- [Migration Roadmap](docs/migrations/MIGRATION_ROADMAP.md) - Plan for code migrations

## Troubleshooting

If you experience issues with the application:

1. **Messages not being processed**: Ensure the memory processor worker is running (`npm run worker:memory`)
2. **Episodes not being created**: Ensure the episode agent worker is running (`npm run worker:episode`)
3. **Redis connection issues**: Verify Redis is running and accessible
4. **Database connection errors**: Check PostgreSQL is running and connection string is correct
5. **Port conflicts**: See [STARTUP_INSTRUCTIONS.md](./docs/STARTUP_INSTRUCTIONS.md) for resolving port conflicts

For detailed debugging assistance, run the diagnostic scripts in the `scripts/diagnostics/` directory.

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -am 'Add new feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Submit a pull request 