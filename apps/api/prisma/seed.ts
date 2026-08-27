import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';

import { PrismaClient } from '../src/generated/prisma/client';
import { LEDGER_ACCOUNT_SPECS } from '../src/loans/disbursal/ledger-accounts';
import {
  ALL_PERMISSION_CODES,
  PERMISSION_CATALOG,
} from '../src/users/rbac/permission-catalog';
import {
  NOTIFICATION_RULE_SPECS,
  NOTIFICATION_TEMPLATE_SPECS,
} from './seed-data/notifications';

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
  // SUPER_ADMIN is a system role: it cannot be renamed, deactivated, deleted, or
  // stripped of permissions, so an organization cannot administer away its own
  // last administrator (Module 03 Rules 25/26, Q-RBAC-17). The two Module 03
  // fixture roles below carry the non-ACTIVE statuses the role-lifecycle
  // scenarios need — the seed is the only place a DRAFT or INACTIVE role exists.
  const roleSpecs = [
    { code: 'SUPER_ADMIN', status: 'ACTIVE' as const, isSystem: true },
    { code: 'BRANCH_ADMIN', status: 'ACTIVE' as const, isSystem: false },
    { code: 'FIELD_EMPLOYEE', status: 'ACTIVE' as const, isSystem: false },
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
        name: spec.code.replace(/_/g, ' ').toLowerCase(),
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

  // `loans.approve` is granted to Super Admin only, so Scenario 17 has a
  // permission a Branch Admin demonstrably lacks despite valid credentials.
  const grants: Record<string, string[]> = {
    // Everything except `field.checkin`: only a Field Employee checks in, so GPS
    // Scenarios 3 and 30 need an authenticated admin who is refused. Derived from
    // the catalog rather than listed, so a new permission is granted to Super
    // Admin the moment it is added — the alternative is a role that silently
    // falls behind the catalog and a Super Admin who cannot reach a new module.
    //
    // `recovery.writeoff.post` is the second exclusion, for a different reason
    // than `field.checkin`. Writing a loan off is the most irreversible act in
    // the system: it posts a loss to the ledger and abandons a receivable. The
    // source (Rule 28, Scenario 43) treats it as a distinct authority, and
    // Scenario 43 needs an account that reaches the recovery screen and is
    // refused the posting — which is impossible if the seed's most privileged
    // role holds it. An organization that wants it grants it to an explicitly
    // configured role.
    // `retention.purge.run` is the third exclusion, on the same reasoning as
    // `recovery.writeoff.post`. A purge destroys records irreversibly, and
    // Scenario 58 needs an account that reaches retention administration and is
    // still refused the purge — impossible if the seed's most privileged role
    // holds it. Rule 76 protects immutable evidence regardless of the grant;
    // this keeps the *purgeable* categories behind a deliberate grant too.
    SUPER_ADMIN: ALL_PERMISSION_CODES.filter(
      (code) =>
        code !== 'field.checkin' &&
        code !== 'recovery.writeoff.post' &&
        code !== 'retention.purge.run',
    ),
    // A Branch Admin may end sessions too, but SessionManagementService confines
    // them to their own branch — the permission grants the action, not the reach.
    // The same holds for `field.checkin.view`: granted here, branch-confined in
    // GpsCheckInService.
    //
    // Module 02 (Q-ORG-13) follows the same shape: `branches.view` is granted,
    // but BranchService confines a caller carrying a branchId to that one
    // branch. No create/update/delete/activate — branch administration stays
    // with the Super Admin, so Scenarios 34 and 35 have a role that reaches
    // Branch Management and is still refused every mutation.
    //
    // Module 03 (Q-RBAC-21) applies the same shape a third time. A Branch Admin
    // reaches Employee Management and the role list, and is refused every
    // mutation that is not employee activation: no `employees.create`, no
    // `employees.assign`, no `users.assign_role`, no `roles.*` write. That gives
    // Scenarios 19, 25, 37 and 40 an account that gets to the screen and is
    // denied the action, which is the only way to prove the check is real.
    // `users.view` is granted so Scenario 23 can prove branch confinement on a
    // surface the caller is otherwise entitled to.
    BRANCH_ADMIN: [
      'dashboard.view',
      'loans.view',
      'collections.record',
      'sessions.revoke',
      'field.checkin.view',
      'organizations.view',
      'branches.view',
      'users.view',
      'employees.view',
      'employees.activate',
      'roles.view',
      'permissions.view',
      // Module 04 (Q-CUST-6, Q-CUST-13) applies the same shape a fourth time.
      // Branch Admin is the source-named KYC approval authority, so it holds the
      // whole KYC, document and guarantor surface — and is still refused
      // `customers.delete` and `customers.convert`. That is what gives
      // Scenarios 23 and 29 an account that reaches Customer Management and is
      // denied the action, which is the only way to prove those checks are real.
      'customers.view',
      'customers.create',
      'customers.update',
      'customers.activate',
      'customers.kyc.view',
      'customers.kyc.submit',
      'customers.kyc.approve',
      'customers.documents.upload',
      'customers.documents.verify',
      'customers.documents.download',
      'customers.guarantors.view',
      'customers.guarantors.manage',
      // Module 05 repeats the shape a fifth time. Branch Admin runs the whole
      // guarantor surface — including KYC review, since the source names no
      // other authority (Q-GUAR-13) — and is deliberately refused
      // `customers.guarantors.delete`.
      //
      // That omission is load-bearing, not an oversight: Module 05 Scenario 40
      // needs an account that reaches the guarantor screen and is denied
      // deletion, exactly as `customers.delete` does for Scenario 23. Granting
      // it here would silently make that test unprovable. Deactivation is the
      // sanctioned removal path (Rule 34), and Branch Admin holds it.
      'customers.guarantors.deactivate',
      'customers.guarantors.documents.upload',
      'customers.guarantors.documents.verify',
      'customers.guarantors.documents.download',
      'customers.guarantors.kyc.review',
      // Module 06 applies the shape a sixth time, and more strictly. A Branch
      // Admin must see products and schemes — they cannot fill in a loan
      // application's scheme step otherwise — but holds no write on either.
      //
      // That is not the usual "withhold one grant so a test can prove a denial";
      // the source is explicit that Branch Admin is not a configuration owner.
      // Product configuration decides what every borrower in the organization
      // can be charged, so it stays with the Super Admin. The read/write split
      // in the catalog exists precisely so this line can grant one without the
      // other.
      'loans.products.view',
      'loans.schemes.view',
      // Module 07 applies the shape a seventh time. A Branch Admin runs the
      // whole application surface — creating, submitting, reviewing, requesting
      // more information, repricing within the scheme and rejecting — and is
      // deliberately refused three grants.
      //
      // `loans.approve` is withheld by the pre-existing Module 01 fixture, which
      // Scenario 28 already depends on. The two added here are:
      //
      //   - `applications.delete_draft`, so Scenario 36 has an account that
      //     reaches the draft and is denied deletion, exactly as
      //     `customers.guarantors.delete` does for Module 05.
      //   - `applications.override_rate`, because pricing off the scheme is a
      //     configuration decision and Module 06 already keeps those with the
      //     Super Admin. Granting it here would let a branch quietly reprice a
      //     loan the organization never approved.
      //
      // Both omissions are load-bearing: granting either would silently make an
      // e2e denial unprovable.
      'loans.applications.view',
      'loans.applications.create',
      'loans.applications.submit',
      'loans.applications.review',
      'loans.applications.modify_terms',
      'loans.applications.reject',
      'loans.applications.documents.view',
      'loans.applications.documents.upload',
      'loans.applications.documents.verify',
      'loans.applications.documents.download',
      // Module 08 adds a fourth withheld grant, `applications.sanction.issue`,
      // on the same reasoning as `override_rate` above rather than as a new
      // approval tier: issuing the letter is the commitment-of-terms act that
      // directly follows `loans.approve`, which this role does not hold.
      // Granting it would let a branch commit the organization to terms one
      // step removed from the decision it was denied. There is still exactly
      // one approval authority — Rule 21 forbids inventing a hierarchy, and
      // none is invented here.
      //
      // The other three Module 08 grants are transcription, not commitment:
      // recording what a customer answered and that a signed agreement arrived
      // are the branch's clerical work, and assessment follows
      // `documents.verify`'s precedent that a branch reviewer does the legwork.
      'loans.applications.assessment.view',
      'loans.applications.assessment.record',
      'loans.applications.sanction.record_response',
      'loans.applications.agreement.record',
      // Module 09 adds a fifth withheld grant, `disbursements.confirm`, and it
      // is the most load-bearing of the five. Scheduling a date, picking a
      // funding account and transcribing that a bank transfer happened are all
      // branch work — reversible, and none of them moves money. Confirming is
      // the irreversible act: it posts the ledger entry, activates the loan and
      // generates the repayment schedule.
      //
      // Rule 28 is explicit that approval permission must not imply
      // disbursement permission, and Scenario 30 needs an account holding one
      // and denied the other to prove it. This role already lacks
      // `loans.approve`; withholding `disbursements.confirm` on the same
      // reasoning keeps money movement with the approval authority and gives
      // Scenarios 29 and 30 the denial they assert. Granting it would silently
      // make both unprovable.
      'loans.disbursements.view',
      'loans.disbursements.schedule',
      'loans.disbursements.record_transfer',
      'loans.disbursements.cancel',
      // Module 10 adds a sixth withheld grant, `schedules.regenerate`, on the
      // same reasoning one module later. Reading a schedule and downloading it
      // are branch work — the borrower asks what they owe and a branch answers.
      // Regenerating rewrites every remaining due date and amount the borrower
      // is contractually bound to, which is the approval authority's act rather
      // than the branch's, and Scenarios 18 and 32 need an account holding
      // `schedules.view` and denied exactly this to prove it.
      //
      // `schedules.retry` is withheld alongside it. A retry is recovery from a
      // failed generation, and deciding that a loan's schedule is genuinely
      // missing rather than merely unread is the same judgement.
      'loans.schedules.view',
      'loans.schedules.export',
      // Module 11 adds a seventh withheld grant, `collections.reverse`, on the
      // same reasoning a module later. Taking a repayment and posting it is
      // exactly the branch's job — it is the daily work of the surface, and a
      // Branch Admin who cannot collect cannot run a branch. Reversing one is
      // the opposite: it unwinds a committed financial posting, re-opens an
      // obligation the borrower had settled, and puts money back on their
      // account. That is the approval authority's act, on the same footing as
      // `disbursements.confirm` and `schedules.regenerate`.
      //
      // Scenario 36 needs an account that holds `collections.post` and is
      // denied exactly this. Granting it would silently make that unprovable.
      //
      // `collections.sync` is withheld alongside it, for a different reason
      // rather than a punitive one: syncing is a field-device act, and the
      // account that submits an offline capture is the agent who took the
      // money. A Branch Admin has no device queue to flush.
      'collections.view',
      'collections.post',
      // Master data follows the Module 06 shape rather than the usual
      // withhold-one-grant-for-a-test shape: a Branch Admin needs to read the
      // option lists — every customer and guarantor form renders them — but an
      // option list is organization-wide configuration, so changing it stays
      // with the Super Admin. One branch editing the shared list of document
      // types would change what every other branch can select.
      'master_data.view',
      // Module 14 withholds four at once, which is a first — but they divide on
      // exactly the two lines every module above has drawn.
      //
      // Reading is branch work. A Branch Admin reads the ledger daily, because
      // answering "what did this branch post yesterday" is how a cash drawer
      // gets reconciled, and an admin who cannot see their own branch's ledger
      // cannot run it. Authoring a draft journal is the same clerical act one
      // step further: a draft moves nothing, posts nothing, and can be thrown
      // away. So `accounts.view`, `journals.view`, `journals.create` and
      // `ledger.view` are granted.
      //
      // Posting is not. `journals.post` writes to the authoritative ledger by
      // hand, outside every source module's controls — the same authority
      // `disbursements.confirm` was withheld to protect, reached by a different
      // door. `journals.reverse` unwinds a committed posting, on the same
      // footing as `collections.reverse`. Both stay with the approval authority.
      //
      // `accounts.manage` is withheld on the master-data reasoning rather than
      // the money reasoning: the chart of accounts is organization-wide
      // configuration, and one branch editing it would change what every other
      // branch is able to post to.
      //
      // `ledger.reconcile` is withheld because a reconciliation that spans one
      // branch is not a reconciliation. It compares every source transaction in
      // the organization against every journal; scoping it to a branch would
      // report every other branch's postings as missing.
      //
      // Scenarios 44, 48, 49 and 50 each need an account that reaches the
      // screen and is refused the action. Granting any of these four would
      // silently make one of them unprovable.
      'accounting.accounts.view',
      'accounting.journals.view',
      'accounting.journals.create',
      'accounting.ledger.view',
      // Module 12 divides on the same two lines, and withholds three.
      //
      // Receiving an agent's cash and counting it is branch work — it is the
      // branch's own drawer being reconciled — so `handovers.view`,
      // `handovers.receive`, `reconciliation.view`, `reconciliation.perform`
      // and `field.collections.view` are granted. So is
      // `field.collections.verify`: judging whether an offline capture is
      // genuine is a supervisory act over the branch's own agents, and it moves
      // no money.
      //
      // Three are withheld:
      //
      //  * `field.collections.record` — for the reason `collections.sync`
      //    already is. Recording a *field* collection is the act of the person
      //    who physically took the cash, and it opens a custody balance in that
      //    person's name. A Branch Admin taking an over-the-counter payment
      //    uses `collections.post`, which credits branch cash directly.
      //  * `cash.handovers.reverse` — it unwinds a committed custody journal
      //    and moves cash back out of the branch's books, on the same footing
      //    as `collections.reverse` and `journals.reverse`.
      //  * `cash.reconciliation.resolve` — deciding who bears a shortage is the
      //    approval authority's act. A branch that could both count the cash
      //    and forgive the difference is an unreviewed control, which is the
      //    single most valuable thing this module adds.
      //
      // Scenarios 30, 42 and 43 each need an account that reaches the screen
      // and is refused the action. Granting any of the three would make one of
      // them unprovable.
      'field.collections.view',
      'field.collections.verify',
      'cash.handovers.view',
      'cash.handovers.receive',
      'cash.reconciliation.view',
      'cash.reconciliation.perform',
      // Module 13 applies the shape again. A Branch Admin runs the recovery
      // desk for their branch — reading the overdue book, opening cases,
      // assigning officers, recording activity, escalating, closing and issuing
      // notices — and is refused the three authorities that give money back:
      //
      //  * `penalties.waive` — assessing a charge and forgiving it are the two
      //    halves of one control, and Scenario 20 needs an account that reaches
      //    the penalty screen and is refused the waiver.
      //  * `recovery.settlements.approve` — a desk that could both agree terms
      //    with a borrower and approve forgiving the remainder is unreviewed.
      //    Branch Admin proposes; approval is the approval authority's act.
      //  * `recovery.writeoff.post` — see the Super Admin exclusion below.
      //
      // Granting any of the three would make Scenarios 20, 43 or 44 unprovable.
      'overdue.view',
      'penalties.assess',
      'recovery.cases.view',
      'recovery.cases.create',
      'recovery.cases.assign',
      'recovery.actions.record',
      'recovery.cases.escalate',
      'recovery.cases.close',
      'recovery.notices.issue',
      'recovery.settlements.propose',
      // Module 15 divides on the two lines every module above has drawn, and
      // withholds two.
      //
      // Reading operational reports is branch work: a Branch Admin who cannot
      // see their own branch's portfolio, collections, field cash or overdue
      // book cannot run the branch. Those seven categories are granted, and so
      // is `reports.export` — a supervisor who can read a report on screen and
      // is refused the same figures as a file has been given a distinction
      // without a difference.
      //
      // Two are withheld:
      //
      //  * `reports.financial.view` — the financial reports are the
      //    organization's ledger, not one branch's operations, on the same
      //    reasoning that withheld `accounting.ledger.reconcile`. Scenarios 28
      //    and 49 each need an account that reaches the reports area and is
      //    refused this one specifically.
      //  * `reports.export.pii` — an export carrying customer names and mobile
      //    numbers leaves the system and is forwarded. Withholding it does not
      //    refuse the export; it masks those columns, which is exactly what
      //    Scenario 35 describes.
      //
      // Saved reports are granted in full: a definition is a stored filter set,
      // and running one re-validates scope against the runner's live
      // authorization rather than trusting what was saved.
      'reports.dashboard.view',
      'reports.portfolio.view',
      'reports.applications.view',
      'reports.disbursals.view',
      'reports.collections.view',
      'reports.field.view',
      'reports.overdue.view',
      'reports.export',
      'reports.saved.view',
      'reports.saved.manage',
      // Module 16 repeats the shape one last time, and more strictly than
      // anywhere else: a Branch Admin reaches all three notification
      // administration screens and is refused every mutation on all three.
      //
      // That is not caution for its own sake. Four of Module 16's permission
      // scenarios need exactly this account — one that gets to the screen and is
      // denied the act — and granting any one of the withheld codes would make
      // the corresponding test unprovable:
      //
      //  * `notifications.templates.manage` / `.delete` — Scenarios 11 and 43.
      //  * `notifications.rules.manage` / `.delete` — Scenarios 41 and 44.
      //    Scenario 41 in particular needs a branch-confined caller refused a
      //    rule in *another* branch; withholding manage entirely is stricter
      //    than that scenario requires, and deliberately so, because notification
      //    routing is organization policy rather than branch operations.
      //  * `notifications.deliveries.retry` — Scenario 45, verbatim: an account
      //    that can see a failed delivery and cannot retry it.
      //
      // `notifications.view` is granted so Delivery Monitoring shows message
      // bodies rather than metadata alone — a Branch Admin investigating why a
      // branch notification failed needs to see what was sent.
      'notifications.view',
      'notifications.preferences.manage',
      'notifications.templates.view',
      'notifications.rules.view',
      'notifications.deliveries.view',
      // Module 17 repeats the shape a final time, with one deliberate exception.
      //
      // The exception is `settings.branch.manage`. Every other "manage" code
      // this role holds elsewhere is withheld here, but a Branch Admin owning
      // their own branch's settings is the module's stated intent (Rule 2), and
      // the code is bounded by scope rather than authority: the service narrows
      // every write through the shared branch-scope helper, so holding it grants
      // their branch and never another's. That is what Scenario 44 proves — an
      // account that can edit Branch A and is refused Branch B — and it needs a
      // role that HOLDS the code, which a pure view-only grant could not give.
      //
      // Everything else is withheld, and each withholding makes a specific
      // scenario provable rather than being caution for its own sake:
      //
      //  * `settings.manage` — org-scoped settings are not branch operations.
      //  * `settings.protected.manage` — Scenario 64: reaches the setting list,
      //    refused the protected one, and sees its value masked.
      //  * `settings.changes.approve` — approval authority is separate from the
      //    maker-checker rule; withholding it keeps Branch Admin a proposer.
      //  * `settings.calendar.manage` — Scenario 19; the calendar governs EOD
      //    for the whole organization.
      //  * `audit.export` — Scenario 42, verbatim: an account that can read the
      //    trail and cannot export it.
      //  * `audit.sensitive.view` — Scenario 39: before/after values arrive
      //    masked for this role.
      //  * every `maintenance.*` write — Scenario 45's authority half. The
      //    scope half needs MAINT_OPERATOR below, which holds the retry code and
      //    is still refused another branch's job.
      //
      // `audit.view` is granted so Scenario 36 has a branch-confined reader on a
      // surface it is otherwise entitled to — and note that confinement has a
      // NULL fallback, because `audit_logs.branch_id` is retrofitted and every
      // pre-Module-17 row carries NULL.
      'settings.view',
      'settings.branch.manage',
      'settings.changes.view',
      'settings.changes.submit',
      'settings.calendar.view',
      'audit.view',
      'maintenance.jobs.view',
    ],
    // Deliberately without `sessions.revoke`, so Scenario 23 has a role that is
    // authenticated and demonstrably unauthorized for remote revocation.
    //
    // `field.checkin` is the mirror image: only a Field Employee may check in,
    // so GPS Scenarios 3 and 30 have an authenticated admin who is denied.
    // Note the admins hold `field.checkin.view` but NOT `field.checkin` — being
    // able to review someone's check-in history is not permission to create one.
    // `customers.view` and nothing else from Module 04 (Q-CUST-23): a field
    // agent must be able to identify the customer they are collecting from, but
    // creating or editing one is a branch-office action. Scenario 23 uses this
    // role for the unauthorized-edit refusal.
    FIELD_EMPLOYEE: [
      'dashboard.view',
      'collections.record',
      'field.checkin',
      'customers.view',
      // Needed to render a customer's stored gender or a guarantor's
      // relationship as a label rather than a raw code on a field screen.
      'master_data.view',
      // Module 11. Collecting in the field is this role's entire purpose, so it
      // holds the money-moving act and the offline path that a Branch Admin
      // does not. It is refused `collections.reverse` on the same reasoning as
      // Branch Admin, more strongly: an agent who could reverse their own
      // receipt could take cash and erase the record of it.
      //
      // `loans.schedules.view` comes with it out of necessity rather than
      // generosity — an agent must be able to see what is owed before they can
      // collect it, and the schedule is where that lives.
      'collections.view',
      'collections.post',
      'collections.sync',
      'loans.schedules.view',
      // Module 12. Taking cash in the field and handing it to the branch is
      // this role's other half. It holds the agent's side of the transfer and
      // is refused the branch's side entirely:
      //
      //  * `cash.handovers.receive` — submitting and receiving are the two
      //    sides of one transfer. One person holding both could sign for cash
      //    they never handed over, and Scenario 43 needs an agent account that
      //    reaches the action and is refused it.
      //  * `field.collections.verify` — an agent who could confirm their own
      //    offline capture could launder a fabricated one.
      //  * `cash.reconciliation.*` — counting the branch drawer is branch work.
      //
      // It holds `cash.handovers.view` so an agent can see what they owe the
      // branch and what has already been received.
      'field.collections.view',
      'field.collections.record',
      'cash.handovers.view',
      'cash.handovers.submit',
      // Module 13. This role is the Recovery Officer of the source's story:
      // working assigned cases in the field is the third half of its job.
      //
      // It holds the two acts an officer performs — reading their cases and
      // recording what happened — plus the offline path, on the same reasoning
      // as `collections.sync`: recovery visits happen where there is no signal.
      //
      // It is refused everything that decides rather than records:
      //
      //  * `recovery.cases.assign` — an officer who could reassign could hand
      //    away a case they were accountable for, or take one they were never
      //    given. Scenario 42 needs an agent account that reaches the case and
      //    is refused the assignment.
      //  * `recovery.cases.close` and `.escalate` — deciding a debt is resolved
      //    is not the act of the person whose performance it measures.
      //  * `penalties.*`, `recovery.settlements.*`, `recovery.writeoff.post` —
      //    an officer who could waive a penalty or forgive a balance in front
      //    of the customer is the control this module exists to prevent.
      //
      // `overdue.view` comes with it out of necessity rather than generosity:
      // an officer must see what is owed before they can recover it. Scope
      // confinement to their own assigned cases is enforced server-side, not by
      // withholding the read — the permission grants the action, not the reach.
      'overdue.view',
      'recovery.cases.view',
      'recovery.actions.record',
      'recovery.sync',
      // Module 16. A field agent receives notifications — assignment alerts and
      // due reminders are most of what routes to this role — and may tune the
      // optional ones. Nothing else: notification configuration is office work,
      // and Delivery Monitoring exposes other users' traffic.
      //
      // Reading their own notification centre needs no grant at all; Rule 53
      // gives it to every authenticated user, which is why there is no
      // `notifications.*` view code here despite this role being the module's
      // busiest recipient.
      'notifications.preferences.manage',
    ],
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
  /**
   * The starting values for the four lists a business admin maintains.
   *
   * Every row here is `isSystem: true`. These are the values the application
   * shipped with and that business logic reads by code — the KYC completeness
   * check iterates document categories, so deleting `ID` would not fail loudly,
   * it would quietly stop requiring an identity document. The service refuses to
   * delete them; an admin may still relabel them, reorder them, or set them
   * INACTIVE to retire one. Values an admin adds later carry `isSystem: false`
   * and are freely deletable.
   *
   * `displayOrder` is set in tens so a later insertion has room between two
   * existing values without renumbering the list.
   *
   * Seeded for both organizations: master data is per-org, and OTHERORG needs
   * its own copy for the tenant-isolation proofs to mean anything.
   */
  const masterDataSpecs = [
    // DOCUMENT_TYPE covers the union of the borrower KYC categories and the
    // loan-application support categories. They are separate zod enums in the
    // code for good reason — different tables, different permissions — but as
    // an admin-facing list of "kinds of document", one list is what a user
    // expects to see.
    //
    // **This list is labels, not authority.** Which document types are *valid*
    // stays with the `@IsIn` guards in the DTOs, and which are *required* stays
    // with `REQUIRED_KYC_DOCUMENTS` in `kyc.service.ts`, which gates approval.
    // Uploads still read their options from the compiled-in registries; this
    // category exists so an organization can relabel "Identity Proof" to match
    // its own vocabulary without a deploy. Letting an admin add a value here
    // would produce an option every DTO rejects, and letting them remove one
    // would not relax the approval gate — so the rows are all `isSystem` and
    // the service refuses to delete them.
    { category: 'DOCUMENT_TYPE', code: 'ID', label: 'Identity Proof' },
    { category: 'DOCUMENT_TYPE', code: 'ADDRESS', label: 'Address Proof' },
    { category: 'DOCUMENT_TYPE', code: 'PHOTO', label: 'Photograph' },
    { category: 'DOCUMENT_TYPE', code: 'INCOME', label: 'Income Proof' },
    { category: 'DOCUMENT_TYPE', code: 'COLLATERAL', label: 'Collateral' },

    // Replaces the free-text `gender` VarChar(30) on Customer. OTHER and
    // UNDISCLOSED are distinct on purpose: "a third option" and "declined to
    // say" are different answers, and collapsing them loses the distinction.
    { category: 'GENDER', code: 'MALE', label: 'Male' },
    { category: 'GENDER', code: 'FEMALE', label: 'Female' },
    { category: 'GENDER', code: 'OTHER', label: 'Other' },
    { category: 'GENDER', code: 'UNDISCLOSED', label: 'Prefer not to say' },

    // Replaces the free-text `relationship` VarChar(100) on Guarantor.
    { category: 'RELATIONSHIP', code: 'SPOUSE', label: 'Spouse' },
    { category: 'RELATIONSHIP', code: 'PARENT', label: 'Parent' },
    { category: 'RELATIONSHIP', code: 'SIBLING', label: 'Sibling' },
    { category: 'RELATIONSHIP', code: 'CHILD', label: 'Child' },
    { category: 'RELATIONSHIP', code: 'RELATIVE', label: 'Other relative' },
    { category: 'RELATIONSHIP', code: 'FRIEND', label: 'Friend' },
    { category: 'RELATIONSHIP', code: 'COLLEAGUE', label: 'Colleague' },
    {
      category: 'RELATIONSHIP',
      code: 'BUSINESS_PARTNER',
      label: 'Business partner',
    },

    // Replaces the free-text `purpose` on LoanApplication.
    {
      category: 'LOAN_PURPOSE',
      code: 'HOME_IMPROVEMENT',
      label: 'Home improvement',
    },
    { category: 'LOAN_PURPOSE', code: 'EDUCATION', label: 'Education' },
    { category: 'LOAN_PURPOSE', code: 'MEDICAL', label: 'Medical expenses' },
    {
      category: 'LOAN_PURPOSE',
      code: 'BUSINESS_EXPANSION',
      label: 'Business expansion',
    },
    {
      category: 'LOAN_PURPOSE',
      code: 'WORKING_CAPITAL',
      label: 'Working capital',
    },
    {
      category: 'LOAN_PURPOSE',
      code: 'VEHICLE_PURCHASE',
      label: 'Vehicle purchase',
    },
    {
      category: 'LOAN_PURPOSE',
      code: 'DEBT_CONSOLIDATION',
      label: 'Debt consolidation',
    },
    { category: 'LOAN_PURPOSE', code: 'AGRICULTURE', label: 'Agriculture' },
    { category: 'LOAN_PURPOSE', code: 'OTHER', label: 'Other' },
  ];

  for (const org of [demo, other]) {
    // Ordered within each category, in tens, following the spec array's order.
    const orderByCategory: Record<string, number> = {};

    for (const spec of masterDataSpecs) {
      const next = (orderByCategory[spec.category] ?? 0) + 10;
      orderByCategory[spec.category] = next;

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
        },
        create: {
          orgId: org.orgId,
          category: spec.category,
          code: spec.code,
          label: spec.label,
          displayOrder: next,
          status: 'ACTIVE',
          isSystem: true,
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
