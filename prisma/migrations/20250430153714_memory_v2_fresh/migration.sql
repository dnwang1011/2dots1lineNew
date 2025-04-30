-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phone" TEXT,
    "wechat_id" TEXT,
    "subscription_plan" TEXT,
    "gender" TEXT,
    "age" INTEGER,
    "city" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawData" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "topicKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "sessionId" TEXT NOT NULL,
    "perspectiveOwnerId" UUID NOT NULL,
    "subjectId" UUID,
    "importanceScore" DOUBLE PRECISION,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "processingStatus" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "RawData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChunkEmbedding" (
    "id" TEXT NOT NULL,
    "rawDataId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "summary" TEXT,
    "vector" DOUBLE PRECISION[],
    "dimension" INTEGER NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,

    CONSTRAINT "ChunkEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "centroidVec" DOUBLE PRECISION[],
    "centroidDim" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "rawDataId" TEXT,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Thought" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "dimension" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "rawDataId" TEXT,

    CONSTRAINT "Thought_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChunkEpisode" (
    "chunkId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChunkEpisode_pkey" PRIMARY KEY ("chunkId","episodeId")
);

-- CreateTable
CREATE TABLE "EpisodeThought" (
    "episodeId" TEXT NOT NULL,
    "thoughtId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,

    CONSTRAINT "EpisodeThought_pkey" PRIMARY KEY ("episodeId","thoughtId")
);

-- CreateTable
CREATE TABLE "OntologyVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OntologyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "properties" JSONB,
    "synonyms" TEXT[],
    "ontologyVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EdgeType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fromNodeTypes" TEXT[],
    "toNodeTypes" TEXT[],
    "properties" JSONB,
    "ontologyVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EdgeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OntologyChangeProposal" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "proposedDefinition" JSONB NOT NULL,
    "justification" TEXT NOT NULL,
    "examples" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "OntologyChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RawData_userId_idx" ON "RawData"("userId");

-- CreateIndex
CREATE INDEX "RawData_sessionId_idx" ON "RawData"("sessionId");

-- CreateIndex
CREATE INDEX "RawData_perspectiveOwnerId_idx" ON "RawData"("perspectiveOwnerId");

-- CreateIndex
CREATE INDEX "RawData_createdAt_idx" ON "RawData"("createdAt");

-- CreateIndex
CREATE INDEX "ChunkEmbedding_userId_idx" ON "ChunkEmbedding"("userId");

-- CreateIndex
CREATE INDEX "Episode_userId_idx" ON "Episode"("userId");

-- CreateIndex
CREATE INDEX "Episode_rawDataId_idx" ON "Episode"("rawDataId");

-- CreateIndex
CREATE INDEX "Thought_userId_idx" ON "Thought"("userId");

-- CreateIndex
CREATE INDEX "Thought_rawDataId_idx" ON "Thought"("rawDataId");

-- CreateIndex
CREATE INDEX "NodeType_ontologyVersionId_idx" ON "NodeType"("ontologyVersionId");

-- CreateIndex
CREATE INDEX "EdgeType_ontologyVersionId_idx" ON "EdgeType"("ontologyVersionId");

-- CreateIndex
CREATE INDEX "OntologyChangeProposal_status_idx" ON "OntologyChangeProposal"("status");

-- CreateIndex
CREATE INDEX "OntologyChangeProposal_userId_idx" ON "OntologyChangeProposal"("userId");

-- AddForeignKey
ALTER TABLE "RawData" ADD CONSTRAINT "RawData_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkEmbedding" ADD CONSTRAINT "ChunkEmbedding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkEmbedding" ADD CONSTRAINT "ChunkEmbedding_rawDataId_fkey" FOREIGN KEY ("rawDataId") REFERENCES "RawData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_rawDataId_fkey" FOREIGN KEY ("rawDataId") REFERENCES "RawData"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thought" ADD CONSTRAINT "Thought_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thought" ADD CONSTRAINT "Thought_rawDataId_fkey" FOREIGN KEY ("rawDataId") REFERENCES "RawData"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkEpisode" ADD CONSTRAINT "ChunkEpisode_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ChunkEmbedding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChunkEpisode" ADD CONSTRAINT "ChunkEpisode_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeThought" ADD CONSTRAINT "EpisodeThought_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeThought" ADD CONSTRAINT "EpisodeThought_thoughtId_fkey" FOREIGN KEY ("thoughtId") REFERENCES "Thought"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeType" ADD CONSTRAINT "NodeType_ontologyVersionId_fkey" FOREIGN KEY ("ontologyVersionId") REFERENCES "OntologyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeType" ADD CONSTRAINT "EdgeType_ontologyVersionId_fkey" FOREIGN KEY ("ontologyVersionId") REFERENCES "OntologyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntologyChangeProposal" ADD CONSTRAINT "OntologyChangeProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
