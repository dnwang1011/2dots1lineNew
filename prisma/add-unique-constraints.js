// prisma/add-unique-constraints.js
// Script to add unique constraints to pivot tables

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addUniqueConstraints() {
  try {
    console.log('Adding unique constraints to pivot tables...');
    
    // Execute raw SQL to add unique constraints
    // Note: These should match what's in the schema but using @@unique instead of @@id
    
    // Add unique constraint to ChunkEpisode
    await prisma.$executeRaw`
      ALTER TABLE IF EXISTS "ChunkEpisode" ADD CONSTRAINT "ChunkEpisode_unique_constraint" UNIQUE("chunkId", "episodeId");
    `;
    console.log('Added unique constraint to ChunkEpisode table');
    
    // Add unique constraint to EpisodeThought
    await prisma.$executeRaw`
      ALTER TABLE IF EXISTS "EpisodeThought" ADD CONSTRAINT "EpisodeThought_unique_constraint" UNIQUE("episodeId", "thoughtId");
    `;
    console.log('Added unique constraint to EpisodeThought table');
    
    console.log('Successfully added all unique constraints');
  } catch (error) {
    console.error('Error adding unique constraints:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addUniqueConstraints()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  }); 