-- Module 16 — Notifications
--
-- Four notification tables have existed since the initial schema as unused
-- stubs written before the specification. None has ever held a row, and none
-- carries the columns its rules depend on. This migration extends them in
-- place and adds four tables.
--
-- Split across two migrations on purpose. This one adds every new enum *value*;
-- `20260827120500_notifications_constraints` adds every CHECK constraint that
-- *reads* one. Postgres will not let a value added by `ALTER TYPE ... ADD VALUE`
-- be used in the same transaction that added it, and Prisma runs each migration
-- inside a transaction — so a constraint referencing a new value has to wait for
-- the next migration to commit. Merging them produces
-- "unsafe use of new value ... of enum type" at deploy time.
--
-- Notable choices, each tied to a rule the specification states:
--
--   * `notification_triggers` is RENAMED to `notification_event_rules`, not
--     dropped and recreated. It is empty either way, but a rename is the honest
--     expression of intent and survives review better than a drop.
--   * `notifications.title` / `.message` hold content rendered and frozen at
--     creation (Rule 40, Scenario 8). Reading them back through the template at
--     display time is what the specification forbids.
--   * `notifications.read_status` is a column on a per-recipient row, which is
--     what makes "User A reads, User B stays unread" structurally true rather
--     than service-enforced (Rules 51, 52; Scenario 4).
--   * `notification_events.deduplication_key` carries a UNIQUE index. That index
--     is the idempotency guarantee (Rules 12, 14, 22, 23); the service's
--     pre-check only makes a duplicate legible in the audit trail.
--
-- New NOT NULL columns without defaults are safe here only because all four
-- tables are empty. Verified before writing this file.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "notification_recipient_strategy" AS ENUM ('ROLE', 'ASSIGNED_USER', 'RECORD_OWNER', 'BRANCH_USER_GROUP', 'EXPLICIT');

-- CreateEnum
CREATE TYPE "notification_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "notification_event_status" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "email_provider_kind" AS ENUM ('CONSOLE', 'SMTP');

-- AlterEnum
-- IN_APP is the notification centre and the header bell. It is the only channel
-- the LMS itself completes, and so the only one that may report DELIVERED.
ALTER TYPE "notification_channel" ADD VALUE 'IN_APP';

-- AlterEnum
-- Rules 17, 18 and Scenario 27: a provider that accepted a message has not
-- delivered it. ACCEPTED_BY_PROVIDER is the terminal status for EMAIL and SMS
-- until delivery webhooks exist.
ALTER TYPE "notification_delivery_status" ADD VALUE 'ACCEPTED_BY_PROVIDER';
ALTER TYPE "notification_delivery_status" ADD VALUE 'RETRY_SCHEDULED';
ALTER TYPE "notification_delivery_status" ADD VALUE 'PERMANENT_FAILURE';

-- AlterEnum
-- One value per entry in the specification's Background list of source events.
-- The eight pre-existing values are reused where they already name one.
ALTER TYPE "notification_event" ADD VALUE 'APPLICATION_SUBMITTED';
ALTER TYPE "notification_event" ADD VALUE 'APPLICATION_RETURNED';
ALTER TYPE "notification_event" ADD VALUE 'APPLICATION_REJECTED';
ALTER TYPE "notification_event" ADD VALUE 'APPROVAL_REQUESTED';
ALTER TYPE "notification_event" ADD VALUE 'APPROVAL_APPROVED';
ALTER TYPE "notification_event" ADD VALUE 'APPROVAL_REJECTED';
ALTER TYPE "notification_event" ADD VALUE 'APPROVAL_ESCALATED';
ALTER TYPE "notification_event" ADD VALUE 'DISBURSAL_COMPLETED';
ALTER TYPE "notification_event" ADD VALUE 'DISBURSAL_FAILED';
ALTER TYPE "notification_event" ADD VALUE 'EMI_PARTIALLY_PAID';
ALTER TYPE "notification_event" ADD VALUE 'EMI_PAID';
ALTER TYPE "notification_event" ADD VALUE 'EMI_OVERDUE';
ALTER TYPE "notification_event" ADD VALUE 'RECEIPT_POSTED';
ALTER TYPE "notification_event" ADD VALUE 'RECEIPT_REVERSED';
ALTER TYPE "notification_event" ADD VALUE 'FIELD_SYNC_EXCEPTION';
ALTER TYPE "notification_event" ADD VALUE 'CASH_SHORTAGE';
ALTER TYPE "notification_event" ADD VALUE 'CASH_EXCESS';
ALTER TYPE "notification_event" ADD VALUE 'RECOVERY_ASSIGNED';
ALTER TYPE "notification_event" ADD VALUE 'PROMISE_TO_PAY_REMINDER';
ALTER TYPE "notification_event" ADD VALUE 'PROMISE_TO_PAY_MISSED';
ALTER TYPE "notification_event" ADD VALUE 'LOAN_FORECLOSED';
ALTER TYPE "notification_event" ADD VALUE 'LOAN_WRITTEN_OFF';
ALTER TYPE "notification_event" ADD VALUE 'NPA_STATE_CHANGED';
ALTER TYPE "notification_event" ADD VALUE 'SECURITY_ALERT';

-- AlterEnum
-- The logical lifecycle stops at SENT. Whether a provider delivered is a
-- per-attempt fact on notification_deliveries, not a logical status (Rule 17).
ALTER TYPE "notification_status" ADD VALUE 'CREATED';
ALTER TYPE "notification_status" ADD VALUE 'SENT';
ALTER TYPE "notification_status" ADD VALUE 'RETRYING';
ALTER TYPE "notification_status" ADD VALUE 'SUPPRESSED';
ALTER TYPE "notification_status" ADD VALUE 'ARCHIVED';

-- ---------------------------------------------------------------------------
-- notification_templates — extend
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "notification_templates"
  ADD COLUMN "name" VARCHAR(150) NOT NULL,
  ADD COLUMN "category" VARCHAR(50) NOT NULL,
  ADD COLUMN "source_module" VARCHAR(50) NOT NULL,
  ADD COLUMN "title_template" VARCHAR(500),
  ADD COLUMN "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
  -- Rules 55, 56: the renderer consults these before putting content on SMS or
  -- EMAIL, so PII policy is enforced at generation rather than by inspecting
  -- each seeded template by eye.
  ADD COLUMN "contains_pii" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sensitivity" VARCHAR(20) NOT NULL DEFAULT 'INTERNAL',
  -- Rule 39: notifications record which version produced their frozen content,
  -- so history survives an edit without storing a full template history.
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  -- Rule 33: protected system templates may be edited but never deleted.
  ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "updated_by" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_org_id_name_key" ON "notification_templates"("org_id", "name");

-- CreateIndex
CREATE INDEX "notification_templates_org_id_event_type_status_idx" ON "notification_templates"("org_id", "event_type", "status");

-- ---------------------------------------------------------------------------
-- notification_triggers -> notification_event_rules
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "notification_triggers" RENAME TO "notification_event_rules";
ALTER TABLE "notification_event_rules" RENAME COLUMN "trigger_id" TO "rule_id";
ALTER TABLE "notification_event_rules" RENAME COLUMN "enabled" TO "is_active";
ALTER TABLE "notification_event_rules" RENAME CONSTRAINT "notification_triggers_pkey" TO "notification_event_rules_pkey";

-- The old recipient_type is an audience category, which cannot express "whoever
-- this case is assigned to". Replaced by recipient_strategy below.
ALTER TABLE "notification_event_rules" DROP COLUMN "recipient_type";

ALTER TABLE "notification_event_rules"
  ADD COLUMN "name" VARCHAR(150) NOT NULL,
  -- Rules 34, 41 and Scenario 41: a branch-scoped rule fires only for that
  -- branch's events; NULL fires organization-wide.
  ADD COLUMN "branch_id" UUID,
  -- Scenario 15: validated server-side against a whitelist of supported pairs.
  ADD COLUMN "source_module" VARCHAR(50) NOT NULL,
  ADD COLUMN "source_trigger" VARCHAR(100) NOT NULL,
  ADD COLUMN "recipient_strategy" "notification_recipient_strategy" NOT NULL,
  ADD COLUMN "recipient_role_code" VARCHAR(50),
  ADD COLUMN "recipient_permission_code" VARCHAR(100),
  ADD COLUMN "explicit_recipient_user_ids" UUID[],
  ADD COLUMN "priority" "notification_priority" NOT NULL DEFAULT 'NORMAL',
  -- Rules 47, 48: a mandatory rule is evaluated without reading preferences.
  ADD COLUMN "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
  -- Rules 19-21: retry policy is configured, not hard-coded. Backoff is
  -- backoff_base_seconds * 2^(attempt-1), deterministic and without jitter.
  ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "backoff_base_seconds" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "send_immediately" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "scheduled_offset_days" INTEGER,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Prisma's @updatedAt writes only on update, so the column needs a default for
-- inserts; the default is then dropped so the application always supplies it.
ALTER TABLE "notification_event_rules" ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropIndex
DROP INDEX IF EXISTS "notification_triggers_org_id_event_type_channel_idx";

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_rules_org_id_name_key" ON "notification_event_rules"("org_id", "name");

-- CreateIndex
CREATE INDEX "notification_event_rules_org_id_event_type_is_active_idx" ON "notification_event_rules"("org_id", "event_type", "is_active");

-- CreateIndex
CREATE INDEX "notification_event_rules_org_id_template_id_idx" ON "notification_event_rules"("org_id", "template_id");

-- ---------------------------------------------------------------------------
-- notification_events — new (Module 16's outbox)
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "notification_events" (
    "org_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "branch_id" UUID,
    "event_type" "notification_event" NOT NULL,
    "source_module" VARCHAR(50) NOT NULL,
    "source_record_id" UUID,
    "source_version" VARCHAR(64),
    "deduplication_key" VARCHAR(300) NOT NULL,
    -- Money travels here as a decimal STRING of paise, never a JSON number:
    -- JSON numbers are IEEE-754 doubles and Rule 25 prohibits floating-point
    -- money in notification generation. Business dates travel as YYYY-MM-DD
    -- strings, because a timestamp would invent the time component Rules 26
    -- and 68 forbid.
    "payload" JSONB NOT NULL,
    -- Rule 67: when the business event happened, which is neither when this row
    -- was written nor when any delivery was attempted.
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "notification_event_status" NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("org_id","event_id")
);

-- CreateIndex
-- Rules 12, 14, 22, 23 and Scenario 23. This index, not the service check, is
-- what makes replay safe.
CREATE UNIQUE INDEX "notification_events_org_id_deduplication_key_key" ON "notification_events"("org_id", "deduplication_key");

-- CreateIndex
CREATE INDEX "notification_events_org_id_status_created_at_idx" ON "notification_events"("org_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "notification_events_org_id_event_type_occurred_at_idx" ON "notification_events"("org_id", "event_type", "occurred_at");

-- ---------------------------------------------------------------------------
-- notifications — extend
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "notifications"
  ADD COLUMN "event_id" UUID,
  ADD COLUMN "rule_id" UUID,
  -- Denormalised from the event so branch scoping is an indexed predicate
  -- rather than a three-table join (Rules 2, 4; Scenarios 40, 42).
  ADD COLUMN "branch_id" UUID,
  ADD COLUMN "recipient_role_snapshot" VARCHAR(200),
  ADD COLUMN "template_version" INTEGER,
  -- Rendered and frozen at creation. Rule 40 and Scenario 8: editing a template
  -- must not retroactively rewrite what was already communicated.
  ADD COLUMN "title" VARCHAR(250) NOT NULL,
  ADD COLUMN "message" TEXT NOT NULL,
  ADD COLUMN "rendered_payload_hash" VARCHAR(64),
  ADD COLUMN "priority" "notification_priority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
  -- Scenario 20: a suppressed notification is a created row, not a silent drop,
  -- so the suppression outcome has somewhere to be recorded.
  ADD COLUMN "suppression_reason" VARCHAR(100),
  -- Rules 51, 52 and Scenario 4: per-recipient read state on a per-recipient row.
  ADD COLUMN "read_status" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "read_at" TIMESTAMPTZ(6),
  -- Rule 71 and Scenario 46: soft archival. Neither this row nor its attempts
  -- are ever hard-deleted (Rule 70, Scenario 47).
  ADD COLUMN "archived_at" TIMESTAMPTZ(6),
  ADD COLUMN "queued_at" TIMESTAMPTZ(6),
  ADD COLUMN "processed_at" TIMESTAMPTZ(6),
  ADD COLUMN "sent_at" TIMESTAMPTZ(6),
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "notifications" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "notifications" ALTER COLUMN "status" SET DEFAULT 'CREATED';

-- CreateIndex
-- The notification centre and bell-badge query. read_status is a column rather
-- than a derived join precisely so this index can exist.
CREATE INDEX "notifications_org_id_recipient_user_id_read_status_created__idx" ON "notifications"("org_id", "recipient_user_id", "read_status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_org_id_branch_id_created_at_idx" ON "notifications"("org_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_org_id_event_id_idx" ON "notifications"("org_id", "event_id");

-- ---------------------------------------------------------------------------
-- notification_deliveries — extend
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "notification_deliveries"
  ADD COLUMN "provider" VARCHAR(50),
  -- Rule 18: the provider's own status preserved verbatim beside the canonical
  -- one, so mapping never loses the original response.
  ADD COLUMN "provider_status" VARCHAR(100),
  -- Rules 19, 20 and Scenarios 28, 29: what the retryable-versus-permanent
  -- decision keys on.
  ADD COLUMN "failure_code" VARCHAR(100),
  ADD COLUMN "completed_at" TIMESTAMPTZ(6),
  ADD COLUMN "next_retry_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "notification_deliveries_org_id_status_next_retry_at_idx" ON "notification_deliveries"("org_id", "status", "next_retry_at");

-- ---------------------------------------------------------------------------
-- notification_preferences — new
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE "notification_preferences" (
    "org_id" UUID NOT NULL,
    "preference_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
    -- The nine specification event categories as a flat boolean map. A row per
    -- category would be nine writes per save and buys no query benefit, since
    -- evaluation always reads the whole record for one user.
    "event_preferences" JSONB NOT NULL DEFAULT '{}',
    -- Rules 65, 66 and Scenarios 21, 51: optimistic concurrency. A mismatch is
    -- a 409 carrying current server state, never a silent overwrite.
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("org_id","preference_id")
);

-- CreateIndex
-- Rules 49, 50: preferences are scoped to one user in one organization.
CREATE UNIQUE INDEX "notification_preferences_org_id_user_id_key" ON "notification_preferences"("org_id", "user_id");

-- ---------------------------------------------------------------------------
-- email_provider_configs — new
-- ---------------------------------------------------------------------------

-- CreateTable
-- Mirrors sms_provider_configs, including its central omission: there is no
-- password column. The database says which provider and how to address it; the
-- environment (SMTP_PASSWORD) says how to authenticate.
CREATE TABLE "email_provider_configs" (
    "org_id" UUID NOT NULL,
    "config_id" UUID NOT NULL,
    "provider" "email_provider_kind" NOT NULL,
    "host" VARCHAR(200),
    "port" INTEGER,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "username" VARCHAR(200),
    "from_address" VARCHAR(320),
    "from_name" VARCHAR(200),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "email_provider_configs_pkey" PRIMARY KEY ("org_id","config_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_provider_configs_org_id_key" ON "email_provider_configs"("org_id");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_event_rules" ADD CONSTRAINT "notification_event_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_event_rules" ADD CONSTRAINT "notification_event_rules_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT, not CASCADE: Rule 36 and Scenario 11 require deletion of a
-- referenced template to be blocked, not to silently take its rules with it.
ALTER TABLE "notification_event_rules" ADD CONSTRAINT "notification_event_rules_org_id_template_id_fkey" FOREIGN KEY ("org_id", "template_id") REFERENCES "notification_templates"("org_id", "template_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_branch_id_fkey" FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches"("org_id", "branch_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_event_id_fkey" FOREIGN KEY ("org_id", "event_id") REFERENCES "notification_events"("org_id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_user_id_fkey" FOREIGN KEY ("org_id", "user_id") REFERENCES "users"("org_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_provider_configs" ADD CONSTRAINT "email_provider_configs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id") ON DELETE CASCADE ON UPDATE CASCADE;
