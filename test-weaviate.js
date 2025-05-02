// test-weaviate.js
// Simple script to test Weaviate class creation

require('dotenv').config();
const weaviate = require('weaviate-ts-client').default;

// Initialize Weaviate client
const host = process.env.WEAVIATE_HOST || 'localhost:8080';
const scheme = process.env.WEAVIATE_SCHEME || 'http';
console.log(`Connecting to Weaviate at ${scheme}://${host}`);

const client = weaviate.client({
  scheme,
  host,
});

// Test connection
async function runTest() {
  try {
    console.log('Testing Weaviate connection...');
    const meta = await client.misc.metaGetter().do();
    console.log(`Connected to Weaviate v${meta.version}`);
    
    // Get schema
    const schema = await client.schema.getter().do();
    console.log('Current schema classes:', schema.classes ? schema.classes.map(c => c.class).join(', ') : 'none');
    
    // Check if ChunkEmbedding exists
    const existingClass = schema.classes?.find(c => c.class === 'ChunkEmbedding');
    if (existingClass) {
      console.log('ChunkEmbedding already exists, deleting it first');
      await client.schema.classDeleter().withClassName('ChunkEmbedding').do();
      console.log('ChunkEmbedding deleted');
    }
    
    console.log('Creating ChunkEmbedding class...');
    const classObj = {
      class: 'ChunkEmbedding',
      description: 'A memory chunk with its embedding vector',
      vectorizer: 'none',
      vectorIndexType: 'hnsw',
      vectorIndexConfig: {
        distance: 'cosine'
      },
      properties: [
        {
          name: 'dbId',
          description: 'ID of the ChunkEmbedding in the database',
          dataType: ['text'],
        },
        {
          name: 'text',
          description: 'The full text content of the chunk',
          dataType: ['text'],
        },
        {
          name: 'rawDataId',
          description: 'ID of the source raw data',
          dataType: ['text']
        },
        {
          name: 'importance',
          description: 'Importance score of the memory (0-1)',
          dataType: ['number']
        },
        {
          name: 'userId',
          description: 'ID of the user this memory belongs to',
          dataType: ['text']
        }
      ]
    };
    
    try {
      const result = await client.schema.classCreator().withClass(classObj).do();
      console.log('Class creation successful:', result);
    } catch (error) {
      console.error('Class creation failed:', error);
      if (error.response && error.response.data) {
        console.error('Response data:', JSON.stringify(error.response.data));
      }
    }
    
    // Verify schema again
    const updatedSchema = await client.schema.getter().do();
    console.log('Updated schema classes:', updatedSchema.classes.map(c => c.class).join(', '));
  } catch (error) {
    console.error('Test failed:', error);
  }
}

runTest(); 