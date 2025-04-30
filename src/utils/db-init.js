// src/utils/db-init.js
// Utility for database initialization and verification

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Initialize the database by checking connections and schema
 */
async function initializeDatabase() {
  try {
    console.log('Initializing database connection...');
    
    // Test connection
    await prisma.$connect();
    console.log('Database connection successful.');
    
    // Check if User table exists and has records
    const userCount = await prisma.user.count();
    console.log(`Database has ${userCount} users.`);
    
    return true;
  } catch (error) {
    console.error('Database initialization failed:', error);
    return false;
  }
}

/**
 * Initialize ontology versions and types if they don't exist
 */
async function initializeOntology() {
  try {
    // Check if there's an active ontology version
    let activeVersion = await prisma.ontologyVersion.findFirst({
      where: { active: true }
    });
    
    // If no active version exists, create the initial version
    if (!activeVersion) {
      console.log('No active ontology version found. Creating initial version...');
      
      activeVersion = await prisma.ontologyVersion.create({
        data: {
          name: 'Initial Ontology',
          description: 'Initial ontology schema for 2dots1line',
          active: true
        }
      });
      
      // Define basic node types
      const nodeTypes = [
        {
          name: 'Person',
          description: 'User, child, parent, teacher...',
          properties: JSON.stringify({
            required: ['name'],
            optional: ['age', 'gender', 'relationship']
          }),
          synonyms: ['individual', 'human', 'user'],
          ontologyVersionId: activeVersion.id
        },
        {
          name: 'Event',
          description: 'Any activity or occurrence',
          properties: JSON.stringify({
            required: ['name'],
            optional: ['date', 'location', 'description']
          }),
          synonyms: ['activity', 'occurrence', 'happening'],
          ontologyVersionId: activeVersion.id
        },
        {
          name: 'Emotion',
          description: 'Feelings experienced during events',
          properties: JSON.stringify({
            required: ['name'],
            optional: ['intensity', 'valence']
          }),
          synonyms: ['feeling', 'mood', 'sentiment'],
          ontologyVersionId: activeVersion.id
        },
        {
          name: 'Goal',
          description: 'Long-term aims or aspirations',
          properties: JSON.stringify({
            required: ['name'],
            optional: ['timeframe', 'priority', 'status']
          }),
          synonyms: ['aim', 'objective', 'aspiration'],
          ontologyVersionId: activeVersion.id
        },
        {
          name: 'Trait',
          description: 'Personality attributes',
          properties: JSON.stringify({
            required: ['name'],
            optional: ['strength', 'category']
          }),
          synonyms: ['attribute', 'characteristic', 'quality'],
          ontologyVersionId: activeVersion.id
        }
      ];
      
      // Define basic edge types
      const edgeTypes = [
        {
          name: 'PARTICIPATED_IN',
          description: 'Who was involved in an event',
          fromNodeTypes: ['Person'],
          toNodeTypes: ['Event'],
          properties: JSON.stringify({
            optional: ['role', 'significance']
          }),
          ontologyVersionId: activeVersion.id
        },
        {
          name: 'FELT',
          description: 'Emotions experienced during event',
          fromNodeTypes: ['Person', 'Event'],
          toNodeTypes: ['Emotion'],
          properties: JSON.stringify({
            optional: ['intensity', 'duration']
          }),
          ontologyVersionId: activeVersion.id
        },
        {
          name: 'HAS_TRAIT',
          description: 'Personality traits',
          fromNodeTypes: ['Person'],
          toNodeTypes: ['Trait'],
          properties: JSON.stringify({
            optional: ['strength', 'evidence']
          }),
          ontologyVersionId: activeVersion.id
        },
        {
          name: 'PURSUES',
          description: 'Motivational goals',
          fromNodeTypes: ['Person'],
          toNodeTypes: ['Goal'],
          properties: JSON.stringify({
            optional: ['priority', 'progress']
          }),
          ontologyVersionId: activeVersion.id
        }
      ];
      
      // Create node types
      for (const nodeType of nodeTypes) {
        await prisma.nodeType.create({ data: nodeType });
      }
      
      // Create edge types
      for (const edgeType of edgeTypes) {
        await prisma.edgeType.create({ data: edgeType });
      }
      
      console.log('Initial ontology created successfully.');
    } else {
      console.log(`Active ontology version found: ${activeVersion.name}`);
    }
    
    return true;
  } catch (error) {
    console.error('Ontology initialization failed:', error);
    return false;
  }
}

// Export functions
module.exports = {
  initializeDatabase,
  initializeOntology
}; 