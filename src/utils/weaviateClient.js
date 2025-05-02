const weaviateModule = require('weaviate-ts-client');
const weaviate = weaviateModule.default ?? weaviateModule; // Interop-safe loading
const logger = require('./logger').childLogger('WeaviateClient');

let weaviateClient = null;

// Make initializeWeaviate async to allow await for connection check
async function initializeWeaviate() {
  if (weaviateClient) {
    return weaviateClient;
  }

  // Sanitize host input
  const rawHostInput = process.env.WEAVIATE_HOST || 'localhost:8080';
  const host = rawHostInput.replace(/^https?:\/\//, ''); // Remove scheme if present
  const scheme = process.env.WEAVIATE_SCHEME || 'http';
  const apiKey = process.env.WEAVIATE_API_KEY;

  if (!process.env.WEAVIATE_HOST) {
    logger.warn('WEAVIATE_HOST not set, using default localhost:8080');
  } else if (rawHostInput !== host) {
    logger.warn(`WEAVIATE_HOST included scheme, sanitized from '${rawHostInput}' to '${host}'`);
  }

  try {
    const clientConfig = {
      scheme: scheme,
      host: host, // Use sanitized host
    };

    // Only add API key if explicitly provided AND not running locally
    if (apiKey && !host.includes('localhost')) {
        clientConfig.apiKey = apiKey; // Assuming v2 still uses apiKey directly in config
        logger.info('Using Weaviate API Key authentication.');
    } else if (apiKey && host.includes('localhost')){
        logger.info('WEAVIATE_API_KEY is set but target host is localhost. Skipping API key authentication.');
    } else {
        logger.info('No Weaviate API Key found or needed for localhost. Using anonymous access.');
    }

    logger.info(`Initializing Weaviate client with ${scheme}://${host}`);
    
    // Use the .client() factory method from the correctly resolved 'weaviate' object
    weaviateClient = weaviate.client(clientConfig); 
    
    logger.info('Weaviate client instance created.');
    
    // Perform an initial health check with retry
    await checkConnectionWithRetry(weaviateClient); // Use await here

    return weaviateClient;

  } catch (error) {
    logger.error(`Failed to initialize Weaviate client: ${error.message || error}`, { error });
    weaviateClient = null;
    return null;
  }
}

// Renamed original checkConnection and added retry logic
async function checkConnectionWithRetry(client, retries = 5, delay = 1000) {
    if (!client) return false;
    // Extract host/scheme safely for logging, using the config attached by the client itself if possible
    const connectionDetails = { 
      host: client.host || 'unknown', // v2 might store config differently, adjust if needed
      scheme: client.scheme || 'unknown' 
    };

    for (let i = 0; i < retries; i++) {
        try {
            // Use client.misc.liveChecker().do() for a lightweight liveness check in v2 if metaGetter fails often
            // Sticking with metaGetter for version info as requested previously.
            const meta = await client.misc.metaGetter().do();
            if (meta && meta.version) {
                logger.info(`Successfully connected to Weaviate v${meta.version} after ${i} retries.`);
                return true;
            } else {
                logger.warn(`Connected to Weaviate, but received unexpected meta response (attempt ${i + 1}/${retries}). Meta: ${JSON.stringify(meta)}`);
                // Treat unexpected but non-error response as potential success or retry
            }
        } catch (error) {
            const isLastRetry = i === retries - 1;
            const logFn = isLastRetry ? logger.error : logger.warn;
            logFn(`Failed to connect to Weaviate (attempt ${i + 1}/${retries}): ${error.message}`, { connectionDetails });

            if (isLastRetry) {
                logger.error(`Failed to connect to Weaviate after ${retries} attempts.`, { error });
                 if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout') || error.message.includes('503')) {
                   logger.error('Weaviate server appears unreachable or not ready. Please ensure it is running and accessible.');
                 }
                return false; // Failed after all retries
            }
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i))); 
        }
    }
    // Should technically not be reached if retries > 0
    logger.error('Connection check loop completed without success or definitive failure after retries.'); 
    return false; 
 }

// Initialize on load - Now async
(async () => {
  try {
    await initializeWeaviate();
    logger.info('Async Weaviate initialization process completed.');
  } catch (error) {
    logger.error(`Error during async Weaviate initialization: ${error.message}`, { error });
  }
})();


module.exports = {
    getClient: () => weaviateClient, // Function to get the current client instance
    // Exported checkConnection now uses the retry logic
    checkConnection: () => checkConnectionWithRetry(weaviateClient) 
}; 