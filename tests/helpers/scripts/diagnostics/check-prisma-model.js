// check-prisma-model.js - Check the structure of Prisma models

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPrismaModels() {
  try {
    // Get schema
    const schema = await prisma._getDmmf();
    
    // Find the Episode model
    const episodeModel = schema.modelMap.Episode;
    console.log('Episode Model Fields:');
    Object.keys(episodeModel.fields).forEach(fieldName => {
      const field = episodeModel.fields[fieldName];
      console.log(`  ${fieldName}: ${field.type} (${field.kind})`);
    });
    
    // Find the ChunkEpisode model (or similar)
    console.log('\nLooking for ChunkEpisode model...');
    const modelNames = Object.keys(schema.modelMap);
    console.log('Available models:', modelNames.join(', '));
    
    // Check for models related to chunks and episodes
    const relatedModels = modelNames.filter(modelName => 
      modelName.includes('Episode') || modelName.includes('Chunk'));
    
    console.log('\nRelated Models:', relatedModels.join(', '));
    
    // For each related model, print fields
    for (const modelName of relatedModels) {
      console.log(`\n${modelName} Model Fields:`);
      const model = schema.modelMap[modelName];
      Object.keys(model.fields).forEach(fieldName => {
        const field = model.fields[fieldName];
        console.log(`  ${fieldName}: ${field.type} (${field.kind})`);
      });
    }
    
  } catch (error) {
    console.error('Error checking Prisma models:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the function
checkPrismaModels(); 