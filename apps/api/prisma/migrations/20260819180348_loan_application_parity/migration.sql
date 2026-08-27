/*
  Warnings:

  - Added the required column `updated_at` to the `loan_application_documents` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "application_review_decision" ADD VALUE 'TERMS_MODIFIED';

-- AlterEnum
ALTER TYPE "application_review_type" ADD VALUE 'MODIFY_TERMS';

-- AlterTable
ALTER TABLE "guarantor_documents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "loan_application_documents" ADD COLUMN     "document_number" VARCHAR(100),
ADD COLUMN     "file_name" VARCHAR(255),
ADD COLUMN     "file_size" INTEGER,
ADD COLUMN     "mime_type" VARCHAR(100),
ADD COLUMN     "superseded_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL,
ADD COLUMN     "verification_reason" TEXT,
ADD COLUMN     "verified_at" TIMESTAMPTZ(6),
ADD COLUMN     "verified_by" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "loan_application_reviews" ADD COLUMN     "previous_duration_count" INTEGER,
ADD COLUMN     "previous_frequency" "repayment_frequency",
ADD COLUMN     "previous_interest_rate_bps" BIGINT,
ADD COLUMN     "previous_interest_type" "interest_type";

-- AlterTable
ALTER TABLE "loan_applications" ADD COLUMN     "created_by" UUID,
ADD COLUMN     "updated_by" UUID;

-- CreateIndex
CREATE INDEX "loan_application_documents_org_id_application_id_document_t_idx" ON "loan_application_documents"("org_id", "application_id", "document_type");
