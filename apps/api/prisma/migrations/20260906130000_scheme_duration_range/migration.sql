-- A scheme duration may describe a range of accepted terms, not only one count.
--
-- Daily loans are stated as dates — "from today until the 15th" — so the number
-- of installments is whatever those dates imply. A published list of fixed
-- counts cannot express that, and `assertSelectable` refuses any pair the scheme
-- does not carry, so a 45-day or 137-day loan could not be written at all.
--
-- Weekly and monthly are deliberately unchanged: there the short list of terms
-- is the lender's offer, not an input limitation.
--
-- Both columns nullable, and no backfill: a row with them null is an exact term
-- and behaves exactly as it does today. That is what makes this migration safe
-- to apply to a live book — no existing scheme changes what it offers.
ALTER TABLE "loan_scheme_durations"
  ADD COLUMN "min_duration_count" INTEGER,
  ADD COLUMN "max_duration_count" INTEGER;

-- The bounds are meaningful only together, and only in the right order. A row
-- carrying one bound would silently behave as an exact term while looking like
-- a range; a reversed pair would match nothing at all and read as "this scheme
-- offers a term nobody can select".
--
-- `durationCount` must sit inside its own range because it is what the form
-- pre-fills — a default outside the accepted bounds would offer the user a
-- value the submit gate then refuses.
ALTER TABLE "loan_scheme_durations"
  ADD CONSTRAINT "loan_scheme_durations_range_coherent" CHECK (
    ("min_duration_count" IS NULL AND "max_duration_count" IS NULL)
    OR (
      "min_duration_count" IS NOT NULL
      AND "max_duration_count" IS NOT NULL
      AND "min_duration_count" >= 1
      AND "min_duration_count" <= "max_duration_count"
      AND "duration_count" BETWEEN "min_duration_count" AND "max_duration_count"
    )
  );
