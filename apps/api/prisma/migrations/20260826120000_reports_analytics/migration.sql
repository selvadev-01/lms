-- Module 15 — Reports & Analytics
--
-- Reports are read-only views over the other modules, so this migration adds no
-- table: the only thing Module 15 owns is the saved report *definition*, and
-- `report_definitions` already existed as an unused four-column stub.
--
-- Six columns are added to it. Each is here because a scenario queries it and a
-- JSON blob could not serve that query:
--
--   * owner_user_id / visibility — Scenario 39 returns "only reports visible to
--     that user", which is a WHERE clause. Inside a JSON column it would be a
--     full scan plus a post-filter in JavaScript, which is the shape every
--     scope rule in this codebase forbids.
--   * branch_id — the scope as saved. Nullable for organization-wide
--     definitions, and never trusted at run time: Rules 4 and 27 make the
--     runner's live authorization decide, so this narrows and never widens.
--   * filters / date_basis / from_date / to_date — the request the definition
--     replays.
--   * version — Scenario 59. Two editors saving the same definition must not
--     silently overwrite each other, and optimistic concurrency needs a column.
--
-- `updated_at` is NOT NULL with a default, because the existing rows (there are
-- none in practice, but the column must be safe regardless) need a value and
-- Prisma's @updatedAt only writes on update.

-- AlterEnum: Module 15's report vocabulary.
--
-- Added rather than replacing the eight legacy values. Dropping a value from a
-- Postgres enum requires rewriting the type and every column that uses it; no
-- legacy value has ever been written by application code, so they are left in
-- place. Prefixed with CATEGORY_ because CASH and LOAN are already taken.
ALTER TYPE "report_type" ADD VALUE IF NOT EXISTS 'CATEGORY_DASHBOARD';
ALTER TYPE "report_type" ADD VALUE IF NOT EXISTS 'CATEGORY_PORTFOLIO';
ALTER TYPE "report_type" ADD VALUE IF NOT EXISTS 'CATEGORY_APPLICATIONS';
ALTER TYPE "report_type" ADD VALUE IF NOT EXISTS 'CATEGORY_DISBURSALS';
ALTER TYPE "report_type" ADD VALUE IF NOT EXISTS 'CATEGORY_COLLECTIONS';
ALTER TYPE "report_type" ADD VALUE IF NOT EXISTS 'CATEGORY_FIELD_COLLECTIONS';
ALTER TYPE "report_type" ADD VALUE IF NOT EXISTS 'CATEGORY_OVERDUE_RECOVERY';
ALTER TYPE "report_type" ADD VALUE IF NOT EXISTS 'CATEGORY_FINANCIAL';

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "report_visibility" AS ENUM ('PRIVATE', 'SHARED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

-- AlterTable
ALTER TABLE "report_definitions"
    ADD COLUMN IF NOT EXISTS "owner_user_id" UUID,
    ADD COLUMN IF NOT EXISTS "visibility" "report_visibility" NOT NULL DEFAULT 'PRIVATE',
    ADD COLUMN IF NOT EXISTS "branch_id" UUID,
    ADD COLUMN IF NOT EXISTS "filters" JSONB,
    ADD COLUMN IF NOT EXISTS "date_basis" VARCHAR(40),
    ADD COLUMN IF NOT EXISTS "from_date" DATE,
    ADD COLUMN IF NOT EXISTS "to_date" DATE,
    ADD COLUMN IF NOT EXISTS "last_run_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_definitions_org_id_owner_user_id_idx"
    ON "report_definitions"("org_id", "owner_user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "report_definitions_org_id_visibility_status_idx"
    ON "report_definitions"("org_id", "visibility", "status");

-- AddForeignKey
ALTER TABLE "report_definitions"
    ADD CONSTRAINT "report_definitions_org_id_owner_user_id_fkey"
    FOREIGN KEY ("org_id", "owner_user_id") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions"
    ADD CONSTRAINT "report_definitions_org_id_branch_id_fkey"
    FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
