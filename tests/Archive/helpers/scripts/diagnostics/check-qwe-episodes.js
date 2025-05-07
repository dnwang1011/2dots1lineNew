const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkEpisodes() {
  try {
    const userId = 'd9fe3dbe-bc25-4040-ac00-a835d418c5b4'; // qwe asd user
    
    // Check for episodes
    const episodes = await prisma.episode.findMany({
      where: {
        userId: userId
      }
    });
    
    console.log('Total episodes found:', episodes.length);
    
    if (episodes.length > 0) {
      episodes.forEach((episode, index) => {
        console.log(`\nEpisode ${index + 1}:`);
        console.log(`- ID: ${episode.id}`);
        console.log(`- Title: ${episode.title}`);
        console.log(`- Narrative: ${episode.narrative.substring(0, 100)}${episode.narrative.length > 100 ? '...' : ''}`);
      });
      
      // Check chunks associated with episodes
      for (const episode of episodes) {
        const chunkEpisodes = await prisma.chunkEpisode.findMany({
          where: { episodeId: episode.id },
          include: { chunk: true }
        });
        
        console.log(`\nChunks in episode ${episode.id}:`);
        console.log(`- Total chunks: ${chunkEpisodes.length}`);
        
        for (const ce of chunkEpisodes) {
          console.log(`  - Chunk: ${ce.chunkId}`);
          if (ce.chunk && ce.chunk.text) {
            console.log(`    Text: ${ce.chunk.text.substring(0, 50)}...`);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkEpisodes(); 