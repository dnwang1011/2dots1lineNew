// config/queue.config.js
// Configuration for BullMQ queues and processing parameters

module.exports = {
  // Queue names
  queues: {
    orphanChunks: process.env.ORPHAN_QUEUE_NAME || 'orphan-chunks',
    importanceEval: process.env.IMPORTANCE_QUEUE_NAME || 'importance-eval',
    episodeProcessing: process.env.EPISODE_QUEUE_NAME || 'episode-processing',
    thoughtGeneration: process.env.THOUGHT_QUEUE_NAME || 'thought-generation',
    documentProcessing: process.env.DOCUMENT_QUEUE_NAME || 'document-processing',
  },
  
  // Queue processing settings
  concurrency: {
    orphanChunks: parseInt(process.env.ORPHAN_QUEUE_CONCURRENCY, 10) || 2,
    importanceEval: parseInt(process.env.IMPORTANCE_QUEUE_CONCURRENCY, 10) || 3,
    episodeProcessing: parseInt(process.env.EPISODE_QUEUE_CONCURRENCY, 10) || 2,
    thoughtGeneration: parseInt(process.env.THOUGHT_QUEUE_CONCURRENCY, 10) || 1,
    documentProcessing: parseInt(process.env.DOCUMENT_QUEUE_CONCURRENCY, 10) || 2,
  },
  
  // Retry settings
  retryStrategy: {
    maxAttempts: parseInt(process.env.QUEUE_MAX_ATTEMPTS, 10) || 3,
    backoff: {
      type: 'exponential',
      delay: parseInt(process.env.QUEUE_RETRY_DELAY_MS, 10) || 5000, // 5 seconds
    },
  },
  
  // Job settings
  jobSettings: {
    removeOnComplete: parseInt(process.env.REMOVE_COMPLETED_JOBS, 10) || 1000, // Keep last 1000 completed jobs
    removeOnFail: parseInt(process.env.REMOVE_FAILED_JOBS, 10) || 5000, // Keep last 5000 failed jobs
  },
}; 