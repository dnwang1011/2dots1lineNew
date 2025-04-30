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
CREATE INDEX "NodeType_ontologyVersionId_idx" ON "NodeType"("ontologyVersionId");

-- CreateIndex
CREATE INDEX "EdgeType_ontologyVersionId_idx" ON "EdgeType"("ontologyVersionId");

-- CreateIndex
CREATE INDEX "OntologyChangeProposal_status_idx" ON "OntologyChangeProposal"("status");

-- CreateIndex
CREATE INDEX "OntologyChangeProposal_userId_idx" ON "OntologyChangeProposal"("userId");

-- AddForeignKey
ALTER TABLE "NodeType" ADD CONSTRAINT "NodeType_ontologyVersionId_fkey" FOREIGN KEY ("ontologyVersionId") REFERENCES "OntologyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EdgeType" ADD CONSTRAINT "EdgeType_ontologyVersionId_fkey" FOREIGN KEY ("ontologyVersionId") REFERENCES "OntologyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OntologyChangeProposal" ADD CONSTRAINT "OntologyChangeProposal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
