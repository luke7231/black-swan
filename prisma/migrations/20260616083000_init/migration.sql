-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceName" AS ENUM ('balletmania', 'esangdance');

-- CreateEnum
CREATE TYPE "ScraperRunStatus" AS ENUM ('running', 'success', 'failed');

-- CreateTable
CREATE TABLE "SourcePost" (
    "id" TEXT NOT NULL,
    "source" "SourceName" NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "rawJson" JSONB NOT NULL,
    "classificationJson" JSONB,
    "contentHash" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPost" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourcePrimary" "SourceName" NOT NULL,
    "status" TEXT,
    "postedAt" TIMESTAMP(3),
    "jobType" TEXT,
    "isBallet" BOOLEAN NOT NULL DEFAULT false,
    "balletConfidence" TEXT,
    "audienceTypes" JSONB NOT NULL,
    "subjectTypes" JSONB NOT NULL,
    "locationText" TEXT,
    "sido" TEXT,
    "sigungu" TEXT,
    "dongOrStation" TEXT,
    "days" JSONB NOT NULL,
    "timeSlots" JSONB NOT NULL,
    "times" JSONB NOT NULL,
    "classCount" INTEGER,
    "durationMinutes" INTEGER,
    "payType" TEXT,
    "payMinManwon" DOUBLE PRECISION,
    "payMaxManwon" DOUBLE PRECISION,
    "payText" TEXT,
    "payNegotiable" BOOLEAN NOT NULL DEFAULT false,
    "contactMethods" JSONB NOT NULL,
    "contactEmails" JSONB NOT NULL,
    "contactPhones" JSONB NOT NULL,
    "requirementsJson" JSONB NOT NULL,
    "confidenceJson" JSONB,
    "normalizedJson" JSONB NOT NULL,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobPostSource" (
    "id" TEXT NOT NULL,
    "jobPostId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "source" "SourceName" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "confidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobPostSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperRun" (
    "id" TEXT NOT NULL,
    "source" "SourceName",
    "targetDate" TEXT NOT NULL,
    "llmMode" TEXT NOT NULL,
    "status" "ScraperRunStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "collected" INTEGER NOT NULL DEFAULT 0,
    "classified" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "logs" JSONB,

    CONSTRAINT "ScraperRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourcePost_source_postedAt_idx" ON "SourcePost"("source", "postedAt");

-- CreateIndex
CREATE INDEX "SourcePost_contentHash_idx" ON "SourcePost"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SourcePost_source_sourcePostId_key" ON "SourcePost"("source", "sourcePostId");

-- CreateIndex
CREATE INDEX "JobPost_postedAt_idx" ON "JobPost"("postedAt");

-- CreateIndex
CREATE INDEX "JobPost_sourcePrimary_idx" ON "JobPost"("sourcePrimary");

-- CreateIndex
CREATE INDEX "JobPost_contentHash_idx" ON "JobPost"("contentHash");

-- CreateIndex
CREATE INDEX "JobPostSource_source_sourceUrl_idx" ON "JobPostSource"("source", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "JobPostSource_jobPostId_sourcePostId_key" ON "JobPostSource"("jobPostId", "sourcePostId");

-- AddForeignKey
ALTER TABLE "JobPostSource" ADD CONSTRAINT "JobPostSource_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobPostSource" ADD CONSTRAINT "JobPostSource_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "SourcePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
