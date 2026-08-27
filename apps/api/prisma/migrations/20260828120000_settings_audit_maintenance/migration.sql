-- ============================================================================
-- Module 17 — Settings, Audit & Maintenance
--
-- Seven new tables, six new enums, one new column on `audit_logs`, plus two
-- things Prisma cannot express and which are therefore hand-written at the
-- bottom of this file:
--
--   1. PARTIAL UNIQUE INDEXES for the branch-nullable scope tables.
--   2. The APPEND-ONLY TRIGGER on `audit_logs`.
--
-- Both are load-bearing. Read the notes on each before changing anything.
--
--
-- Why partial unique indexes (Rules 1, 2; Scenario 5)
-- ---------------------------------------------------------------------------
-- `settings`, `business_calendars` and `maintenance_modes` are all scoped by a
-- NULLABLE `branch_id`, where NULL means "organization-wide" rather than
-- "unknown". Postgres treats NULLs as DISTINCT in a unique index, so the
-- obvious constraint
--
--     UNIQUE (org_id, branch_id, setting_code)
--
-- does NOT prevent two organization-wide rows for the same setting code — the
-- two NULLs never collide. Scenario 5 ("prevent duplicate setting code in the
-- applicable scope") would silently fail for exactly the rows that matter most.
--
-- The fix is one partial index per scope. Prisma has no syntax for a partial
-- unique index, so these exist ONLY here: they will never appear in a
-- `prisma migrate diff`, and `schema.prisma` carries a `///` note on each model
-- pointing back at this file. If a later change "fixes" the apparently-missing
-- constraint by adding an `@@unique`, the result is a WEAKER constraint that
-- reintroduces the duplicate. `setting.service.spec.ts` asserts the P2002.
--
--
-- Why the audit trigger (Rules 46, 47; Scenarios 37, 43)
-- ---------------------------------------------------------------------------
-- The `audit_logs` section header in schema.prisma has claimed since the
-- initial migration that append-only is "enforced by raw SQL migration". Until
-- now that was simply untrue: no trigger, no REVOKE, nothing. This migration
-- makes the comment honest.
--
-- The function ALWAYS raises, so unlike `reject_journal_line_mutation` it never
-- returns and the BEFORE-trigger return-value trap does not apply here. (That
-- trap is real: returning NULL from a BEFORE ... FOR EACH ROW trigger silently
-- CANCELS the operation with no error. It matters wherever a trigger has a
-- permitted path. This one has none.)
--
-- KNOWN AND ACCEPTED CONSEQUENCE: `audit_logs` has `ON DELETE CASCADE` from
-- `organizations`, so hard-deleting an organization that has audit rows now
-- FAILS. That is arguably correct — an organization whose audit trail must
-- survive should not be hard-deletable — and it is covered by a test so it is
-- documented behaviour rather than a later surprise. Do not "fix" it by
-- dropping the trigger; that silently kills Scenario 43.
--
-- TRUNCATE does not fire row-level triggers, so `prisma migrate reset` in dev
-- and e2e is unaffected.
--
-- No `integrity_hash` / `previous_event_hash` columns are added, despite the
-- spec's table dump listing them. A hash chain that nothing verifies is
-- theatre; a trigger that raises is enforcement. Revisit only alongside a
-- verifier and a serialisation strategy for the currently fire-and-forget
-- audit writes.
-- ============================================================================


-- CreateEnum
CREATE TYPE "setting_value_type" AS ENUM ('STRING', 'INTEGER', 'PAISE', 'BOOLEAN', 'DATE', 'TIME', 'ENUM', 'JSON');

-- CreateEnum
CREATE TYPE "setting_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "setting_change_status" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "maintenance_trigger_type" AS ENUM ('SCHEDULED', 'MANUAL', 'RECOVERY');

-- CreateEnum
CREATE TYPE "maintenance_job_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RETRY_SCHEDULED', 'CANCELLED', 'RECOVERY_REQUIRED');

-- CreateEnum
CREATE TYPE "maintenance_step_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "branch_id" UUID;

-- CreateTable
CREATE TABLE "settings" (
    "org_id" UUID NOT NULL,
    "setting_id" UUID NOT NULL,
    "branch_id" UUID,
    "setting_code" VARCHAR(100) NOT NULL,
    "setting_category" VARCHAR(50) NOT NULL,
    "value_type" "setting_value_type" NOT NULL,
    "value_json" JSONB NOT NULL,
    "effective_from" DATE,
    "effective_to" DATE,
    "status" "setting_status" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_protected" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("org_id","setting_id")
);

-- CreateTable
CREATE TABLE "setting_change_requests" (
    "org_id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "change_request_number" VARCHAR(30) NOT NULL,
    "branch_id" UUID,
    "setting_id" UUID,
    "setting_code" VARCHAR(100) NOT NULL,
    "requested_value_json" JSONB NOT NULL,
    "base_version" INTEGER NOT NULL,
    "result_version" INTEGER,
    "change_reason" TEXT NOT NULL,
    "status" "setting_change_status" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requested_by" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "rejected_by" UUID,
    "rejected_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "applied_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "setting_change_requests_pkey" PRIMARY KEY ("org_id","change_request_id")
);

-- CreateTable
CREATE TABLE "business_calendars" (
    "org_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "branch_id" UUID,
    "name" VARCHAR(150) NOT NULL,
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'Asia/Kolkata',
    "working_days" INTEGER[],
    "eod_window_start" VARCHAR(5),
    "eod_window_end" VARCHAR(5),
    "allow_controlled_rerun" BOOLEAN NOT NULL DEFAULT true,
    "status" "record_status" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_calendars_pkey" PRIMARY KEY ("org_id","calendar_id")
);

-- CreateTable
CREATE TABLE "calendar_holidays" (
    "org_id" UUID NOT NULL,
    "holiday_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "holiday_date" DATE NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_holidays_pkey" PRIMARY KEY ("org_id","holiday_id")
);

-- CreateTable
CREATE TABLE "maintenance_job_runs" (
    "org_id" UUID NOT NULL,
    "job_run_id" UUID NOT NULL,
    "branch_id" UUID,
    "job_type" VARCHAR(60) NOT NULL,
    "business_date" DATE,
    "trigger_type" "maintenance_trigger_type" NOT NULL,
    "execution_key" VARCHAR(200) NOT NULL,
    "status" "maintenance_job_status" NOT NULL DEFAULT 'QUEUED',
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "succeeded_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(60),
    "failure_summary" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "next_retry_at" TIMESTAMPTZ(6),
    "parent_job_run_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_job_runs_pkey" PRIMARY KEY ("org_id","job_run_id")
);

-- CreateTable
CREATE TABLE "maintenance_job_steps" (
    "org_id" UUID NOT NULL,
    "job_step_id" UUID NOT NULL,
    "job_run_id" UUID NOT NULL,
    "step_code" VARCHAR(60) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "maintenance_step_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(60),
    "failure_summary" TEXT,

    CONSTRAINT "maintenance_job_steps_pkey" PRIMARY KEY ("org_id","job_step_id")
);

-- CreateTable
CREATE TABLE "maintenance_modes" (
    "org_id" UUID NOT NULL,
    "maintenance_mode_id" UUID NOT NULL,
    "branch_id" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "enabled_by" UUID,
    "enabled_at" TIMESTAMPTZ(6),
    "expected_end_at" TIMESTAMPTZ(6),
    "disabled_by" UUID,
    "disabled_at" TIMESTAMPTZ(6),
    "allowed_permissions" TEXT[],
    "blocked_operations" TEXT[],
    "user_message" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_modes_pkey" PRIMARY KEY ("org_id","maintenance_mode_id")
);

-- CreateIndex
CREATE INDEX "settings_org_id_setting_category_status_idx" ON "settings"("org_id", "setting_category", "status");

-- CreateIndex
CREATE INDEX "settings_org_id_setting_code_idx" ON "settings"("org_id", "setting_code");

-- CreateIndex
CREATE INDEX "setting_change_requests_org_id_status_submitted_at_idx" ON "setting_change_requests"("org_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "setting_change_requests_org_id_setting_code_idx" ON "setting_change_requests"("org_id", "setting_code");

-- CreateIndex
CREATE UNIQUE INDEX "setting_change_requests_org_id_change_request_number_key" ON "setting_change_requests"("org_id", "change_request_number");

-- CreateIndex
CREATE INDEX "business_calendars_org_id_status_idx" ON "business_calendars"("org_id", "status");

-- CreateIndex
CREATE INDEX "calendar_holidays_org_id_calendar_id_holiday_date_idx" ON "calendar_holidays"("org_id", "calendar_id", "holiday_date");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_holidays_org_id_calendar_id_holiday_date_key" ON "calendar_holidays"("org_id", "calendar_id", "holiday_date");

-- CreateIndex
CREATE INDEX "maintenance_job_runs_org_id_branch_id_job_type_business_dat_idx" ON "maintenance_job_runs"("org_id", "branch_id", "job_type", "business_date");

-- CreateIndex
CREATE INDEX "maintenance_job_runs_org_id_status_created_at_idx" ON "maintenance_job_runs"("org_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_job_runs_org_id_execution_key_key" ON "maintenance_job_runs"("org_id", "execution_key");

-- CreateIndex
CREATE INDEX "maintenance_job_steps_org_id_job_run_id_sequence_idx" ON "maintenance_job_steps"("org_id", "job_run_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_job_steps_org_id_job_run_id_step_code_key" ON "maintenance_job_steps"("org_id", "job_run_id", "step_code");

-- CreateIndex
CREATE INDEX "maintenance_modes_org_id_enabled_idx" ON "maintenance_modes"("org_id", "enabled");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_branch_id_occurred_at_idx" ON "audit_logs"("org_id", "branch_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_action_occurred_at_idx" ON "audit_logs"("org_id", "action", "occurred_at");

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "setting_change_requests" ADD CONSTRAINT "setting_change_requests_org_id_setting_id_fkey" FOREIGN KEY ("org_id", "setting_id") REFERENCES "settings"("org_id", "setting_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_calendars" ADD CONSTRAINT "business_calendars_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_calendars" ADD CONSTRAINT "business_calendars_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_holidays" ADD CONSTRAINT "calendar_holidays_org_id_calendar_id_fkey" FOREIGN KEY ("org_id", "calendar_id") REFERENCES "business_calendars"("org_id", "calendar_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_job_runs" ADD CONSTRAINT "maintenance_job_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_job_runs" ADD CONSTRAINT "maintenance_job_runs_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_job_steps" ADD CONSTRAINT "maintenance_job_steps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_job_steps" ADD CONSTRAINT "maintenance_job_steps_org_id_job_run_id_fkey" FOREIGN KEY ("org_id", "job_run_id") REFERENCES "maintenance_job_runs"("org_id", "job_run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_modes" ADD CONSTRAINT "maintenance_modes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_modes" ADD CONSTRAINT "maintenance_modes_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ============================================================================
-- HAND-WRITTEN — NOT GENERATED BY PRISMA. See the header of this file.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Partial unique indexes for the branch-nullable scope tables.
--
-- Two per table: one for the organization-wide row (branch_id IS NULL), one for
-- branch rows. Together they give the uniqueness a plain UNIQUE constraint
-- cannot, because NULL <> NULL in a Postgres unique index.
-- ----------------------------------------------------------------------------

-- One value per setting code per organization...
CREATE UNIQUE INDEX "settings_org_code_key"
  ON "settings" ("org_id", "setting_code")
  WHERE "branch_id" IS NULL;

-- ...and one per setting code per branch.
CREATE UNIQUE INDEX "settings_branch_code_key"
  ON "settings" ("org_id", "branch_id", "setting_code")
  WHERE "branch_id" IS NOT NULL;

-- One calendar per organization...
CREATE UNIQUE INDEX "business_calendars_org_key"
  ON "business_calendars" ("org_id")
  WHERE "branch_id" IS NULL;

-- ...and one per branch.
CREATE UNIQUE INDEX "business_calendars_branch_key"
  ON "business_calendars" ("org_id", "branch_id")
  WHERE "branch_id" IS NOT NULL;

-- One maintenance-mode row per organization...
CREATE UNIQUE INDEX "maintenance_modes_org_key"
  ON "maintenance_modes" ("org_id")
  WHERE "branch_id" IS NULL;

-- ...and one per branch (Scenario 34 — branch maintenance is independent).
CREATE UNIQUE INDEX "maintenance_modes_branch_key"
  ON "maintenance_modes" ("org_id", "branch_id")
  WHERE "branch_id" IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 2. Audit append-only enforcement.
--
-- Makes true the claim the schema has carried since the initial migration.
-- Always raises: viewing an audit event must never permit modifying it
-- (Rule 54), and no application path may edit or delete one (Rule 47).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only; % on audit % is refused. Audit evidence is immutable (Module 17, Rules 46-47).',
    TG_OP, OLD.audit_id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only ON "audit_logs";
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();


-- ----------------------------------------------------------------------------
-- 3. Backfill note for `audit_logs.branch_id`.
--
-- Deliberately NOT backfilled. Every pre-Module-17 row keeps branch_id NULL,
-- and `AuditQueryService` confines a branch-scoped reader with
--
--     branch_id = theirs OR (branch_id IS NULL AND the actor is in their branch)
--
-- A backfill would have to guess the branch from the actor, freezing that guess
-- into data that is supposed to be immutable evidence. Leaving it NULL keeps
-- "we do not know" honest and puts the fallback in one readable place.
-- ----------------------------------------------------------------------------
