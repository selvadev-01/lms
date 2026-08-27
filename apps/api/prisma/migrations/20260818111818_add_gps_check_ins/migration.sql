-- CreateEnum
CREATE TYPE "gps_verification_status" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "gps_permission_status" AS ENUM ('GRANTED', 'DENIED', 'UNAVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "gps_network_status" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "gps_failure_reason" AS ENUM ('PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT', 'ACCURACY_REJECTED', 'STALE_LOCATION', 'INVALID_COORDINATES', 'PROVIDER_ERROR', 'NETWORK_LOST', 'PERSISTENCE_FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "gps_check_ins" (
    "org_id" UUID NOT NULL,
    "check_in_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "client_attempt_id" UUID NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "accuracy_meters" DECIMAL(8,2),
    "location_timestamp" TIMESTAMPTZ(6),
    "verification_status" "gps_verification_status" NOT NULL DEFAULT 'PENDING',
    "permission_status" "gps_permission_status" NOT NULL DEFAULT 'UNKNOWN',
    "network_status" "gps_network_status" NOT NULL,
    "failure_reason" "gps_failure_reason",
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "gps_check_ins_pkey" PRIMARY KEY ("org_id","check_in_id")
);

-- CreateIndex
CREATE INDEX "gps_check_ins_org_id_user_id_created_at_idx" ON "gps_check_ins"("org_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "gps_check_ins_org_id_branch_id_created_at_idx" ON "gps_check_ins"("org_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "gps_check_ins_org_id_user_id_verification_status_verified_a_idx" ON "gps_check_ins"("org_id", "user_id", "verification_status", "verified_at");

-- CreateIndex
CREATE UNIQUE INDEX "gps_check_ins_org_id_client_attempt_id_key" ON "gps_check_ins"("org_id", "client_attempt_id");

-- AddForeignKey
ALTER TABLE "gps_check_ins" ADD CONSTRAINT "gps_check_ins_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_check_ins" ADD CONSTRAINT "gps_check_ins_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "users"("org_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_check_ins" ADD CONSTRAINT "gps_check_ins_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gps_check_ins" ADD CONSTRAINT "gps_check_ins_org_id_session_id_fkey" FOREIGN KEY ("org_id", "session_id") REFERENCES "user_sessions"("org_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
