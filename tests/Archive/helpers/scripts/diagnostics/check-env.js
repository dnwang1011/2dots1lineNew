// Load environment variables
require('dotenv').config();

// Print environment variables relevant to Redis
console.log('Environment Variables Check:');
console.log('---------------------------');
console.log('REDIS_HOST:', process.env.REDIS_HOST);
console.log('REDIS_PORT:', process.env.REDIS_PORT);
console.log('---------------------------');

// Check if dotenv is finding the .env file
console.log('Dotenv config path:', require.cache[require.resolve('dotenv')]?.exports?.path || 'Not found'); 