import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';

import { PrismaClient } from '../src/generated/prisma/client';
import { LEDGER_ACCOUNT_SPECS } from '../src/loans/disbursal/ledger-accounts';
import {
  NOTIFICATION_RULE_SPECS,
  NOTIFICATION_TEMPLATE_SPECS,
} from '../src/notifications/notification-seed-specs';
import {
  MASTER_DATA_SPECS,
  withDisplayOrder,
} from '../src/organizations/provisioning/master-data-specs';
import {
  CORE_ROLE_GRANTS,
  CORE_ROLE_SPECS,
  roleDisplayName,
} from '../src/organizations/provisioning/role-specs';
import { PERMISSION_CATALOG } from '../src/users/rbac/permission-catalog';

/**
 * Development seed for the Sign-In story.
 *
 * Creates the fixtures the Gherkin scenarios need: two organizations (to prove
 * cross-tenant isolation), two branches (to prove cross-branch denial), the
 * three roles, a permission only Super Admin holds, and one user per account
 * state. Idempotent — safe to re-run.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL as string,
  }),
});

const SEED_PASSWORD = 'Kestrel7Vault';

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  // --- Organizations ------------------------------------------------------
  const demo = await prisma.organization.upsert({
    where: { code: 'DEMO' },
    update: {},
    create: {
      code: 'DEMO',
      name: 'Demo Finance Ltd',
      legalName: 'Demo Finance Private Limited',
      status: 'ACTIVE',
      timezone: 'Asia/Kolkata',
    },
  });

  // Exists so Scenario 19 can prove organization scope is enforced.
  const other = await prisma.organization.upsert({
    where: { code: 'OTHERORG' },
    update: {},
    create: {
      code: 'OTHERORG',
      name: 'Other Finance Ltd',
      status: 'ACTIVE',
      timezone: 'Asia/Kolkata',
    },
  });

  // --- Branches -----------------------------------------------------------
  const branchA = await prisma.branch.upsert({
    where: { orgId_code: { orgId: demo.orgId, code: 'BR001' } },
    update: {},
    create: {
      orgId: demo.orgId,
      code: 'BR001',
      name: 'Chennai Main Branch',
      addressLine1: '12 Anna Salai',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600002',
      status: 'ACTIVE',
    },
  });

  // Exists so Scenarios 9 and 18 can prove branch scope is enforced.
  const branchB = await prisma.branch.upsert({
    where: { orgId_code: { orgId: demo.orgId, code: 'BR002' } },
    update: {},
    create: {
      orgId: demo.orgId,
      code: 'BR002',
      name: 'Coimbatore Branch',
      addressLine1: '45 Avinashi Road',
      city: 'Coimbatore',
      state: 'Tamil Nadu',
      pincode: '641018',
      status: 'ACTIVE',
    },
  });

  /**
   * Deliberately childless: no users, customers, loans or any other
   * branch-scoped row ever points at it. Module 02 Scenario 29 needs a branch
   * the delete guard will actually let through, and BR001/BR002 can never
   * qualify — they carry the fixtures every other spec depends on.
   *
   * If a future seed attaches anything to BR003, the organizations e2e spec
   * fails on the delete, which is the intended alarm.
   */
  await prisma.branch.upsert({
    where: { orgId_code: { orgId: demo.orgId, code: 'BR003' } },
    update: {},
    create: {
      orgId: demo.orgId,
      code: 'BR003',
      name: 'Madurai Branch',
      addressLine1: '8 West Veli Street',
      city: 'Madurai',
      state: 'Tamil Nadu',
      pincode: '625001',
      status: 'ACTIVE',
    },
  });

  // --- Roles --------------------------------------------------------------
  // The three core roles come from the shared provisioning specs, so the seed
  // and the signup path cannot drift apart — SUPER_ADMIN's system flag and the
  // reasoning behind it live in `src/organizations/provisioning/role-specs.ts`.
  //
  // The fixture roles below are seed-only. They carry the non-ACTIVE statuses
  // the role-lifecycle scenarios need — the seed is the only place a DRAFT or
  // INACTIVE role exists — and must never appear in a real organization.
  const roleSpecs = [
    ...CORE_ROLE_SPECS,
    // Scenario 30: the "Save & Activate" target must start out not-yet-active.
    { code: 'RBAC_DRAFT_ROLE', status: 'DRAFT' as const, isSystem: false },
    // Scenario 35: an inactive role must be refused as an active authorization.
    {
      code: 'RBAC_INACTIVE_ROLE',
      status: 'INACTIVE' as const,
      isSystem: false,
    },
    // Scenario 56: deletion is blocked while a role is assigned to a user.
    { code: 'RBAC_ASSIGNED_ROLE', status: 'ACTIVE' as const, isSystem: false },
    // Module 17 Scenario 45. This role exists to make a *scope* denial provable
    // as distinct from an *authority* denial.
    //
    // Branch Admin is refused a maintenance retry because it lacks the code at
    // all — that proves nothing about branch confinement. Scenario 45 asks for
    // something stricter: an administrator authorized only for Branch A who
    // attempts to retry a Branch B job and is denied. Proving it needs an
    // account that HOLDS `maintenance.jobs.retry` and is still refused, which
    // no existing role can supply.
    { code: 'MAINT_OPERATOR', status: 'ACTIVE' as const, isSystem: false },
  ];
  const roles: Record<string, string> = {};
  for (const spec of roleSpecs) {
    const role = await prisma.role.upsert({
      where: { orgId_code: { orgId: demo.orgId, code: spec.code } },
      // `isSystem` and `status` are re-asserted on update so a re-seed repairs a
      // fixture an e2e run left in the wrong state — the DRAFT role in
      // particular is activated by Scenario 30 and must return to DRAFT.
      update: { status: spec.status, isSystem: spec.isSystem },
      create: {
        orgId: demo.orgId,
        code: spec.code,
        name: roleDisplayName(spec.code),
        status: spec.status,
        isSystem: spec.isSystem,
      },
    });
    roles[spec.code] = role.roleId;
  }

  // --- Permissions --------------------------------------------------------
  // Permissions are per-organization rows, not a global catalog, so each org
  // needs its own set. The list itself lives in src/users/permission-catalog.ts
  // so the seed and PermissionService.syncCatalogForOrg cannot drift apart.
  const permissions: Record<string, string> = {};
  for (const spec of PERMISSION_CATALOG) {
    const permission = await prisma.permission.upsert({
      where: { orgId_code: { orgId: demo.orgId, code: spec.code } },
      update: {
        module: spec.module,
        action: spec.action,
        description: spec.description,
      },
      create: { orgId: demo.orgId, ...spec },
    });
    permissions[spec.code] = permission.permissionId;
  }

  // The three core roles' grants come from the shared provisioning specs. Every
  // withheld permission there is load-bearing — each omission gives an e2e
  // scenario an account that reaches a screen and is refused the action — and
  // the reasoning for each lives alongside the list in
  // `src/organizations/provisioning/role-specs.ts`.
  //
  // The fixture grants below are seed-only, for the roles above that no real
  // organization has.
  const grants: Record<string, readonly string[]> = {
    ...CORE_ROLE_GRANTS,
    // The Module 03 fixture roles each hold exactly one harmless permission.
    // One rather than none because activating a role requires a non-empty
    // permission set (Scenario 30), and `dashboard.view` rather than anything
    // privileged because these roles get assigned to real fixture users during
    // e2e runs and must not widen what those accounts can reach.
    RBAC_DRAFT_ROLE: ['dashboard.view'],
    RBAC_INACTIVE_ROLE: ['dashboard.view'],
    RBAC_ASSIGNED_ROLE: ['dashboard.view'],
    // Module 17 Scenario 45 — see the role spec above for why this exists.
    //
    // It holds the maintenance codes a Branch Admin is refused, and is assigned
    // to a user confined to BR001. The denial it proves is therefore about
    // *reach*, not authority: the account can genuinely retry a job, and is
    // still refused one belonging to BR002.
    //
    // Nothing beyond maintenance: this is a fixture for one scenario, and a
    // wider grant would make it a second administrator whose reach other tests
    // would have to account for.
    MAINT_OPERATOR: [
      'dashboard.view',
      'maintenance.jobs.view',
      'maintenance.jobs.run',
      'maintenance.jobs.retry',
      'maintenance.eod.run',
    ],
  };

  for (const [roleCode, permissionCodes] of Object.entries(grants)) {
    for (const permissionCode of permissionCodes) {
      await prisma.rolePermission.upsert({
        where: {
          orgId_roleId_permissionId: {
            orgId: demo.orgId,
            roleId: roles[roleCode],
            permissionId: permissions[permissionCode],
          },
        },
        update: {},
        create: {
          orgId: demo.orgId,
          roleId: roles[roleCode],
          permissionId: permissions[permissionCode],
        },
      });
    }
  }

  // --- Users --------------------------------------------------------------
  const users = [
    {
      mobile: '9000000001',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      branchId: null,
      status: 'ACTIVE' as const,
    },
    {
      mobile: '9000000002',
      name: 'Branch Admin A',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    {
      mobile: '9000000003',
      name: 'Branch Admin B',
      role: 'BRANCH_ADMIN',
      branchId: branchB.branchId,
      status: 'ACTIVE' as const,
    },
    {
      mobile: '9000000004',
      name: 'Field Employee',
      role: 'FIELD_EMPLOYEE',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    {
      mobile: '9000000005',
      name: 'Inactive Admin',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'INACTIVE' as const,
    },
    {
      mobile: '9000000006',
      name: 'Locked Admin',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'LOCKED' as const,
    },
    /**
     * Owned exclusively by the Change Password e2e spec, which mutates this
     * account's password and — unlike the other specs — cannot restore it: with
     * a password history depth of 5, setting the seed password back would be
     * rejected as reuse. Give any other spec its own account rather than
     * borrowing this one.
     */
    {
      mobile: '9000000007',
      name: 'Password Changer',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    /**
     * Owned exclusively by the Active Sessions e2e spec, which signs in from
     * several browser contexts at once and revokes them. Sharing it would make
     * another spec's session disappear mid-test.
     *
     * A Branch Admin so the spec also exercises `sessions.revoke` under branch
     * scope; its password is never changed, so it needs no restoration.
     */
    {
      mobile: '9000000008',
      name: 'Session Manager',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    /**
     * Owned exclusively by the GPS Check-in e2e spec. A Field Employee on
     * Branch A, so the spec can prove a verified check-in never moves the user
     * to another branch (GPS Scenario 24).
     *
     * Separate from `9000000004` because the check-in spec revokes sessions and
     * grants/denies geolocation per browser context; sharing the general Field
     * Employee fixture would make an unrelated spec's session disappear.
     */
    {
      mobile: '9000000009',
      name: 'GPS Field Employee',
      role: 'FIELD_EMPLOYEE',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    /**
     * An INACTIVE Field Employee, so GPS Scenarios 28 and 29 have an account
     * that holds `field.checkin` yet must still be refused a new field session.
     * The existing inactive fixture (`9000000005`) is a Branch Admin and would
     * fail on the permission check first, proving nothing about account status.
     */
    {
      mobile: '9000000010',
      name: 'Inactive Field Employee',
      role: 'FIELD_EMPLOYEE',
      branchId: branchA.branchId,
      status: 'INACTIVE' as const,
    },
    /**
     * Owned exclusively by the Organizations & Branches e2e spec. A Super Admin
     * (branchId null = organization-wide) so the spec can create, edit,
     * deactivate and delete branches without disturbing `9000000001`, which
     * every other spec signs in as.
     *
     * The spec mutates DEMO's own organization row and BR002's status, so it
     * must run against a freshly seeded database.
     */
    {
      mobile: '9000000011',
      name: 'Org Branch Admin',
      role: 'SUPER_ADMIN',
      branchId: null,
      status: 'ACTIVE' as const,
    },
    /**
     * The branch-confined counterpart, owned by the same spec. Holds
     * `branches.view` and nothing else in Module 02, so Scenarios 15, 16, 34
     * and 35 have an account that reaches Branch Management, sees only BR001,
     * and is refused every mutation and every cross-branch read.
     */
    {
      mobile: '9000000012',
      name: 'Branch Scoped Admin',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    /**
     * Module 03 fixtures (9000000013–19), owned exclusively by the users,
     * employees and roles e2e specs. Separate from 9000000011/12 because those
     * belong to the Organizations spec, which deactivates BR002 — a Module 03
     * spec signing in as them would race it.
     *
     * The Super Admin actor for all three specs. Organization-wide, so it can
     * reach every branch's employees and administer roles.
     */
    {
      mobile: '9000000013',
      name: 'RBAC Super Admin',
      role: 'SUPER_ADMIN',
      branchId: null,
      status: 'ACTIVE' as const,
    },
    /**
     * The branch-confined actor. Holds `employees.view`/`activate`, `users.view`,
     * `roles.view` and `permissions.view` and nothing else in Module 03, so it
     * proves both halves of the rule: it reaches Employee Management and the role
     * list, and is refused create, assign, role-permission edits and every
     * cross-branch read (Scenarios 19, 22, 23, 25, 37, 40).
     */
    {
      mobile: '9000000014',
      name: 'RBAC Branch Admin',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    /**
     * The mutation target: edited, deactivated and reactivated by the users spec.
     * Also the holder of RBAC_ASSIGNED_ROLE, which is what makes that role
     * undeletable for Scenario 56.
     *
     * It signs in during Scenario 9/45, so it accumulates audit rows and is
     * permanently undeletable — which is exactly what Scenario 54 asserts.
     */
    {
      mobile: '9000000015',
      name: 'RBAC Target User',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    /**
     * On Branch B, so Scenario 23 has a user a Branch A admin must not reach.
     * Never mutated — only read and refused.
     */
    {
      mobile: '9000000016',
      name: 'RBAC Other Branch User',
      role: 'BRANCH_ADMIN',
      branchId: branchB.branchId,
      status: 'ACTIVE' as const,
    },
    /** An active employee: the assign/deactivate/reactivate target. */
    {
      mobile: '9000000017',
      name: 'RBAC Field Employee',
      role: 'FIELD_EMPLOYEE',
      branchId: branchA.branchId,
      employeeCode: 'EMP017',
      status: 'ACTIVE' as const,
    },
    /**
     * An INACTIVE employee, so Scenarios 10, 20 and 53 have someone who must not
     * appear in the field-assignment selector and must be refused new work.
     */
    {
      mobile: '9000000018',
      name: 'RBAC Inactive Employee',
      role: 'FIELD_EMPLOYEE',
      branchId: branchA.branchId,
      employeeCode: 'EMP018',
      status: 'INACTIVE' as const,
    },
    /**
     * The deletable account, and this module's equivalent of BR003.
     *
     * `AuditLog.actorUserId` carries a composite FK to `users`, so any user who
     * has ever signed in is permanently undeletable — correct per Rules 14 and
     * 43, but it leaves the delete path untestable unless one fixture stays
     * pristine. This is that fixture: PENDING, no password ever used, never
     * signed in, referenced by nothing.
     *
     * If a future spec signs in as 9000000019, Scenario 54's successful-delete
     * assertion starts failing, which is the intended alarm.
     */
    {
      mobile: '9000000019',
      name: 'RBAC Deletable User',
      role: 'FIELD_EMPLOYEE',
      branchId: branchA.branchId,
      employeeCode: 'EMP019',
      status: 'PENDING' as const,
    },
    /**
     * Module 17 Scenario 45 — the branch-confined maintenance operator.
     *
     * Confined to Branch A and holding `maintenance.jobs.retry`, so a refusal
     * on a Branch B job is demonstrably about scope rather than authority. A
     * Branch Admin refused the same act proves only that it lacks the code.
     *
     * This account signs in, so it is permanently undeletable — deliberately not
     * 9000000019's kind of fixture, and it must not be borrowed for the delete
     * path.
     */
    {
      mobile: '9000000020',
      name: 'Maintenance Operator',
      role: 'MAINT_OPERATOR',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    /**
     * Password-recovery fixtures, owned solely by `recovery.spec.ts`.
     *
     * That spec completes a real reset, so the account it uses does NOT end the
     * run on the seed password. It previously borrowed 9000000002 and
     * 9000000003, which `gps-check-in.spec.ts` and `auth.spec.ts` sign in to
     * with the seed password — so whichever ran second got a 401 that read as an
     * authentication bug rather than as another spec having moved the password.
     *
     * Two accounts rather than one because issuing a recovery request cancels
     * every earlier one for that user (Q-REC-8): two specs recovering the same
     * account would invalidate each other's code, which is correct behaviour
     * that would otherwise look flaky.
     *
     * If a future spec signs in as either of these expecting the seed password,
     * it will fail intermittently — use an account of your own instead.
     */
    {
      mobile: '9000000021',
      name: 'Recovery Policy Target',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
    {
      mobile: '9000000022',
      name: 'Recovery History Target',
      role: 'BRANCH_ADMIN',
      branchId: branchA.branchId,
      status: 'ACTIVE' as const,
    },
  ];

  for (const spec of users) {
    // Only the Module 03 employee fixtures carry a code; an administrator has
    // none, which is precisely what separates the two surfaces over this table.
    const employeeCode = 'employeeCode' in spec ? spec.employeeCode : null;

    const user = await prisma.user.upsert({
      where: { orgId_mobile: { orgId: demo.orgId, mobile: spec.mobile } },
      update: {
        passwordHash,
        status: spec.status,
        // Re-asserted so a spec that reassigned or deactivated a fixture does not
        // leave the next run starting from the wrong branch or status.
        branchId: spec.branchId,
        employeeCode,
        // Keep the locked fixture locked for an hour on every re-seed.
        lockedUntil:
          spec.status === 'LOCKED'
            ? new Date(Date.now() + 60 * 60 * 1000)
            : null,
        failedLoginAttempts: spec.status === 'LOCKED' ? 5 : 0,
      },
      create: {
        orgId: demo.orgId,
        mobile: spec.mobile,
        name: spec.name,
        branchId: spec.branchId,
        employeeCode,
        passwordHash,
        status: spec.status,
        lockedUntil:
          spec.status === 'LOCKED'
            ? new Date(Date.now() + 60 * 60 * 1000)
            : null,
        failedLoginAttempts: spec.status === 'LOCKED' ? 5 : 0,
      },
    });

    /**
     * Re-seeding resets the password, so the retained history must go with it.
     * Otherwise a developer who re-seeds after testing a reset would find the
     * seed password rejected as "recently used" — correct behaviour against
     * stale rows, but baffling on a freshly seeded database.
     */
    await prisma.passwordHistory.deleteMany({
      where: { orgId: demo.orgId, userId: user.userId },
    });

    await prisma.userRole.upsert({
      where: {
        orgId_userId_roleId: {
          orgId: demo.orgId,
          userId: user.userId,
          roleId: roles[spec.role],
        },
      },
      update: {},
      create: {
        orgId: demo.orgId,
        userId: user.userId,
        roleId: roles[spec.role],
      },
    });

    /**
     * A second role for the target user, so RBAC_ASSIGNED_ROLE has a holder and
     * Scenario 56 ("role deletion is blocked when assigned") has something to
     * refuse. This also makes 9000000015 the multi-role fixture, which is what
     * proves the effective permission set is the union of ACTIVE roles rather
     * than whichever row came back first (Q-RBAC-33).
     */
    if (spec.mobile === '9000000015') {
      await prisma.userRole.upsert({
        where: {
          orgId_userId_roleId: {
            orgId: demo.orgId,
            userId: user.userId,
            roleId: roles.RBAC_ASSIGNED_ROLE,
          },
        },
        update: {},
        create: {
          orgId: demo.orgId,
          userId: user.userId,
          roleId: roles.RBAC_ASSIGNED_ROLE,
        },
      });
    }
  }

  // --- Customers (Module 04) ----------------------------------------------
  /**
   * Every fixture below exists to make a specific *refusal* provable, in the
   * same spirit as the Module 03 role fixtures. None of them live in BR003 —
   * that branch must stay childless for the Module 02 delete-guard scenario.
   *
   * Ownership: `apps/web/e2e/customers.spec.ts` owns CUST001-CUST008 and the
   * scratch code range CUSTZZ*. No other spec may mutate them. The customers
   * spec must not mutate any Module 03 user fixture.
   *
   * `update:` re-asserts status, type and verification state on every run, so a
   * re-seed repairs whatever an e2e run left behind (a KYC approval, a
   * deactivation, a consumed mobile verification).
   */
  const customerSpecs = [
    {
      code: 'CUST001',
      branchId: branchA.branchId,
      type: 'KYC' as const,
      fullName: 'Anitha Raman',
      mobile: '9100000001',
      status: 'ACTIVE' as const,
      // Approved KYC: the readable happy-path profile, and the customer the
      // cross-branch scenario tries to reach from BR002.
      kyc: 'APPROVED' as const,
      mobileVerified: true,
    },
    {
      code: 'CUST002',
      branchId: branchB.branchId,
      type: 'KYC' as const,
      fullName: 'Bhaskar Nair',
      mobile: '9100000002',
      status: 'ACTIVE' as const,
      // Scenario 21: a BR001 Branch Admin must not reach this record. Lives in
      // BR002 for exactly that reason.
      kyc: 'APPROVED' as const,
      mobileVerified: true,
    },
    {
      code: 'CUST003',
      branchId: branchA.branchId,
      type: 'KYC' as const,
      fullName: 'Chitra Devi',
      mobile: '9100000003',
      status: 'PENDING' as const,
      // Scenario 7: submitted with no documents at all, so approval must be
      // refused for a missing required set rather than succeeding.
      kyc: 'SUBMITTED' as const,
      mobileVerified: false,
    },
    {
      code: 'CUST004',
      branchId: branchA.branchId,
      type: 'KYC' as const,
      fullName: 'Dinesh Kumar',
      mobile: '9100000004',
      status: 'PENDING' as const,
      // Scenario 8: already returned for revision, with a reason on the record.
      kyc: 'REVISION_REQUIRED' as const,
      mobileVerified: false,
    },
    {
      code: 'CUST005',
      branchId: branchA.branchId,
      type: 'LOCAL' as const,
      fullName: 'Eswari Selvam',
      mobile: '9100000005',
      status: 'ACTIVE' as const,
      // A fully onboarded LOCAL customer: no KYC row at all (Q-CUST-2), mobile
      // verified. Proves "active without KYC" is a legitimate state.
      kyc: null,
      mobileVerified: true,
    },
    {
      code: 'CUST006',
      branchId: branchA.branchId,
      type: 'LOCAL' as const,
      fullName: 'Farhan Basha',
      mobile: '9100000006',
      status: 'PENDING' as const,
      // Scenario 14: LOCAL with `mobileVerifiedAt` null. Activation must be
      // refused until an OTP round-trip completes.
      kyc: null,
      mobileVerified: false,
    },
    {
      code: 'CUST007',
      branchId: branchA.branchId,
      type: 'LOCAL' as const,
      fullName: 'Gayathri Mohan',
      mobile: '9100000007',
      status: 'ACTIVE' as const,
      // Scenario 27: the LOCAL → KYC conversion target. Verified and active, so
      // the conversion is testing the type change and not some other refusal.
      kyc: null,
      mobileVerified: true,
    },
    {
      code: 'CUST008',
      branchId: branchB.branchId,
      type: 'KYC' as const,
      fullName: 'Hari Prasad',
      mobile: '9100000008',
      status: 'INACTIVE' as const,
      // The deactivated record, and this module's deletable target: nothing
      // else in the seed points at it, so the delete guard must let it through
      // (Scenario 37's negative case). Lives in BR002 so deleting it cannot
      // disturb the BR001 fixtures the rest of the spec walks.
      kyc: 'REJECTED' as const,
      mobileVerified: true,
    },
  ];

  for (const spec of customerSpecs) {
    const customer = await prisma.customer.upsert({
      where: {
        orgId_customerCode: { orgId: demo.orgId, customerCode: spec.code },
      },
      update: {
        status: spec.status,
        customerType: spec.type,
        branchId: spec.branchId,
        mobileVerifiedAt: spec.mobileVerified ? new Date() : null,
      },
      create: {
        orgId: demo.orgId,
        branchId: spec.branchId,
        customerCode: spec.code,
        customerType: spec.type,
        fullName: spec.fullName,
        mobile: spec.mobile,
        mobileVerifiedAt: spec.mobileVerified ? new Date() : null,
        addressLine1: '12 Gandhi Street',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
        status: spec.status,
      },
    });

    // A LOCAL customer has no KYC row at all rather than a NOT_REQUIRED one
    // (Q-CUST-2), so "does this customer need KYC" is a row test. Re-seeding
    // deletes any row an e2e run created against a LOCAL fixture.
    if (spec.kyc === null) {
      await prisma.customerKyc.deleteMany({
        where: { orgId: demo.orgId, customerId: customer.customerId },
      });
      continue;
    }

    const existingKyc = await prisma.customerKyc.findFirst({
      where: { orgId: demo.orgId, customerId: customer.customerId },
    });

    const kycData = {
      status: spec.kyc,
      submittedAt: new Date(),
      reviewedAt: spec.kyc === 'SUBMITTED' ? null : new Date(),
      revisionReason:
        spec.kyc === 'REVISION_REQUIRED'
          ? 'Address proof is illegible. Please re-upload a clearer scan.'
          : null,
    };

    if (existingKyc) {
      await prisma.customerKyc.update({
        where: {
          orgId_kycId: { orgId: demo.orgId, kycId: existingKyc.kycId },
        },
        data: kycData,
      });
    } else {
      await prisma.customerKyc.create({
        data: {
          orgId: demo.orgId,
          customerId: customer.customerId,
          ...kycData,
        },
      });
    }
  }

  // --- Second organization ------------------------------------------------
  // Same mobile number as DEMO's Super Admin on purpose: it proves the mobile
  // is only unique within an org and that the org code is what discriminates.
  //
  // This org deliberately gets the full permission catalog too. It previously
  // had none, which meant its Super Admin held a role granting nothing — a
  // cross-tenant isolation fixture that also silently modelled the "new org is
  // locked out" bug. Syncing the catalog here is what the real provisioning path
  // will do via PermissionService.syncCatalogForOrg.
  const otherRole = await prisma.role.upsert({
    where: { orgId_code: { orgId: other.orgId, code: 'SUPER_ADMIN' } },
    update: { isSystem: true },
    create: {
      orgId: other.orgId,
      code: 'SUPER_ADMIN',
      name: 'super admin',
      status: 'ACTIVE',
      isSystem: true,
    },
  });

  for (const spec of PERMISSION_CATALOG) {
    const permission = await prisma.permission.upsert({
      where: { orgId_code: { orgId: other.orgId, code: spec.code } },
      update: {
        module: spec.module,
        action: spec.action,
        description: spec.description,
      },
      create: { orgId: other.orgId, ...spec },
    });
    if (spec.code === 'field.checkin') continue;
    await prisma.rolePermission.upsert({
      where: {
        orgId_roleId_permissionId: {
          orgId: other.orgId,
          roleId: otherRole.roleId,
          permissionId: permission.permissionId,
        },
      },
      update: {},
      create: {
        orgId: other.orgId,
        roleId: otherRole.roleId,
        permissionId: permission.permissionId,
      },
    });
  }

  const otherUser = await prisma.user.upsert({
    where: { orgId_mobile: { orgId: other.orgId, mobile: '9000000001' } },
    update: { passwordHash, status: 'ACTIVE' },
    create: {
      orgId: other.orgId,
      mobile: '9000000001',
      name: 'Other Org Admin',
      passwordHash,
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.upsert({
    where: {
      orgId_userId_roleId: {
        orgId: other.orgId,
        userId: otherUser.userId,
        roleId: otherRole.roleId,
      },
    },
    update: {},
    create: {
      orgId: other.orgId,
      userId: otherUser.userId,
      roleId: otherRole.roleId,
    },
  });

  /**
   * A customer inside the second organization, for Scenario 30.
   *
   * Cross-*branch* denial (Scenario 21) is already covered by CUST002 in BR002,
   * but that is a different check on a different code path: branch confinement
   * narrows a query the caller is otherwise entitled to make, whereas the tenant
   * boundary is unconditional. This fixture is the only way to prove the second
   * one, because a DEMO caller must fail to reach it even as Super Admin — who
   * has no branchId and is therefore subject to no branch filter at all.
   */
  // --- Loan products and schemes (Module 06) -------------------------------
  /**
   * Enough configuration for a loan application to be created against, plus the
   * fixtures that make Module 07's refusals provable.
   *
   * Ownership: `apps/web/e2e/loan-products.spec.ts` and
   * `apps/web/e2e/loan-applications.spec.ts` own these codes and the scratch
   * range `PRODZZ*` / `SCHZZ*`. No other spec may mutate them.
   *
   * `update:` re-asserts status and rate on every run, so a re-seed repairs
   * whatever an e2e run left behind (a deactivation, a repricing).
   *
   * The four loan types are all represented because `LoanApplication` has no
   * `loanType` column — it reads the type through its product — so covering the
   * enum requires four products rather than one product and four values.
   */
  const productSpecs = [
    {
      code: 'PROD-PERSONAL',
      name: 'Personal Loan',
      loanType: 'PERSONAL' as const,
      status: 'ACTIVE' as const,
    },
    {
      code: 'PROD-BUSINESS',
      name: 'Business Loan',
      loanType: 'BUSINESS' as const,
      status: 'ACTIVE' as const,
    },
    {
      code: 'PROD-GOLD',
      name: 'Gold Loan',
      loanType: 'GOLD' as const,
      status: 'ACTIVE' as const,
    },
    {
      // Scenario 38 and Rule 71: an application must not be creatable against a
      // withdrawn product, and proving that needs one that is withdrawn.
      code: 'PROD-VEHICLE',
      name: 'Vehicle Loan (withdrawn)',
      loanType: 'VEHICLE' as const,
      status: 'INACTIVE' as const,
    },
  ];

  const products: Record<string, { loanProductId: string }> = {};

  for (const spec of productSpecs) {
    products[spec.code] = await prisma.loanProduct.upsert({
      where: { orgId_code: { orgId: demo.orgId, code: spec.code } },
      update: { status: spec.status, name: spec.name, loanType: spec.loanType },
      create: {
        orgId: demo.orgId,
        code: spec.code,
        name: spec.name,
        loanType: spec.loanType,
        status: spec.status,
      },
    });
  }

  /**
   * `durations` is re-asserted on every run for the same reason as the statuses
   * above: an e2e run that deactivates an option must not leave the next run
   * with an unselectable scheme.
   */
  const schemeSpecs = [
    {
      code: 'SCH-PERS-RED',
      productCode: 'PROD-PERSONAL',
      name: 'Personal Reducing 12%',
      interestType: 'REDUCING' as const,
      // Integer basis points, never a float: 12.00% p.a.
      interestRateBps: 1_200n,
      status: 'ACTIVE' as const,
      durations: [
        { frequency: 'MONTHLY' as const, durationCount: 6 },
        { frequency: 'MONTHLY' as const, durationCount: 12 },
        { frequency: 'MONTHLY' as const, durationCount: 24 },
      ],
    },
    {
      code: 'SCH-PERS-FLAT',
      productCode: 'PROD-PERSONAL',
      name: 'Personal Flat 10%',
      interestType: 'FLAT' as const,
      interestRateBps: 1_000n,
      status: 'ACTIVE' as const,
      // Weekly and daily options exist so the EMI calculator's non-monthly
      // paths are reachable from the UI, not only from its unit tests.
      durations: [
        { frequency: 'WEEKLY' as const, durationCount: 52 },
        { frequency: 'DAILY' as const, durationCount: 100 },
      ],
    },
    {
      code: 'SCH-BUS-RED',
      productCode: 'PROD-BUSINESS',
      name: 'Business Reducing 18%',
      interestType: 'REDUCING' as const,
      interestRateBps: 1_800n,
      status: 'ACTIVE' as const,
      durations: [
        { frequency: 'MONTHLY' as const, durationCount: 12 },
        { frequency: 'QUARTERLY' as const, durationCount: 8 },
      ],
    },
    {
      // Scenario 10: a deactivated scheme must not be selectable, and a direct
      // request naming it must be refused. Both need a scheme that is INACTIVE
      // while its product is fine.
      code: 'SCH-GOLD-OLD',
      productCode: 'PROD-GOLD',
      name: 'Gold Reducing 15% (withdrawn)',
      interestType: 'REDUCING' as const,
      interestRateBps: 1_500n,
      status: 'INACTIVE' as const,
      durations: [{ frequency: 'MONTHLY' as const, durationCount: 12 }],
    },
    {
      // The third way a scheme can be unselectable: ACTIVE, under an ACTIVE
      // product, but with no term anyone could borrow over. Distinct from the
      // two above, and the only fixture that proves the durations half of the
      // selectability rule.
      code: 'SCH-GOLD-EMPTY',
      productCode: 'PROD-GOLD',
      name: 'Gold Reducing 15% (no terms)',
      interestType: 'REDUCING' as const,
      interestRateBps: 1_500n,
      status: 'ACTIVE' as const,
      durations: [],
    },
  ];

  for (const spec of schemeSpecs) {
    const product = products[spec.productCode];

    if (!product) {
      throw new Error(
        `Scheme ${spec.code} names unknown product ${spec.productCode}`,
      );
    }

    const scheme = await prisma.loanScheme.upsert({
      where: { orgId_code: { orgId: demo.orgId, code: spec.code } },
      update: {
        name: spec.name,
        interestType: spec.interestType,
        interestRateBps: spec.interestRateBps,
        status: spec.status,
      },
      create: {
        orgId: demo.orgId,
        loanProductId: product.loanProductId,
        code: spec.code,
        name: spec.name,
        interestType: spec.interestType,
        interestRateBps: spec.interestRateBps,
        status: spec.status,
      },
    });

    for (const duration of spec.durations) {
      await prisma.loanSchemeDuration.upsert({
        where: {
          orgId_loanSchemeId_frequency_durationCount: {
            orgId: demo.orgId,
            loanSchemeId: scheme.loanSchemeId,
            frequency: duration.frequency,
            durationCount: duration.durationCount,
          },
        },
        update: { status: 'ACTIVE' },
        create: {
          orgId: demo.orgId,
          loanSchemeId: scheme.loanSchemeId,
          frequency: duration.frequency,
          durationCount: duration.durationCount,
          status: 'ACTIVE',
        },
      });
    }
  }

  // --- Module 13: the penalty rule overdue loans are assessed against -------
  //
  // The `penalty_rules` tables came from the initial migration and stayed empty
  // because nothing wrote them: Module 11 *consumes* `Penalty` rows and never
  // creates one, and Module 13 is the first module that assesses. Without a
  // rule reachable from a loan, `PenaltyService.assess` correctly refuses with
  // "No penalty rule is configured for this loan" — which is right, but leaves
  // a freshly seeded organization unable to charge penal interest at all.
  //
  // 0.05% per day of the overdue balance after a 5-day grace period: a
  // conventional retail figure, chosen so the seeded schemes have a defensible
  // default rather than an arbitrary one. An organization overrides it per
  // scheme or per loan.
  const penaltyRule = await prisma.penaltyRule.upsert({
    where: {
      orgId_penaltyRuleId: {
        orgId: demo.orgId,
        penaltyRuleId: '00000000-0000-4000-8000-00000000d001',
      },
    },
    update: {
      calculationType: 'PERCENTAGE_OUTSTANDING_PER_DAY',
      rateBps: 5n,
      graceDays: 5,
      status: 'ACTIVE',
    },
    create: {
      orgId: demo.orgId,
      penaltyRuleId: '00000000-0000-4000-8000-00000000d001',
      name: 'Standard Penal Interest',
      calculationType: 'PERCENTAGE_OUTSTANDING_PER_DAY',
      rateBps: 5n,
      fixedAmountPaise: null,
      graceDays: 5,
      status: 'ACTIVE',
    },
  });

  // Attached to every DEMO scheme, so any loan built from one can be assessed.
  // `findMany` rather than reusing the loop variable above: the loop's `scheme`
  // is out of scope here, and re-reading is what keeps this block independent
  // of how many schemes the specs above happen to define.
  for (const scheme of await prisma.loanScheme.findMany({
    where: { orgId: demo.orgId },
    select: { loanSchemeId: true },
  })) {
    const existing = await prisma.penaltyRuleOverride.findFirst({
      where: {
        orgId: demo.orgId,
        loanSchemeId: scheme.loanSchemeId,
        penaltyRuleId: penaltyRule.penaltyRuleId,
      },
    });

    if (!existing) {
      await prisma.penaltyRuleOverride.create({
        data: {
          orgId: demo.orgId,
          loanSchemeId: scheme.loanSchemeId,
          penaltyRuleId: penaltyRule.penaltyRuleId,
        },
      });
    }
  }

  const otherBranch = await prisma.branch.upsert({
    where: { orgId_code: { orgId: other.orgId, code: 'BR001' } },
    update: {},
    create: {
      orgId: other.orgId,
      code: 'BR001',
      name: 'Other Org Branch',
      addressLine1: '3 Residency Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560025',
      status: 'ACTIVE',
    },
  });

  await prisma.customer.upsert({
    where: {
      orgId_customerCode: { orgId: other.orgId, customerCode: 'CUST001' },
    },
    update: { status: 'ACTIVE' },
    create: {
      orgId: other.orgId,
      branchId: otherBranch.branchId,
      customerCode: 'CUST001',
      customerType: 'KYC',
      fullName: 'Other Org Customer',
      mobile: '9100000001',
      addressLine1: '3 Residency Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560025',
      status: 'ACTIVE',
    },
  });

  /**
   * Module 07 Scenario 44: a customer in one organization and a scheme in
   * another must not combine. Proving that needs a scheme OTHERORG owns, so a
   * DEMO caller naming this id is refused on tenancy rather than on status —
   * which is why it is ACTIVE and fully formed rather than a withdrawn stub.
   */
  const otherProduct = await prisma.loanProduct.upsert({
    where: { orgId_code: { orgId: other.orgId, code: 'PROD-PERSONAL' } },
    update: { status: 'ACTIVE' },
    create: {
      orgId: other.orgId,
      code: 'PROD-PERSONAL',
      name: 'Other Org Personal Loan',
      loanType: 'PERSONAL',
      status: 'ACTIVE',
    },
  });

  const otherScheme = await prisma.loanScheme.upsert({
    where: { orgId_code: { orgId: other.orgId, code: 'SCH-PERS-RED' } },
    update: { status: 'ACTIVE' },
    create: {
      orgId: other.orgId,
      loanProductId: otherProduct.loanProductId,
      code: 'SCH-PERS-RED',
      name: 'Other Org Personal Reducing 12%',
      interestType: 'REDUCING',
      interestRateBps: 1_200n,
      status: 'ACTIVE',
    },
  });

  await prisma.loanSchemeDuration.upsert({
    where: {
      orgId_loanSchemeId_frequency_durationCount: {
        orgId: other.orgId,
        loanSchemeId: otherScheme.loanSchemeId,
        frequency: 'MONTHLY',
        durationCount: 12,
      },
    },
    update: { status: 'ACTIVE' },
    create: {
      orgId: other.orgId,
      loanSchemeId: otherScheme.loanSchemeId,
      frequency: 'MONTHLY',
      durationCount: 12,
      status: 'ACTIVE',
    },
  });

  // --- Master data (admin-maintained option lists) --------------------------
  // The four option lists every organization starts with, from the shared
  // provisioning specs. The reasoning for each category — and why every row is
  // `isSystem` — lives in
  // `src/organizations/provisioning/master-data-specs.ts`.
  //
  // Seeded for both organizations: master data is per-org, and OTHERORG needs
  // its own copy for the tenant-isolation proofs to mean anything.
  // Ordered within each category, in tens, by the shared helper — so the seed
  // and the provisioning path can never number the same list differently.
  const masterDataSpecs = withDisplayOrder(MASTER_DATA_SPECS);

  for (const org of [demo, other]) {
    for (const spec of masterDataSpecs) {
      const next = spec.displayOrder;

      await prisma.masterDataValue.upsert({
        where: {
          orgId_category_code: {
            orgId: org.orgId,
            category: spec.category,
            code: spec.code,
          },
        },
        // Re-asserts label, order and ACTIVE on every run, so a re-seed repairs
        // whatever an e2e run left behind — a relabel, a deactivation.
        update: {
          label: spec.label,
          displayOrder: next,
          status: 'ACTIVE',
          isSystem: true,
          requiresCollateral: spec.requiresCollateral ?? null,
        },
        create: {
          orgId: org.orgId,
          category: spec.category,
          code: spec.code,
          label: spec.label,
          displayOrder: next,
          status: 'ACTIVE',
          isSystem: true,
          // LOAN_TYPE rows only. Re-asserted on update alongside the rest, so a
          // re-seed repairs a flag an e2e run flipped.
          requiresCollateral: spec.requiresCollateral ?? null,
        },
      });
    }
  }

  // --- Chart of accounts (Module 09) ---------------------------------------
  // The three accounts a disbursal posts to. Both organizations get them: a
  // disbursal in OTHERORG must balance too, and an org whose funding account is
  // missing would fail at the ledger step rather than at a validation.
  //
  // Deliberately not branch-scoped — which branch a posting belongs to is
  // carried by the AccountDimension on each journal line. See
  // src/loans/ledger-accounts.ts for why there are three and not thirty.
  for (const org of [demo, other]) {
    for (const spec of LEDGER_ACCOUNT_SPECS) {
      await prisma.account.upsert({
        where: {
          orgId_accountCode: {
            orgId: org.orgId,
            accountCode: spec.accountCode,
          },
        },
        // Re-asserts ACTIVE on every run, so a re-seed repairs an account an
        // e2e deactivation test left INACTIVE — the same reasoning as master
        // data above. Scenario 34 deactivates one on purpose.
        update: {
          accountName: spec.accountName,
          accountType: spec.accountType,
          normalBalance: spec.normalBalance,
          status: 'ACTIVE',
        },
        create: {
          orgId: org.orgId,
          accountCode: spec.accountCode,
          accountName: spec.accountName,
          accountType: spec.accountType,
          normalBalance: spec.normalBalance,
          status: 'ACTIVE',
          // Module 14 posting eligibility. Set on create only, unlike `status`
          // above: these two are operator-configurable from the Chart of
          // Accounts screen, so re-asserting them on every run would silently
          // undo a deliberate change. A new organization needs them because
          // the column default for `isManualPostingAllowed` is false, which
          // would leave its journal builder with an empty account picker.
          isManualPostingAllowed: spec.isManualPostingAllowed,
          isControlAccount: spec.isControlAccount,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Module 16 — notification templates and event rules
  // -------------------------------------------------------------------------
  //
  // Seeded for both organizations, because a notification pipeline with no
  // rules is indistinguishable from a broken one: events would be raised,
  // matched against nothing, and marked PROCESSED with no notification to show
  // for it.
  //
  // Templates first — a rule carries a foreign key to one, and `RESTRICT` on
  // that key means an out-of-order insert fails rather than silently creating a
  // rule pointing at nothing.
  //
  // Preferences are deliberately NOT seeded. The evaluator treats a missing row
  // as "everything on", so a fresh user receives everything; writing a row here
  // would be recording a decision the user has not made.
  //
  // `EmailProviderConfig` is not seeded either: with no row the resolution falls
  // through to the `EMAIL_PROVIDER` environment value and then to `console`,
  // which is exactly how SMS already behaves for an unconfigured organization.
  for (const org of [demo, other]) {
    const templateIds = new Map<string, string>();

    for (const spec of NOTIFICATION_TEMPLATE_SPECS) {
      const template = await prisma.notificationTemplate.upsert({
        where: {
          orgId_code_channel: {
            orgId: org.orgId,
            code: spec.code,
            channel: spec.channel,
          },
        },
        // `update` carries the content so a re-seed repairs a template someone
        // broke, but deliberately does not touch `version`: bumping it here
        // would claim an edit that no administrator made, and Rule 39 uses that
        // number as evidence of which version produced a notification.
        update: {
          name: spec.name,
          category: spec.category,
          sourceModule: spec.sourceModule,
          subject: spec.subject ?? null,
          titleTemplate: spec.titleTemplate ?? null,
          body: spec.body,
          containsPii: spec.containsPii,
          status: 'ACTIVE',
          isSystem: true,
        },
        create: {
          orgId: org.orgId,
          code: spec.code,
          name: spec.name,
          category: spec.category,
          sourceModule: spec.sourceModule,
          eventType: spec.eventType as never,
          channel: spec.channel,
          subject: spec.subject ?? null,
          titleTemplate: spec.titleTemplate ?? null,
          body: spec.body,
          containsPii: spec.containsPii,
          status: 'ACTIVE',
          // Rule 33: editable, never deletable. An organization that deleted
          // its own approval template would stop notifying approvers, and the
          // failure would look like a delivery bug.
          isSystem: true,
        },
        select: { templateId: true, code: true, channel: true },
      });

      templateIds.set(`${spec.code}:${spec.channel}`, template.templateId);
    }

    for (const spec of NOTIFICATION_RULE_SPECS) {
      const templateId = templateIds.get(
        `${spec.templateCode}:${spec.channel}`,
      );
      if (!templateId) {
        throw new Error(
          `Rule "${spec.name}" names template ${spec.templateCode} on ${spec.channel}, which is not seeded.`,
        );
      }

      await prisma.notificationEventRule.upsert({
        where: { orgId_name: { orgId: org.orgId, name: spec.name } },
        // Not re-asserted on update: `isActive` and the retry policy are what an
        // administrator tunes on the Event Rules screen, and re-seeding them
        // would silently undo a deliberate change. Only the wiring is repaired.
        update: {
          templateId,
          recipientStrategy: spec.recipientStrategy,
          recipientRoleCode: spec.recipientRoleCode ?? null,
          recipientPermissionCode: spec.recipientPermissionCode ?? null,
        },
        create: {
          orgId: org.orgId,
          name: spec.name,
          // Null: these are organization-wide rules, which is the wider
          // authority. A branch that wants its own adds one.
          branchId: null,
          eventType: spec.eventType as never,
          sourceModule: spec.sourceModule,
          sourceTrigger: spec.sourceTrigger,
          recipientStrategy: spec.recipientStrategy,
          recipientRoleCode: spec.recipientRoleCode ?? null,
          recipientPermissionCode: spec.recipientPermissionCode ?? null,
          explicitRecipientUserIds: [],
          channel: spec.channel,
          templateId,
          priority: spec.priority,
          isMandatory: spec.isMandatory,
          isActive: true,
        },
      });
    }
  }

  console.log(
    `Seeded orgs DEMO/OTHERORG, branches BR001/BR002/BR003, ${users.length} users, ${customerSpecs.length} customers, ${productSpecs.length} loan products, ${schemeSpecs.length} loan schemes, ${masterDataSpecs.length} master data values per org, ${LEDGER_ACCOUNT_SPECS.length} ledger accounts per org, ${NOTIFICATION_TEMPLATE_SPECS.length} notification templates and ${NOTIFICATION_RULE_SPECS.length} event rules per org.`,
  );
  console.log(
    `Sign in with orgCode=DEMO, mobile=9000000001, password=${SEED_PASSWORD}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
