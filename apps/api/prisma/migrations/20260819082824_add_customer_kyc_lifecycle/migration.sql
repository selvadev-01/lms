-- AlterTable
ALTER TABLE "customer_documents" ADD COLUMN     "file_name" VARCHAR(255),
ADD COLUMN     "file_size" INTEGER,
ADD COLUMN     "mime_type" VARCHAR(100),
ADD COLUMN     "superseded_at" TIMESTAMPTZ(6),
ADD COLUMN     "uploaded_by" UUID,
ADD COLUMN     "verification_reason" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "email" VARCHAR(320);

-- AlterTable
ALTER TABLE "guarantors" ADD COLUMN     "consent_at" TIMESTAMPTZ(6),
ADD COLUMN     "relationship" VARCHAR(100);

-- CreateTable
CREATE TABLE "customer_mobile_verifications" (
    "org_id" UUID NOT NULL,
    "verification_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "mobile" VARCHAR(20) NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "requested_by" UUID,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_mobile_verifications_pkey" PRIMARY KEY ("org_id","verification_id")
);

-- CreateIndex
CREATE INDEX "customer_mobile_verifications_org_id_customer_id_idx" ON "customer_mobile_verifications"("org_id", "customer_id");

-- CreateIndex
CREATE INDEX "customer_documents_org_id_customer_id_document_type_idx" ON "customer_documents"("org_id", "customer_id", "document_type");

-- CreateIndex
CREATE INDEX "customers_org_id_customer_type_idx" ON "customers"("org_id", "customer_type");

-- CreateIndex
CREATE INDEX "customers_org_id_status_idx" ON "customers"("org_id", "status");

-- AddForeignKey
ALTER TABLE "customer_mobile_verifications" ADD CONSTRAINT "customer_mobile_verifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_mobile_verifications" ADD CONSTRAINT "customer_mobile_verifications_org_id_customer_id_fkey" FOREIGN KEY ("org_id", "customer_id") REFERENCES "customers"("org_id", "customer_id") ON DELETE CASCADE ON UPDATE CASCADE;
