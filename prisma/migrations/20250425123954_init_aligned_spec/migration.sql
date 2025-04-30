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
    "processedFlag" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RawData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticChunk" (
    "id" TEXT NOT NULL,
    "rawDataId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "chunkIndex" INTEGER NOT NULL,
    "importanceScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "perspectiveOwnerId" UUID NOT NULL,
    "subjectId" UUID,
    "topicKey" TEXT,

    CONSTRAINT "SemanticChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embedding" (
    "id" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[],
    "dimension" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "importanceScore" DOUBLE PRECISION NOT NULL,
    "modelConfidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "embeddingType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "rawDataId" TEXT,
    "chunkId" TEXT,
    "episodeId" TEXT,
    "thoughtId" TEXT,
    "perspectiveOwnerId" UUID NOT NULL,
    "subjectId" UUID,
    "linkedNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vectorCollection" TEXT NOT NULL,
    "vectorId" TEXT NOT NULL,
    "isIncremental" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "rawDataId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "emotionTags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" UUID NOT NULL,
    "perspectiveOwnerId" UUID NOT NULL,
    "subjectId" UUID,
    "linkedNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topicKey" TEXT,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Thought" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "modelConfidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "subjectType" TEXT NOT NULL,
    "subjectName" TEXT NOT NULL,
    "rawDataId" TEXT,
    "chunkId" TEXT,
    "embeddingId" TEXT,
    "episodeId" TEXT,
    "perspectiveOwnerId" UUID NOT NULL,
    "subjectId" UUID,
    "linkedNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Thought_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbeddingUpdate" (
    "id" TEXT NOT NULL,
    "embeddingId" TEXT NOT NULL,
    "previousVector" DOUBLE PRECISION[],
    "similarityScore" DOUBLE PRECISION,
    "updateReason" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbeddingUpdate_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "SemanticChunk_perspectiveOwnerId_idx" ON "SemanticChunk"("perspectiveOwnerId");

-- CreateIndex
CREATE INDEX "SemanticChunk_topicKey_idx" ON "SemanticChunk"("topicKey");

-- CreateIndex
CREATE INDEX "SemanticChunk_createdAt_idx" ON "SemanticChunk"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SemanticChunk_rawDataId_chunkIndex_key" ON "SemanticChunk"("rawDataId", "chunkIndex");

-- CreateIndex
CREATE INDEX "Episode_topicKey_idx" ON "Episode"("topicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Thought_embeddingId_key" ON "Thought"("embeddingId");

-- CreateIndex
CREATE INDEX "EmbeddingUpdate_embeddingId_idx" ON "EmbeddingUpdate"("embeddingId");

-- AddForeignKey
ALTER TABLE "RawData" ADD CONSTRAINT "RawData_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticChunk" ADD CONSTRAINT "SemanticChunk_rawDataId_fkey" FOREIGN KEY ("rawDataId") REFERENCES "RawData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticChunk" ADD CONSTRAINT "SemanticChunk_perspectiveOwnerId_fkey" FOREIGN KEY ("perspectiveOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_rawDataId_fkey" FOREIGN KEY ("rawDataId") REFERENCES "RawData"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "SemanticChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_rawDataId_fkey" FOREIGN KEY ("rawDataId") REFERENCES "RawData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thought" ADD CONSTRAINT "Thought_rawDataId_fkey" FOREIGN KEY ("rawDataId") REFERENCES "RawData"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thought" ADD CONSTRAINT "Thought_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "SemanticChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thought" ADD CONSTRAINT "Thought_embeddingId_fkey" FOREIGN KEY ("embeddingId") REFERENCES "Embedding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thought" ADD CONSTRAINT "Thought_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thought" ADD CONSTRAINT "Thought_perspectiveOwnerId_fkey" FOREIGN KEY ("perspectiveOwnerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmbeddingUpdate" ADD CONSTRAINT "EmbeddingUpdate_embeddingId_fkey" FOREIGN KEY ("embeddingId") REFERENCES "Embedding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
