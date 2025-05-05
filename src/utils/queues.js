const { Queue } = require('bullmq');
const { getRedisConfig } = require('./redisConfig'); // Import the function
const logger = require('./logger').childLogger('QueueUtils');

let memoryProcessingQueue = null;
let episodeAgentQueue = null; // Added queue variable

const MEMORY_PROCESSING_QUEUE_NAME = 'memory-processing';
const EPISODE_AGENT_QUEUE_NAME = 'episode-agent-jobs'; // Added queue name

// Shared connection options
let connectionOptions = null;
try {
  connectionOptions = getRedisConfig();
  if (!connectionOptions) {
    throw new Error('Redis configuration is missing or invalid.');
  }
} catch (error) {
  logger.error('Failed to get Redis configuration:', { error });
  // Handle critical failure - perhaps exit?
  process.exit(1); 
}

// Default job options can be shared or specific
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: true,
  removeOnFail: 50, // Keep some failed jobs
};

// Initialize Memory Queue
try {
  memoryProcessingQueue = new Queue(MEMORY_PROCESSING_QUEUE_NAME, {
    connection: connectionOptions,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  logger.info(`BullMQ Queue initialized: ${MEMORY_PROCESSING_QUEUE_NAME}`);
} catch (error) {
  logger.error(`Failed to initialize BullMQ Queue ${MEMORY_PROCESSING_QUEUE_NAME}:`, { error });
  memoryProcessingQueue = null;
}

// Initialize Episode Agent Queue
try {
  episodeAgentQueue = new Queue(EPISODE_AGENT_QUEUE_NAME, {
    connection: connectionOptions,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  logger.info(`BullMQ Queue initialized: ${EPISODE_AGENT_QUEUE_NAME}`);
} catch (error) {
  logger.error(`Failed to initialize BullMQ Queue ${EPISODE_AGENT_QUEUE_NAME}:`, { error });
  episodeAgentQueue = null;
}

function getMemoryQueue() {
  if (!memoryProcessingQueue) {
    logger.warn('Memory processing queue accessed but not initialized!');
  }
  return memoryProcessingQueue;
}

function getEpisodeAgentQueue() {
  if (!episodeAgentQueue) {
      logger.warn('Episode agent queue accessed but not initialized!');
  }
  return episodeAgentQueue;
}

async function addMemoryJob(jobName, data) {
  const queue = getMemoryQueue();
  if (queue) {
    try {
      const job = await queue.add(jobName, data);
      logger.info(`Added job ${jobName} to queue ${MEMORY_PROCESSING_QUEUE_NAME} with ID ${job.id}`);
      return job;
    } catch (error) {
      logger.error(`Failed to add job ${jobName} to queue ${MEMORY_PROCESSING_QUEUE_NAME}:`, { error, jobData: data });
      return null;
    }
  }
  return null;
}

// Added function for the new queue
async function addEpisodeAgentJob(jobName, data, delayMs = 5000) { // Default 5 sec delay
  const queue = getEpisodeAgentQueue();
  if (queue) {
      try {
          // Add job with specific options (including delay)
          const job = await queue.add(jobName, data, { delay: delayMs }); 
          logger.info(`Added job ${jobName} to queue ${EPISODE_AGENT_QUEUE_NAME} with ID ${job.id} (Delay: ${delayMs}ms)`);
          return job;
      } catch (error) {
          logger.error(`Failed to add job ${jobName} to queue ${EPISODE_AGENT_QUEUE_NAME}:`, { error, jobData: data });
          return null;
      }
  }
  return null;
}

// Graceful shutdown for ALL queues
const shutdownQueues = async () => {
  logger.info('Closing BullMQ queues...');
  const promises = [];
  if (memoryProcessingQueue) {
    promises.push(memoryProcessingQueue.close());
  }
  if (episodeAgentQueue) {
    promises.push(episodeAgentQueue.close());
  }
  await Promise.all(promises);
  logger.info('BullMQ queues closed.');
};

process.on('SIGTERM', shutdownQueues);
process.on('SIGINT', shutdownQueues);


module.exports = {
  MEMORY_PROCESSING_QUEUE_NAME,
  EPISODE_AGENT_QUEUE_NAME, // Export new name
  getMemoryQueue,
  getEpisodeAgentQueue, // Export new getter
  addMemoryJob,
  addEpisodeAgentJob, // Export new adder
}; 