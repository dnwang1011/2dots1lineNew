// Load environment variables
require('dotenv').config();

// Import the Redis config utility
const { getRedisConfig } = require('./src/utils/redisConfig');

// Log environment variables
console.log('Environment Variables:');
console.log('REDIS_HOST:', process.env.REDIS_HOST);
console.log('REDIS_PORT:', process.env.REDIS_PORT);

// Get Redis config
const redisConfig = getRedisConfig();
console.log('\nRedis Config Result:');
console.log(redisConfig); 