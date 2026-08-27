-- AlterEnum
ALTER TYPE "user_status" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "is_system" BOOLEAN NOT NULL DEFAULT false;
