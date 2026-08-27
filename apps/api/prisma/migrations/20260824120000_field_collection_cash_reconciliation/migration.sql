-- Module 12 — Field Collection & Cash Reconciliation.
--
-- Three things happen here, and the ordering between them is not negotiable.
--
--  1. `journal_entry_type` gains `TRANSFER`. This runs FIRST and alone, because
--     `ALTER TYPE ... ADD VALUE` forces Postgres out of the transaction Prisma
--     wraps around a migration. Anything before it that failed would already be
--     committed and `migrate resolve --rolled-back` could not undo it.
--  2. `collections` gains custody and evidence columns, and the trigger that
--     freezes a posted collection is RELAXED. Without that relaxation nothing
--     in this module works: linking a collection to a handover and recording a
--     verification decision are both same-status updates on a POSTED row, and
--     the existing trigger permits an update only when the status becomes
--     REVERSED. See section 6.
--  3. Two new tables — `cash_handovers` and `cash_reconciliations` — with the
--     money identities as CHECK constraints and the append-only rules as
--     triggers, so they hold whether or not a service remembers them.
--
-- **Every statement is idempotent.** Because step 1 breaks the wrapping
-- transaction, a failure partway through leaves earlier DDL committed. IF NOT
-- EXISTS / IF EXISTS guards and `DO $$` existence checks throughout mean a
-- retry over a partially-applied database converges instead of erroring.
--
-- Nullable columns are compared with IS NOT DISTINCT FROM, never `=`: NULL = NULL
-- is NULL, which would fail an AND chain and refuse a legitimate transition.

-- ---------------------------------------------------------------------------
-- 1. journal_entry_type — TRANSFER
--
-- A cash handover is not a collection. It debits one asset account and credits
-- another between two parties who both already have the money on their books,
-- and creating a second customer repayment here is what Rule 21 forbids. It
-- therefore needs a type of its own rather than borrowing COLLECTION.
--
-- MUST be the first statement in this file. See the header.
-- ---------------------------------------------------------------------------

ALTER TYPE "journal_entry_type" ADD VALUE IF NOT EXISTS 'TRANSFER';


-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_handover_status') THEN
    CREATE TYPE "cash_handover_status" AS ENUM (
      'CREATED', 'SUBMITTED', 'RECEIVED', 'RECONCILED', 'CANCELLED', 'REVERSED'
    );
  END IF;
END $$;

-- CreateEnum
--
-- The source draws RECONCILED as a parent of MATCHED and DISCREPANCY_PENDING.
-- Persisted as a parent plus a child, a row could hold an incoherent pair
-- (PENDING alongside MATCHED) and every query would filter on two columns. One
-- flat enum cannot express the incoherent state at all.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_reconciliation_status') THEN
    CREATE TYPE "cash_reconciliation_status" AS ENUM (
      'PENDING', 'MATCHED', 'DISCREPANCY_PENDING', 'RESOLVED'
    );
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_discrepancy_type') THEN
    CREATE TYPE "cash_discrepancy_type" AS ENUM (
      'SHORTAGE', 'EXCESS', 'COUNTERFEIT', 'DAMAGED_NOTES',
      'DISPUTED_COLLECTION', 'OTHER'
    );
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cash_discrepancy_resolution') THEN
    CREATE TYPE "cash_discrepancy_resolution" AS ENUM (
      'RECOVERED_FROM_AGENT', 'WRITTEN_OFF', 'ADJUSTED_NEXT_HANDOVER',
      'ESCALATED', 'NO_ACTION'
    );
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 3. cash_handovers
--
-- No loan_id and no customer_id, deliberately. A handover moves custody, not
-- money owed: tagging it to a loan would surface a custody transfer in that
-- borrower's ledger (Rules 21, 22).
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE IF NOT EXISTS "cash_handovers" (
  "org_id"                  UUID           NOT NULL,
  "handover_id"             UUID           NOT NULL,
  "handover_number"         VARCHAR(50)    NOT NULL,
  "branch_id"               UUID           NOT NULL,
  "field_agent_id"          UUID           NOT NULL,
  "business_date"           DATE           NOT NULL,
  "expected_cash_paise"     BIGINT         NOT NULL,
  "handed_over_cash_paise"  BIGINT         NOT NULL,
  "received_cash_paise"     BIGINT,
  "difference_paise"        BIGINT         NOT NULL DEFAULT 0,
  "handover_status"         "cash_handover_status" NOT NULL,
  "notes"                   TEXT,
  "acknowledgment_reference" VARCHAR(150),
  "received_by"             UUID,
  "received_at"             TIMESTAMPTZ(6),
  "journal_entry_id"        UUID,
  "idempotency_key"         VARCHAR(150)   NOT NULL,
  "request_fingerprint"     VARCHAR(64),
  "receive_idempotency_key" VARCHAR(150),
  "reversal_of_handover_id" UUID,
  "reversal_reason"         TEXT,
  "reversed_at"             TIMESTAMPTZ(6),
  "reversed_by"             UUID,
  "created_by"              UUID           NOT NULL,
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("org_id", "handover_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "cash_handovers_org_id_handover_number_key"
  ON "cash_handovers" ("org_id", "handover_number");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_handovers_org_id_idempotency_key_key"
  ON "cash_handovers" ("org_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_handovers_org_id_receive_idempotency_key_key"
  ON "cash_handovers" ("org_id", "receive_idempotency_key");
-- What actually prevents a handover being reversed twice under concurrency:
-- the second reversal loses on this index rather than on a read-then-write
-- check that two transactions can both pass.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_handovers_org_id_reversal_of_handover_id_key"
  ON "cash_handovers" ("org_id", "reversal_of_handover_id");
CREATE INDEX IF NOT EXISTS "cash_handovers_org_id_branch_id_business_date_idx"
  ON "cash_handovers" ("org_id", "branch_id", "business_date");
CREATE INDEX IF NOT EXISTS "cash_handovers_org_id_field_agent_id_business_date_idx"
  ON "cash_handovers" ("org_id", "field_agent_id", "business_date");
CREATE INDEX IF NOT EXISTS "cash_handovers_org_id_handover_status_idx"
  ON "cash_handovers" ("org_id", "handover_status");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_org_id_fkey') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "organizations" ("org_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_branch_fkey') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_branch_fkey"
      FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches" ("org_id", "branch_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_field_agent_fkey') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_field_agent_fkey"
      FOREIGN KEY ("org_id", "field_agent_id") REFERENCES "users" ("org_id", "user_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_received_by_fkey') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_received_by_fkey"
      FOREIGN KEY ("org_id", "received_by") REFERENCES "users" ("org_id", "user_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_journal_entry_fkey') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_journal_entry_fkey"
      FOREIGN KEY ("org_id", "journal_entry_id")
      REFERENCES "journal_entries" ("org_id", "journal_entry_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_reversal_of_fkey') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_reversal_of_fkey"
      FOREIGN KEY ("org_id", "reversal_of_handover_id")
      REFERENCES "cash_handovers" ("org_id", "handover_id");
  END IF;
END $$;

-- Money invariants as database facts.
--
-- These are not a second opinion on the service: they are the guarantee. A
-- service can be bypassed by a script, a fixture or a future endpoint; a CHECK
-- cannot.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_amounts_non_negative') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_amounts_non_negative"
      CHECK (
        "handed_over_cash_paise" > 0
        AND "expected_cash_paise" >= 0
        AND ("received_cash_paise" IS NULL OR "received_cash_paise" >= 0)
      );
  END IF;

  -- difference = received - handedOver, on any row that has been received.
  -- Left unconstrained before receipt because `received_cash_paise` is NULL
  -- then and the difference is meaningless rather than zero.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_difference_identity') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_difference_identity"
      CHECK (
        "handover_status" NOT IN ('RECEIVED', 'RECONCILED')
        OR "difference_paise" = "received_cash_paise" - "handed_over_cash_paise"
      );
  END IF;

  -- Scenario 53 — "the handover is not falsely marked received" — as a fact
  -- the database enforces. A RECEIVED row without a receiver, a timestamp and
  -- a journal is exactly the half-committed state the scenario describes, and
  -- it is unrepresentable.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_received_is_complete') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_received_is_complete"
      CHECK (
        "handover_status" NOT IN ('RECEIVED', 'RECONCILED')
        OR (
          "received_by" IS NOT NULL
          AND "received_at" IS NOT NULL
          AND "received_cash_paise" IS NOT NULL
          AND "journal_entry_id" IS NOT NULL
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_handovers_reversed_has_reason') THEN
    ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_reversed_has_reason"
      CHECK (
        "handover_status" <> 'REVERSED'
        OR ("reversal_reason" IS NOT NULL AND "reversed_at" IS NOT NULL AND "reversed_by" IS NOT NULL)
      );
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 4. cash_reconciliations
-- ---------------------------------------------------------------------------

-- CreateTable
CREATE TABLE IF NOT EXISTS "cash_reconciliations" (
  "org_id"                UUID           NOT NULL,
  "reconciliation_id"     UUID           NOT NULL,
  "reconciliation_number" VARCHAR(50)    NOT NULL,
  "branch_id"             UUID           NOT NULL,
  "field_agent_id"        UUID           NOT NULL,
  "handover_id"           UUID,
  "business_date"         DATE           NOT NULL,
  "expected_cash_paise"   BIGINT         NOT NULL,
  "actual_cash_paise"     BIGINT         NOT NULL,
  "difference_paise"      BIGINT         NOT NULL,
  "reconciliation_status" "cash_reconciliation_status" NOT NULL,
  "discrepancy_type"      "cash_discrepancy_type",
  "discrepancy_reason"    TEXT,
  "resolution_action"     "cash_discrepancy_resolution",
  "resolution_notes"      TEXT,
  "approval_reference"    VARCHAR(150),
  "resolved_by"           UUID,
  "resolved_at"           TIMESTAMPTZ(6),
  "approved_by"           UUID,
  "notes"                 TEXT,
  "idempotency_key"       VARCHAR(150)   NOT NULL,
  "request_fingerprint"   VARCHAR(64),
  "created_by"            UUID           NOT NULL,
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "cash_reconciliations_pkey" PRIMARY KEY ("org_id", "reconciliation_id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "cash_reconciliations_org_id_reconciliation_number_key"
  ON "cash_reconciliations" ("org_id", "reconciliation_number");
CREATE UNIQUE INDEX IF NOT EXISTS "cash_reconciliations_org_id_idempotency_key_key"
  ON "cash_reconciliations" ("org_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "cash_reconciliations_org_id_branch_id_business_date_idx"
  ON "cash_reconciliations" ("org_id", "branch_id", "business_date");
CREATE INDEX IF NOT EXISTS "cash_reconciliations_org_id_field_agent_id_business_date_idx"
  ON "cash_reconciliations" ("org_id", "field_agent_id", "business_date");
CREATE INDEX IF NOT EXISTS "cash_reconciliations_org_id_reconciliation_status_idx"
  ON "cash_reconciliations" ("org_id", "reconciliation_status");
CREATE INDEX IF NOT EXISTS "cash_reconciliations_org_id_handover_id_idx"
  ON "cash_reconciliations" ("org_id", "handover_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_org_id_fkey') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_org_id_fkey"
      FOREIGN KEY ("org_id") REFERENCES "organizations" ("org_id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_branch_fkey') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_branch_fkey"
      FOREIGN KEY ("org_id", "branch_id") REFERENCES "branches" ("org_id", "branch_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_field_agent_fkey') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_field_agent_fkey"
      FOREIGN KEY ("org_id", "field_agent_id") REFERENCES "users" ("org_id", "user_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_resolved_by_fkey') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_resolved_by_fkey"
      FOREIGN KEY ("org_id", "resolved_by") REFERENCES "users" ("org_id", "user_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_handover_fkey') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_handover_fkey"
      FOREIGN KEY ("org_id", "handover_id")
      REFERENCES "cash_handovers" ("org_id", "handover_id");
  END IF;
END $$;

DO $$ BEGIN
  -- Unconditional, unlike the handover's: a reconciliation always has both
  -- figures, so the three columns can never disagree at any point in the
  -- lifecycle.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_difference_identity') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_difference_identity"
      CHECK ("difference_paise" = "actual_cash_paise" - "expected_cash_paise");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_amounts_non_negative') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_amounts_non_negative"
      CHECK ("expected_cash_paise" >= 0 AND "actual_cash_paise" >= 0);
  END IF;

  -- A matched reconciliation with a non-zero difference is a contradiction.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_matched_is_zero') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_matched_is_zero"
      CHECK ("reconciliation_status" <> 'MATCHED' OR "difference_paise" = 0);
  END IF;

  -- Rule 35: a discrepancy requires a recorded reason. Enforced here so an
  -- endpoint added later cannot file a blank one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_discrepancy_has_reason') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_discrepancy_has_reason"
      CHECK (
        "reconciliation_status" <> 'DISCREPANCY_PENDING'
        OR ("discrepancy_type" IS NOT NULL AND "discrepancy_reason" IS NOT NULL)
      );
  END IF;

  -- Rule 35's other half: an authorized resolution, with an actor and a time.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_reconciliations_resolved_is_complete') THEN
    ALTER TABLE "cash_reconciliations" ADD CONSTRAINT "cash_reconciliations_resolved_is_complete"
      CHECK (
        "reconciliation_status" <> 'RESOLVED'
        OR (
          "resolution_action" IS NOT NULL
          AND "discrepancy_type" IS NOT NULL
          AND "discrepancy_reason" IS NOT NULL
          AND "resolved_by" IS NOT NULL
          AND "resolved_at" IS NOT NULL
        )
      );
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 5. collections — custody and evidence columns
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "collections"
  ADD COLUMN IF NOT EXISTS "is_field_collection"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "gps_capture_status"     "gps_verification_status",
  ADD COLUMN IF NOT EXISTS "gps_check_in_id"        UUID,
  ADD COLUMN IF NOT EXISTS "field_visit_id"         UUID,
  ADD COLUMN IF NOT EXISTS "customer_ack_reference" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "custody_handover_id"    UUID;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collections_gps_check_in_fkey') THEN
    ALTER TABLE "collections" ADD CONSTRAINT "collections_gps_check_in_fkey"
      FOREIGN KEY ("org_id", "gps_check_in_id")
      REFERENCES "gps_check_ins" ("org_id", "check_in_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collections_field_visit_fkey') THEN
    ALTER TABLE "collections" ADD CONSTRAINT "collections_field_visit_fkey"
      FOREIGN KEY ("org_id", "field_visit_id")
      REFERENCES "field_visits" ("org_id", "visit_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collections_custody_handover_fkey') THEN
    ALTER TABLE "collections" ADD CONSTRAINT "collections_custody_handover_fkey"
      FOREIGN KEY ("org_id", "custody_handover_id")
      REFERENCES "cash_handovers" ("org_id", "handover_id");
  END IF;
END $$;

-- CreateIndex
--
-- The agent cash-custody derivation (Rule 24) runs this exact predicate on
-- every balance read and again inside every handover transaction, so it is the
-- hottest query in the module.
CREATE INDEX IF NOT EXISTS "collections_custody_derivation_idx"
  ON "collections" ("org_id", "collector_user_id", "is_field_collection",
                    "payment_mode", "collection_status", "custody_handover_id");
CREATE INDEX IF NOT EXISTS "collections_org_id_custody_handover_id_idx"
  ON "collections" ("org_id", "custody_handover_id");


-- ---------------------------------------------------------------------------
-- 6. Relaxing the posted-collection trigger
--
-- **This section is why Module 12 works at all.**
--
-- `reject_posted_collection_mutation` as written by Module 11 permits an update
-- to a POSTED collection only when `NEW.collection_status = 'REVERSED'`. Module
-- 12 needs two same-status updates on posted rows:
--
--   * setting `custody_handover_id` when a handover claims the cash, and
--   * setting `verification_status` when a reviewer confirms or rejects an
--     offline capture (the transition Module 11's docblock hands to Module 12).
--
-- Both fall through the REVERSED branch and hit the RAISE EXCEPTION. The
-- relaxation below adds a third branch permitting a same-status update when
-- every column that represents money or identity is unchanged and only the
-- custody, verification and bookkeeping columns differ.
--
-- The pinned list is deliberately the SAME list the reversal branch pins, plus
-- `collection_date` and `payment_mode`. Nothing that decides how much money
-- moved, to which loan, under which receipt or against which journal can be
-- touched by this path — which is what keeps Scenario 32 ("edit posted
-- collection is blocked") true while making Scenarios 22 and 31 possible.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_posted_collection_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Collection % cannot be deleted. Financial records are retained; reverse it instead.',
      OLD.collection_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.collection_status = 'POSTED' THEN
    -- Branch 1: the reversal, unchanged from Module 11.
    IF NEW.collection_status = 'REVERSED'
       AND NEW.collection_id             = OLD.collection_id
       AND NEW.org_id                    = OLD.org_id
       AND NEW.loan_id                   = OLD.loan_id
       AND NEW.amount_paise              = OLD.amount_paise
       AND NEW.penalty_paid_paise        = OLD.penalty_paid_paise
       AND NEW.interest_paid_paise       = OLD.interest_paid_paise
       AND NEW.principal_paid_paise      = OLD.principal_paid_paise
       AND NEW.fees_paid_paise           = OLD.fees_paid_paise
       AND NEW.unallocated_amount_paise  = OLD.unallocated_amount_paise
       AND NEW.idempotency_key           = OLD.idempotency_key
       AND NEW.receipt_number            IS NOT DISTINCT FROM OLD.receipt_number
       AND NEW.journal_entry_id          IS NOT DISTINCT FROM OLD.journal_entry_id
       AND NEW.posted_at                 IS NOT DISTINCT FROM OLD.posted_at
    THEN
      RETURN NEW;
    END IF;

    -- Branch 2 (Module 12): custody and verification bookkeeping.
    --
    -- The status is unchanged and every financial column is pinned. What may
    -- move is `custody_handover_id` (a handover claiming this cash),
    -- `verification_status` / `verification_notes` (a reviewer's decision on an
    -- offline capture), and `updated_at` (the concurrency token, which Prisma
    -- always writes).
    IF NEW.collection_status = OLD.collection_status
       AND NEW.collection_id             = OLD.collection_id
       AND NEW.org_id                    = OLD.org_id
       AND NEW.loan_id                   = OLD.loan_id
       AND NEW.branch_id                 = OLD.branch_id
       AND NEW.customer_id               = OLD.customer_id
       AND NEW.collector_user_id         = OLD.collector_user_id
       AND NEW.collection_date           = OLD.collection_date
       AND NEW.payment_mode              = OLD.payment_mode
       AND NEW.amount_paise              = OLD.amount_paise
       AND NEW.penalty_paid_paise        = OLD.penalty_paid_paise
       AND NEW.interest_paid_paise       = OLD.interest_paid_paise
       AND NEW.principal_paid_paise      = OLD.principal_paid_paise
       AND NEW.fees_paid_paise           = OLD.fees_paid_paise
       AND NEW.unallocated_amount_paise  = OLD.unallocated_amount_paise
       AND NEW.idempotency_key           = OLD.idempotency_key
       AND NEW.receipt_number            IS NOT DISTINCT FROM OLD.receipt_number
       AND NEW.journal_entry_id          IS NOT DISTINCT FROM OLD.journal_entry_id
       AND NEW.posted_at                 IS NOT DISTINCT FROM OLD.posted_at
       AND NEW.is_field_collection       = OLD.is_field_collection
       -- The reported GPS outcome is evidence and is frozen at capture. Rule 41
       -- and Scenario 55: a failed capture must never later read as a success,
       -- and permitting this column to move is exactly how that would happen.
       AND NEW.gps_capture_status        IS NOT DISTINCT FROM OLD.gps_capture_status
       AND NEW.gps_check_in_id           IS NOT DISTINCT FROM OLD.gps_check_in_id
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Posted collection % is immutable. Use the reversal flow instead of editing it.',
      OLD.collection_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.collection_status = 'REVERSED' THEN
    RAISE EXCEPTION
      'Collection % is already reversed and cannot be modified further.',
      OLD.collection_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 7. Append-only triggers for the new tables
--
-- Modelled on `reject_posted_collection_mutation`. Each raises with
-- ERRCODE = 'check_violation' and an operator-readable message, which the
-- services pattern-match to turn into a 409 rather than a 500.
--
-- Note the BEFORE-trigger return-value hazard: a DELETE branch must RAISE, not
-- RETURN NULL. Returning NULL from a BEFORE DELETE silently cancels the delete
-- and reports success, which is worse than either allowing or refusing it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_cash_handover_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A draft nobody has acted on may be discarded; anything that has been
    -- submitted is part of the custody trail (Rules 28, 29; Scenario 35).
    IF OLD.handover_status = 'CREATED' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION
      'Cash handover % cannot be deleted once submitted. The custody trail is retained; reverse it instead.',
      OLD.handover_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- A received handover has a posted custody journal behind it. Only two
  -- transitions remain, and neither may touch the money.
  IF OLD.handover_status = 'RECEIVED' THEN
    IF NEW.handover_status IN ('RECONCILED', 'REVERSED')
       AND NEW.handover_id             = OLD.handover_id
       AND NEW.org_id                  = OLD.org_id
       AND NEW.branch_id               = OLD.branch_id
       AND NEW.field_agent_id          = OLD.field_agent_id
       AND NEW.business_date           = OLD.business_date
       AND NEW.handed_over_cash_paise  = OLD.handed_over_cash_paise
       AND NEW.received_cash_paise     IS NOT DISTINCT FROM OLD.received_cash_paise
       AND NEW.expected_cash_paise     = OLD.expected_cash_paise
       AND NEW.difference_paise        = OLD.difference_paise
       AND NEW.handover_number         = OLD.handover_number
       AND NEW.idempotency_key         = OLD.idempotency_key
       AND NEW.journal_entry_id        IS NOT DISTINCT FROM OLD.journal_entry_id
       AND NEW.received_by             IS NOT DISTINCT FROM OLD.received_by
       AND NEW.received_at             IS NOT DISTINCT FROM OLD.received_at
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Cash handover % has been received and its amounts are immutable. Reverse it instead of editing it.',
      OLD.handover_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.handover_status IN ('RECONCILED', 'REVERSED', 'CANCELLED') THEN
    RAISE EXCEPTION
      'Cash handover % is closed and cannot be modified further.',
      OLD.handover_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_handovers_append_only ON "cash_handovers";
CREATE TRIGGER cash_handovers_append_only
  BEFORE UPDATE OR DELETE ON "cash_handovers"
  FOR EACH ROW EXECUTE FUNCTION reject_cash_handover_mutation();


CREATE OR REPLACE FUNCTION reject_cash_reconciliation_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Reconciliation % cannot be deleted. The counted figures are retained for audit.',
      OLD.reconciliation_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- Rule 36 and Scenario 29 as a database fact: resolving a discrepancy may
  -- record what was decided, and may never rewrite what was counted.
  IF OLD.reconciliation_status IN ('MATCHED', 'DISCREPANCY_PENDING') THEN
    IF NEW.reconciliation_status = 'RESOLVED'
       AND NEW.reconciliation_id     = OLD.reconciliation_id
       AND NEW.org_id                = OLD.org_id
       AND NEW.branch_id             = OLD.branch_id
       AND NEW.field_agent_id        = OLD.field_agent_id
       AND NEW.business_date         = OLD.business_date
       AND NEW.expected_cash_paise   = OLD.expected_cash_paise
       AND NEW.actual_cash_paise     = OLD.actual_cash_paise
       AND NEW.difference_paise      = OLD.difference_paise
       AND NEW.reconciliation_number = OLD.reconciliation_number
       AND NEW.idempotency_key       = OLD.idempotency_key
       AND NEW.handover_id           IS NOT DISTINCT FROM OLD.handover_id
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Reconciliation % is final. Its expected, actual and difference figures cannot be changed.',
      OLD.reconciliation_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.reconciliation_status = 'RESOLVED' THEN
    RAISE EXCEPTION
      'Reconciliation % is already resolved and cannot be modified further.',
      OLD.reconciliation_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cash_reconciliations_append_only ON "cash_reconciliations";
CREATE TRIGGER cash_reconciliations_append_only
  BEFORE UPDATE OR DELETE ON "cash_reconciliations"
  FOR EACH ROW EXECUTE FUNCTION reject_cash_reconciliation_mutation();


-- ---------------------------------------------------------------------------
-- 8. Chart of accounts — 1220 Field Agent Cash in Hand
--
-- Inserted here as well as added to LEDGER_ACCOUNT_SPECS because the seed is
-- not re-run on deploy: existing organizations need this row or their first
-- field collection fails with "account not configured" inside a money-moving
-- transaction.
--
-- A control account, closed to manual posting, on 1100's precedent: its balance
-- is driven by Module 12's collections and handovers, and a hand-authored
-- journal against it would put the control total and the custody detail out of
-- step with nothing to detect the drift.
-- ---------------------------------------------------------------------------

-- `updated_at` is supplied explicitly. Module 14 made it NOT NULL with no
-- default, so unlike the Module 11 income-account insert this statement cannot
-- omit it — the column would be NULL and the insert would fail. Any later
-- account insert must do the same.
INSERT INTO "accounts" ("org_id", "account_id", "account_code", "account_name",
                        "account_type", "normal_balance", "status",
                        "created_at", "updated_at",
                        "is_control_account", "is_manual_posting_allowed", "is_postable")
SELECT o."org_id", gen_random_uuid(), '1220', 'Field Agent Cash in Hand',
       'ASSET'::"account_type", 'DEBIT'::"normal_balance",
       'ACTIVE'::"account_status", now(), now(),
       TRUE, FALSE, TRUE
  FROM "organizations" o
ON CONFLICT ("org_id", "account_code") DO NOTHING;

-- Re-assert the flags for a database where the row already existed from an
-- earlier partial run with different values.
UPDATE "accounts"
   SET "is_control_account"        = TRUE,
       "is_manual_posting_allowed" = FALSE
 WHERE "account_code" = '1220';
