/*
  Module 05 — Guarantors: lifecycle (ACTIVE/INACTIVE), guarantor KYC status and
  full CustomerDocument parity for guarantor_documents.

  Prisma warned that `guarantor_documents.updated_at` is NOT NULL with no
  default, which fails on a non-empty table. `guarantor_documents` is empty in
  every environment today — no application code has ever written to it, the
  model was schema-only until this module. Rather than depend on that staying
  true (a hand-inserted row in someone's dev database would fail the migration),
  the column is given DEFAULT CURRENT_TIMESTAMP below. Prisma's `@updatedAt`
  writes the value on every update regardless, so the default only ever supplies
  the backfill for pre-existing rows.
*/
-- CreateEnum
CREATE TYPE "guarantor_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "guarantor_kyc_status" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SUBMITTED', 'REVISION_REQUIRED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "guarantor_documents" ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "document_number" VARCHAR(100),
ADD COLUMN     "file_name" VARCHAR(255),
ADD COLUMN     "file_size" INTEGER,
ADD COLUMN     "mime_type" VARCHAR(100),
ADD COLUMN     "superseded_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "uploaded_by" UUID,
ADD COLUMN     "verification_reason" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "verification_status" SET DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "guarantors" ADD COLUMN     "consent_by" UUID,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "deactivated_at" TIMESTAMPTZ(6),
ADD COLUMN     "deactivation_reason" VARCHAR(500),
ADD COLUMN     "kyc_reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN     "kyc_reviewed_by" UUID,
ADD COLUMN     "kyc_revision_reason" TEXT,
ADD COLUMN     "kyc_status" "guarantor_kyc_status" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "kyc_submitted_at" TIMESTAMPTZ(6),
ADD COLUMN     "status" "guarantor_status" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updated_by" UUID;

-- CreateIndex
CREATE INDEX "guarantor_documents_org_id_guarantor_id_document_type_idx" ON "guarantor_documents"("org_id", "guarantor_id", "document_type");

-- CreateIndex
CREATE INDEX "guarantors_org_id_status_idx" ON "guarantors"("org_id", "status");

-- CreateIndex
CREATE INDEX "guarantors_org_id_mobile_idx" ON "guarantors"("org_id", "mobile");

-- CreateIndex
CREATE INDEX "guarantors_org_id_full_name_idx" ON "guarantors"("org_id", "full_name");
