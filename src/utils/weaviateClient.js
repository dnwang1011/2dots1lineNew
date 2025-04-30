const weaviateImport = require('weaviate-ts-client');
const weaviate = weaviateImport.default;
const logger = require('./logger').childLogger('WeaviateClient');

let weaviateClient = null;

function initializeWeaviate() {
  if (weaviateClient) {
    return weaviateClient;
  }

  const host = process.env.WEAVIATE_HOST || 'localhost:8080';
  const scheme = process.env.WEAVIATE_SCHEME || 'http';
  const apiKey = process.env.WEAVIATE_API_KEY;

  if (!process.env.WEAVIATE_HOST) {
    logger.warn('WEAVIATE_HOST not set, using default localhost:8080');
  }

  try {
    const clientConfig = { scheme, host };

    // Only add API key if explicitly provided AND not running locally
    if (apiKey && !host.includes('localhost')) {
        // Check if weaviateImport.ApiKey exists and is a constructor
        if (typeof weaviateImport.ApiKey === 'function') {
            clientConfig.apiKey = new weaviateImport.ApiKey(apiKey);
            logger.info('Using Weaviate API Key authentication.');
        } else {
            logger.warn('Weaviate API Key provided, but weaviate.ApiKey constructor not found. Skipping API key auth.');
        }
    } else if (apiKey && host.includes('localhost')){
        logger.info('WEAVIATE_API_KEY is set but target host is localhost. Skipping API key authentication.');
    } else {
        logger.info('No Weaviate API Key found or needed for localhost. Using anonymous access.');
    }

    logger.info(`Initializing Weaviate client with ${scheme}://${host}`);
    weaviateClient = weaviate.client(clientConfig);
    logger.info('Weaviate client instance created.');
    
    // Perform an initial health check
    checkConnection(weaviateClient);

    return weaviateClient;

  } catch (error) {
    logger.error('Failed to initialize Weaviate client:', { error });
    weaviateClient = null;
    return null;
  }
}

async function checkConnection(client) {
   if (!client) return false;
   try {
     const meta = await client.misc.metaGetter().do();
     if (meta && meta.version) {
       logger.info(`Successfully connected to Weaviate v${meta.version}.`);
       return true;
     } else {
       logger.warn('Connected to Weaviate, but received unexpected meta response.');
       return false;
     }
   } catch (error) {
     logger.error(`Failed to connect to Weaviate: ${error.message}`, {
       error,
       connectionDetails: { host: client.host, scheme: client.scheme }
     });
     if (error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
       logger.error('Weaviate server appears unreachable. Please ensure it is running and accessible.');
     }
     return false;
   }
 }

// Initialize on load
initializeWeaviate();

module.exports = {
    getClient: () => weaviateClient, // Function to get the current client instance
    checkConnection: () => checkConnection(weaviateClient) // Function to check the current client
}; 