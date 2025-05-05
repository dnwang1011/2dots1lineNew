// src/workers/episodeAgent.worker.js
// Worker for processing chunks and linking them to episodes

const { Worker } = require('bullmq');
const redisConfig = require('../utils/redisConfig');
const logger = require('../utils/logger').childLogger('EpisodeAgent');

// Explicitly clear module cache for episodeAgent to ensure we load the latest version
const episodeAgentPath = require.resolve('../services/episodeAgent');
if (require.cache[episodeAgentPath]) {
  delete require.cache[episodeAgentPath];
  logger.info(`[EpisodeAgent] Cleared module cache for episodeAgent at ${episodeAgentPath}`);
}

// Now load the module fresh
const episodeAgent = require('../services/episodeAgent');

// Add version tracking for debugging
const VERSION = '2.0-GraphQL';
logger.info(`[EpisodeAgent] Worker version ${VERSION} initialized`);

// Queue configuration
const QUEUE_NAME = 'episode-agent-jobs';

// Initialize the worker
async function initializeWorker() {
  logger.info(`Initializing Episode Agent Worker (${VERSION}) for queue: ${QUEUE_NAME}`);
  
  // Get Redis configuration
  const redisConnection = redisConfig.getRedisConfig();
  if (!redisConnection) {
    logger.error('Redis configuration missing or invalid. Worker initialization failed.');
    process.exit(1);
  }

  // Worker options
  const workerOpts = {
    connection: redisConnection,
    concurrency: 5,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 50 // Keep 50 failed jobs for debugging
    }
  };

  logger.info('Episode Agent Worker effective options: ' + JSON.stringify({ opts: workerOpts }));

  // Create the worker
  const worker = new Worker(QUEUE_NAME, async (job) => {
    // Process the job
    const { chunkId, userId } = job.data;
    logger.info(`[EpisodeAgent] Processing chunk ${chunkId} for user ${userId} (worker version: ${VERSION})`);
    
    try {
      // Verify episodeAgent has the correct implementation
      if (typeof episodeAgent.processChunk !== 'function') {
        throw new Error('Invalid episodeAgent module: processChunk function not found');
      }
      
      // Double-check that we're using the GraphQL implementation
      if (!episodeAgent.useGraphQL) {
        logger.warn('[EpisodeAgent] WARNING: episodeAgent may not be using GraphQL implementation!');
      }
      
      // Call the episodeAgent service to process the chunk
      await episodeAgent.processChunk(chunkId, userId);
    } catch (error) {
      logger.error(`[EpisodeAgent] Error processing chunk ${chunkId}:`, { error });
      // Re-throw to trigger BullMQ retry mechanism
      throw error;
    }
    
    return { status: 'completed' };
  }, workerOpts);

  // Event handlers
  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed`, { result: job.returnvalue });
  });

  worker.on('failed', (job, err) => {
    logger.error(`!!! JOB FAILED EVENT TRIGGERED !!! Job ${job.id} (Name: ${job.name}, Attempts: ${job.attemptsMade}) failed permanently or after retries.`, {
      error_message: err.message,
      error_stack: err.stack,
      job_data: job.data,
      job_failed_reason: job.failedReason
    });
  });

  logger.info(`Episode Agent Worker (${VERSION}) started and listening for jobs...`);
  
  return worker;
}

// Handle graceful shutdown
let worker = null;
async function shutdown() {
  logger.info('Shutting down Episode Agent Worker...');
  
  try {
    logger.info('Closing BullMQ queues...');
    if (worker) {
      await worker.close();
    }
    
    logger.info('BullMQ queues closed.');
    
    // Call the episodeAgent shutdown function
    await episodeAgent.shutdown();
    
    logger.info('Episode Agent Worker shutdown complete.');
  } catch (error) {
    logger.error('Error during Episode Agent Worker shutdown:', { error });
  }
}

// Handle process signals for graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Initiating graceful shutdown...');
  await shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received. Initiating graceful shutdown...');
  await shutdown();
  process.exit(0);
});

// Start the worker
(async () => {
  try {
    worker = await initializeWorker();
  } catch (error) {
    logger.error('Failed to initialize Episode Agent Worker:', { error });
    process.exit(1);
  }
})(); 