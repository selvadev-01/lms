-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "contact_email" VARCHAR(255),
ADD COLUMN     "deactivated_at" TIMESTAMPTZ(6),
ADD COLUMN     "deactivation_reason" VARCHAR(500);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "deactivated_at" TIMESTAMPTZ(6),
ADD COLUMN     "deactivation_reason" VARCHAR(500);
