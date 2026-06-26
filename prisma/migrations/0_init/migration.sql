-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'builder');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "MappingMode" AS ENUM ('direct', 'ai');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('text', 'long_text', 'number', 'single_select', 'multi_select', 'attachment');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('received', 'item_created', 'files_pending', 'mapped', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('stored', 'uploading', 'uploaded', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'builder',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "FormStatus" NOT NULL DEFAULT 'draft',
    "boardId" TEXT,
    "mappingMode" "MappingMode" NOT NULL DEFAULT 'direct',
    "aiPrompt" TEXT,
    "aiAllowedColumns" JSONB,
    "welcomeText" TEXT,
    "welcomeButtonLabel" TEXT NOT NULL DEFAULT 'Start',
    "thankYouText" TEXT,
    "theme" JSONB,
    "dailySubmissionCap" INTEGER NOT NULL DEFAULT 200,
    "privacyNotice" TEXT,
    "createdById" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB,
    "directMapping" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'received',
    "mondayItemId" TEXT,
    "aiReasoning" TEXT,
    "errorMessage" TEXT,
    "droppedColumns" JSONB,
    "clientIp" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "aiPromptRendered" TEXT,
    "aiRawResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "sanitizedFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT,
    "bytes" BYTEA NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'stored',
    "mondayAssetId" TEXT,
    "uploadedToMonday" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardSchemaCache" (
    "boardId" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardSchemaCache_pkey" PRIMARY KEY ("boardId")
);

-- CreateTable
CREATE TABLE "AuthTokenDenylist" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthTokenDenylist_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Form_slug_key" ON "Form"("slug");

-- CreateIndex
CREATE INDEX "Form_createdById_idx" ON "Form"("createdById");

-- CreateIndex
CREATE INDEX "Form_status_idx" ON "Form"("status");

-- CreateIndex
CREATE INDEX "Question_formId_order_idx" ON "Question"("formId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_idempotencyKey_key" ON "Submission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Submission_formId_createdAt_idx" ON "Submission"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");

-- CreateIndex
CREATE INDEX "Submission_status_nextAttemptAt_idx" ON "Submission"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Attachment_submissionId_idx" ON "Attachment"("submissionId");

-- CreateIndex
CREATE INDEX "Attachment_submissionId_questionId_idx" ON "Attachment"("submissionId", "questionId");

-- CreateIndex
CREATE INDEX "AuthTokenDenylist_expiresAt_idx" ON "AuthTokenDenylist"("expiresAt");

-- AddForeignKey
ALTER TABLE "Form" ADD CONSTRAINT "Form_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

