// test-memory-retrieval.js
// A script to test and debug the memory retrieval system

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const memoryManager = require('../../src/services/memoryManager.service');
const logger = require('../../src/utils/logger');

// Get command line arguments
const args = process.argv.slice(2);
const userId = args[0] || '4b84c387-ff6b-45d5-a25d-7f1d7905b951'; // Default to the test user
const query = args[1] || 'troubleshooting the memory system'; // Default query

async function testMemoryRetrieval() {
  console.log('========================================');
  console.log('MEMORY RETRIEVAL TEST');
  console.log('========================================');
  console.log(`User ID: ${userId}`);
  console.log(`Query: "${query}"`);
  console.log('----------------------------------------');

  try {
    // First check if episodes exist for this user
    const episodes = await prisma.episode.findMany({
      where: { userId },
      include: {
        chunks: {
          include: {
            chunk: true
          }
        }
      }
    });

    console.log(`Found ${episodes.length} episodes in database for user:`);
    episodes.forEach((ep, i) => {
      console.log(`\nEpisode #${i+1}: ${ep.title || 'Untitled'}`);
      console.log(`  ID: ${ep.id}`);
      console.log(`  Created: ${ep.createdAt}`);
      console.log(`  Chunks: ${ep.chunks.length}`);
      console.log(`  Has narrative: ${ep.narrative ? 'Yes' : 'No'}`);
      console.log(`  Centroid vector length: ${ep.centroidVec?.length || 0}`);
      
      // Display sample of chunks
      if (ep.chunks.length > 0) {
        console.log('\n  Sample Chunks:');
        ep.chunks.slice(0, 3).forEach((c, j) => {
          console.log(`    ${j+1}. ${c.chunk?.text?.substring(0, 100) || 'No text'}...`);
        });
      }
    });

    console.log('\n----------------------------------------');
    console.log('RETRIEVING MEMORIES FOR QUERY:');
    console.log('----------------------------------------');

    // Use memoryManager to retrieve memories with detailed logging
    console.log('Attempting to retrieve memories...');
    const memories = await memoryManager.retrieveMemories(query, userId, {
      limit: 10,
      minImportance: 0.1,
      certainty: 0.3
    });

    console.log(`\nRetrieved ${memories.length} memories:`);
    memories.forEach((memory, i) => {
      console.log(`\nMemory #${i+1} (${memory.type}):`);
      console.log(`  ID: ${memory.id}`);
      console.log(`  Similarity: ${memory.similarity ? (memory.similarity * 100).toFixed(2) + '%' : 'N/A'}`);
      
      if (memory.type === 'episode') {
        console.log(`  Title: ${memory.title || 'Untitled'}`);
        if (memory.narrative) {
          console.log(`  Narrative: ${memory.narrative.substring(0, 200)}...`);
        }
        if (memory.content) {
          console.log(`  Content sample: ${memory.content.substring(0, 200)}...`);
        }
      } else if (memory.type === 'chunk') {
        console.log(`  Text: ${memory.text?.substring(0, 200) || 'No text'}...`);
      } else if (memory.type === 'thought') {
        console.log(`  Name: ${memory.name || 'Unnamed'}`);
        console.log(`  Content: ${memory.content?.substring(0, 200) || 'No content'}...`);
      }
    });

    console.log('\n----------------------------------------');
    console.log('SAMPLE MEMORY CONTEXT FORMATTING:');
    console.log('----------------------------------------');

    // Format memories the way chat.service.js would
    let memoryContext = '';
    if (memories && memories.length > 0) {
      memoryContext = 'RELEVANT CONTEXT FROM MEMORY:\n' +
      memories.map((m, i) => {
        if (m.type === 'episode') {
          const episodeInfo = `[Episode ${i+1}] ${m.title || 'Untitled Episode'} (Relevance: ${(m.similarity*100).toFixed(1)}%)\n` +
                              `${m.narrative || m.content || 'No content available'}\n` +
                              `IMPORTANT: Consider this past experience when responding.`;
          return episodeInfo;
        }
        if (m.type === 'thought') return `[Thought ${i+1}] ${m.name}: ${m.content?.substring(0,200)}...`;
        if (m.type === 'chunk') return `[Fragment ${i+1}] ${m.text?.substring(0,200)}...`;
        return `[Memory ${i+1}] ${m.content || m.text || 'N/A'}`.substring(0, 200) + '...';
      }).join('\n\n');
      memoryContext += '\n\nIMPORTANT: These memories contain real past conversations and experiences. Use them naturally in your response.';
    } else {
      memoryContext = 'No relevant memories found.';
    }

    console.log(memoryContext);

  } catch (error) {
    console.error('Error during memory retrieval test:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testMemoryRetrieval(); 