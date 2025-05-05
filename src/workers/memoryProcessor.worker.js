// Load environment variables first
require('dotenv').config();

const { Worker } = require('bullmq');
const logger = require('../utils/logger').childLogger('MemoryWorker');
const { getRedisConfig } = require('../utils/redisConfig'); 
const { MEMORY_PROCESSING_QUEUE_NAME } = require('../utils/queues');
const memoryManager = require('../services/memoryManager.service');
const rawDataRepository = require('../repositories/rawData.repository'); 
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fileUploadService = require('../services/fileUpload.service');
const fs = require('fs');
const { handleServiceError } = require('../utils/errorHandler');

// Verify environment variables are loaded correctly
if (!process.env.REDIS_HOST) {
  logger.error('Critical environment variable REDIS_HOST is missing. Ensure .env file is properly configured.');
  process.exit(1);
}

// Get Redis connection configuration
const redisConnection = getRedisConfig();

if (!redisConnection) {
  logger.error('Redis connection not configured. Memory Worker cannot start.');
  process.exit(1); // Exit if Redis is not configured
}

// --- Job Processing Logic ---
const processJob = async (job) => {
  logger.info(`Processing job ${job.id} of type ${job.name}...`, { jobData: job.data });

  // Process different job types
  switch(job.name) {
    case 'processRawData':
      return await processRawDataJob(job);
    case 'processFileUpload':
      return await processFileUploadJob(job);
    default:
      logger.warn(`Unknown job type "${job.name}" received.`);
      return { status: 'skipped', reason: 'unknown job type' };
  }
};

// Process raw data (original implementation)
const processRawDataJob = async (job) => {
  const { rawDataId } = job.data;
  logger.info(`Processing rawData job ${job.id} for rawDataId: ${rawDataId}...`);

  if (!rawDataId) {
    throw new Error(`Job ${job.id} received without rawDataId.`);
  }

  try {
    // Fetch the full RawData record using the ID
    const results = await rawDataRepository.findMany({
      where: { id: rawDataId },
      take: 1,
    });
    const rawDataRecord = results.length > 0 ? results[0] : null;

    if (!rawDataRecord) {
      // If the record doesn't exist (maybe deleted?), log and consider the job done.
      logger.warn(`RawData record ${rawDataId} not found for job ${job.id}. Skipping processing.`);
      return { status: 'skipped', reason: 'rawData not found' };
    }

    // Call the actual memory processing pipeline
    await memoryManager.processMemoryPipeline(rawDataRecord);

    logger.info(`Successfully processed rawData job ${job.id} for rawDataId: ${rawDataId}`);
    return { status: 'completed' }; // Indicate success

  } catch (error) {
    // Use handleServiceError to ensure consistent logging/formatting
    // Pass the job details for context
    const serviceError = handleServiceError(error, `MemoryWorker processRawDataJob ${job.id}`, { rawDataId });
    logger.error(`Error processing job ${job.id} for rawDataId ${rawDataId}: ${serviceError.message}`, {
        jobId: job.id,
        jobName: job.name,
        rawDataId: rawDataId,
        error: serviceError.originalError || serviceError.message,
        stack: serviceError.stack,
    });
    // Rethrow the original or wrapped error to let BullMQ handle retries/failure
    throw serviceError.originalError || serviceError; 
  }
};

// Process file upload job
const processFileUploadJob = async (job) => {
  const { jobId, userId, sessionId, message, filePath, originalname, mimetype, size } = job.data;
  logger.info(`Processing fileUpload job ${job.id} for jobId: ${jobId}...`);

  if (!jobId || !userId || !sessionId || !filePath) {
    throw new Error(`Job ${job.id} received with missing required fields.`);
  }

  try {
    // Update job status to PROCESSING
    await prisma.fileUploadJob.update({
      where: { id: jobId },
      data: { 
        status: 'PROCESSING',
        startedAt: new Date()
      }
    });

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found at path: ${filePath}`);
    }

    // Create a file object similar to what multer would provide
    const file = {
      path: filePath,
      originalname,
      mimetype,
      size
    };

    // Process the file using the existing service
    logger.info(`Processing file ${originalname} for job ${jobId}`);
    const result = await fileUploadService.processUploadedFile(
      userId,
      sessionId,
      file,
      message
    );

    // Check success
    if (!result.success) {
      throw new Error(result.message || 'File processing failed');
    }

    // Update job as completed
    await prisma.fileUploadJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        resultData: {
          analysisText: result.message,
          rawDataIds: {
            fileEventId: result.fileEventRawDataId,
            analysisId: result.analysisRawDataId
          }
        }
      }
    });

    // Clean up the file now that we're done with it
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) {
        logger.error(`Error cleaning up processed file: ${unlinkErr.message}`, { filePath });
      } else {
        logger.info(`Successfully cleaned up processed file`, { filePath });
      }
    });

    logger.info(`Successfully processed fileUpload job ${job.id} for jobId: ${jobId}`);
    return { status: 'completed', resultData: result };

  } catch (error) {
    // Handle error and update job
    const serviceError = handleServiceError(error, `MemoryWorker processFileUploadJob ${job.id}`, { jobId });
    logger.error(`Error processing fileUpload job ${job.id} for jobId ${jobId}: ${serviceError.message}`, {
      jobId: job.id,
      uploadJobId: jobId,
      error: serviceError.originalError || serviceError.message,
      stack: serviceError.stack,
    });

    try {
      // Update job as failed
      await prisma.fileUploadJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: serviceError.message
        }
      });

      // Clean up the file on error
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            logger.error(`Error cleaning up file after processing error: ${unlinkErr.message}`, { filePath });
          }
        });
      }
    } catch (updateErr) {
      logger.error(`Error updating job status to FAILED: ${updateErr.message}`, { jobId });
    }

    // Rethrow the error to let BullMQ handle retries
    throw serviceError.originalError || serviceError;
  }
};

// --- Worker Initialization ---
logger.info(`Initializing Memory Worker for queue: ${MEMORY_PROCESSING_QUEUE_NAME}`);

const worker = new Worker(MEMORY_PROCESSING_QUEUE_NAME, processJob, {
  connection: redisConnection,
  concurrency: 5, // Process up to 5 jobs concurrently (adjust as needed)
  limiter: {      // Optional: Rate limit jobs per duration
    max: 100,     // Max 100 jobs
    duration: 1000, // per 1000ms (1 second)
  },
});

// --- Worker Event Listeners ---
worker.on('completed', (job, result) => {
  logger.info(`Job ${job.id} completed`, { result });
});

worker.on('failed', (job, err) => {
  // Error is already logged within processJob, but log the failure event itself
  logger.error(`Job ${job.id} failed after ${job.attemptsMade} attempts`, {
    error: err.message,
    stack: err.stack,
    jobData: job.data,
   });
  // Potentially add alerting here (e.g., PagerDuty, Slack)
});

worker.on('error', err => {
  // Handles errors like Redis connection issues
  logger.error('Worker encountered an error', { error: err.message, stack: err.stack });
});

logger.info('Memory Worker started and listening for jobs...');

// --- Graceful Shutdown ---
const gracefulShutdown = async () => {
  logger.info('Shutting down Memory Worker...');
  await worker.close();
  logger.info('Memory Worker closed.');
  process.exit(0);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown); 