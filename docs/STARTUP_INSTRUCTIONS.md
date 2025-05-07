# 2dots1line Application Startup Guide

## Application Architecture

The 2dots1line application consists of three main components:

1. **Main Server** (`src/index.js`): Handles API requests, user interfaces, and coordinates the system
2. **Memory Processor Worker** (`src/workers/memoryProcessor.worker.js`): Processes raw data (user and AI messages) into structured memories with importance scores
3. **Episode Agent Worker** (`src/workers/episodeAgent.worker.js`): Creates narrative episodes from processed chunks

All three components must be running simultaneously for the application to function properly. If any component is missing, parts of the functionality will fail.

## Dependencies

The application relies on several external services:

1. **PostgreSQL**: Relational database (used by Prisma)
2. **Redis**: Queue system for memory processing and episode generation
3. **Weaviate**: Vector database for storing and retrieving embeddings

These must be started before running the application.

## Starting Dependencies

### Prerequisite: Start Docker

Before proceeding, ensure Docker is running on your system. Follow these steps:

1. **Open Docker**:
   - On macOS, open the Docker application from your Applications folder or search for "Docker" in Spotlight.
   - Wait for Docker to fully start. You should see the Docker icon in the menu bar.

2. **Verify Docker is Running**:
   - Open a terminal and run:
     ```bash
     docker ps
     ```
   - If Docker is running, this command will list any active containers. If Docker is not running, you'll see an error message.

3. **Proceed with Starting Dependencies**:
   - Once Docker is running, you can continue with the instructions below.

### Option 1: Using Docker Compose (Recommended)

If you have a `docker-compose.yml` file, start all dependencies with:

```bash
docker-compose up -d
```

### Option 2: Starting Services Individually

#### PostgreSQL
```bash
# Using Docker
docker run --name postgres -e POSTGRES_PASSWORD=yourpassword -p 5432:5432 -d postgres

# Alternatively, if installed locally
pg_ctl -D /usr/local/var/postgres start
```

#### Redis
```bash
# Using Docker
docker run --name redis -p 6379:6379 -d redis

# Alternatively, if installed locally
redis-server
```

#### Weaviate
```bash
# Using Docker
docker run -d --name weaviate -p 8080:8080 \
  -e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true \
  -e PERSISTENCE_DATA_PATH="/var/lib/weaviate" \
  -e DEFAULT_VECTORIZER_MODULE="none" \
  -e ENABLE_MODULES="" \
  -e CLUSTER_HOSTNAME="node1" \
  semitechnologies/weaviate:1.22.5
```

### Prisma Setup

After PostgreSQL is running:

```bash
# Generate Prisma client
npx prisma generate

# Apply migrations (if needed)
npx prisma migrate dev

# Seed database (if needed)
npx prisma db seed
```

## Starting the Application

### Option 1: Use the convenience script (recommended)

```bash
npm run start:all
```

This will start all three components in the correct order with a single command. Use Ctrl+C to stop all processes.

### Option 2: Start components individually

You'll need to open three separate terminal windows:

```bash
# Terminal 1 - Main Server
npm start

# Terminal 2 - Memory Processor Worker
npm run worker:memory

# Terminal 3 - Episode Agent Worker
npm run worker:episode
```

### Option 3: Run the shell script directly

```bash
./start.sh
```

## Terminating the Application

### Stopping Components Started with start:all

When using `npm run start:all` or `./start.sh`, simply press **Ctrl+C** in the terminal where you ran the command. The trap handler in the script will catch the interrupt signal and kill all three Node.js processes.

### Finding and Killing Specific Processes

If Ctrl+C doesn't work or you need to forcefully terminate processes:

```bash
# Find all node processes
ps aux | grep node

# Kill specific process by PID
kill <PID>

# Kill all node processes (use with caution)
pkill -f node
```

## Stopping Dependencies

### Option 1: Using Docker Compose

If using docker-compose:

```bash
docker-compose down
```

### Option 2: Stopping Individual Services

#### PostgreSQL
```bash
# If using Docker
docker stop postgres
docker rm postgres

# If running locally
pg_ctl -D /usr/local/var/postgres stop
```