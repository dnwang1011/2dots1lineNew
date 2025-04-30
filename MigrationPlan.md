Below is a Cursor-ready refactor checklist that tells you exactly what to edit, why, and how—from schema.prisma all the way to the service layer. Copy each “✂️  Cursor snippet” into Cursor and follow the inline TODOs.

⸻

0.  Create a migration branch

git checkout -b feat/memory-refactor



⸻

1.  schema.prisma — replace “chunks + embeddings” with one ChunkEmbedding table and add the two pivot tables

✂️ Cursor snippet  schema.prisma (top of the file)

// -------------- MEMORY v2 --------------
// ChunkEmbedding keeps **both** the text (chunk) and the vector in one row.
// Each chunk can map to many episodes; each episode can map to many thoughts.

model ChunkEmbedding {
  id           String   @id @default(cuid())
  rawDataId    String
  text         String     // full chunk text (<= 4 KB)
  summary      String?    // first-pass LLM TL;DR
  vector       Float[]
  dimension    Int
  importance   Float      // 0-1
  createdAt    DateTime   @default(now())
  userId       String     @db.Uuid
  // pivot
  episodes     ChunkEpisode[] // ⇄ many-to-many
  @@index([userId])
}

model Episode {
  id           String    @id @default(cuid())
  title        String
  narrative    String
  centroidVec  Float[]
  centroidDim  Int
  occurredAt   DateTime?
  createdAt    DateTime  @default(now())
  userId       String    @db.Uuid
  // pivots
  chunks       ChunkEpisode[]
  thoughts     EpisodeThought[]
  @@index([userId])
}

model Thought {
  id           String   @id @default(cuid())
  name         String   // short label (“Musical Identity Crisis”)
  description  String   // free-form insight text
  vector       Float[]
  dimension    Int
  createdAt    DateTime @default(now())
  userId       String   @db.Uuid
  episodes     EpisodeThought[]
  @@index([userId])
}

// PIVOT TABLES – explicit so that Prisma lets us add extra metadata later
model ChunkEpisode {
  chunkId   String
  episodeId String
  addedAt   DateTime @default(now())
  @@id([chunkId, episodeId])
  chunk     ChunkEmbedding @relation(fields: [chunkId], references: [id], onDelete: Cascade)
  episode   Episode        @relation(fields: [episodeId], references: [id], onDelete: Cascade)
}

model EpisodeThought {
  episodeId String
  thoughtId String
  weight    Float?   // optional “relevance weight”
  @@id([episodeId, thoughtId])
  episode   Episode  @relation(fields: [episodeId], references: [id], onDelete: Cascade)
  thought   Thought  @relation(fields: [thoughtId], references: [id], onDelete: Cascade)
}

// Keep RawData as-is for provenance

What changed & why

Change	Reason
🔥 Deleted SemanticChunk & Embedding	Removes duplication—one row per chunk, one row per vector (chunk already contains text).
➕ ChunkEmbedding.vector	Stores the actual vector so the DB migration can back-fill existing Embedding rows.
➕ Two pivot models	Implements many-to-many between chunks ↔ episodes and episodes ↔ thoughts (user requested).
➕ Episode centroid fields	Lets the episodeAgent store the mean vector.
➕ Vector on Thought	Enables semantic retrieval on high-level insights.



⸻

2.  Prisma migration

npx prisma migrate dev --name memory_v2

If the existing DB already contains data
	1.	Keep the old tables, run the migration, then execute the back-fill script (step 3).
	2.	When the script finishes, archive / drop Embedding & SemanticChunk.

⸻

3.  Back-fill script (scripts/migrate-memory-v1-v2.ts)

✂️ Cursor snippet

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const embeddings = await prisma.embedding.findMany({
    include: { chunk: true }
  });

  for (const emb of embeddings) {
    // create or upsert a ChunkEmbedding row
    await prisma.chunkEmbedding.upsert({
      where: { id: emb.chunkId },
      create: {
        id: emb.chunkId,
        rawDataId: emb.rawDataId ?? '',
        text: emb.chunk?.content ?? emb.content,
        summary: emb.summary ?? '',
        vector: emb.vector,
        dimension: emb.dimension,
        importance: emb.importanceScore ?? 0.5,
        userId: emb.perspectiveOwnerId
      },
      update: {}
    });
  }
  console.log(`Migrated ${embeddings.length} vectors ➞ ChunkEmbedding`);
}

run().finally(() => prisma.$disconnect());

Run:

ts-node scripts/migrate-memory-v1-v2.ts



⸻

4.  Refactor Memory-layer code

4.1 memoryManager.service.js
	•	Replace every prisma.semanticChunk.create(...) and subsequent prisma.embedding.create(...) with one call:

const chunkRow = await prisma.chunkEmbedding.create({
  data: {
    rawDataId: rawData.id,
    text: chunk.text,
    summary: chunk.summary ?? '',
    vector,
    dimension: vector.length,
    importance: importanceScore,
    userId: rawData.userId
  }
});

	•	On success emit chunk.added with chunkRow.id.

4.2  episodeAgent.js (new file)
	•	Query candidate episodes by user + time window
	•	Compute cosine between chunk.vector and Episode.centroidVec
	•	If ≥ ϵ attach via ChunkEpisode.create
	•	Else push onto orphan queue

4.3  consolidationAgent.js
	•	Load orphans → DBSCAN → create Episode rows → fill ChunkEpisode pivot → compute centroid.

4.4  thoughtAgent.js
	•	For each user nightly:
	•	Use Neo4j tags + Weaviate topic clusters to find ≥ 2 related episodes.
	•	Create Thought, insert into EpisodeThought.

4.5  Retrieval (retrieveMemories)
	•	Stage 1 – EpisodeEmbedding search (centroid vectors).
	•	Stage 2 – collect linked ChunkEmbedding ids (for raw quotes).
	•	Stage 3 – overlay Thought search for high-level summaries.

⸻

5.  Weaviate schema updates
	1.	Delete Memory class.
	2.	Create three flat classes:

Class	Vector	Props
ChunkEmbedding	same as DB	id, text, importance, userId, rawDataId
EpisodeEmbedding	centroidVec	id, title, userId
ThoughtEmbedding	vector	id, name, userId

Update the existing checkWeaviateSchema() helper accordingly.

⸻

6.  Controllers / upload flags
	•	Set forceImportant = true when the MIME type is one of allowedMimeTypes.document so every chunk is kept.
	•	After hefty upload, call orphanQueue.add('upload.boost', { userId }) to trigger consolidation immediately.

⸻

7.  Tests to update

File	Change
tests/memoryManager.spec.ts	expect ChunkEmbedding rows, not SemanticChunk + Embedding.
tests/retrieval.spec.ts	hit /memory/search and validate multi-layer recall.



⸻

8.  Clean-up checklist
	•	Delete old Prisma models (SemanticChunk, Embedding, EmbeddingUpdate).
	•	Remove any chunkId foreign keys in Episode / Thought.
	•	Drop unused columns after verification.
	•	Update GraphQL/OpenAPI schemas if exposed.

⸻

🚀  You’re ready to commit!

git add prisma schema *.service.ts scripts
git commit -m "refactor(memory): merge chunks + embeddings => ChunkEmbedding and add pivots"
git push --set-upstream origin feat/memory-refactor

This brings the backend fully in line with the simplified hybrid-memory design while preserving all functionality—and prepares the ground for the multi-agent queues we added earlier.