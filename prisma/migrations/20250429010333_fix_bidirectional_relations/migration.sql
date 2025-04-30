/*
  Warnings:

  - You are about to drop the column `processedFlag` on the `RawData` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "RawData" DROP COLUMN "processedFlag",
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processingError" TEXT,
ADD COLUMN     "processingStatus" TEXT NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "linkedUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_SubjectRawData" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_SubjectRawData_AB_unique" ON "_SubjectRawData"("A", "B");

-- CreateIndex
CREATE INDEX "_SubjectRawData_B_index" ON "_SubjectRawData"("B");

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SubjectRawData" ADD CONSTRAINT "_SubjectRawData_A_fkey" FOREIGN KEY ("A") REFERENCES "RawData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SubjectRawData" ADD CONSTRAINT "_SubjectRawData_B_fkey" FOREIGN KEY ("B") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
