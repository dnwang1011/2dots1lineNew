// test-knowledge-node.js - Test KnowledgeNode and Relationship classes

const weaviateClientUtil = require('./src/utils/weaviateClient');
const { v4: uuidv4 } = require('uuid');

async function testKnowledgeGraphClasses() {
  try {
    console.log('Testing KnowledgeNode and Relationship classes in Weaviate');
    
    // Get Weaviate client
    const client = weaviateClientUtil.getClient();
    if (!client) {
      console.error('Weaviate client not available. Make sure Weaviate is running.');
      return;
    }
    
    // Create test KnowledgeNode
    const nodeId1 = uuidv4();
    const nodeId2 = uuidv4();
    
    console.log('\nCreating test KnowledgeNodes...');
    
    try {
      // Create first node
      await client.data
        .creator()
        .withClassName('KnowledgeNode')
        .withId(nodeId1)
        .withProperties({
          entity: 'Machine Learning',
          type: 'concept',
          description: 'A branch of artificial intelligence focused on building systems that learn from data'
        })
        .do();
      
      console.log(`Created KnowledgeNode with ID: ${nodeId1}`);
      
      // Create second node
      await client.data
        .creator()
        .withClassName('KnowledgeNode')
        .withId(nodeId2)
        .withProperties({
          entity: 'Neural Networks',
          type: 'concept',
          description: 'A computing system inspired by biological neural networks in brains'
        })
        .do();
      
      console.log(`Created KnowledgeNode with ID: ${nodeId2}`);
      
      // Create relationship between nodes
      const relationshipId = uuidv4();
      
      await client.data
        .creator()
        .withClassName('Relationship')
        .withId(relationshipId)
        .withProperties({
          relationType: 'is_part_of',
          sourceNodeId: nodeId2,
          targetNodeId: nodeId1,
          confidence: 0.95,
          metadata: JSON.stringify({ source: 'test', createdBy: 'test-script' }),
          sourceIds: ['test-id-1'],
          createdAt: new Date().toISOString()
        })
        .do();
      
      console.log(`Created Relationship with ID: ${relationshipId}`);
    } catch (error) {
      console.error('Error creating test objects:', error.message);
    }
    
    // Query for KnowledgeNodes
    console.log('\nQuerying KnowledgeNodes...');
    
    try {
      const result = await client.graphql
        .get()
        .withClassName('KnowledgeNode')
        .withFields('entity type description _additional { id }')
        .do();
      
      const nodes = result?.data?.Get?.KnowledgeNode || [];
      console.log(`Found ${nodes.length} KnowledgeNodes:`);
      
      nodes.forEach((node, i) => {
        console.log(`\n#${i + 1}: ${node.entity} (${node.type})`);
        console.log(`  ID: ${node._additional.id}`);
        console.log(`  Description: ${node.description}`);
      });
    } catch (error) {
      console.error('Error querying KnowledgeNodes:', error.message);
    }
    
    // Query for Relationships
    console.log('\nQuerying Relationships...');
    
    try {
      const result = await client.graphql
        .get()
        .withClassName('Relationship')
        .withFields('relationType sourceNodeId targetNodeId confidence _additional { id }')
        .do();
      
      const relationships = result?.data?.Get?.Relationship || [];
      console.log(`Found ${relationships.length} Relationships:`);
      
      for (const rel of relationships) {
        console.log(`\nRelationship: ${rel.relationType}`);
        console.log(`  ID: ${rel._additional.id}`);
        console.log(`  Source -> Target: ${rel.sourceNodeId} -> ${rel.targetNodeId}`);
        console.log(`  Confidence: ${rel.confidence}`);
        
        // Get source node details
        const sourceNode = await client.data
          .getterById()
          .withClassName('KnowledgeNode')
          .withId(rel.sourceNodeId)
          .do();
          
        // Get target node details
        const targetNode = await client.data
          .getterById()
          .withClassName('KnowledgeNode')
          .withId(rel.targetNodeId)
          .do();
          
        if (sourceNode?.properties?.entity && targetNode?.properties?.entity) {
          console.log(`  Relationship: ${sourceNode.properties.entity} ${rel.relationType} ${targetNode.properties.entity}`);
        }
      }
    } catch (error) {
      console.error('Error querying Relationships:', error.message);
    }
    
  } catch (error) {
    console.error('Error testing KnowledgeNode and Relationship classes:', error);
  }
}

// Run the test
testKnowledgeGraphClasses(); 