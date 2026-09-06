-- Q-CUST-23. Grants `customers.create` to every existing FIELD_EMPLOYEE role.
--
-- `CORE_ROLE_GRANTS` in role-specs.ts is only read when an organization is
-- provisioned, so changing that array alone would leave every organization
-- created before this migration without the grant. This backfills them.
--
-- Idempotent by way of ON CONFLICT DO NOTHING on the composite primary key
-- (org_id, role_id, permission_id): re-running it, or running it against an
-- organization provisioned after the spec change, is a no-op.
--
-- Scoped by role code rather than role id because the id is per-organization.
-- A role someone renamed or created by hand with the code FIELD_EMPLOYEE is
-- treated as the field role, which is the same rule the resolver uses.
--
-- Nothing is granted where the `customers.create` permission row is absent from
-- an organization's catalogue: the INNER JOIN simply matches nothing, rather
-- than inventing a permission row that provisioning did not create.
INSERT INTO "role_permissions" ("org_id", "role_id", "permission_id")
SELECT r."org_id", r."role_id", p."permission_id"
FROM "roles" r
JOIN "permissions" p
  ON p."org_id" = r."org_id"
 AND p."code" = 'customers.create'
WHERE r."code" = 'FIELD_EMPLOYEE'
ON CONFLICT ("org_id", "role_id", "permission_id") DO NOTHING;
