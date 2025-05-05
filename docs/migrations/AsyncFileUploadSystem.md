# Asynchronous File Upload System

## Overview

The asynchronous file upload system enables non-blocking processing of file uploads by decoupling the initial upload request from the processing pipeline. This system implements a job queue architecture using BullMQ and Redis, allowing the API to respond quickly to client requests while handling resource-intensive operations like document parsing, AI analysis, and memory processing in the background.

## Architecture

### Components

- **API Endpoints**: Dedicated REST endpoints for async upload and status checking
- **Job Queue**: BullMQ queue for managing upload processing tasks
- **Worker Process**: Background worker that consumes jobs from the queue
- **Database Schema**: `FileUploadJob` model for tracking job status and results
- **Redis**: Used by BullMQ for job persistence and queue management

### Data Flow

1. Client uploads a file to the async endpoint (`/api/chat/upload/async`)
2. API creates a job record in the database with status "pending" and returns a job ID
3. API adds the job to the BullMQ queue
4. Client can poll for job status using the status endpoint (`/api/chat/upload/status/:jobId`)
5. Worker process picks up the job and processes the file (parsing, AI analysis, memory storage)
6. Worker updates the job status in the database upon completion or failure
7. Client retrieves the final result via the status endpoint

## API Endpoints

### Async File Upload

```
POST /api/chat/upload/async
```

**Request:**
- `file`: The file to upload (multipart/form-data)
- `session_id`: Chat session identifier
- `message` (optional): Accompanying text message

**Response:**
```json
{
  "success": true,
  "data": {
    "jobId": "job_1234567890",
    "status": "pending"
  }
}
```

### Job Status Check

```
GET /api/chat/upload/status/:jobId
```

**Response (in progress):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_1234567890",
    "status": "processing"
  }
}
```

**Response (completed):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_1234567890",
    "status": "completed",
    "result": {
      "aiResponse": {
        "text": "Analysis of your document shows..."
      },
      "fileId": "file_1234567890"
    }
  }
}
```

**Response (failed):**
```json
{
  "success": true,
  "data": {
    "jobId": "job_1234567890",
    "status": "failed",
    "error": "Invalid file format"
  }
}
```

## Database Schema

The system uses a `FileUploadJob` model in the Prisma schema:

```prisma
model FileUploadJob {
  id            String    @id @default(uuid())
  userId        String
  sessionId     String
  status        String    // "pending", "processing", "completed", "failed"
  fileId        String?   // ID of the uploaded file once processed
  result        Json?     // AI analysis result and other metadata
  error         String?   // Error message if job failed
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

## Job Queue Implementation

The system uses `bullmq` for job queue management:

```javascript
// src/utils/queues.js
const { Queue } = require('bullmq');
const redisConfig = require('./redisConfig');

// Create queue for async file uploads
const fileUploadQueue = new Queue('file-upload', {
  connection: redisConfig.getRedisConfig(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: 1000,
    removeOnFail: 1000
  }
});

module.exports = { fileUploadQueue };
```

## Worker Implementation

The file upload worker processes jobs from the queue:

```javascript
// src/workers/fileProcessor.worker.js
const { Worker } = require('bullmq');
const redisConfig = require('../utils/redisConfig');
const fileUploadService = require('../services/fileUpload.service');
const logger = require('../utils/logger');

const fileUploadWorker = new Worker('file-upload', async (job) => {
  logger.info(`Processing file upload job ${job.id}`);
  
  try {
    // Update job status to "processing"
    await updateJobStatus(job.data.jobId, 'processing');
    
    // Process the file using existing service
    const result = await fileUploadService.processFile(job.data);
    
    // Update job with completed status and result
    await updateJobStatus(job.data.jobId, 'completed', result);
    
    return result;
  } catch (error) {
    logger.error(`Error processing file upload job ${job.id}: ${error.message}`);
    
    // Update job with failed status and error
    await updateJobStatus(job.data.jobId, 'failed', null, error.message);
    
    throw error;
  }
}, {
  connection: redisConfig.getRedisConfig(),
  concurrency: 2  // Limit concurrent file processing jobs
});

// Helper function to update job status in database
async function updateJobStatus(jobId, status, result = null, error = null) {
  // Implementation details...
}

module.exports = fileUploadWorker;
```

## Configuration Requirements

### Environment Variables

The system requires the following environment variables:

```
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional_password
```

### Redis Configuration

Redis must be configured with persistence to prevent job loss during restarts:

```
appendonly yes
appendfsync everysec
```

## Client Integration

### Frontend Implementation

Example of how to use the async upload API from the frontend:

```javascript
// Example using fetch API
async function uploadFileAsync(file, sessionId, message = '') {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('session_id', sessionId);
  if (message) formData.append('message', message);
  
  try {
    // Start the upload
    const uploadResponse = await fetch('/api/chat/upload/async', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: formData
    });
    
    const data = await uploadResponse.json();
    if (!data.success) throw new Error(data.error?.message || 'Upload failed');
    
    const jobId = data.data.jobId;
    
    // Start polling for status
    return pollJobStatus(jobId);
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

// Poll for job status
async function pollJobStatus(jobId, maxAttempts = 60, interval = 2000) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/chat/upload/status/${jobId}`, {
          headers: {
            'Authorization': `Bearer ${getAuthToken()}`
          }
        });
        
        const data = await response.json();
        if (!data.success) throw new Error(data.error?.message || 'Status check failed');
        
        // Check if job is complete
        if (data.data.status === 'completed') {
          return resolve(data.data.result);
        }
        
        // Check if job failed
        if (data.data.status === 'failed') {
          return reject(new Error(data.data.error || 'Job processing failed'));
        }
        
        // Continue polling if still in progress
        attempts++;
        if (attempts >= maxAttempts) {
          return reject(new Error('Job processing timeout'));
        }
        
        setTimeout(checkStatus, interval);
      } catch (error) {
        reject(error);
      }
    };
    
    // Start polling
    checkStatus();
  });
}
```

## Error Handling

The system implements several layers of error handling:

1. **API Validation**: Input validation at the REST API level
2. **Job Queue Retries**: Automatic retries with exponential backoff for transient failures
3. **Dead-Letter Queue**: Failed jobs after max retries are stored for analysis
4. **Client-Side Error Recovery**: Frontend polling with timeout and appropriate user feedback

## Monitoring & Maintenance

### Queue Monitoring

The production environment should include monitoring for:
- Queue lengths
- Job processing times
- Failure rates
- Worker health

### Cleanup Tasks

The system automatically cleans up:
- Completed jobs (after 1000 jobs)
- Failed jobs (after 1000 jobs)
- Temporary files (after processing)

## Future Enhancements

Potential improvements for future development:

1. **WebSocket Notifications**: Replace polling with push notifications when jobs complete
2. **Progress Updates**: More granular progress reporting for large file processing
3. **Priority Queues**: Add job priorities for different file types or user tiers
4. **Rate Limiting**: Implement per-user rate limiting for upload requests
5. **Cross-Upload References**: Enable referencing other uploaded files in analysis 