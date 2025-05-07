// tests/helpers/scripts/test-weaviate-schema.js - Test Weaviate schema and classes

const weaviateClientUtil = require('../../../src/utils/weaviateClient');

async function testWeaviateSchema() {
  try {
    // Get Weaviate client
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('Weaviate client not available. Make sure Weaviate is running.');
      return;
    }
    
    console.log('Connecting to Weaviate...');
    
    // Get Weaviate version
    const meta = await client.misc.metaGetter().do();
    console.log(`Connected to Weaviate version: ${meta.version}`);
    
    // Get schema
    const schema = await client.schema.getter().do();
    console.log('Retrieved schema with classes:', schema.classes.map(c => c.class).join(', '));
    
    // Check specific classes we're interested in
    const chunkClass = schema.classes.find(c => c.class === 'ChunkEmbedding');
    const episodeClass = schema.classes.find(c => c.class === 'EpisodeEmbedding');
    const thoughtClass = schema.classes.find(c => c.class === 'ThoughtEmbedding');
    
    console.log('\nChecking ChunkEmbedding class:');
    if (chunkClass) {
      console.log('  Found ChunkEmbedding class');
      console.log('  Vector index type:', chunkClass.vectorIndexType);
      console.log('  Vectorizer:', chunkClass.vectorizer);
      console.log('  Vector distance:', chunkClass.vectorIndexConfig?.distance);
      console.log('  Properties:', chunkClass.properties.map(p => p.name).join(', '));
    } else {
      console.log('  ChunkEmbedding class not found!');
    }
    
    console.log('\nChecking EpisodeEmbedding class:');
    if (episodeClass) {
      console.log('  Found EpisodeEmbedding class');
      console.log('  Vector index type:', episodeClass.vectorIndexType);
      console.log('  Vectorizer:', episodeClass.vectorizer);
      console.log('  Vector distance:', episodeClass.vectorIndexConfig?.distance);
      console.log('  Properties:', episodeClass.properties.map(p => p.name).join(', '));
    } else {
      console.log('  EpisodeEmbedding class not found!');
    }
    
    console.log('\nChecking ThoughtEmbedding class:');
    if (thoughtClass) {
      console.log('  Found ThoughtEmbedding class');
      console.log('  Vector index type:', thoughtClass.vectorIndexType);
      console.log('  Vectorizer:', thoughtClass.vectorizer);
      console.log('  Vector distance:', thoughtClass.vectorIndexConfig?.distance);
      console.log('  Properties:', thoughtClass.properties.map(p => p.name).join(', '));
    } else {
      console.log('  ThoughtEmbedding class not found!');
    }
    
    // Try a simple query to see if it works
    console.log('\nTesting GraphQL query on ChunkEmbedding class:');
    try {
      const result = await client.graphql
        .get()
        .withClassName('ChunkEmbedding')
        .withFields('chunkDbId text _additional { id }')
        .withLimit(1)
        .do();
      
      console.log('GraphQL query result:', JSON.stringify(result, null, 2));
    } catch (queryError) {
      console.error('Error running GraphQL query:', queryError.message);
    }
    
  } catch (error) {
    console.error('Error testing Weaviate schema:', error);
  }
}

// Run the test
testWeaviateSchema();
