-- Module 10 — Repayment Schedule.
--
-- Module 09 already generates version 1 of a schedule inside the disbursal
-- transaction. This migration adds what managing that schedule afterwards
-- needs: the per-installment balance columns the story's Table-Only block
-- names, and the versioning/supersession columns that let a regeneration
-- retire a version without deleting financial history.
--
-- Every money column is BIGINT integer paise. No FLOAT/NUMERIC anywhere.

-- ---------------------------------------------------------------------------
-- 1. repayment_schedules — provenance, supersession, concurrency
-- ---------------------------------------------------------------------------

ALTER TABLE "repayment_schedules"
  ADD COLUMN "disbursement_id"     UUID,
  ADD COLUMN "generated_by"        UUID,
  ADD COLUMN "superseded_at"       TIMESTAMPTZ(6),
  ADD COLUMN "superseded_by"       UUID,
  ADD COLUMN "regeneration_reason" TEXT,
  ADD COLUMN "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  ADD COLUMN "updated_at"          TIMESTAMPTZ(6);

-- Existing rows predate the column; seed the concurrency token from the
-- generation timestamp so a client reading one immediately after this
-- migration holds a version that matches.
UPDATE "repayment_schedules" SET "updated_at" = "generated_at" WHERE "updated_at" IS NULL;

ALTER TABLE "repayment_schedules" ALTER COLUMN "updated_at" SET NOT NULL;

-- Backfill provenance for schedules Module 09 already wrote: the disbursal that
-- confirmed the loan. Only COMPLETED disbursements ever produce a schedule.
UPDATE "repayment_schedules" rs
   SET "disbursement_id" = d."disbursement_id",
       "generated_by"    = d."confirmed_by"
  FROM "disbursements" d
 WHERE d."org_id"  = rs."org_id"
   AND d."loan_id" = rs."loan_id"
   AND d."status"  = 'COMPLETED';

ALTER TABLE "repayment_schedules"
  ADD CONSTRAINT "repayment_schedules_org_id_disbursement_id_fkey"
  FOREIGN KEY ("org_id", "disbursement_id")
  REFERENCES "disbursements" ("org_id", "disbursement_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The ACTIVE-schedule lookup runs on every schedule read.
CREATE INDEX "repayment_schedules_org_id_loan_id_status_idx"
  ON "repayment_schedules" ("org_id", "loan_id", "status");

-- ---------------------------------------------------------------------------
-- 2. emis — opening balance, paid and outstanding
-- ---------------------------------------------------------------------------

ALTER TABLE "emis"
  ADD COLUMN "opening_principal_paise"  BIGINT,
  ADD COLUMN "paid_amount_paise"        BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "outstanding_amount_paise" BIGINT,
  ADD COLUMN "updated_at"               TIMESTAMPTZ(6);

-- Opening balance for installment n is the financed principal less every
-- principal component before it. A window function over the schedule reproduces
-- exactly what generation would have written, so backfilled rows and newly
-- generated rows are indistinguishable.
UPDATE "emis" e
   SET "opening_principal_paise" = b."opening_principal_paise"
  FROM (
    SELECT "org_id",
           "emi_id",
           SUM("principal_due_paise") OVER (
             PARTITION BY "org_id", "repayment_schedule_id"
           )
           - COALESCE(
               SUM("principal_due_paise") OVER (
                 PARTITION BY "org_id", "repayment_schedule_id"
                 ORDER BY "installment_number"
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ),
               0
             ) AS "opening_principal_paise"
      FROM "emis"
  ) b
 WHERE b."org_id" = e."org_id"
   AND b."emi_id" = e."emi_id";

-- No collection module exists yet, so nothing has been paid against any
-- existing row: outstanding is the full contractual amount.
UPDATE "emis"
   SET "outstanding_amount_paise" = "total_due_paise",
       "updated_at"               = "created_at"
 WHERE "outstanding_amount_paise" IS NULL;

ALTER TABLE "emis"
  ALTER COLUMN "opening_principal_paise"  SET NOT NULL,
  ALTER COLUMN "outstanding_amount_paise" SET NOT NULL,
  ALTER COLUMN "updated_at"               SET NOT NULL;
