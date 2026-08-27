-- ============================================================================
-- Module 14 — Accounting & Ledger.
--
-- Two things happen here, and the second is the reason this file is
-- hand-written rather than generated.
--
-- 1. The chart of accounts and the journal gain the columns a real accounting
--    module needs: posting eligibility, hierarchy metadata, reversal linkage,
--    idempotency and an optimistic-concurrency token.
--
-- 2. The three triggers Modules 09 and 11 installed are rewritten.
--
-- Those triggers assume every journal row is born POSTED, because when they
-- were written every journal row was. Module 14 introduces the DRAFT state and
-- all three refuse it outright:
--
--   * journal_lines_balanced fires on every draft line insert, so a
--     deliberately still-being-built draft is rejected at COMMIT.
--   * journal_lines_append_only raises on every UPDATE and DELETE, so a draft
--     line can never be corrected or removed.
--   * journal_entries_append_only refuses every DELETE, so a draft can never
--     be discarded.
--
-- The rule those triggers are actually protecting is not "journal rows never
-- change". It is "POSTED journal rows never change, and nothing reaches POSTED
-- unbalanced". Each function below is rewritten to say that instead, and the
-- balance decision moves to the DRAFT -> POSTED transition, which is the only
-- moment a draft's lines stop being a form and become the ledger.
--
-- # Two ordering constraints this file obeys
--
-- **The trigger rewrite must precede the data backfills.** This migration sets
-- `posted_by` and `branch_id` on existing POSTED rows. The *old*
-- reject_posted_journal_entry_mutation refuses any update to a POSTED row that
-- is not the flip to REVERSED, so backfilling before replacing it fails with
-- "Posted journal entry ... is immutable". Section 5 therefore runs before
-- section 6.
--
-- **Every statement is idempotent.** `ALTER TYPE ... ADD VALUE` forces Postgres
-- out of the transaction Prisma wraps around a migration, so a failure partway
-- through leaves earlier DDL committed and `migrate resolve --rolled-back`
-- cannot undo it. IF NOT EXISTS / IF EXISTS guards throughout mean a retry over
-- a partially-applied database converges instead of erroring.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_branch_scope') THEN
    CREATE TYPE "account_branch_scope" AS ENUM ('ORGANIZATION', 'BRANCH');
  END IF;
END
$$;

-- MANUAL and ADJUSTMENT are the only two entry types an operator may author.
-- Every other member is owned by a source module.
ALTER TYPE "journal_entry_type" ADD VALUE IF NOT EXISTS 'MANUAL';
ALTER TYPE "journal_entry_type" ADD VALUE IF NOT EXISTS 'ADJUSTMENT';


-- ----------------------------------------------------------------------------
-- 2. accounts — posting eligibility, hierarchy metadata, concurrency token
-- ----------------------------------------------------------------------------

ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "account_category"          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "description"               TEXT,
  ADD COLUMN IF NOT EXISTS "is_postable"               BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "is_manual_posting_allowed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_control_account"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "branch_scope"              "account_branch_scope" NOT NULL DEFAULT 'ORGANIZATION',
  ADD COLUMN IF NOT EXISTS "effective_from"            DATE,
  ADD COLUMN IF NOT EXISTS "effective_to"              DATE,
  ADD COLUMN IF NOT EXISTS "created_by"                UUID,
  ADD COLUMN IF NOT EXISTS "updated_by"                UUID;

-- `updated_at` is NOT NULL with no default, which is why `prisma migrate dev`
-- refuses to generate this file: it cannot invent a value for the existing
-- rows. Three statements instead of one — add nullable, backfill from
-- created_at (the honest value: nothing has updated these rows), then pin.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6);
UPDATE "accounts" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "accounts" ALTER COLUMN "updated_at" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "accounts_org_id_status_idx"            ON "accounts" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "accounts_org_id_account_type_idx"      ON "accounts" ("org_id", "account_type");
CREATE INDEX IF NOT EXISTS "accounts_org_id_parent_account_id_idx" ON "accounts" ("org_id", "parent_account_id");


-- ----------------------------------------------------------------------------
-- 3. journal_entries — draft state, reversal linkage, idempotency
-- ----------------------------------------------------------------------------

ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "branch_id"                 UUID,
  ADD COLUMN IF NOT EXISTS "original_journal_entry_id" UUID,
  ADD COLUMN IF NOT EXISTS "reversal_reason"           TEXT,
  ADD COLUMN IF NOT EXISTS "adjustment_reason"         TEXT,
  ADD COLUMN IF NOT EXISTS "approval_reference"        VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "idempotency_key"           VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "request_fingerprint"       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "posted_by"                 UUID;

-- Added nullable here; backfilled and pinned NOT NULL in section 7, after the
-- trigger rewrite. Backfilling it here would be an UPDATE against POSTED rows
-- while the *old* immutability trigger is still installed, and that trigger
-- refuses every POSTED update that is not the flip to REVERSED.
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6);

-- A DRAFT has not been posted. A NOT NULL posted_at would force every draft to
-- carry a posting timestamp that is a lie. Metadata-only: every existing row is
-- POSTED or REVERSED and already has a value.
ALTER TABLE "journal_entries" ALTER COLUMN "posted_at" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "journal_entries_org_id_status_entry_date_idx"
  ON "journal_entries" ("org_id", "status", "entry_date");

CREATE INDEX IF NOT EXISTS "journal_entries_org_id_branch_id_entry_date_idx"
  ON "journal_entries" ("org_id", "branch_id", "entry_date");

-- Partial rather than plain unique. PostgreSQL treats NULLs as distinct, so a
-- plain unique index would behave identically — but writing the predicate makes
-- the intent legible: only a key that exists is claimed.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_org_id_idempotency_key_key"
  ON "journal_entries" ("org_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- A journal may be reversed exactly once. Two concurrent reversals: one wins
-- this index, the other's transaction rolls back and surfaces as a 409. The
-- service pre-check produces the readable message; this is the guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS "journal_entries_org_id_original_journal_entry_id_key"
  ON "journal_entries" ("org_id", "original_journal_entry_id")
  WHERE "original_journal_entry_id" IS NOT NULL;

-- Reconciliation reads this to detect two authoritative journals for one source
-- event. Deliberately NOT unique: the requirement is to flag a duplicate for
-- investigation, and a unique index would instead make this migration fail on
-- any historic one.
CREATE INDEX IF NOT EXISTS "journal_entries_org_id_source_status_idx"
  ON "journal_entries" ("org_id", "source_type", "source_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_org_id_branch_id_fkey'
  ) THEN
    ALTER TABLE "journal_entries"
      ADD CONSTRAINT "journal_entries_org_id_branch_id_fkey"
      FOREIGN KEY ("org_id", "branch_id")
      REFERENCES "branches" ("org_id", "branch_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_org_id_original_journal_entry_id_fkey'
  ) THEN
    ALTER TABLE "journal_entries"
      ADD CONSTRAINT "journal_entries_org_id_original_journal_entry_id_fkey"
      FOREIGN KEY ("org_id", "original_journal_entry_id")
      REFERENCES "journal_entries" ("org_id", "journal_entry_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- 4. journal_lines — source component
-- ----------------------------------------------------------------------------

-- PENALTY | INTEREST | PRINCIPAL | FEE | FUNDING | MANUAL. Lets reconciliation
-- trace a source transaction to its journal at line granularity.
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "source_component" VARCHAR(50);


-- ============================================================================
-- 5. TRIGGER REWRITE
--
-- Runs BEFORE the section 7 backfills, because those backfills update POSTED
-- rows and the trigger being replaced here is what would refuse them.
--
-- Every function uses CREATE OR REPLACE, which rebinds the existing trigger in
-- place. The triggers themselves are NOT dropped and recreated —
-- journal_lines_balanced is a CONSTRAINT TRIGGER whose DEFERRABLE INITIALLY
-- DEFERRED clause is the only reason a multi-line entry can be written at all,
-- and retyping that clause is a risk with no upside.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 5.1 Balance assertion on lines — now POSTED-only.
-- ----------------------------------------------------------------------------
--
-- Still deferred to COMMIT: a two-line entry must not be judged after its first
-- line. The change is the status lookup. A DRAFT entry's lines are exempt
-- because a draft is by definition allowed to be mid-build; 5.4 is where a
-- draft's balance is actually decided.
--
-- The lookup must be a live SELECT rather than a flag passed in, because this
-- trigger is what covers the case 5.5 cannot see: a line added to an
-- already-POSTED entry later in the same transaction.
CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS TRIGGER AS $$
DECLARE
  entry_status TEXT;
  total_debit  BIGINT;
  total_credit BIGINT;
BEGIN
  SELECT status::TEXT INTO entry_status
    FROM journal_entries
   WHERE org_id = NEW.org_id
     AND journal_entry_id = NEW.journal_entry_id;

  -- The entry was deleted in this same transaction and its lines cascaded.
  -- There is nothing left to assert about.
  IF entry_status IS NULL THEN
    RETURN NULL;
  END IF;

  IF entry_status = 'DRAFT' THEN
    RETURN NULL;
  END IF;

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


-- ----------------------------------------------------------------------------
-- 5.2 Per-line shape — enforced on every line, draft or posted.
-- ----------------------------------------------------------------------------
--
-- A line with both sides positive, or with neither, is a data-entry error at
-- the moment it is written, not an intermediate state a later post could
-- redeem. So unlike the balance check, this one does not exempt drafts.
--
-- A CHECK constraint would be the natural home, but adding one to a table with
-- data means either a full validating scan or a NOT VALID constraint that never
-- runs for existing rows. A BEFORE trigger is unconditional from the first row.
CREATE OR REPLACE FUNCTION assert_journal_line_shape() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.debit_paise < 0 OR NEW.credit_paise < 0 THEN
    RAISE EXCEPTION
      'Journal line % has a negative amount. Reverse the entry instead of negating a line.',
      NEW.line_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.debit_paise > 0 AND NEW.credit_paise > 0 THEN
    RAISE EXCEPTION
      'Journal line % has both a debit and a credit. A line is one side or the other.',
      NEW.line_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.debit_paise = 0 AND NEW.credit_paise = 0 THEN
    RAISE EXCEPTION
      'Journal line % moves nothing. A zero line is not a fact.',
      NEW.line_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS journal_lines_shape ON journal_lines;
CREATE TRIGGER journal_lines_shape
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION assert_journal_line_shape();


-- ----------------------------------------------------------------------------
-- 5.3 Line append-only — relaxed to DRAFT parents.
-- ----------------------------------------------------------------------------
--
-- "The ledger is append-only" means the POSTED ledger. A draft's lines are not
-- yet ledger; they are a form being filled in. The parent's status decides, so
-- a line cannot be freed by flipping something on the line itself.
--
-- NOTE the return values. The previous version of this function always raised
-- and therefore never returned. A BEFORE ... FOR EACH ROW trigger must return
-- OLD for DELETE and NEW for UPDATE: returning NULL silently CANCELS the
-- operation with no error, which would make a draft-line delete appear to
-- succeed while doing nothing.
CREATE OR REPLACE FUNCTION reject_journal_line_mutation() RETURNS TRIGGER AS $$
DECLARE
  entry_status TEXT;
BEGIN
  SELECT status::TEXT INTO entry_status
    FROM journal_entries
   WHERE org_id = OLD.org_id
     AND journal_entry_id = OLD.journal_entry_id;

  -- The parent is being deleted in the same statement and its lines are
  -- cascading. Permitted only because the entry-level trigger has already
  -- decided whether that DELETE is legal at all — it refuses for anything but
  -- a DRAFT.
  IF entry_status IS NULL OR entry_status = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Journal lines of a % entry are append-only. Post a reversing entry instead of editing line %.',
    entry_status, OLD.journal_line_id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 5.4 What makes a set of lines postable.
-- ----------------------------------------------------------------------------
--
-- Four conditions, in the order an operator would want to hear them. A plain
-- function rather than a trigger, because the event that needs it is a status
-- change on a different table.
CREATE OR REPLACE FUNCTION assert_entry_postable(p_org_id UUID, p_entry_id UUID)
RETURNS VOID AS $$
DECLARE
  line_count   INT;
  debit_lines  INT;
  credit_lines INT;
  bad_lines    INT;
  total_debit  BIGINT;
  total_credit BIGINT;
BEGIN
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE debit_paise  > 0),
         COUNT(*) FILTER (WHERE credit_paise > 0),
         COUNT(*) FILTER (WHERE (debit_paise > 0 AND credit_paise > 0)
                             OR (debit_paise = 0 AND credit_paise = 0)
                             OR debit_paise < 0
                             OR credit_paise < 0),
         COALESCE(SUM(debit_paise), 0),
         COALESCE(SUM(credit_paise), 0)
    INTO line_count, debit_lines, credit_lines, bad_lines, total_debit, total_credit
    FROM journal_lines
   WHERE org_id = p_org_id
     AND journal_entry_id = p_entry_id;

  IF line_count = 0 THEN
    RAISE EXCEPTION 'Journal entry % has no lines and cannot be posted.', p_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF bad_lines > 0 THEN
    RAISE EXCEPTION
      'Journal entry % has % line(s) that are zero-valued, negative, or both debit and credit.',
      p_entry_id, bad_lines
      USING ERRCODE = 'check_violation';
  END IF;

  IF debit_lines = 0 OR credit_lines = 0 THEN
    RAISE EXCEPTION
      'Journal entry % must have at least one debit line and at least one credit line.',
      p_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF total_debit <> total_credit THEN
    RAISE EXCEPTION
      'Journal entry % is unbalanced: debit % <> credit %',
      p_entry_id, total_debit, total_credit
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 5.5 Entry immutability — DRAFT-permissive, POSTED-frozen.
-- ----------------------------------------------------------------------------
--
-- Three legal shapes, and nothing else:
--
--   DRAFT  -> DRAFT     an edit. Everything but identity may change.
--   DRAFT  -> POSTED    the post. Identity pinned, posted_at/by required, and
--                       the lines must satisfy assert_entry_postable.
--   POSTED -> REVERSED  the reversal mark. Only status and updated_at move.
--
-- DELETE is legal only for a DRAFT. The "referenced downstream" case is a
-- service-level check, not this one: the database has no way to know an
-- approval workflow points at a draft.
--
-- updated_at is deliberately absent from every pin list. Prisma sets it on
-- every update, so pinning it would make each of these transitions impossible.
--
-- The POSTED branch also permits a backfill of posted_by and branch_id where
-- the old value was NULL. That exception exists for this migration's own
-- section 7 and for nothing else: it can only ever fill a hole, never change an
-- answer, because the guard requires OLD to be NULL.
CREATE OR REPLACE FUNCTION reject_posted_journal_entry_mutation() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'Journal entry % is % and cannot be deleted. Post a reversing entry instead.',
      OLD.journal_entry_id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- DRAFT source ---
  IF OLD.status = 'DRAFT' THEN
    -- Identity is fixed the moment the draft exists. The entry number is drawn
    -- from the org sequence at creation and must never be recycled.
    IF NEW.journal_entry_id <> OLD.journal_entry_id
       OR NEW.org_id        <> OLD.org_id
       OR NEW.entry_number  <> OLD.entry_number
       OR NEW.created_by    <> OLD.created_by
       OR NEW.created_at    <> OLD.created_at
    THEN
      RAISE EXCEPTION
        'Journal entry % identity is immutable even in draft.',
        OLD.journal_entry_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.status = 'DRAFT' THEN
      -- A draft has not been posted. Letting an edit set these would
      -- manufacture a posting timestamp for an entry that never posted.
      IF NEW.posted_at IS NOT NULL OR NEW.posted_by IS NOT NULL THEN
        RAISE EXCEPTION
          'Draft journal entry % cannot carry a posting timestamp.',
          OLD.journal_entry_id
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.status = 'POSTED' THEN
      IF NEW.posted_at IS NULL OR NEW.posted_by IS NULL THEN
        RAISE EXCEPTION
          'Journal entry % cannot be posted without a posting timestamp and actor.',
          OLD.journal_entry_id
          USING ERRCODE = 'check_violation';
      END IF;

      -- The balance decision. It lives here rather than on journal_lines
      -- because the lines were written earlier and a status flip does not
      -- re-fire their trigger.
      PERFORM assert_entry_postable(NEW.org_id, NEW.journal_entry_id);

      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Journal entry % cannot move from DRAFT to %.',
      OLD.journal_entry_id, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- POSTED source ---
  IF OLD.status = 'POSTED' THEN
    -- One-time backfill of a column that has never held a value. Filling a
    -- hole is not editing a posting: the guard requires the old value to be
    -- NULL, so this can never rewrite an answer the ledger already gave.
    IF NEW.status = 'POSTED'
       AND NEW.journal_entry_id = OLD.journal_entry_id
       AND NEW.org_id           = OLD.org_id
       AND NEW.entry_number     = OLD.entry_number
       AND NEW.entry_date       = OLD.entry_date
       AND NEW.entry_type       = OLD.entry_type
       AND NEW.created_by       = OLD.created_by
       AND NEW.posted_at   IS NOT DISTINCT FROM OLD.posted_at
       AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
       AND NEW.source_id   IS NOT DISTINCT FROM OLD.source_id
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND (OLD.posted_by IS NULL OR NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by)
       AND (OLD.branch_id IS NULL OR NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id)
    THEN
      RETURN NEW;
    END IF;

    -- The one legal flip, with everything else pinned.
    IF NEW.status = 'REVERSED'
       AND NEW.journal_entry_id = OLD.journal_entry_id
       AND NEW.org_id           = OLD.org_id
       AND NEW.entry_number     = OLD.entry_number
       AND NEW.entry_date       = OLD.entry_date
       AND NEW.entry_type       = OLD.entry_type
       AND NEW.created_by       = OLD.created_by
       AND NEW.posted_at                 IS NOT DISTINCT FROM OLD.posted_at
       AND NEW.posted_by                 IS NOT DISTINCT FROM OLD.posted_by
       AND NEW.branch_id                 IS NOT DISTINCT FROM OLD.branch_id
       AND NEW.source_type               IS NOT DISTINCT FROM OLD.source_type
       AND NEW.source_id                 IS NOT DISTINCT FROM OLD.source_id
       AND NEW.description               IS NOT DISTINCT FROM OLD.description
       AND NEW.idempotency_key           IS NOT DISTINCT FROM OLD.idempotency_key
       AND NEW.original_journal_entry_id IS NOT DISTINCT FROM OLD.original_journal_entry_id
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'Posted journal entry % is immutable. Post a reversing entry instead of editing it.',
      OLD.journal_entry_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- --- REVERSED source: terminal, except the same one-time backfill. ---
  IF OLD.status = 'REVERSED'
     AND NEW.status           = OLD.status
     AND NEW.journal_entry_id = OLD.journal_entry_id
     AND NEW.org_id           = OLD.org_id
     AND NEW.entry_number     = OLD.entry_number
     AND NEW.entry_date       = OLD.entry_date
     AND NEW.entry_type       = OLD.entry_type
     AND NEW.created_by       = OLD.created_by
     AND NEW.posted_at   IS NOT DISTINCT FROM OLD.posted_at
     AND NEW.source_type IS NOT DISTINCT FROM OLD.source_type
     AND NEW.source_id   IS NOT DISTINCT FROM OLD.source_id
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND (OLD.posted_by IS NULL OR NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by)
     AND (OLD.branch_id IS NULL OR NEW.branch_id IS NOT DISTINCT FROM OLD.branch_id)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Journal entry % is reversed and is terminal.',
    OLD.journal_entry_id
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 5.6 Account hierarchy must stay acyclic.
-- ----------------------------------------------------------------------------
--
-- The service also walks the chain, to produce a message naming the two
-- accounts involved. That walk runs outside a lock, so two concurrent edits
-- could each see an acyclic chain and together create a cycle. This is the
-- guarantee; the service's walk is the ergonomics.
CREATE OR REPLACE FUNCTION assert_account_hierarchy_acyclic() RETURNS TRIGGER AS $$
DECLARE
  cursor_id UUID := NEW.parent_account_id;
  depth     INT  := 0;
BEGIN
  IF NEW.parent_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_account_id = NEW.account_id THEN
    RAISE EXCEPTION 'Account % cannot be its own parent.', NEW.account_id
      USING ERRCODE = 'check_violation';
  END IF;

  WHILE cursor_id IS NOT NULL LOOP
    depth := depth + 1;

    IF depth > 32 THEN
      RAISE EXCEPTION
        'Account hierarchy for % is deeper than 32 levels; refusing to walk further.',
        NEW.account_id
        USING ERRCODE = 'check_violation';
    END IF;

    IF cursor_id = NEW.account_id THEN
      RAISE EXCEPTION
        'Assigning parent % to account % would create a circular hierarchy.',
        NEW.parent_account_id, NEW.account_id
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT parent_account_id INTO cursor_id
      FROM accounts
     WHERE org_id = NEW.org_id
       AND account_id = cursor_id;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS accounts_hierarchy_acyclic ON accounts;
CREATE TRIGGER accounts_hierarchy_acyclic
  BEFORE INSERT OR UPDATE OF parent_account_id ON accounts
  FOR EACH ROW EXECUTE FUNCTION assert_account_hierarchy_acyclic();


-- ----------------------------------------------------------------------------
-- 6. Seeded chart of accounts — posting eligibility
-- ----------------------------------------------------------------------------

-- The accounts an operator may legitimately hand-post to.
UPDATE "accounts"
   SET "is_manual_posting_allowed" = TRUE
 WHERE "account_code" IN ('1200', '1210', '4100', '4200', '4300');

-- 1100 Loan Receivable is the control account the loan book drives. Every
-- rupee in it was put there by a disbursal and is retired by a collection.
-- Hand-posting to it would desynchronise the ledger from the loan book, so it
-- is closed to manual posting and marked as the control account it is.
UPDATE "accounts"
   SET "is_control_account"        = TRUE,
       "is_manual_posting_allowed" = FALSE
 WHERE "account_code" = '1100';


-- ----------------------------------------------------------------------------
-- 7. Journal backfills
--
-- Every statement here updates existing POSTED rows, so all of them must run
-- after section 5: the trigger replaced there is what permits a POSTED row's
-- untouched columns to be filled in at all.
-- ----------------------------------------------------------------------------

-- Nothing has updated these rows, so created_at is the honest value.
UPDATE "journal_entries" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "journal_entries" ALTER COLUMN "updated_at" SET NOT NULL;

-- posted_by is unknowable for historic rows. created_by is the same actor in
-- every posting path that exists today, so it is the honest backfill.
UPDATE "journal_entries"
   SET "posted_by" = "created_by"
 WHERE "posted_by" IS NULL
   AND "status" IN ('POSTED', 'REVERSED');

-- Backfill branch_id from the dimension rows each entry's lines already carry.
-- Deterministic because every posting path today writes exactly one branch per
-- entry; DISTINCT collapses the repeats rather than assuming there are none.
UPDATE "journal_entries" je
   SET "branch_id" = sub."branch_id"
  FROM (
    SELECT DISTINCT jl."org_id", jl."journal_entry_id", d."branch_id"
      FROM "journal_lines" jl
      JOIN "account_dimensions" d
        ON d."org_id"       = jl."org_id"
       AND d."dimension_id" = jl."dimension_id"
     WHERE d."branch_id" IS NOT NULL
  ) sub
 WHERE sub."org_id"           = je."org_id"
   AND sub."journal_entry_id" = je."journal_entry_id"
   AND je."branch_id" IS NULL;
