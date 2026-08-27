-- CreateTable
CREATE TABLE "user_sessions" (
    "org_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(50),
    "ip_address" INET,
    "user_agent" TEXT,
    "branch_id" UUID,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("org_id","session_id")
);

-- CreateIndex
CREATE INDEX "user_sessions_org_id_user_id_idx" ON "user_sessions"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "users"("org_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
