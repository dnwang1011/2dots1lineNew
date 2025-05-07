const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkChunksByUser() {
  try {
    const users = await prisma.user.findMany();
    console.log(`Total users in database: ${users.length}`);
    
    for (const user of users) {
      const chunks = await prisma.chunkEmbedding.findMany({
        where: { userId: user.id }
      });
      
      console.log(`\nUser: ${user.firstName} ${user.lastName} (${user.id})`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Total chunks: ${chunks.length}`);
      
      if (chunks.length > 0) {
        // Group chunks by sessionId
        const sessionMap = {};
        for (const chunk of chunks) {
          if (!sessionMap[chunk.sessionId]) {
            sessionMap[chunk.sessionId] = [];
          }
          sessionMap[chunk.sessionId].push(chunk);
        }
        
        console.log(`  Chunks by session:`);
        for (const [sessionId, sessionChunks] of Object.entries(sessionMap)) {
          console.log(`    Session ${sessionId}: ${sessionChunks.length} chunks`);
        }
        
        // Check how many have vectors in Weaviate
        console.log(`  Checking first ${Math.min(5, chunks.length)} chunks for vectors...`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkChunksByUser(); 