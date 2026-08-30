-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('DRAFT', 'QUOTED', 'SOLD', 'IN_PROGRESS', 'AWAITING_CLOSEOUT', 'CLOSED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceModel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceModelVersion" (
    "id" TEXT NOT NULL,
    "priceModelId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rates" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Measurement" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "providerRef" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "roofAreaSqFt" INTEGER NOT NULL,
    "pitchTwelfths" INTEGER NOT NULL,
    "stories" INTEGER NOT NULL,
    "facets" INTEGER NOT NULL,
    "ridgeHipLf" INTEGER NOT NULL,
    "valleyLf" INTEGER NOT NULL,
    "eaveLf" INTEGER NOT NULL,
    "rakeLf" INTEGER NOT NULL,
    "flashingLf" INTEGER NOT NULL,
    "penetrations" INTEGER NOT NULL,
    "existingLayers" INTEGER NOT NULL,
    "deckingCondition" TEXT NOT NULL,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priceModelVersionId" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "subtotalCents" BIGINT NOT NULL,
    "overheadCents" BIGINT NOT NULL,
    "marginCents" BIGINT NOT NULL,
    "totalCents" BIGINT NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantityX100" INTEGER NOT NULL,
    "unitRateCents" BIGINT NOT NULL,
    "netMultiplierBps" INTEGER NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "factors" JSONB NOT NULL,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Closeout" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "actualCostCents" BIGINT NOT NULL,
    "varianceCents" BIGINT NOT NULL,
    "attributedCents" BIGINT NOT NULL,
    "unattributedCents" BIGINT NOT NULL,

    CONSTRAINT "Closeout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseoutLineItem" (
    "id" TEXT NOT NULL,
    "closeoutId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,

    CONSTRAINT "CloseoutLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VarianceRecord" (
    "id" TEXT NOT NULL,
    "closeoutId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "note" TEXT,
    "photoId" TEXT,

    CONSTRAINT "VarianceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "exifTakenAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "PriceModel_tenantId_idx" ON "PriceModel"("tenantId");

-- CreateIndex
CREATE INDEX "PriceModelVersion_tenantId_idx" ON "PriceModelVersion"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceModelVersion_priceModelId_version_key" ON "PriceModelVersion"("priceModelId", "version");

-- CreateIndex
CREATE INDEX "Job_tenantId_idx" ON "Job"("tenantId");

-- CreateIndex
CREATE INDEX "Job_tenantId_state_idx" ON "Job"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "Measurement_jobId_key" ON "Measurement"("jobId");

-- CreateIndex
CREATE INDEX "Measurement_tenantId_idx" ON "Measurement"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_jobId_key" ON "Quote"("jobId");

-- CreateIndex
CREATE INDEX "Quote_tenantId_idx" ON "Quote"("tenantId");

-- CreateIndex
CREATE INDEX "Quote_tenantId_issuedAt_idx" ON "Quote"("tenantId", "issuedAt");

-- CreateIndex
CREATE INDEX "QuoteLineItem_tenantId_idx" ON "QuoteLineItem"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLineItem_quoteId_idx_key" ON "QuoteLineItem"("quoteId", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "Closeout_jobId_key" ON "Closeout"("jobId");

-- CreateIndex
CREATE INDEX "Closeout_tenantId_idx" ON "Closeout"("tenantId");

-- CreateIndex
CREATE INDEX "CloseoutLineItem_tenantId_idx" ON "CloseoutLineItem"("tenantId");

-- CreateIndex
CREATE INDEX "VarianceRecord_tenantId_idx" ON "VarianceRecord"("tenantId");

-- CreateIndex
CREATE INDEX "Photo_tenantId_idx" ON "Photo"("tenantId");

-- CreateIndex
CREATE INDEX "Photo_jobId_idx" ON "Photo"("jobId");

-- CreateIndex
CREATE INDEX "Event_tenantId_idx" ON "Event"("tenantId");

-- CreateIndex
CREATE INDEX "Event_jobId_at_idx" ON "Event"("jobId", "at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceModelVersion" ADD CONSTRAINT "PriceModelVersion_priceModelId_fkey" FOREIGN KEY ("priceModelId") REFERENCES "PriceModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_priceModelVersionId_fkey" FOREIGN KEY ("priceModelVersionId") REFERENCES "PriceModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Closeout" ADD CONSTRAINT "Closeout_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutLineItem" ADD CONSTRAINT "CloseoutLineItem_closeoutId_fkey" FOREIGN KEY ("closeoutId") REFERENCES "Closeout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VarianceRecord" ADD CONSTRAINT "VarianceRecord_closeoutId_fkey" FOREIGN KEY ("closeoutId") REFERENCES "Closeout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
