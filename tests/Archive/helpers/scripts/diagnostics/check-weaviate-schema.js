// check-weaviate-schema.js
// Script to check Weaviate schema configuration

const weaviateClientUtil = require('./src/utils/weaviateClient');

async function checkWeaviateSchema() {
  console.log('========================================');
  console.log('WEAVIATE SCHEMA CHECK');
  console.log('========================================');
  
  try {
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('Error: Weaviate client not available');
      return;
    }
    
    console.log('Fetching full Weaviate schema...');
    const schema = await client.schema.getter().do();
    
    // Get all classes
    const classes = schema.classes || [];
    console.log(`Found ${classes.length} classes in the schema.`);
    
    // Find the EpisodeEmbedding class
    const episodeClass = classes.find(c => c.class === 'EpisodeEmbedding');
    
    if (episodeClass) {
      console.log('\n----------------------------------------');
      console.log('EPISODEEMBEDDING CLASS DETAILS:');
      console.log('----------------------------------------');
      console.log(`Class name: ${episodeClass.class}`);
      console.log(`Description: ${episodeClass.description}`);
      console.log(`Vectorizer: ${episodeClass.vectorizer}`);
      console.log(`Vector index type: ${episodeClass.vectorIndexType || 'Not specified'}`);
      
      if (episodeClass.vectorIndexConfig) {
        console.log('\nVector index configuration:');
        console.log(JSON.stringify(episodeClass.vectorIndexConfig, null, 2));
      } else {
        console.log('\nNo vector index configuration specified.');
      }
      
      if (episodeClass.properties && episodeClass.properties.length > 0) {
        console.log('\nProperties:');
        episodeClass.properties.forEach(prop => {
          console.log(`- ${prop.name} (${prop.dataType.join(', ')}): ${prop.description || 'No description'}`);
        });
      }
      
      // Attempt to get vector dimensions from Weaviate metadata
      try {
        const meta = await client.misc.metaGetter().do();
        console.log('\nWeaviate version:', meta.version);
        
        if (meta.modules && meta.modules.text2vec) {
          console.log('Text2Vec module configuration:');
          console.log(JSON.stringify(meta.modules.text2vec, null, 2));
        }
      } catch (metaError) {
        console.error('Error getting Weaviate metadata:', metaError.message);
      }
    } else {
      console.log('\nEpisodeEmbedding class not found in schema.');
      
      // List all available classes
      console.log('\nAvailable classes:');
      classes.forEach(c => {
        console.log(`- ${c.class}`);
      });
    }
    
    // Try to find at least one object in each class to check vector dimensions
    console.log('\n----------------------------------------');
    console.log('CHECKING VECTOR DIMENSIONS IN EACH CLASS:');
    console.log('----------------------------------------');
    
    for (const cls of classes) {
      try {
        const result = await client.graphql
          .get()
          .withClassName(cls.class)
          .withFields('_additional { id vector }')
          .withLimit(1)
          .do();
        
        const objects = result?.data?.Get?.[cls.class] || [];
        if (objects.length > 0 && objects[0]._additional?.vector) {
          console.log(`Class ${cls.class}: Vector dimension = ${objects[0]._additional.vector.length}`);
        } else {
          console.log(`Class ${cls.class}: No objects with vectors found`);
        }
      } catch (error) {
        console.error(`Error querying class ${cls.class}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('Error checking Weaviate schema:', error);
  }
}

// Run the check
checkWeaviateSchema(); 