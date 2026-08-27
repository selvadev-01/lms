-- Module 11 — EMI Collection.
--
-- Adds the posting, allocation, receipt, reversal and offline-identity columns
-- to `collections`; gives `penalties` the paid/outstanding pair that `emis`
-- already has; seeds the three income accounts a repayment is recognised in;
-- and installs the database-level invariants that make a posted collection
-- immutable and internally consistent.
--
-- The invariants below are deliberately in the database rather than only in the
-- service, for the same reason the disbursal migration gives: an "append-only"
-- rule that only one code path respects is not append-only. A future module, a
-- migration or a psql session must hit the same wall.

-- CreateEnum
CREATE TYPE "collection_status" AS ENUM ('CREATED', 'SYNCED', 'POSTED', 'REVERSED', 'FAILED');

-- AlterTable
--
-- `collection_status` is NOT NULL without a default on purpose: every row must
-- declare where it sits in the lifecycle, and there is no safe default (a
-- CREATED default would let a bug write a row that looks like an unposted
-- request). Safe to add unconditionally because the table is empty — nothing
-- has ever written a collection.
ALTER TABLE "collections" ADD COLUMN     "collection_status" "collection_status" NOT NULL,
ADD COLUMN     "device_id" VARCHAR(150),
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "fees_paid_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "interest_paid_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "journal_entry_id" UUID,
ADD COLUMN     "offline_transaction_uuid" UUID,
ADD COLUMN     "penalty_paid_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "posted_at" TIMESTAMPTZ(6),
ADD COLUMN     "posted_by" UUID,
ADD COLUMN     "principal_paid_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "receipt_number" VARCHAR(100),
ADD COLUMN     "request_fingerprint" VARCHAR(64),
ADD COLUMN     "reversal_of_collection_id" UUID,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMPTZ(6),
ADD COLUMN     "reversed_by" UUID,
ADD COLUMN     "unallocated_amount_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL;

-- AlterTable
--
-- Mirrors what `emis` already carries. Without these a partially-paid penalty
-- could only be expressed as a status, and computing "penalty outstanding"
-- would mean summing `collection_allocations` on every read.
ALTER TABLE "penalties" ADD COLUMN     "outstanding_amount_paise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "paid_amount_paise" BIGINT NOT NULL DEFAULT 0;

-- Backfill: an open penalty owes its full assessed amount. Settled, waived and
-- cancelled rows owe nothing, which the DEFAULT 0 already gives them. Same
-- shape as the `emis.outstanding_amount_paise` backfill in the Module 10
-- migration.
UPDATE "penalties"
   SET "outstanding_amount_paise" = "amount_paise"
 WHERE "status" IN ('ASSESSED', 'PARTIALLY_PAID');

-- CreateIndex
CREATE INDEX "collections_org_id_collection_status_collection_date_idx" ON "collections"("org_id", "collection_status", "collection_date");

-- CreateIndex
--
-- Scenario 16: a receipt number belongs to exactly one collection. Nullable
-- because an unposted or reversal row has none, and Postgres does not collide
-- NULLs in a unique index — the same property
-- `disbursements_org_id_transaction_reference_key` relies on.
CREATE UNIQUE INDEX "collections_org_id_receipt_number_key" ON "collections"("org_id", "receipt_number");

-- CreateIndex
--
-- Scenarios 18, 42: a device's transaction syncs at most once, however many
-- times the device retries.
CREATE UNIQUE INDEX "collections_org_id_offline_transaction_uuid_key" ON "collections"("org_id", "offline_transaction_uuid");

-- CreateIndex
--
-- Scenario 33: a collection can be reversed at most once. This is the structural
-- guarantee — a second reversal is a database error, not a check the service
-- must remember to make.
CREATE UNIQUE INDEX "collections_org_id_reversal_of_collection_id_key" ON "collections"("org_id", "reversal_of_collection_id");

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_id_journal_entry_id_fkey" FOREIGN KEY ("org_id", "journal_entry_id") REFERENCES "journal_entries"("org_id", "journal_entry_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_org_id_reversal_of_collection_id_fkey" FOREIGN KEY ("org_id", "reversal_of_collection_id") REFERENCES "collections"("org_id", "collection_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Money invariants
-- ---------------------------------------------------------------------------

-- Rule 33 / Scenarios 9, 10: a collection is a positive amount of money.
ALTER TABLE "collections" ADD CONSTRAINT "collections_amount_positive"
  CHECK ("amount_paise" > 0);

-- No component of an allocation is ever negative. A negative component would
-- let the sum identity below hold while the allocation itself was nonsense.
ALTER TABLE "collections" ADD CONSTRAINT "collections_components_non_negative"
  CHECK ("penalty_paid_paise" >= 0 AND "interest_paid_paise" >= 0
     AND "principal_paid_paise" >= 0 AND "fees_paid_paise" >= 0
     AND "unallocated_amount_paise" >= 0);

-- The source's money identity:
--
--   collected = penalty + interest + principal + fees + unallocated
--
-- Conditioned on status rather than unconditional, because a CREATED or SYNCED
-- row legitimately has a positive amount and no allocation — the allocation
-- does not exist until the posting transaction computes it. Only POSTED and
-- REVERSED rows are money, and only they must balance.
--
-- A plain CHECK rather than a trigger because every column is on the same row:
-- no query is needed, so it cannot be deferred wrongly and costs nothing.
ALTER TABLE "collections" ADD CONSTRAINT "collections_allocation_sums"
  CHECK (
    "collection_status" NOT IN ('POSTED', 'REVERSED')
    OR "amount_paise" = "penalty_paid_paise" + "interest_paid_paise"
                      + "principal_paid_paise" + "fees_paid_paise"
                      + "unallocated_amount_paise"
  );

-- Penalties follow the same rule as EMIs: the assessed amount is contractual and
-- a payment moves the paid/outstanding pair, never the assessed figure.
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_paid_within_assessed"
  CHECK ("paid_amount_paise" >= 0
     AND "outstanding_amount_paise" >= 0
     AND "paid_amount_paise" <= "amount_paise");

-- ---------------------------------------------------------------------------
-- Append-only enforcement for posted collections
-- ---------------------------------------------------------------------------

-- Rules 21, 22, 44 / Scenarios 25, 27, 28. A posted collection is a financial
-- record: it cannot be edited in place and cannot be deleted. The only legal
-- change is the transition to REVERSED, and even that must leave every
-- financial column exactly as it was.
--
-- Modelled on `reject_posted_journal_entry_mutation` from the disbursal
-- migration, and deliberately stricter: that one pins only the entry's identity
-- columns, so it would permit a status flip that also rewrote the description.
-- This one pins every column that carries money or identity.
--
-- Nullable columns compare with IS NOT DISTINCT FROM rather than `=`, because
-- NULL = NULL is NULL, which would fail the AND chain and refuse a legitimate
-- reversal of a cash collection that has no transaction reference.
CREATE OR REPLACE FUNCTION reject_posted_collection_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Collection % cannot be deleted. Financial records are retained; reverse it instead.',
      OLD.collection_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.collection_status = 'POSTED' THEN
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

CREATE TRIGGER collections_append_only
  BEFORE UPDATE OR DELETE ON collections
  FOR EACH ROW EXECUTE FUNCTION reject_posted_collection_mutation();

-- Harden the journal-entry equivalent while we are here. The disbursal version
-- pins the entry's identity but leaves `posted_at`, `source_type`, `source_id`,
-- `description` and `created_by` free, so an update that flipped the status
-- could also rewrite what the entry claims to be about. A reversal only ever
-- needs to change `status`; nothing else about a posted entry is ever legal to
-- change.
CREATE OR REPLACE FUNCTION reject_posted_journal_entry_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Posted journal entry % cannot be deleted. Post a reversing entry instead.',
      OLD.journal_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'POSTED' THEN
    IF NEW.status = 'REVERSED'
       AND NEW.journal_entry_id = OLD.journal_entry_id
       AND NEW.org_id           = OLD.org_id
       AND NEW.entry_number     = OLD.entry_number
       AND NEW.entry_date       = OLD.entry_date
       AND NEW.entry_type       = OLD.entry_type
       AND NEW.posted_at        = OLD.posted_at
       AND NEW.created_by       = OLD.created_by
       AND NEW.source_type      IS NOT DISTINCT FROM OLD.source_type
       AND NEW.source_id        IS NOT DISTINCT FROM OLD.source_id
       AND NEW.description      IS NOT DISTINCT FROM OLD.description
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Posted journal entry % is immutable. Post a reversing entry instead of editing it.',
      OLD.journal_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Income accounts for collection posting
-- ---------------------------------------------------------------------------

-- A repayment credits Loan Receivable for the principal portion only — that is
-- the asset raised at disbursal being retired — and recognises interest,
-- penalty and fees as income at the moment of collection.
--
-- Interest was never booked as a receivable (disbursal debits Loan Receivable
-- for the sanctioned principal alone), so there is no interest receivable to
-- retire. See the header of `ledger-accounts.ts`.
--
-- Inserted here as well as added to LEDGER_ACCOUNT_SPECS because the seed is
-- not re-run on deploy: existing organizations need these rows or their first
-- collection fails with "account not configured" inside a money-moving
-- transaction.
INSERT INTO "accounts" ("org_id", "account_id", "account_code", "account_name",
                        "account_type", "normal_balance", "status", "created_at")
SELECT o."org_id", gen_random_uuid(), v.code, v.name,
       'INCOME'::"account_type", 'CREDIT'::"normal_balance",
       'ACTIVE'::"account_status", now()
  FROM "organizations" o
 CROSS JOIN (VALUES
   ('4100', 'Interest Income'),
   ('4200', 'Penalty Income'),
   ('4300', 'Fee Income')
 ) AS v(code, name)
ON CONFLICT ("org_id", "account_code") DO NOTHING;
