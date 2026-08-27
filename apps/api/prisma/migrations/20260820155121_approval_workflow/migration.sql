-- CreateEnum
CREATE TYPE "sanction_response" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "application_review_decision" ADD VALUE 'SANCTIONED';
ALTER TYPE "application_review_decision" ADD VALUE 'CUSTOMER_ACCEPTED';
ALTER TYPE "application_review_decision" ADD VALUE 'AGREEMENT_SIGNED';

-- AlterEnum
ALTER TYPE "application_review_type" ADD VALUE 'SANCTION';

-- AlterTable
ALTER TABLE "credit_assessments" ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "income_monthly_paise" BIGINT,
ADD COLUMN     "superseded_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "loan_applications" ADD COLUMN     "customer_responded_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "sanction_letters" (
    "org_id" UUID NOT NULL,
    "sanction_letter_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "sanction_number" VARCHAR(50) NOT NULL,
    "sanctioned_amount_paise" BIGINT NOT NULL,
    "interest_type" "interest_type" NOT NULL,
    "interest_rate_bps" BIGINT NOT NULL,
    "repayment_frequency" "repayment_frequency" NOT NULL,
    "duration_count" INTEGER NOT NULL,
    "installment_amount_paise" BIGINT NOT NULL,
    "total_payable_paise" BIGINT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID NOT NULL,
    "valid_until" DATE,
    "notes" TEXT,
    "customer_response" "sanction_response" NOT NULL DEFAULT 'PENDING',
    "customer_responded_at" TIMESTAMPTZ(6),
    "response_recorded_by" UUID,
    "decline_reason" TEXT,
    "agreement_signed_at" TIMESTAMPTZ(6),
    "agreement_signed_recorded_by" UUID,
    "agreement_reference" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sanction_letters_pkey" PRIMARY KEY ("org_id","sanction_letter_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sanction_letters_org_id_application_id_key" ON "sanction_letters"("org_id", "application_id");

-- CreateIndex
CREATE UNIQUE INDEX "sanction_letters_org_id_sanction_number_key" ON "sanction_letters"("org_id", "sanction_number");

-- CreateIndex
CREATE INDEX "credit_assessments_org_id_application_id_superseded_at_idx" ON "credit_assessments"("org_id", "application_id", "superseded_at");

-- AddForeignKey
ALTER TABLE "sanction_letters" ADD CONSTRAINT "sanction_letters_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanction_letters" ADD CONSTRAINT "sanction_letters_org_id_application_id_fkey" FOREIGN KEY ("org_id", "application_id") REFERENCES "loan_applications"("org_id", "application_id") ON DELETE CASCADE ON UPDATE CASCADE;
