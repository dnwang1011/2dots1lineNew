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

#### Redis
```bash
# If using Docker
docker stop redis
docker rm redis

# If running locally
redis-cli shutdown
```

#### Weaviate
```bash
# If using Docker
docker stop weaviate
docker rm weaviate
```

## Resolving Port Conflicts

The application uses the following ports by default:
- Main server: 3002
- PostgreSQL: 5432
- Redis: 6379
- Weaviate: 8080

If you encounter port conflicts:

### Check for Processes Using a Port

```bash
# macOS/Linux
lsof -i :PORT_NUMBER

# Windows
netstat -ano | findstr :PORT_NUMBER
```

### Kill Process Using a Port

```bash
# Find the PID using the port
lsof -i :3002

# Kill the process
kill -9 <PID>
```

### Changing Application Port

To use a different port for the main server, modify the environment variable:

```bash
# In .env file
PORT=3003

# Or when starting the application
PORT=3003 npm start
```

## Common Issues

1. **Messages recorded but not processed**: If you see messages in the UI but no importance scores or episodes being created, it likely means the Memory Processor Worker is not running.

2. **No episodes being created**: If chunks are being created but no episodes, check if the Episode Agent Worker is running.

3. **Redis connection issues**: Both workers require Redis to be running. Make sure Redis is installed and configured properly.

4. **Weaviate connection issues**: The vector database needs to be running for memory and episode retrieval.

5. **Database connection errors**: Check that PostgreSQL is running and the connection string in your `.env` file is correct.

## Monitoring

You can monitor the application components:

```bash
# Check all running node processes
ps aux | grep node

# View logs
npm run memory:monitor

# Check Docker containers
docker ps
```

## Data Persistence and Backups

To back up your data:

```bash
# Back up the application
npm run backup

# Back up PostgreSQL data
pg_dump -U postgres mydatabase > backup.sql

# Back up Weaviate data
# Weaviate data is stored in the Docker volume, back up the volume
``` 
### Check if All Processes are Running

```bash
ps aux | grep 'node src/' | grep -v grep
```

You should see three processes (main app, memory worker, episode worker).

### Check Application Logs

To see the main application logs:

```bash
tail -n 50 app.log
```

To see memory processing logs:

```bash
tail -n 50 memory-worker.log
```

To see episode agent logs:

```bash
tail -n 50 episode-worker.log
```

## Complete System Restart

If you need to restart everything:

```bash
# Stop node processes
pkill -f "node src/"

# Stop Redis
redis-cli shutdown

# Restart Docker containers
docker-compose down
docker-compose up -d

# Wait for 30 seconds
echo "Waiting 30 seconds for Docker containers to initialize..."
sleep 30

# Start Redis
redis-server &

# Start the application components
node src/index.js > app.log 2>&1 &
node src/workers/memoryProcessor.worker.js > memory-worker.log 2>&1 &
node src/workers/episodeAgent.worker.js > episode-worker.log 2>&1 &

# Check if everything is running
echo "Checking if all processes are running..."
ps aux | grep 'node src/' | grep -v grep
```

## Troubleshooting

If the system isn't working correctly:

1. Check all logs for errors
2. Make sure all Docker containers are running with `docker ps`
3. Make sure Redis is running with `redis-cli ping` (should return "PONG")
4. Restart the components in the correct order as described above 