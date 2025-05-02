const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const episodes = await prisma.episode.findMany({
      take: 10,
      orderBy: {
        createdAt: 'desc',
      },
      include: { // Include count of linked chunks
        _count: {
          select: { chunks: true },
        },
      },
    });
    console.log("--- Latest 10 Episodes ---");
    if (episodes.length === 0) {
      console.log("No episodes found.");
    } else {
      episodes.forEach(ep => {
        console.log(`- ID: ${ep.id}, Title: "${ep.title}" (Created: ${ep.createdAt.toISOString()}, Chunks Linked: ${ep._count.chunks})`);
      });
    }
    console.log("------------------------");
  } catch (error) {
    console.error("Error fetching episodes:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main(); 