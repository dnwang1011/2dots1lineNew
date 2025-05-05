#!/bin/bash

echo "Starting 2dots1line application..."

# Start the main server
node src/index.js &
MAIN_PID=$!
echo "Main server started with PID: $MAIN_PID"

# Give the main server a moment to initialize
sleep 2

# Start the memory processor worker
node src/workers/memoryProcessor.worker.js &
MEMORY_PID=$!
echo "Memory processor worker started with PID: $MEMORY_PID"

# Start the episode agent worker
node src/workers/episodeAgent.worker.js &
EPISODE_PID=$!
echo "Episode agent worker started with PID: $EPISODE_PID"

echo "All components started successfully!"
echo "Use Ctrl+C to stop all processes"

# Handle shutdown gracefully
trap "kill $MAIN_PID $MEMORY_PID $EPISODE_PID; exit" INT TERM EXIT

# Wait for all background processes
wait 