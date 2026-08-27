-- CreateEnum
CREATE TYPE "recovery_request_status" AS ENUM ('REQUESTED', 'VERIFIED', 'COMPLETED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_changed_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "password_recovery_requests" (
    "org_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "reset_token_hash" TEXT,
    "status" "recovery_request_status" NOT NULL DEFAULT 'REQUESTED',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "resend_count" INTEGER NOT NULL DEFAULT 0,
    "last_sent_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "token_expires_at" TIMESTAMPTZ(6),
    "consumed_at" TIMESTAMPTZ(6),
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "password_recovery_requests_pkey" PRIMARY KEY ("org_id","request_id")
);

-- CreateIndex
CREATE INDEX "password_recovery_requests_org_id_user_id_status_idx" ON "password_recovery_requests"("org_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "password_recovery_requests_expires_at_idx" ON "password_recovery_requests"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_recovery_requests_reset_token_hash_key" ON "password_recovery_requests"("reset_token_hash");

-- AddForeignKey
ALTER TABLE "password_recovery_requests" ADD CONSTRAINT "password_recovery_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_recovery_requests" ADD CONSTRAINT "password_recovery_requests_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "users"("org_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
