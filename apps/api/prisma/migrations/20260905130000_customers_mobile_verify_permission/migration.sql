-- Q-CUST-23. Introduces `customers.mobile.verify` and grants it to the two
-- roles that verify a customer's number.
--
-- Unlike the `customers.create` backfill, this permission did not exist before,
-- so the row has to be created per organization first. `permissions` is
-- org-scoped (each organization holds its own copy of the catalogue), which is
-- why this inserts one row per organization rather than a single global row.
--
-- Both statements are idempotent: the first on the (org_id, code) unique index,
-- the second on the role_permissions composite key.

-- 1. Add the permission to every organization's catalogue.
INSERT INTO "permissions" ("org_id", "permission_id", "code", "module", "action", "description")
SELECT o."org_id",
       gen_random_uuid(),
       'customers.mobile.verify',
       'customers',
       'mobile_verify',
       'Send and confirm a LOCAL customer''s mobile verification code.'
FROM "organizations" o
ON CONFLICT ("org_id", "code") DO NOTHING;

-- 2. Grant it to BRANCH_ADMIN and FIELD_EMPLOYEE.
--
-- Branch Admin previously reached these routes through `customers.update`, so
-- without this grant the change would silently remove a capability it already
-- had. Field Employee is the new holder.
INSERT INTO "role_permissions" ("org_id", "role_id", "permission_id")
SELECT r."org_id", r."role_id", p."permission_id"
FROM "roles" r
JOIN "permissions" p
  ON p."org_id" = r."org_id"
 AND p."code" = 'customers.mobile.verify'
WHERE r."code" IN ('BRANCH_ADMIN', 'FIELD_EMPLOYEE')
ON CONFLICT ("org_id", "role_id", "permission_id") DO NOTHING;

-- 3. Super Admin holds every permission that is not deliberately excluded, so
-- it must receive this one too or a Super Admin would lose the ability to
-- verify a mobile that `customers.update` used to give them.
INSERT INTO "role_permissions" ("org_id", "role_id", "permission_id")
SELECT r."org_id", r."role_id", p."permission_id"
FROM "roles" r
JOIN "permissions" p
  ON p."org_id" = r."org_id"
 AND p."code" = 'customers.mobile.verify'
WHERE r."code" = 'SUPER_ADMIN'
ON CONFLICT ("org_id", "role_id", "permission_id") DO NOTHING;
