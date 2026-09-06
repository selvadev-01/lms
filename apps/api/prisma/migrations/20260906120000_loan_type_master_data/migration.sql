-- Loan type becomes admin-managed master data (Option 1).
--
-- `loan_products.loan_type` was the Postgres enum `loan_type`, so the four
-- values it named were the only ones any tenant could ever have. A tenant that
-- lends against, say, a tractor had no way to say so. The column becomes text
-- holding a `LOAN_TYPE` master-data code, and the list becomes rows an admin can
-- add to.
--
-- The knowledge that came with the enum has to go somewhere. `GOLD` and
-- `VEHICLE` were hardcoded in `COLLATERAL_LOAN_TYPES` as the secured types whose
-- applications require a COLLATERAL document to submit. A hardcoded set cannot
-- answer that for a type it has never heard of, so the answer moves onto the
-- master-data row itself as `requires_collateral`.

-- 1. The flag. Nullable because it is meaningless for every other category
--    (a GENDER does not require collateral), and a NOT NULL default of false
--    would assert an answer where there is no question.
ALTER TABLE "master_data_values"
  ADD COLUMN "requires_collateral" BOOLEAN;

-- 2. The column's type. USING casts the existing enum labels to their text, so
--    every existing product keeps exactly the value it had — 'GOLD' stays
--    'GOLD'. No data moves and no product changes type.
ALTER TABLE "loan_products"
  ALTER COLUMN "loan_type" TYPE VARCHAR(50) USING "loan_type"::text;

-- 3. Seed the four former enum members as system rows, for every organization
--    that exists. `is_system` marks them undeletable: a product still points at
--    them by code, and deleting 'GOLD' would leave that product naming a type
--    the list no longer offers.
--
--    Only organizations are enumerated here, not products — an org with no
--    products yet still needs the list, which is precisely the case that
--    prompted this change.
INSERT INTO "master_data_values"
  ("org_id", "value_id", "category", "code", "label", "display_order",
   "status", "is_system", "requires_collateral", "created_at", "updated_at")
SELECT
  o."org_id",
  gen_random_uuid(),
  'LOAN_TYPE',
  t."code",
  t."label",
  t."display_order",
  'ACTIVE',
  TRUE,
  t."requires_collateral",
  NOW(),
  NOW()
FROM "organizations" o
CROSS JOIN (VALUES
  ('PERSONAL', 'Personal', 0, FALSE),
  ('BUSINESS', 'Business', 1, FALSE),
  -- The two the hardcoded set named. Their behaviour is preserved exactly.
  ('GOLD',     'Gold',     2, TRUE),
  ('VEHICLE',  'Vehicle',  3, TRUE)
) AS t("code", "label", "display_order", "requires_collateral")
-- Idempotent against a re-run and against an org that somehow already has the
-- category, rather than failing the whole migration on one conflict.
ON CONFLICT ("org_id", "category", "code") DO NOTHING;

-- 4. The enum type itself is now unreferenced.
DROP TYPE "loan_type";
