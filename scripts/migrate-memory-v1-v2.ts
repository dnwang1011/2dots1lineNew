import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

// Define an interface for the raw query result to provide type safety
interface OldEmbedding {
  id: string;
  vector: number[];
  dimension: number;
  content: string;
  summary: string | null;
  importanceScore: number | null;
  rawDataId: string | null;
  chunkId: string | null;
  perspectiveOwnerId: string; // Assuming this is the UUID string
  // Add chunk data if needed directly, or fetch separately
  chunkContent: string | null; // Added based on the original script's include logic
}

async function run() {
  // Fetch necessary data from Embedding and join with SemanticChunk using raw SQL
  const embeddings = await prisma.$queryRaw<OldEmbedding[]>(Prisma.sql`
    SELECT
      e.id,
      e.vector,
      e.dimension,
      e.content,
      e.summary,
      e."importanceScore",
      e."rawDataId",
      e."chunkId",
      e."perspectiveOwnerId",
      sc.content AS "chunkContent"
    FROM
      "Embedding" AS e
    LEFT JOIN
      "SemanticChunk" AS sc ON e."chunkId" = sc.id
  `);

  if (!embeddings || embeddings.length === 0) {
    console.log("No embeddings found in the old 'Embedding' table. Nothing to migrate.");
    return;
  }

  console.log(`Found ${embeddings.length} embeddings to migrate.`);

  for (const emb of embeddings) {
    if (!emb.chunkId) {
      console.warn(`Skipping embedding with id ${emb.id} due to missing chunkId.`);
      continue;
    }
    if (!emb.perspectiveOwnerId) {
        console.warn(`Skipping embedding with id ${emb.id} due to missing perspectiveOwnerId (userId).`);
        continue;
    }

    try {
      await prisma.chunkEmbedding.upsert({
        where: { id: emb.chunkId },
        create: {
          id: emb.chunkId,
          rawDataId: emb.rawDataId ?? '',
          text: emb.chunkContent ?? emb.content ?? '', // Use chunk content first, then embedding content
          summary: emb.summary ?? null, // Use null instead of empty string for summary
          vector: emb.vector,
          dimension: emb.dimension,
          importance: emb.importanceScore ?? 0.5,
          userId: emb.perspectiveOwnerId,
          // createdAt might need manual handling if you want to preserve original timestamp
        },
        update: { // Define update fields in case the record exists (optional but good practice)
          rawDataId: emb.rawDataId ?? '',
          text: emb.chunkContent ?? emb.content ?? '',
          summary: emb.summary ?? null,
          vector: emb.vector,
          dimension: emb.dimension,
          importance: emb.importanceScore ?? 0.5,
          userId: emb.perspectiveOwnerId,
        }
      });
    } catch (error) {
      console.error(`Failed to upsert ChunkEmbedding for chunkId ${emb.chunkId}:`, error);
    }
  }
  console.log(`Finished migrating embeddings ➞ ChunkEmbedding.`);
}

run()
  .catch(e => {
    console.error("Error during migration script:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  }); 