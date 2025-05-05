// Script to monitor the episode-agent-jobs queue
const { QueueEvents } = require('bullmq');

// Hardcode Redis config for testing
const redisConnection = {
  host: 'localhost',
  port: 6379
};

console.log('Monitoring episode-agent-jobs queue...');
console.log('Press Ctrl+C to exit');

// Create a QueueEvents instance
const queueEvents = new QueueEvents('episode-agent-jobs', {
  connection: redisConnection
});

// Listen for job completion events
queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed with result:`, returnvalue);
});

// Listen for job failure events
queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.log(`Job ${jobId} failed with reason:`, failedReason);
});

// Listen for job progress events
queueEvents.on('progress', ({ jobId, data }) => {
  console.log(`Job ${jobId} reported progress:`, data);
});

// Listen for job added events
queueEvents.on('added', ({ jobId, name }) => {
  console.log(`Job ${jobId} (${name}) added to queue`);
});

// Listen for job active events
queueEvents.on('active', ({ jobId, prev }) => {
  console.log(`Job ${jobId} is now active (prev state: ${prev})`);
});

// Keep the process running
process.on('SIGINT', async () => {
  console.log('\nClosing queue event listener...');
  await queueEvents.close();
  console.log('Queue event listener closed.');
  process.exit(0);
}); 