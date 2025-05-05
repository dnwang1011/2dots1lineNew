// Test script to directly create a job in the episode agent queue
const { Queue } = require('bullmq');
const uuidv4 = require('uuid').v4;

// Hardcode Redis config for testing
const redisConnection = {
  host: 'localhost',
  port: 6379
};

console.log('Using Redis connection:', redisConnection);

// Create queue instance
const queue = new Queue('episode-agent-jobs', {
  connection: redisConnection
});

async function addTestJob() {
  try {
    // Generate a random chunk ID for testing
    const testChunkId = uuidv4();
    const userId = 'd9fe3dbe-bc25-4040-ac00-a835d418c5b4'; // Use the existing user ID from logs

    console.log(`Adding test job for chunk ID: ${testChunkId}`);
    
    // Add job to queue
    const job = await queue.add('processChunkForEpisode', {
      chunkId: testChunkId,
      userId: userId
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    });
    
    console.log(`Job added to episode-agent-jobs queue with ID: ${job.id}`);
  } catch (error) {
    console.error('Error adding job to queue:', error);
  } finally {
    // Close queue connection
    await queue.close();
    console.log('Queue connection closed');
  }
}

// Run the test
addTestJob().catch(console.error); 