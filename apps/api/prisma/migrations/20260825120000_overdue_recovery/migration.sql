-- Module 13 — Overdue & Recovery.
--
-- Four things happen here, and the ordering between them is not negotiable.
--
--  1. `loan_status` gains `NPA` and `FORECLOSED`. These run FIRST and alone,
--     because `ALTER TYPE ... ADD VALUE` forces Postgres out of the transaction
--     Prisma wraps around a migration. Anything before them that failed would
--     already be committed and `migrate resolve --rolled-back` could not undo
--     it.
--  2. The classification and outcome enums this module introduces.
--  3. The four placeholder recovery tables — created by the init migration and
--     never revisited — are brought up to the standard Modules 09-14 set: a
--     document number, a concurrency token, idempotency columns, `created_by`,
--     and the money identities as CHECK constraints. A new
--     `recovery_case_assignments` table carries assignment history, which Rule
--     25 requires and a single mutable `assigned_agent_id` cannot express.
--  4. `5100 Loan Write-off Expense` — the first expense account in the chart.
--
-- **Every statement is idempotent.** Because step 1 breaks the wrapping
-- transaction, a failure partway through leaves earlier DDL committed. IF NOT
-- EXISTS / IF EXISTS guards and `DO $$` existence checks throughout mean a
-- retry over a partially-applied database converges instead of erroring.
--
-- Nullable columns are compared with IS NOT DISTINCT FROM, never `=`: NULL = NULL
-- is NULL, which would fail an AND chain and refuse a legitimate transition.
--
-- # What this module does NOT add
--
-- No penalty-receivable, interest-receivable or fee-receivable account. The
-- source's Scenario 22 asks a recovery payment to credit those, but this ledger
-- is cash-basis: `postDisbursement` raises only principal as an asset, and
-- interest is recognised as income at the moment of collection. Crediting an
-- "interest receivable" would drive an account that never had a balance
-- increasingly negative, and the balance sheet would be wrong by the cumulative
-- interest ever collected. A recovery payment therefore posts exactly what a
-- Module 11 collection posts, through the same `LedgerService.postCollection`.
-- See `ledger-accounts.ts`, which documents the same decision for Module 11.
--
-- No overdue snapshot table. `PENDING -> DUE -> OVERDUE` is derived at read time
-- by `deriveEmiStatus`, comparing `due_date` to the Asia/Kolkata business date
-- (see the `emis` comment in the schema). A stored overdue table would be a
-- second reading of "which installment is due" and would drift from the
-- schedule screen within a release. Days past due, delinquency bucket and NPA
-- classification are likewise derived from authoritative dates and balances,
-- which is what makes Scenario 8 replayable.


-- ---------------------------------------------------------------------------
-- 1. loan_status — NPA and FORECLOSED
--
-- `NPA` is a lifecycle state rather than only a classification flag: Rule 29
-- makes the transition authorized and auditable, and Scenario 41 requires
-- ordinary recovery actions to be refused once a loan reaches a terminal state.
-- Modelling it as a status is what lets every existing `status` guard refuse it
-- by default instead of each one growing a second condition.
--
-- `FORECLOSED` is added for the same reason, though no module can currently
-- produce it — the source's lifecycle (line 89) and Scenario 41 both name it,
-- and a guard cannot refuse a state the enum cannot hold. The transition INTO
-- foreclosure is out of Module 13's scope.
--
-- MUST be the first statements in this file. See the header.
-- ---------------------------------------------------------------------------

ALTER TYPE "loan_status" ADD VALUE IF NOT EXISTS 'NPA';

ALTER TYPE "loan_status" ADD VALUE IF NOT EXISTS 'FORECLOSED';


-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------

-- What came of a recovery contact attempt.
--
-- Split from `recovery_action_type` because the two answer different questions:
-- the type is what the officer did, the outcome is what happened. Scenario 13
-- stores both, and collapsing them would make "phoned, no answer" and "phoned,
-- promised to pay" the same record.
DO $$ BEGIN
  CREATE TYPE "recovery_outcome" AS ENUM (
    'CONTACTED_PROMISED',
    'CONTACTED_REFUSED',
    'CONTACTED_DISPUTED',
    'CONTACTED_PARTIAL_PAYMENT',
    'NO_ANSWER',
    'UNREACHABLE',
    'WRONG_CONTACT',
    'CUSTOMER_UNAVAILABLE',
    'ESCALATION_REQUIRED',
    'RESOLVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "recovery_priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Delinquency ageing buckets.
--
-- The source's Open Question 3 asks whether buckets are configurable and what
-- the ranges are. These are the standard Indian NBFC ranges and they are fixed
-- rather than configurable: a bucket is derived from days past due at read
-- time, so a configurable range would silently reclassify historical reporting
-- the moment someone edited it. A future module that genuinely needs per-org
-- ranges can add the configuration and a snapshot together.
--
--   CURRENT   0 days past due
--   DPD_1_30  1-30      DPD_31_60  31-60     DPD_61_90  61-90
--   DPD_91_180 91-180   DPD_180_PLUS 181+
DO $$ BEGIN
  CREATE TYPE "delinquency_bucket" AS ENUM (
    'CURRENT',
    'DPD_1_30',
    'DPD_31_60',
    'DPD_61_90',
    'DPD_91_180',
    'DPD_180_PLUS'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Asset classification.
--
-- Open Questions 4 and 5 ask what moves a loan into NPA and whether it is
-- automatic. The answer implemented here: 90 days past due makes a loan
-- *eligible* for NPA and the system derives and surfaces that, but the
-- transition of `loans.status` to `NPA` is an authorized action (Rule 29), not
-- an automatic write. That is why this enum lives on the recovery case as a
-- derived-and-confirmed classification rather than being inferred silently.
DO $$ BEGIN
  CREATE TYPE "npa_status" AS ENUM (
    'STANDARD',
    'SPECIAL_MENTION',
    'SUB_STANDARD',
    'DOUBTFUL',
    'LOSS'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- How a recovery case ended.
--
-- `WRITTEN_OFF` and `SETTLED` are distinct from `RECOVERED_FULL`: all three
-- close the case, but only the first two leave the borrower owing less than
-- they contracted to pay, and Scenario 39 requires the closure record to say
-- which happened.
DO $$ BEGIN
  CREATE TYPE "recovery_resolution_type" AS ENUM (
    'RECOVERED_FULL',
    'RECOVERED_PARTIAL',
    'SETTLED',
    'WRITTEN_OFF',
    'RESTRUCTURED',
    'LEGAL_ACTION',
    'NOT_RECOVERABLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- 3. recovery_cases
--
-- Brought up to the Modules 09-14 standard. Every column added here is
-- nullable or defaulted: the table is empty today, but these guards are what
-- make a retry over a partially-applied database converge.
-- ---------------------------------------------------------------------------

ALTER TABLE "recovery_cases"
  -- `RC-<BRANCH>-000001`, allocated per branch inside the creating transaction,
  -- on the `RCP-`/`CH-`/`CR-` precedent. Nullable because the column is added
  -- to a live table; the service always supplies it.
  ADD COLUMN IF NOT EXISTS "case_number" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "priority" "recovery_priority" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS "npa_status" "npa_status" NOT NULL DEFAULT 'STANDARD',
  -- When the current assignee took the case. The full history lives in
  -- `recovery_case_assignments`; this is the denormalised pointer that keeps
  -- the list query a single read.
  ADD COLUMN IF NOT EXISTS "assignment_date" DATE,
  ADD COLUMN IF NOT EXISTS "created_by" UUID,
  ADD COLUMN IF NOT EXISTS "closed_by" UUID,
  ADD COLUMN IF NOT EXISTS "closure_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "resolution_type" "recovery_resolution_type",
  -- The outstanding figure at the moment of closure and what was actually
  -- recovered. Snapshotted rather than derived because Scenario 39 requires the
  -- closure record to remain true after later movements on the loan.
  ADD COLUMN IF NOT EXISTS "outstanding_before_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "recovered_amount_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "remaining_outstanding_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "approval_reference" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "escalated_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "escalation_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "request_fingerprint" VARCHAR(64);

-- One case number per organization, and one idempotency key per organization.
-- Postgres does not collide NULLs in a unique index, so rows predating the
-- columns coexist.
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_cases_org_id_case_number_key"
  ON "recovery_cases" ("org_id", "case_number");

CREATE UNIQUE INDEX IF NOT EXISTS "recovery_cases_org_id_idempotency_key_key"
  ON "recovery_cases" ("org_id", "idempotency_key");

-- At most one open case per loan.
--
-- A partial unique index rather than a CHECK: "open" is every status except
-- CLOSED, and a second open case on the same loan would give two officers
-- conflicting authority over one borrower with nothing to detect it. Closed
-- cases are excluded so a loan that falls overdue again can open a fresh case.
CREATE UNIQUE INDEX IF NOT EXISTS "recovery_cases_one_open_per_loan"
  ON "recovery_cases" ("org_id", "loan_id")
  WHERE "status" <> 'CLOSED';

-- The recovery worklist query: a branch's open cases, oldest first.
CREATE INDEX IF NOT EXISTS "recovery_cases_org_id_assigned_agent_id_status_idx"
  ON "recovery_cases" ("org_id", "assigned_agent_id", "status");

DO $$ BEGIN
  ALTER TABLE "recovery_cases"
    ADD CONSTRAINT "recovery_cases_org_id_created_by_fkey"
    FOREIGN KEY ("org_id", "created_by") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_cases"
    ADD CONSTRAINT "recovery_cases_org_id_closed_by_fkey"
    FOREIGN KEY ("org_id", "closed_by") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A closed case must say how it ended, and a case that is not closed must not
-- claim a closure.
--
-- Written as a single constraint over all four columns rather than four
-- separate ones so that a status-then-fill-in ordering cannot pass: Postgres
-- evaluates a CHECK per statement, so an UPDATE that sets `status` first and
-- the closure columns second would fail here — which is the intended pressure
-- on the service to write them together.
DO $$ BEGIN
  ALTER TABLE "recovery_cases"
    ADD CONSTRAINT "recovery_cases_closure_complete" CHECK (
      ("status" = 'CLOSED') = ("closed_date" IS NOT NULL)
      AND ("status" = 'CLOSED') = ("closed_by" IS NOT NULL)
      AND ("status" = 'CLOSED') = ("resolution_type" IS NOT NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Money is never negative, and the closure figures reconcile.
DO $$ BEGIN
  ALTER TABLE "recovery_cases"
    ADD CONSTRAINT "recovery_cases_money_non_negative" CHECK (
      COALESCE("outstanding_before_paise", 0) >= 0
      AND COALESCE("recovered_amount_paise", 0) >= 0
      AND COALESCE("remaining_outstanding_paise", 0) >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_cases"
    ADD CONSTRAINT "recovery_cases_closure_sums" CHECK (
      "outstanding_before_paise" IS NULL
      OR "recovered_amount_paise" IS NULL
      OR "remaining_outstanding_paise" IS NULL
      OR "outstanding_before_paise" = "recovered_amount_paise" + "remaining_outstanding_paise"
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An assignment date implies an assignee, and vice versa.
DO $$ BEGIN
  ALTER TABLE "recovery_cases"
    ADD CONSTRAINT "recovery_cases_assignment_paired" CHECK (
      ("assigned_agent_id" IS NULL) = ("assignment_date" IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- 4. recovery_case_assignments — assignment history
--
-- Rule 25: "Recovery assignment changes must preserve historical assignment
-- information." Scenario 10 requires the previous assignment to remain visible
-- after a reassignment, and Scenario 54 requires the audit history to record
-- *both* the previous and the new assignee.
--
-- A single mutable `recovery_cases.assigned_agent_id` cannot satisfy any of
-- that: overwriting it destroys exactly the fact the rules require be kept. The
-- audit log is not a substitute either — it is a security record, sanitized and
-- queried by actor, not a domain history the case screen can render in order.
--
-- Append-only, enforced by trigger below. `from_user_id` is NULL on the first
-- assignment, which is what distinguishes an assignment from a reassignment
-- without a second column saying so.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "recovery_case_assignments" (
    "org_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "recovery_case_id" UUID NOT NULL,
    "from_user_id" UUID,
    "to_user_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "reason" TEXT,

    CONSTRAINT "recovery_case_assignments_pkey" PRIMARY KEY ("org_id", "assignment_id")
);

CREATE INDEX IF NOT EXISTS "recovery_case_assignments_org_id_recovery_case_id_idx"
  ON "recovery_case_assignments" ("org_id", "recovery_case_id", "assigned_at");

CREATE INDEX IF NOT EXISTS "recovery_case_assignments_org_id_to_user_id_idx"
  ON "recovery_case_assignments" ("org_id", "to_user_id");

DO $$ BEGIN
  ALTER TABLE "recovery_case_assignments"
    ADD CONSTRAINT "recovery_case_assignments_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_case_assignments"
    ADD CONSTRAINT "recovery_case_assignments_org_id_recovery_case_id_fkey"
    FOREIGN KEY ("org_id", "recovery_case_id")
    REFERENCES "recovery_cases"("org_id", "recovery_case_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_case_assignments"
    ADD CONSTRAINT "recovery_case_assignments_org_id_from_user_id_fkey"
    FOREIGN KEY ("org_id", "from_user_id") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_case_assignments"
    ADD CONSTRAINT "recovery_case_assignments_org_id_to_user_id_fkey"
    FOREIGN KEY ("org_id", "to_user_id") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_case_assignments"
    ADD CONSTRAINT "recovery_case_assignments_org_id_assigned_by_fkey"
    FOREIGN KEY ("org_id", "assigned_by") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reassigning to whoever already holds the case is not a reassignment.
DO $$ BEGIN
  ALTER TABLE "recovery_case_assignments"
    ADD CONSTRAINT "recovery_case_assignments_actually_moves" CHECK (
      "from_user_id" IS DISTINCT FROM "to_user_id"
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION reject_recovery_assignment_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Recovery assignment history is append-only. Record a new assignment instead of editing %.',
    OLD.assignment_id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recovery_case_assignments_append_only ON "recovery_case_assignments";
CREATE TRIGGER recovery_case_assignments_append_only
  BEFORE UPDATE OR DELETE ON "recovery_case_assignments"
  FOR EACH ROW EXECUTE FUNCTION reject_recovery_assignment_mutation();


-- ---------------------------------------------------------------------------
-- 5. recovery_actions
--
-- The init table carried only `action`, `performed_by` and `notes`. The source
-- requires an action date, an outcome, follow-up and promise-to-pay fields, and
-- the full field-evidence set.
--
-- `updated_at` is added because a pending action may be edited (Scenario 31)
-- and that edit needs a concurrency token, exposed to clients as `version`
-- exactly as `Collection.updatedAt` is.
-- ---------------------------------------------------------------------------

ALTER TABLE "recovery_actions"
  -- DATE, not a timestamp: an action happened on a business day (Rule 5's
  -- reasoning applied one level up), and a timestamp would let a device's clock
  -- decide which day a visit fell on.
  ADD COLUMN IF NOT EXISTS "action_date" DATE,
  ADD COLUMN IF NOT EXISTS "outcome" "recovery_outcome",
  ADD COLUMN IF NOT EXISTS "next_follow_up_date" DATE,
  ADD COLUMN IF NOT EXISTS "promise_to_pay_date" DATE,
  ADD COLUMN IF NOT EXISTS "promise_to_pay_amount_paise" BIGINT,
  -- A finalized action is frozen (Scenario 32). NULL means still pending and
  -- editable (Scenario 31). A column rather than a status enum because there
  -- are exactly two states and the timestamp is itself the audit fact.
  ADD COLUMN IF NOT EXISTS "finalized_at" TIMESTAMPTZ(6),
  -- Module 12's offline identity, reused verbatim. The device mints the UUID
  -- and the unique index makes a retried sync return the original row rather
  -- than create a second (Scenario 28).
  ADD COLUMN IF NOT EXISTS "offline_activity_uuid" UUID,
  ADD COLUMN IF NOT EXISTS "device_id" VARCHAR(150),
  -- What the device reported about its GPS attempt, stored separately from
  -- `gps_check_in_id` because a FAILED capture has no check-in row to point at
  -- and Rule 40 requires the failure still be representable. Written from what
  -- the client reported and never promoted: synchronization must not turn a
  -- failure into a success (Scenario 30).
  ADD COLUMN IF NOT EXISTS "gps_capture_status" "gps_verification_status",
  ADD COLUMN IF NOT EXISTS "gps_check_in_id" UUID,
  ADD COLUMN IF NOT EXISTS "customer_ack_reference" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS "recovery_actions_org_id_offline_activity_uuid_key"
  ON "recovery_actions" ("org_id", "offline_activity_uuid");

CREATE INDEX IF NOT EXISTS "recovery_actions_org_id_next_follow_up_date_idx"
  ON "recovery_actions" ("org_id", "next_follow_up_date");

-- The missed-promise sweep of Scenario 16.
CREATE INDEX IF NOT EXISTS "recovery_actions_org_id_promise_to_pay_date_idx"
  ON "recovery_actions" ("org_id", "promise_to_pay_date");

DO $$ BEGIN
  ALTER TABLE "recovery_actions"
    ADD CONSTRAINT "recovery_actions_org_id_performed_by_fkey"
    FOREIGN KEY ("org_id", "performed_by") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_actions"
    ADD CONSTRAINT "recovery_actions_org_id_gps_check_in_id_fkey"
    FOREIGN KEY ("org_id", "gps_check_in_id") REFERENCES "gps_check_ins"("org_id", "check_in_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A promise to pay is an amount AND a date, or neither.
--
-- Rule: a promised amount with no date cannot be followed up and a date with no
-- amount cannot be checked against a payment, so half a promise is not a
-- promise. Scenario 15 stores both.
DO $$ BEGIN
  ALTER TABLE "recovery_actions"
    ADD CONSTRAINT "recovery_actions_promise_paired" CHECK (
      ("promise_to_pay_date" IS NULL) = ("promise_to_pay_amount_paise" IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_actions"
    ADD CONSTRAINT "recovery_actions_promise_positive" CHECK (
      "promise_to_pay_amount_paise" IS NULL OR "promise_to_pay_amount_paise" > 0
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A finalized recovery action cannot be edited or deleted.
--
-- Scenarios 32 and 35. The trigger permits exactly one transition — pending to
-- finalized — and freezes everything else. An "immutable once finalized" rule
-- that only the service respects is not immutable: a future module, a migration
-- or a psql session must hit the same wall.
CREATE OR REPLACE FUNCTION reject_recovery_action_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION
        'Recovery action % is finalized and cannot be deleted. Record a corrective follow-up instead.',
        OLD.recovery_action_id
        USING ERRCODE = 'check_violation';
    END IF;
    -- A BEFORE DELETE trigger must return OLD to let the delete proceed;
    -- returning NULL would silently cancel it.
    RETURN OLD;
  END IF;

  IF OLD.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Recovery action % is finalized. Its outcome and history cannot be changed; record a follow-up instead.',
      OLD.recovery_action_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recovery_actions_append_only ON "recovery_actions";
CREATE TRIGGER recovery_actions_append_only
  BEFORE UPDATE OR DELETE ON "recovery_actions"
  FOR EACH ROW EXECUTE FUNCTION reject_recovery_action_mutation();


-- ---------------------------------------------------------------------------
-- 6. settlements
--
-- Gains the journal linkage a money-moving record needs, the approval
-- timestamp its `approved_by` implies, and the idempotency and concurrency
-- columns every Module 09-14 table carries.
-- ---------------------------------------------------------------------------

ALTER TABLE "settlements"
  ADD COLUMN IF NOT EXISTS "journal_entry_id" UUID,
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "created_by" UUID,
  -- What the borrower still owed when the settlement was agreed, and the amount
  -- forgiven. Snapshotted for the same reason the case closure figures are.
  ADD COLUMN IF NOT EXISTS "outstanding_before_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "waived_amount_paise" BIGINT,
  ADD COLUMN IF NOT EXISTS "approval_reference" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "request_fingerprint" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS "settlements_org_id_idempotency_key_key"
  ON "settlements" ("org_id", "idempotency_key");

DO $$ BEGIN
  ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_org_id_journal_entry_id_fkey"
    FOREIGN KEY ("org_id", "journal_entry_id")
    REFERENCES "journal_entries"("org_id", "journal_entry_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_org_id_created_by_fkey"
    FOREIGN KEY ("org_id", "created_by") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_org_id_approved_by_fkey"
    FOREIGN KEY ("org_id", "approved_by") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_money_non_negative" CHECK (
      "settlement_amount_paise" >= 0
      AND COALESCE("outstanding_before_paise", 0) >= 0
      AND COALESCE("waived_amount_paise", 0) >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An approval is an actor AND a timestamp, or neither.
DO $$ BEGIN
  ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_approval_paired" CHECK (
      ("approved_by" IS NULL) = ("approved_at" IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- What was settled plus what was forgiven is what was owed.
DO $$ BEGIN
  ALTER TABLE "settlements"
    ADD CONSTRAINT "settlements_waiver_sums" CHECK (
      "outstanding_before_paise" IS NULL
      OR "waived_amount_paise" IS NULL
      OR "outstanding_before_paise" = "settlement_amount_paise" + "waived_amount_paise"
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A completed settlement is frozen; everything before completion may still move
-- through its lifecycle. Corrections after completion are reversals in the
-- ledger, never edits here (Rule 31).
CREATE OR REPLACE FUNCTION reject_settlement_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED', 'COMPLETED') THEN
      RAISE EXCEPTION
        'Settlement % has been approved and cannot be deleted.',
        OLD.settlement_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION
      'Settlement % is completed. Correct it with a reversal, not an edit.',
      OLD.settlement_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settlements_append_only ON "settlements";
CREATE TRIGGER settlements_append_only
  BEFORE UPDATE OR DELETE ON "settlements"
  FOR EACH ROW EXECUTE FUNCTION reject_settlement_mutation();


-- ---------------------------------------------------------------------------
-- 7. legal_notices
--
-- The lightest of the four. It gains only the actor and concurrency columns —
-- a notice is a document reference, not a money movement, so it needs no
-- journal linkage or idempotency key.
-- ---------------------------------------------------------------------------

ALTER TABLE "legal_notices"
  ADD COLUMN IF NOT EXISTS "issued_by" UUID,
  ADD COLUMN IF NOT EXISTS "notice_reference" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE "legal_notices"
    ADD CONSTRAINT "legal_notices_org_id_issued_by_fkey"
    FOREIGN KEY ("org_id", "issued_by") REFERENCES "users"("org_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A notice expires after it is issued, never before.
DO $$ BEGIN
  ALTER TABLE "legal_notices"
    ADD CONSTRAINT "legal_notices_expiry_after_notice" CHECK (
      "expiry_date" >= "notice_date"
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "legal_notices"
    ADD CONSTRAINT "legal_notices_period_positive" CHECK (
      "notice_period_days" > 0
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- 8. penalties — the duplicate-accrual guard
--
-- Scenario 19: "penalty has already been authoritatively accrued for a specific
-- eligible period ... the system does not create duplicate penalty for the same
-- authoritative accrual basis."
--
-- Made structural rather than procedural. A service-side "have we accrued this
-- already?" check is a read followed by a write, and two concurrent assessments
-- both pass it. This index makes the second one a database error the service
-- catches and resolves into the existing row — the same shape as the
-- idempotency-key guard on `collections`.
--
-- The basis is (loan, installment, rule, assessed date). `emi_id` is nullable
-- for loan-level penalties; Postgres does not collide NULLs in a unique index,
-- so a partial index over the non-null case and a second over the null case are
-- what actually close the hole. COALESCE to a fixed sentinel is the simpler
-- expression and is what is used here.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "penalties_accrual_basis_key"
  ON "penalties" (
    "org_id",
    "loan_id",
    COALESCE("emi_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("penalty_rule_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "assessed_date"
  )
  WHERE "status" NOT IN ('CANCELLED', 'WAIVED');

-- Assessment writes the contractual figure and the outstanding figure together.
DO $$ BEGIN
  ALTER TABLE "penalties"
    ADD CONSTRAINT "penalties_money_non_negative" CHECK (
      "amount_paise" >= 0
      AND "paid_amount_paise" >= 0
      AND "outstanding_amount_paise" >= 0
      AND "paid_amount_paise" <= "amount_paise"
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------------
-- 9. Chart of accounts — 5100 Loan Write-off Expense
--
-- The first EXPENSE account in this chart. Modules 09-14 needed only assets and
-- income; a write-off is the first event that recognises a loss.
--
-- A write-off posts `Dr 5100 Loan Write-off Expense / Cr 1100 Loan Receivable`:
-- the asset raised at disbursal is retired because it will not be collected,
-- and the loss is recognised as an expense. It is NOT a reduction of income —
-- the interest recognised on earlier collections was genuinely earned and
-- reversing it would misstate every prior period.
--
-- Inserted here as well as added to LEDGER_ACCOUNT_SPECS because the seed is
-- not re-run on deploy: existing organizations need this row or the first
-- write-off fails with "account not configured" inside a money-moving
-- transaction.
--
-- Manual posting is allowed and it is not a control account: unlike 1100 and
-- 1220 its balance is not the summary of a subsidiary ledger, and an accountant
-- writing off a non-loan receivable by hand is a legitimate entry.
--
-- `updated_at` is supplied explicitly. Module 14 made it NOT NULL with no
-- default, so this statement cannot omit it.
-- ---------------------------------------------------------------------------

INSERT INTO "accounts" ("org_id", "account_id", "account_code", "account_name",
                        "account_type", "normal_balance", "status",
                        "created_at", "updated_at",
                        "is_control_account", "is_manual_posting_allowed", "is_postable")
SELECT o."org_id", gen_random_uuid(), '5100', 'Loan Write-off Expense',
       'EXPENSE'::"account_type", 'DEBIT'::"normal_balance",
       'ACTIVE'::"account_status", now(), now(),
       FALSE, TRUE, TRUE
  FROM "organizations" o
ON CONFLICT ("org_id", "account_code") DO NOTHING;

-- Re-assert the flags for a database where the row already existed from an
-- earlier partial run with different values.
UPDATE "accounts"
   SET "is_control_account"        = FALSE,
       "is_manual_posting_allowed" = TRUE,
       "is_postable"               = TRUE
 WHERE "account_code" = '5100';
