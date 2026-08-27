-- CreateTable
CREATE TABLE "password_history" (
    "org_id" UUID NOT NULL,
    "history_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("org_id","history_id")
);

-- CreateIndex
CREATE INDEX "password_history_org_id_user_id_created_at_idx" ON "password_history"("org_id", "user_id", "created_at");

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "users"("org_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;
