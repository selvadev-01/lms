-- AlterTable
ALTER TABLE "disbursements" ADD COLUMN     "confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "confirmed_by" UUID,
ADD COLUMN     "disbursement_account_id" UUID NOT NULL,
ADD COLUMN     "failure_reason" TEXT,
ADD COLUMN     "idempotency_key" VARCHAR(150) NOT NULL,
ADD COLUMN     "journal_entry_id" UUID,
ADD COLUMN     "transfer_date" DATE,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "created_by" UUID,
ADD COLUMN     "updated_by" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "disbursements_org_id_idempotency_key_key" ON "disbursements"("org_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "disbursements_org_id_transaction_reference_key" ON "disbursements"("org_id", "transaction_reference");

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_org_id_disbursement_account_id_fkey" FOREIGN KEY ("org_id", "disbursement_account_id") REFERENCES "accounts"("org_id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_org_id_journal_entry_id_fkey" FOREIGN KEY ("org_id", "journal_entry_id") REFERENCES "journal_entries"("org_id", "journal_entry_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Ledger invariants Prisma cannot express.
--
-- The schema's section 21 comment has promised the sum-to-zero trigger since
-- init_lms_schema; nothing installed it. Module 09 is the first module that
-- posts journal lines, so it is the first that needs it to be real.
-- ============================================================================

-- Rule 13 / Scenarios 19, 21: every journal entry's debits equal its credits.
--
-- DEFERRABLE INITIALLY DEFERRED is the whole point: the check runs once at
-- COMMIT, not after each INSERT. A non-deferred trigger would fire after the
-- first line of a two-line entry and reject a balanced entry mid-write.
CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS TRIGGER AS $$
DECLARE
  total_debit BIGINT;
  total_credit BIGINT;
BEGIN
  SELECT COALESCE(SUM(debit_paise), 0), COALESCE(SUM(credit_paise), 0)
    INTO total_debit, total_credit
    FROM journal_lines
   WHERE org_id = NEW.org_id
     AND journal_entry_id = NEW.journal_entry_id;

  IF total_debit <> total_credit THEN
    RAISE EXCEPTION
      'Journal entry % is unbalanced: debit % <> credit %',
      NEW.journal_entry_id, total_debit, total_credit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();

-- Rule 15 / Scenario 22: the ledger is append-only. Corrections are reversal
-- entries, never edits or deletes.
--
-- Enforced in the database rather than in the service because "append-only"
-- that only one code path respects is not append-only. A future module, a
-- migration or a psql session must hit the same wall.
CREATE OR REPLACE FUNCTION reject_journal_line_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'Journal lines are append-only. Post a reversing entry instead of editing line %.',
    OLD.journal_line_id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_lines_append_only
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION reject_journal_line_mutation();

-- A POSTED entry is frozen except for the one legal transition, POSTED ->
-- REVERSED, which is how a reversal marks the entry it reverses. Everything
-- else about the row stays immutable, and a DELETE is never legal.
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

CREATE TRIGGER journal_entries_append_only
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION reject_posted_journal_entry_mutation();
