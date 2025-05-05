/*
  Warnings:

  - A unique constraint covering the columns `[chunkId,episodeId]` on the table `ChunkEpisode` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[episodeId,thoughtId]` on the table `EpisodeThought` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "RawData" ADD COLUMN     "metadata" JSONB;

-- CreateTable
CREATE TABLE "FileUploadJob" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "filename" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "message" TEXT,
    "resultData" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FileUploadJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileUploadJob_userId_idx" ON "FileUploadJob"("userId");

-- CreateIndex
CREATE INDEX "FileUploadJob_sessionId_idx" ON "FileUploadJob"("sessionId");

-- CreateIndex
CREATE INDEX "FileUploadJob_status_idx" ON "FileUploadJob"("status");

-- CreateIndex
CREATE INDEX "FileUploadJob_createdAt_idx" ON "FileUploadJob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChunkEpisode_unique_constraint" ON "ChunkEpisode"("chunkId", "episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeThought_unique_constraint" ON "EpisodeThought"("episodeId", "thoughtId");

-- AddForeignKey
ALTER TABLE "FileUploadJob" ADD CONSTRAINT "FileUploadJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
