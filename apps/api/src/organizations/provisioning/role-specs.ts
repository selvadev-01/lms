import { ALL_PERMISSION_CODES } from '../../users/rbac/permission-catalog';

/**
 * The roles and grants every organization starts with.
 *
 * Extracted from `prisma/seed.ts` so the seed and the signup provisioning path
 * cannot drift apart. The seed still owns its own e2e fixture roles
 * (`RBAC_DRAFT_ROLE`, `RBAC_INACTIVE_ROLE`, `RBAC_ASSIGNED_ROLE`,
 * `MAINT_OPERATOR`) — those exist to make specific denials provable and must
 * never appear in a real organization.
 */
export interface RoleSpec {
  code: string;
  status: 'ACTIVE' | 'DRAFT' | 'INACTIVE';
  isSystem: boolean;
}

/**
 * SUPER_ADMIN is a system role: it cannot be renamed, deactivated, deleted, or
 * stripped of permissions, so an organization cannot administer away its own
 * last administrator (Module 03 Rules 25/26, Q-RBAC-17).
 */
export const CORE_ROLE_SPECS: readonly RoleSpec[] = [
  { code: 'SUPER_ADMIN', status: 'ACTIVE', isSystem: true },
  { code: 'BRANCH_ADMIN', status: 'ACTIVE', isSystem: false },
  { code: 'FIELD_EMPLOYEE', status: 'ACTIVE', isSystem: false },
];

/** A role's display name is derived, never stored separately. */
export function roleDisplayName(code: string): string {
  return code.replace(/_/g, ' ').toLowerCase();
}

/**
 * The three permissions a Super Admin deliberately does NOT hold.
 *
 * `field.checkin`: only a Field Employee checks in, so GPS Scenarios 3 and 30
 * need an authenticated admin who is refused.
 *
 * `recovery.writeoff.post` is the second exclusion, for a different reason than
 * `field.checkin`. Writing a loan off is the most irreversible act in the
 * system: it posts a loss to the ledger and abandons a receivable. The source
 * (Rule 28, Scenario 43) treats it as a distinct authority, and Scenario 43
 * needs an account that reaches the recovery screen and is refused the posting
 * — which is impossible if the most privileged role holds it. An organization
 * that wants it grants it to an explicitly configured role.
 *
 * `retention.purge.run` is the third exclusion, on the same reasoning as
 * `recovery.writeoff.post`. A purge destroys records irreversibly, and Scenario
 * 58 needs an account that reaches retention administration and is still
 * refused the purge — impossible if the most privileged role holds it. Rule 76
 * protects immutable evidence regardless of the grant; this keeps the
 * *purgeable* categories behind a deliberate grant too.
 */
export const SUPER_ADMIN_EXCLUSIONS: readonly string[] = [
  'field.checkin',
  'recovery.writeoff.post',
  'retention.purge.run',
];

/**
 * Everything except the three exclusions above. Derived from the catalog rather
 * than listed, so a new permission is granted to Super Admin the moment it is
 * added — the alternative is a role that silently falls behind the catalog and
 * a Super Admin who cannot reach a new module.
 */
export const SUPER_ADMIN_PERMISSION_CODES: readonly string[] =
  ALL_PERMISSION_CODES.filter((code) => !SUPER_ADMIN_EXCLUSIONS.includes(code));

/**
 * `loans.approve` is granted to Super Admin only, so Scenario 17 has a
 * permission a Branch Admin demonstrably lacks despite valid credentials.
 *
 * A Branch Admin may end sessions too, but SessionManagementService confines
 * them to their own branch — the permission grants the action, not the reach.
 * The same holds for `field.checkin.view`: granted here, branch-confined in
 * GpsCheckInService.
 *
 * Module 02 (Q-ORG-13) follows the same shape: `branches.view` is granted, but
 * BranchService confines a caller carrying a branchId to that one branch. No
 * create/update/delete/activate — branch administration stays with the Super
 * Admin, so Scenarios 34 and 35 have a role that reaches Branch Management and
 * is still refused every mutation.
 *
 * Module 03 (Q-RBAC-21) applies the same shape a third time. A Branch Admin
 * reaches Employee Management and the role list, and is refused every mutation
 * that is not employee activation: no `employees.create`, no
 * `employees.assign`, no `users.assign_role`, no `roles.*` write. That gives
 * Scenarios 19, 25, 37 and 40 an account that gets to the screen and is denied
 * the action, which is the only way to prove the check is real. `users.view` is
 * granted so Scenario 23 can prove branch confinement on a surface the caller
 * is otherwise entitled to.
 */
export const BRANCH_ADMIN_PERMISSION_CODES: readonly string[] = [
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
  // `customers.delete` and `customers.convert`. That is what gives Scenarios 23
  // and 29 an account that reaches Customer Management and is denied the
  // action, which is the only way to prove those checks are real.
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
  // guarantor surface — including KYC review, since the source names no other
  // authority (Q-GUAR-13) — and is deliberately refused
  // `customers.guarantors.delete`.
  //
  // That omission is load-bearing, not an oversight: Module 05 Scenario 40
  // needs an account that reaches the guarantor screen and is denied deletion,
  // exactly as `customers.delete` does for Scenario 23. Granting it here would
  // silently make that test unprovable. Deactivation is the sanctioned removal
  // path (Rule 34), and Branch Admin holds it.
  'customers.guarantors.deactivate',
  'customers.guarantors.documents.upload',
  'customers.guarantors.documents.verify',
  'customers.guarantors.documents.download',
  'customers.guarantors.kyc.review',
  // Module 06 applies the shape a sixth time, and more strictly. A Branch Admin
  // must see products and schemes — they cannot fill in a loan application's
  // scheme step otherwise — but holds no write on either.
  //
  // That is not the usual "withhold one grant so a test can prove a denial";
  // the source is explicit that Branch Admin is not a configuration owner.
  // Product configuration decides what every borrower in the organization can
  // be charged, so it stays with the Super Admin. The read/write split in the
  // catalog exists precisely so this line can grant one without the other.
  'loans.products.view',
  'loans.schemes.view',
  // Module 07 applies the shape a seventh time. A Branch Admin runs the whole
  // application surface — creating, submitting, reviewing, requesting more
  // information, repricing within the scheme and rejecting — and is
  // deliberately refused three grants.
  //
  // `loans.approve` is withheld by the pre-existing Module 01 fixture, which
  // Scenario 28 already depends on. The two added here are:
  //
  //   - `applications.delete_draft`, so Scenario 36 has an account that reaches
  //     the draft and is denied deletion, exactly as
  //     `customers.guarantors.delete` does for Module 05.
  //   - `applications.override_rate`, because pricing off the scheme is a
  //     configuration decision and Module 06 already keeps those with the Super
  //     Admin. Granting it here would let a branch quietly reprice a loan the
  //     organization never approved.
  //
  // Both omissions are load-bearing: granting either would silently make an e2e
  // denial unprovable.
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
  // Module 08 adds a fourth withheld grant, `applications.sanction.issue`, on
  // the same reasoning as `override_rate` above rather than as a new approval
  // tier: issuing the letter is the commitment-of-terms act that directly
  // follows `loans.approve`, which this role does not hold. Granting it would
  // let a branch commit the organization to terms one step removed from the
  // decision it was denied. There is still exactly one approval authority —
  // Rule 21 forbids inventing a hierarchy, and none is invented here.
  //
  // The other three Module 08 grants are transcription, not commitment:
  // recording what a customer answered and that a signed agreement arrived are
  // the branch's clerical work, and assessment follows `documents.verify`'s
  // precedent that a branch reviewer does the legwork.
  'loans.applications.assessment.view',
  'loans.applications.assessment.record',
  'loans.applications.sanction.record_response',
  'loans.applications.agreement.record',
  // Module 09 adds a fifth withheld grant, `disbursements.confirm`, and it is
  // the most load-bearing of the five. Scheduling a date, picking a funding
  // account and transcribing that a bank transfer happened are all branch work
  // — reversible, and none of them moves money. Confirming is the irreversible
  // act: it posts the ledger entry, activates the loan and generates the
  // repayment schedule.
  //
  // Rule 28 is explicit that approval permission must not imply disbursement
  // permission, and Scenario 30 needs an account holding one and denied the
  // other to prove it. This role already lacks `loans.approve`; withholding
  // `disbursements.confirm` on the same reasoning keeps money movement with the
  // approval authority and gives Scenarios 29 and 30 the denial they assert.
  // Granting it would silently make both unprovable.
  'loans.disbursements.view',
  'loans.disbursements.schedule',
  'loans.disbursements.record_transfer',
  'loans.disbursements.cancel',
  // Module 10 adds a sixth withheld grant, `schedules.regenerate`, on the same
  // reasoning one module later. Reading a schedule and downloading it are
  // branch work — the borrower asks what they owe and a branch answers.
  // Regenerating rewrites every remaining due date and amount the borrower is
  // contractually bound to, which is the approval authority's act rather than
  // the branch's, and Scenarios 18 and 32 need an account holding
  // `schedules.view` and denied exactly this to prove it.
  //
  // `schedules.retry` is withheld alongside it. A retry is recovery from a
  // failed generation, and deciding that a loan's schedule is genuinely missing
  // rather than merely unread is the same judgement.
  'loans.schedules.view',
  'loans.schedules.export',
  // Module 11 adds a seventh withheld grant, `collections.reverse`, on the same
  // reasoning a module later. Taking a repayment and posting it is exactly the
  // branch's job — it is the daily work of the surface, and a Branch Admin who
  // cannot collect cannot run a branch. Reversing one is the opposite: it
  // unwinds a committed financial posting, re-opens an obligation the borrower
  // had settled, and puts money back on their account. That is the approval
  // authority's act, on the same footing as `disbursements.confirm` and
  // `schedules.regenerate`.
  //
  // Scenario 36 needs an account that holds `collections.post` and is denied
  // exactly this. Granting it would silently make that unprovable.
  //
  // `collections.sync` is withheld alongside it, for a different reason rather
  // than a punitive one: syncing is a field-device act, and the account that
  // submits an offline capture is the agent who took the money. A Branch Admin
  // has no device queue to flush.
  'collections.view',
  'collections.post',
  // Master data follows the Module 06 shape rather than the usual
  // withhold-one-grant-for-a-test shape: a Branch Admin needs to read the
  // option lists — every customer and guarantor form renders them — but an
  // option list is organization-wide configuration, so changing it stays with
  // the Super Admin. One branch editing the shared list of document types would
  // change what every other branch can select.
  'master_data.view',
  // Module 14 withholds four at once, which is a first — but they divide on
  // exactly the two lines every module above has drawn.
  //
  // Reading is branch work. A Branch Admin reads the ledger daily, because
  // answering "what did this branch post yesterday" is how a cash drawer gets
  // reconciled, and an admin who cannot see their own branch's ledger cannot
  // run it. Authoring a draft journal is the same clerical act one step
  // further: a draft moves nothing, posts nothing, and can be thrown away. So
  // `accounts.view`, `journals.view`, `journals.create` and `ledger.view` are
  // granted.
  //
  // Posting is not. `journals.post` writes to the authoritative ledger by hand,
  // outside every source module's controls — the same authority
  // `disbursements.confirm` was withheld to protect, reached by a different
  // door. `journals.reverse` unwinds a committed posting, on the same footing
  // as `collections.reverse`. Both stay with the approval authority.
  //
  // `accounts.manage` is withheld on the master-data reasoning rather than the
  // money reasoning: the chart of accounts is organization-wide configuration,
  // and one branch editing it would change what every other branch is able to
  // post to.
  //
  // `ledger.reconcile` is withheld because a reconciliation that spans one
  // branch is not a reconciliation. It compares every source transaction in the
  // organization against every journal; scoping it to a branch would report
  // every other branch's postings as missing.
  //
  // Scenarios 44, 48, 49 and 50 each need an account that reaches the screen
  // and is refused the action. Granting any of these four would silently make
  // one of them unprovable.
  'accounting.accounts.view',
  'accounting.journals.view',
  'accounting.journals.create',
  'accounting.ledger.view',
  // Module 12 divides on the same two lines, and withholds three.
  //
  // Receiving an agent's cash and counting it is branch work — it is the
  // branch's own drawer being reconciled — so `handovers.view`,
  // `handovers.receive`, `reconciliation.view`, `reconciliation.perform` and
  // `field.collections.view` are granted. So is `field.collections.verify`:
  // judging whether an offline capture is genuine is a supervisory act over the
  // branch's own agents, and it moves no money.
  //
  // Three are withheld:
  //
  //  * `field.collections.record` — for the reason `collections.sync` already
  //    is. Recording a *field* collection is the act of the person who
  //    physically took the cash, and it opens a custody balance in that
  //    person's name. A Branch Admin taking an over-the-counter payment uses
  //    `collections.post`, which credits branch cash directly.
  //  * `cash.handovers.reverse` — it unwinds a committed custody journal and
  //    moves cash back out of the branch's books, on the same footing as
  //    `collections.reverse` and `journals.reverse`.
  //  * `cash.reconciliation.resolve` — deciding who bears a shortage is the
  //    approval authority's act. A branch that could both count the cash and
  //    forgive the difference is an unreviewed control, which is the single
  //    most valuable thing this module adds.
  //
  // Scenarios 30, 42 and 43 each need an account that reaches the screen and is
  // refused the action. Granting any of the three would make one of them
  // unprovable.
  'field.collections.view',
  'field.collections.verify',
  'cash.handovers.view',
  'cash.handovers.receive',
  'cash.reconciliation.view',
  'cash.reconciliation.perform',
  // Module 13 applies the shape again. A Branch Admin runs the recovery desk
  // for their branch — reading the overdue book, opening cases, assigning
  // officers, recording activity, escalating, closing and issuing notices — and
  // is refused the three authorities that give money back:
  //
  //  * `penalties.waive` — assessing a charge and forgiving it are the two
  //    halves of one control, and Scenario 20 needs an account that reaches the
  //    penalty screen and is refused the waiver.
  //  * `recovery.settlements.approve` — a desk that could both agree terms with
  //    a borrower and approve forgiving the remainder is unreviewed. Branch
  //    Admin proposes; approval is the approval authority's act.
  //  * `recovery.writeoff.post` — see the Super Admin exclusion above.
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
  // Reading operational reports is branch work: a Branch Admin who cannot see
  // their own branch's portfolio, collections, field cash or overdue book
  // cannot run the branch. Those seven categories are granted, and so is
  // `reports.export` — a supervisor who can read a report on screen and is
  // refused the same figures as a file has been given a distinction without a
  // difference.
  //
  // Two are withheld:
  //
  //  * `reports.financial.view` — the financial reports are the organization's
  //    ledger, not one branch's operations, on the same reasoning that withheld
  //    `accounting.ledger.reconcile`. Scenarios 28 and 49 each need an account
  //    that reaches the reports area and is refused this one specifically.
  //  * `reports.export.pii` — an export carrying customer names and mobile
  //    numbers leaves the system and is forwarded. Withholding it does not
  //    refuse the export; it masks those columns, which is exactly what
  //    Scenario 35 describes.
  //
  // Saved reports are granted in full: a definition is a stored filter set, and
  // running one re-validates scope against the runner's live authorization
  // rather than trusting what was saved.
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
  // Module 16 repeats the shape one last time, and more strictly than anywhere
  // else: a Branch Admin reaches all three notification administration screens
  // and is refused every mutation on all three.
  //
  // That is not caution for its own sake. Four of Module 16's permission
  // scenarios need exactly this account — one that gets to the screen and is
  // denied the act — and granting any one of the withheld codes would make the
  // corresponding test unprovable:
  //
  //  * `notifications.templates.manage` / `.delete` — Scenarios 11 and 43.
  //  * `notifications.rules.manage` / `.delete` — Scenarios 41 and 44.
  //    Scenario 41 in particular needs a branch-confined caller refused a rule
  //    in *another* branch; withholding manage entirely is stricter than that
  //    scenario requires, and deliberately so, because notification routing is
  //    organization policy rather than branch operations.
  //  * `notifications.deliveries.retry` — Scenario 45, verbatim: an account
  //    that can see a failed delivery and cannot retry it.
  //
  // `notifications.view` is granted so Delivery Monitoring shows message bodies
  // rather than metadata alone — a Branch Admin investigating why a branch
  // notification failed needs to see what was sent.
  'notifications.view',
  'notifications.preferences.manage',
  'notifications.templates.view',
  'notifications.rules.view',
  'notifications.deliveries.view',
  // Module 17 repeats the shape a final time, with one deliberate exception.
  //
  // The exception is `settings.branch.manage`. Every other "manage" code this
  // role holds elsewhere is withheld here, but a Branch Admin owning their own
  // branch's settings is the module's stated intent (Rule 2), and the code is
  // bounded by scope rather than authority: the service narrows every write
  // through the shared branch-scope helper, so holding it grants their branch
  // and never another's. That is what Scenario 44 proves — an account that can
  // edit Branch A and is refused Branch B — and it needs a role that HOLDS the
  // code, which a pure view-only grant could not give.
  //
  // Everything else is withheld, and each withholding makes a specific scenario
  // provable rather than being caution for its own sake:
  //
  //  * `settings.manage` — org-scoped settings are not branch operations.
  //  * `settings.protected.manage` — Scenario 64: reaches the setting list,
  //    refused the protected one, and sees its value masked.
  //  * `settings.changes.approve` — approval authority is separate from the
  //    maker-checker rule; withholding it keeps Branch Admin a proposer.
  //  * `settings.calendar.manage` — Scenario 19; the calendar governs EOD for
  //    the whole organization.
  //  * `audit.export` — Scenario 42, verbatim: an account that can read the
  //    trail and cannot export it.
  //  * `audit.sensitive.view` — Scenario 39: before/after values arrive masked
  //    for this role.
  //  * every `maintenance.*` write — Scenario 45's authority half. The scope
  //    half needs MAINT_OPERATOR (an e2e fixture role owned by the seed), which
  //    holds the retry code and is still refused another branch's job.
  //
  // `audit.view` is granted so Scenario 36 has a branch-confined reader on a
  // surface it is otherwise entitled to — and note that confinement has a NULL
  // fallback, because `audit_logs.branch_id` is retrofitted and every
  // pre-Module-17 row carries NULL.
  'settings.view',
  'settings.branch.manage',
  'settings.changes.view',
  'settings.changes.submit',
  'settings.calendar.view',
  'audit.view',
  'maintenance.jobs.view',
];

/**
 * Deliberately without `sessions.revoke`, so Scenario 23 has a role that is
 * authenticated and demonstrably unauthorized for remote revocation.
 *
 * `field.checkin` is the mirror image: only a Field Employee may check in, so
 * GPS Scenarios 3 and 30 have an authenticated admin who is denied. Note the
 * admins hold `field.checkin.view` but NOT `field.checkin` — being able to
 * review someone's check-in history is not permission to create one.
 * `customers.view` and nothing else from Module 04 (Q-CUST-23): a field agent
 * must be able to identify the customer they are collecting from, but creating
 * or editing one is a branch-office action. Scenario 23 uses this role for the
 * unauthorized-edit refusal.
 */
export const FIELD_EMPLOYEE_PERMISSION_CODES: readonly string[] = [
  'dashboard.view',
  'collections.record',
  'field.checkin',
  'customers.view',
  // Needed to render a customer's stored gender or a guarantor's relationship
  // as a label rather than a raw code on a field screen.
  'master_data.view',
  // Module 11. Collecting in the field is this role's entire purpose, so it
  // holds the money-moving act and the offline path that a Branch Admin does
  // not. It is refused `collections.reverse` on the same reasoning as Branch
  // Admin, more strongly: an agent who could reverse their own receipt could
  // take cash and erase the record of it.
  //
  // `loans.schedules.view` comes with it out of necessity rather than
  // generosity — an agent must be able to see what is owed before they can
  // collect it, and the schedule is where that lives.
  'collections.view',
  'collections.post',
  'collections.sync',
  'loans.schedules.view',
  // Module 12. Taking cash in the field and handing it to the branch is this
  // role's other half. It holds the agent's side of the transfer and is refused
  // the branch's side entirely:
  //
  //  * `cash.handovers.receive` — submitting and receiving are the two sides of
  //    one transfer. One person holding both could sign for cash they never
  //    handed over, and Scenario 43 needs an agent account that reaches the
  //    action and is refused it.
  //  * `field.collections.verify` — an agent who could confirm their own
  //    offline capture could launder a fabricated one.
  //  * `cash.reconciliation.*` — counting the branch drawer is branch work.
  //
  // It holds `cash.handovers.view` so an agent can see what they owe the branch
  // and what has already been received.
  'field.collections.view',
  'field.collections.record',
  'cash.handovers.view',
  'cash.handovers.submit',
  // Module 13. This role is the Recovery Officer of the source's story: working
  // assigned cases in the field is the third half of its job.
  //
  // It holds the two acts an officer performs — reading their cases and
  // recording what happened — plus the offline path, on the same reasoning as
  // `collections.sync`: recovery visits happen where there is no signal.
  //
  // It is refused everything that decides rather than records:
  //
  //  * `recovery.cases.assign` — an officer who could reassign could hand away
  //    a case they were accountable for, or take one they were never given.
  //    Scenario 42 needs an agent account that reaches the case and is refused
  //    the assignment.
  //  * `recovery.cases.close` and `.escalate` — deciding a debt is resolved is
  //    not the act of the person whose performance it measures.
  //  * `penalties.*`, `recovery.settlements.*`, `recovery.writeoff.post` — an
  //    officer who could waive a penalty or forgive a balance in front of the
  //    customer is the control this module exists to prevent.
  //
  // `overdue.view` comes with it out of necessity rather than generosity: an
  // officer must see what is owed before they can recover it. Scope confinement
  // to their own assigned cases is enforced server-side, not by withholding the
  // read — the permission grants the action, not the reach.
  'overdue.view',
  'recovery.cases.view',
  'recovery.actions.record',
  'recovery.sync',
  // Module 16. A field agent receives notifications — assignment alerts and due
  // reminders are most of what routes to this role — and may tune the optional
  // ones. Nothing else: notification configuration is office work, and Delivery
  // Monitoring exposes other users' traffic.
  //
  // Reading their own notification centre needs no grant at all; Rule 53 gives
  // it to every authenticated user, which is why there is no `notifications.*`
  // view code here despite this role being the module's busiest recipient.
  'notifications.preferences.manage',
];

/** Role code → the permission codes it holds, for the three core roles. */
export const CORE_ROLE_GRANTS: Readonly<Record<string, readonly string[]>> = {
  SUPER_ADMIN: SUPER_ADMIN_PERMISSION_CODES,
  BRANCH_ADMIN: BRANCH_ADMIN_PERMISSION_CODES,
  FIELD_EMPLOYEE: FIELD_EMPLOYEE_PERMISSION_CODES,
};
