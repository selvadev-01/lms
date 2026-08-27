-- Module 17 — Data retention & archival policies (Scenarios 55-58).

-- Both enums are created in THIS migration and no CHECK constraint below reads
-- a value from them, so the two-migration split that a new value on an existing
-- enum would require does not apply here.
CREATE TYPE "retention_record_category" AS ENUM (
  'AUDIT_LOG',
  'LEDGER_ENTRY',
  'JOURNAL_ENTRY',
  'NOTIFICATION_LOG',
  'MAINTENANCE_JOB',
  'USER_SESSION',
  'REPORT_RUN'
);

CREATE TYPE "retention_policy_status" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "retention_policies" (
  "org_id"                UUID NOT NULL,
  "retention_policy_id"   UUID NOT NULL DEFAULT gen_random_uuid(),
  "name"                  VARCHAR(200) NOT NULL,
  "record_category"       "retention_record_category" NOT NULL,
  "retention_period_days" INTEGER NOT NULL,
  "archive_after_days"    INTEGER,
  "purge_after_days"      INTEGER,
  "immutable_evidence"    BOOLEAN NOT NULL DEFAULT false,
  "legal_hold_supported"  BOOLEAN NOT NULL DEFAULT false,
  "status"                "retention_policy_status" NOT NULL DEFAULT 'ACTIVE',
  "referenced_at"         TIMESTAMPTZ(6),
  "version"               INTEGER NOT NULL DEFAULT 1,
  "created_by"            UUID,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by"            UUID,
  -- NOT NULL with no default, matching the Module 14 `accounts` precedent:
  -- Prisma supplies @updatedAt on every write, and a default here would let a
  -- raw INSERT that forgets the column look correct.
  "updated_at"            TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("org_id", "retention_policy_id")
);

ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A retention period must be a real duration. Zero would mean "purge
-- immediately", which no compliance policy expresses and which the purge path
-- would happily act on.
ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_period_positive"
  CHECK ("retention_period_days" > 0);

ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_archive_positive"
  CHECK ("archive_after_days" IS NULL OR "archive_after_days" > 0);

ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_purge_positive"
  CHECK ("purge_after_days" IS NULL OR "purge_after_days" > 0);

-- Purging before the retention period elapses would destroy evidence the same
-- policy claims to preserve. Refused in the database as well as the service:
-- an impossible policy must not be storable by any path (Rule 75).
--
-- Evaluated per statement, so a write that sets the columns in two steps would
-- trip this — the service always writes both together.
ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_purge_after_retention"
  CHECK (
    "purge_after_days" IS NULL
    OR "purge_after_days" >= "retention_period_days"
  );

-- Archiving is a move, not a deletion, so it may precede the purge but must not
-- precede the retention period it is meant to observe.
ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_archive_before_purge"
  CHECK (
    "archive_after_days" IS NULL
    OR "purge_after_days" IS NULL
    OR "archive_after_days" <= "purge_after_days"
  );

-- Immutable evidence is never purgeable (Rule 76, Scenario 58). Storing a purge
-- schedule against it would record an intention the purge path must refuse —
-- two sources of truth, one of them wrong.
ALTER TABLE "retention_policies"
  ADD CONSTRAINT "retention_policies_immutable_never_purges"
  CHECK (
    "immutable_evidence" = false
    OR "purge_after_days" IS NULL
  );

-- One ACTIVE policy per category per organization. Partial rather than a plain
-- UNIQUE so that retired policies accumulate freely — deactivation is the
-- sanctioned replacement path (Scenario 56), and it must not be blocked by the
-- rows it leaves behind.
CREATE UNIQUE INDEX "retention_policies_org_category_active_key"
  ON "retention_policies" ("org_id", "record_category")
  WHERE "status" = 'ACTIVE';

CREATE INDEX "retention_policies_org_status_idx"
  ON "retention_policies" ("org_id", "status");

CREATE INDEX "retention_policies_org_category_status_idx"
  ON "retention_policies" ("org_id", "record_category", "status");
