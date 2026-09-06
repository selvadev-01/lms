/** Shared constants. No framework imports. */

export const APP_NAME = "LMS";

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  BRANCH_ADMIN: "BRANCH_ADMIN",
  FIELD_EMPLOYEE: "FIELD_EMPLOYEE",
  CUSTOMER: "CUSTOMER",
} as const;

export const LOAN_STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  DISBURSED: "DISBURSED",
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
  DEFAULTED: "DEFAULTED",
} as const;

/**
 * Session lifecycle states.
 *
 * Derived from the `user_sessions` timestamps rather than stored in a column,
 * so the state can never drift from the `revoked_at` / `expires_at` /
 * `last_seen_at` values that actually decide it.
 */
export const SESSION_STATE = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
  LOGGED_OUT: "LOGGED_OUT",
} as const;

export type SessionState = (typeof SESSION_STATE)[keyof typeof SESSION_STATE];

/**
 * Why a session was terminated. Written to `user_sessions.revoked_reason`,
 * which is VARCHAR(50) — keep every value inside that budget.
 *
 * `USER_LOGOUT` is the only reason that derives to LOGGED_OUT; every other
 * reason derives to REVOKED.
 */
export const SESSION_REVOKE_REASON = {
  USER_LOGOUT: "USER_LOGOUT",
  USER_REVOKED: "USER_REVOKED",
  ADMIN_REVOKED: "ADMIN_REVOKED",
  IDLE_TIMEOUT: "IDLE_TIMEOUT",
  ROTATED: "ROTATED",
  CONCURRENCY_LIMIT: "CONCURRENCY_LIMIT",
  PASSWORD_CHANGE: "PASSWORD_CHANGE",
  PASSWORD_RESET: "PASSWORD_RESET",
  ACCOUNT_INELIGIBLE: "ACCOUNT_INELIGIBLE",
  ORG_INACTIVE: "ORG_INACTIVE",
} as const;

export type SessionRevokeReason =
  (typeof SESSION_REVOKE_REASON)[keyof typeof SESSION_REVOKE_REASON];

/**
 * Permission codes, `<module>.<action>` to match the seeded catalog.
 *
 * This list must stay in step with `PERMISSION_CATALOG` in
 * `apps/api/src/users/rbac/permission-catalog.ts`, which is canonical. The web
 * app's page guards and sidebar gating compare against the constants here, so a
 * code present in only one place fails silently: a catalog entry with no
 * constant is a permission the web app can never name, and a constant with no
 * catalog entry guards a page nobody can ever open.
 * `permission-catalog.spec.ts` asserts both directions.
 */
export const PERMISSIONS = {
  /** Open the dashboard for the assigned scope. */
  DASHBOARD_VIEW: "dashboard.view",
  /** Revoke a session belonging to another user. */
  SESSIONS_REVOKE: "sessions.revoke",
  /** Perform a Field Employee GPS check-in. Field Employees only. */
  FIELD_CHECKIN: "field.checkin",
  /** Review another user's GPS check-in history. Admins only, branch-confined. */
  FIELD_CHECKIN_VIEW: "field.checkin.view",

  /** Read the caller's own organization. There is no cross-tenant read. */
  ORGANIZATIONS_VIEW: "organizations.view",
  /** Edit Company Settings. Never the organization code, which is immutable. */
  ORGANIZATIONS_UPDATE: "organizations.update",
  /** List and open branches. Branch-confined for a caller carrying a branchId. */
  BRANCHES_VIEW: "branches.view",
  BRANCHES_CREATE: "branches.create",
  BRANCHES_UPDATE: "branches.update",
  /** Physically delete a branch — refused when anything references it. */
  BRANCHES_DELETE: "branches.delete",
  /** Toggle branch status in either direction. */
  BRANCHES_ACTIVATE: "branches.activate",

  /**
   * Module 03. `users.*` and `employees.*` address the same `users` table
   * deliberately: a Branch Admin must be able to reach Employee Management while
   * being refused Admin Management (Scenarios 22, 25), which one family cannot
   * express. The controller picks the family; the service applies the
   * `employeeCode` filter that keeps each surface to its own records.
   */
  USERS_VIEW: "users.view",
  USERS_CREATE: "users.create",
  USERS_UPDATE: "users.update",
  /** Physically delete a user — refused when anything references them. */
  USERS_DELETE: "users.delete",
  /** Toggle account status in either direction. */
  USERS_ACTIVATE: "users.activate",
  /** Change which roles a user holds. Bounded by the delegation subset rule. */
  USERS_ASSIGN_ROLE: "users.assign_role",

  EMPLOYEES_VIEW: "employees.view",
  EMPLOYEES_CREATE: "employees.create",
  EMPLOYEES_UPDATE: "employees.update",
  /** Change an employee's branch assignment. */
  EMPLOYEES_ASSIGN: "employees.assign",
  EMPLOYEES_ACTIVATE: "employees.activate",
  EMPLOYEES_DELETE: "employees.delete",

  ROLES_VIEW: "roles.view",
  ROLES_CREATE: "roles.create",
  /** Rename a role or edit its description. Never its code, which is immutable. */
  ROLES_UPDATE: "roles.update",
  ROLES_DELETE: "roles.delete",
  /** Save & Activate, and the reverse. */
  ROLES_ACTIVATE: "roles.activate",
  /** Edit a role's permission set. Bounded by the delegation subset rule. */
  ROLES_ASSIGN_PERMISSIONS: "roles.assign_permissions",

  /** Read the catalog the role editor lists. There is no permission write. */
  PERMISSIONS_VIEW: "permissions.view",

  /**
   * Module 04. Four families rather than one, because the story gives them
   * different authorities: Branch Admin is the KYC approver yet is refused
   * `CUSTOMERS_DELETE` and `CUSTOMERS_CONVERT`, which is what gives Scenarios 23
   * and 29 an account that reaches the screen and is denied the action.
   *
   * Every code here must also exist in
   * `apps/api/src/users/permission-catalog.ts` — that file is canonical, this one
   * is what the web app compares against for page guards and sidebar gating.
   */
  CUSTOMERS_VIEW: "customers.view",
  CUSTOMERS_CREATE: "customers.create",
  CUSTOMERS_UPDATE: "customers.update",
  /**
   * Sending and confirming a LOCAL customer's mobile code.
   *
   * Its own code rather than `customers.update`, which used to gate it: a field
   * agent may register a customer and verify their number without being able to
   * edit one afterwards. Verifying now also activates a PENDING LOCAL customer,
   * so this carries the weight `customers.activate` would otherwise.
   */
  CUSTOMERS_MOBILE_VERIFY: "customers.mobile.verify",
  /** Physically delete a customer — refused when anything references them. */
  CUSTOMERS_DELETE: "customers.delete",
  /** Toggle customer status in either direction. */
  CUSTOMERS_ACTIVATE: "customers.activate",
  /** LOCAL → KYC on the existing record. Never creates a second customer. */
  CUSTOMERS_CONVERT: "customers.convert",

  CUSTOMERS_KYC_VIEW: "customers.kyc.view",
  CUSTOMERS_KYC_SUBMIT: "customers.kyc.submit",
  /** Approve, reject, or return KYC for revision. Branch Admin's authority. */
  CUSTOMERS_KYC_APPROVE: "customers.kyc.approve",

  CUSTOMERS_DOCUMENTS_UPLOAD: "customers.documents.upload",
  CUSTOMERS_DOCUMENTS_VERIFY: "customers.documents.verify",
  /** Read the stored bytes. Checked again per request, never by URL alone. */
  CUSTOMERS_DOCUMENTS_DOWNLOAD: "customers.documents.download",

  CUSTOMERS_GUARANTORS_VIEW: "customers.guarantors.view",
  CUSTOMERS_GUARANTORS_MANAGE: "customers.guarantors.manage",
  /**
   * Deactivate and delete are split out of `.manage` rather than folded into it.
   * Module 05 Scenarios 29 and 40 each need a role that reaches the guarantor
   * screen and is refused exactly one of these — impossible to express, let
   * alone test, if editing a guarantor implied being able to delete one.
   */
  CUSTOMERS_GUARANTORS_DEACTIVATE: "customers.guarantors.deactivate",
  CUSTOMERS_GUARANTORS_DELETE: "customers.guarantors.delete",

  CUSTOMERS_GUARANTORS_DOCUMENTS_UPLOAD:
    "customers.guarantors.documents.upload",
  CUSTOMERS_GUARANTORS_DOCUMENTS_VERIFY:
    "customers.guarantors.documents.verify",
  CUSTOMERS_GUARANTORS_DOCUMENTS_DOWNLOAD:
    "customers.guarantors.documents.download",
  /**
   * Separate from `customers.kyc.approve` on purpose: Q-GUAR-13 asks whether a
   * different role approves guarantor KYC, and keeping the codes apart makes
   * that answer a seed change rather than a code change.
   */
  CUSTOMERS_GUARANTORS_KYC_REVIEW: "customers.guarantors.kyc.review",

  /**
   * Modules 06-07 — loan configuration and applications.
   *
   * Read and write are split on both products and schemes so a Branch Admin can
   * hold the read — they cannot fill in an application's scheme step otherwise —
   * without any ability to change what the organization lends. That is not the
   * usual "withhold one grant to prove a denial": the source is explicit that
   * Branch Admin is not a configuration owner.
   */
  LOANS_PRODUCTS_VIEW: "loans.products.view",
  LOANS_PRODUCTS_MANAGE: "loans.products.manage",
  LOANS_PRODUCTS_ACTIVATE: "loans.products.activate",
  LOANS_SCHEMES_VIEW: "loans.schemes.view",
  LOANS_SCHEMES_MANAGE: "loans.schemes.manage",
  /** Controls whether new applications may select the scheme. */
  LOANS_SCHEMES_ACTIVATE: "loans.schemes.activate",

  LOANS_APPLICATIONS_VIEW: "loans.applications.view",
  LOANS_APPLICATIONS_CREATE: "loans.applications.create",
  LOANS_APPLICATIONS_SUBMIT: "loans.applications.submit",
  LOANS_APPLICATIONS_REVIEW: "loans.applications.review",
  LOANS_APPLICATIONS_MODIFY_TERMS: "loans.applications.modify_terms",
  LOANS_APPLICATIONS_REJECT: "loans.applications.reject",
  /**
   * Deliberately withheld from Branch Admin, alongside `LOANS_APPROVE` and
   * `LOANS_APPLICATIONS_DELETE_DRAFT`. Pricing off the scheme is a configuration
   * decision, and Module 06 keeps those with the Super Admin.
   */
  LOANS_APPLICATIONS_OVERRIDE_RATE: "loans.applications.override_rate",
  /** Only an unreferenced draft. A submitted application is never deletable. */
  LOANS_APPLICATIONS_DELETE_DRAFT: "loans.applications.delete_draft",

  LOANS_APPLICATIONS_DOCUMENTS_VIEW: "loans.applications.documents.view",
  LOANS_APPLICATIONS_DOCUMENTS_UPLOAD: "loans.applications.documents.upload",
  LOANS_APPLICATIONS_DOCUMENTS_VERIFY: "loans.applications.documents.verify",
  /** Read the stored bytes. Checked again per request, never by URL alone. */
  LOANS_APPLICATIONS_DOCUMENTS_DOWNLOAD:
    "loans.applications.documents.download",

  // Module 08 — approval workflow beyond the decision itself.

  /** A CIBIL score is the borrower's financial position: reaching an
   * application does not entitle a caller to read one. */
  LOANS_APPLICATIONS_ASSESSMENT_VIEW: "loans.applications.assessment.view",
  LOANS_APPLICATIONS_ASSESSMENT_RECORD: "loans.applications.assessment.record",
  /** Commits the organization to the approved terms. Not a Branch Admin grant. */
  LOANS_APPLICATIONS_SANCTION_ISSUE: "loans.applications.sanction.issue",
  /** Transcribing the customer's answer, not deciding it. */
  LOANS_APPLICATIONS_SANCTION_RECORD_RESPONSE:
    "loans.applications.sanction.record_response",
  LOANS_APPLICATIONS_AGREEMENT_RECORD: "loans.applications.agreement.record",

  /**
   * The approval authority, seeded ahead of this module by Module 01 and reused
   * rather than duplicated. A second code meaning the same decision is how two
   * permissions end up half-granted.
   */
  LOANS_APPROVE: "loans.approve",
  LOANS_VIEW: "loans.view",

  /**
   * Module 09 — disbursal. The first codes here that gate money movement
   * rather than a decision about it.
   *
   * Split five ways because the acts differ in what they risk. Scheduling a
   * date, picking an account and transcribing that a bank transfer happened are
   * clerical and reversible; confirming posts the ledger entry, activates the
   * loan and generates the repayment schedule, and cannot be undone except by a
   * reversal.
   */
  LOANS_DISBURSEMENTS_VIEW: "loans.disbursements.view",
  LOANS_DISBURSEMENTS_SCHEDULE: "loans.disbursements.schedule",
  LOANS_DISBURSEMENTS_RECORD_TRANSFER: "loans.disbursements.record_transfer",
  /**
   * Deliberately withheld from Branch Admin, on the same reasoning as
   * `LOANS_APPROVE` and `LOANS_APPLICATIONS_SANCTION_ISSUE`: confirmation is
   * the money-movement act that follows the approval decision this role does
   * not hold. Rule 28 requires that approval permission not imply disbursement
   * permission, and Scenarios 29/30 need an account denied exactly this.
   */
  LOANS_DISBURSEMENTS_CONFIRM: "loans.disbursements.confirm",
  LOANS_DISBURSEMENTS_CANCEL: "loans.disbursements.cancel",

  /**
   * Module 10 — the repayment schedule generated at disbursal.
   *
   * `view` is separate from `LOANS_DISBURSEMENTS_VIEW` because the audiences
   * diverge: collection and recovery staff must read a schedule for the whole
   * life of the loan, and have no business reading the disbursal record that
   * produced it.
   */
  LOANS_SCHEDULES_VIEW: "loans.schedules.view",
  LOANS_SCHEDULES_EXPORT: "loans.schedules.export",
  /**
   * Withheld from Branch Admin, on the same reasoning as
   * `LOANS_DISBURSEMENTS_CONFIRM`. Regenerating rewrites the borrower's
   * contractual obligations — every remaining due date and amount — so it stays
   * with the approval authority. Scenarios 18 and 32 need an account that holds
   * `view` and is refused exactly this.
   */
  LOANS_SCHEDULES_REGENERATE: "loans.schedules.regenerate",
  /**
   * Recovery from a failed generation (Scenario 29). Separate from
   * `regenerate`: a retry produces the schedule that should already exist and
   * supersedes nothing, whereas a regeneration retires a live one.
   */
  LOANS_SCHEDULES_RETRY: "loans.schedules.retry",

  /**
   * Module 11 — EMI collection.
   *
   * `COLLECTIONS_RECORD` is deliberately **not** re-minted here under a new
   * name. It was seeded by Module 01 as `collections.record` and is already
   * granted to Branch Admin and Field Employee; a second code meaning the same
   * act is how a permission ends up half-granted, with one code checked at the
   * controller and the other in the seed.
   */
  COLLECTIONS_RECORD: "collections.record",
  COLLECTIONS_VIEW: "collections.view",
  /**
   * Post a collection — the act that moves money and writes the ledger.
   *
   * Separate from `record` because recording an intent and committing a
   * financial posting are different authorities, and Module 12's offline flow
   * will let a field agent do the first without the second.
   */
  COLLECTIONS_POST: "collections.post",
  /**
   * Reverse a posted collection.
   *
   * **Withheld from Branch Admin**, on the same reasoning as
   * `LOANS_DISBURSEMENTS_CONFIRM` and `LOANS_SCHEDULES_REGENERATE`: a reversal
   * unwinds a committed financial posting and re-opens a borrower's settled
   * obligation, which is the approval authority's act rather than the branch's.
   * Scenario 36 needs an account that holds `post` and is refused exactly this,
   * so granting it would make the scenario unprovable.
   */
  COLLECTIONS_REVERSE: "collections.reverse",
  /** Submit a collection captured offline. A field-device act. */
  COLLECTIONS_SYNC: "collections.sync",

  /**
   * Master data — the admin-maintained option lists behind dropdown fields.
   *
   * Split for the same reason as the loan-configuration pair above, and with the
   * same result: a Branch Admin holds `view` because every customer and
   * guarantor form renders these lists, and is refused `manage` because an
   * option list is organization-wide configuration. One branch editing the
   * shared document types would change what every other branch can select.
   */
  MASTER_DATA_VIEW: "master_data.view",
  MASTER_DATA_MANAGE: "master_data.manage",

  /**
   * Module 14 — accounting and ledger.
   *
   * Split eight ways rather than one `accounting.manage`, on the same reasoning
   * as Module 09's five-way split: reading a trial balance, reshaping the chart
   * of accounts, authoring a draft journal, posting it and reversing a posted
   * one are five different authorities with five different blast radii.
   *
   * The split that matters most is `JOURNALS_CREATE` versus `JOURNALS_POST`.
   * Authoring a draft writes nothing to the authoritative ledger and is
   * discardable; posting it moves money by hand, outside every source module's
   * controls. One code covering both would make it impossible to grant the
   * clerical half without the financial one.
   */
  ACCOUNTING_ACCOUNTS_VIEW: "accounting.accounts.view",
  ACCOUNTING_ACCOUNTS_MANAGE: "accounting.accounts.manage",
  ACCOUNTING_JOURNALS_VIEW: "accounting.journals.view",
  ACCOUNTING_JOURNALS_CREATE: "accounting.journals.create",
  ACCOUNTING_JOURNALS_POST: "accounting.journals.post",
  ACCOUNTING_JOURNALS_REVERSE: "accounting.journals.reverse",
  ACCOUNTING_LEDGER_VIEW: "accounting.ledger.view",
  /** Run the source-to-journal reconciliation. Spans every branch; detects, never repairs. */
  ACCOUNTING_LEDGER_RECONCILE: "accounting.ledger.reconcile",

  /**
   * Module 12 — field collection and cash custody.
   *
   * Two families rather than one `field.*` block, because they answer to
   * different people. `field.collections.*` is the agent's side: capturing a
   * payment in front of a customer. `cash.*` is the branch's side: taking
   * custody of the money and proving it adds up. A single code spanning both
   * would mean an agent who can record a collection can also sign for having
   * received it, which is the whole control this module exists to provide.
   *
   * Note the `action` values in the permission catalog carry family prefixes
   * (`collections_view`, not `view`) because the `field` module already holds
   * `checkin` and `checkin_view`, and `@@unique([orgId, module, action])` would
   * otherwise collide.
   */

  /**
   * See field collections and their custody state.
   *
   * Held by every role, including Field Employee — but the service narrows a
   * Field Employee who lacks `FIELD_COLLECTIONS_VERIFY` to their own
   * `collectorUserId`, so "view" means something different per role
   * (Scenario 2, Rule 4). That narrowing is in the service, not this code.
   */
  FIELD_COLLECTIONS_VIEW: "field.collections.view",
  /**
   * Record a collection taken in the field.
   *
   * **Withheld from Branch Admin**, for the reason `COLLECTIONS_SYNC` already
   * is: recording a *field* collection is the act of the person who physically
   * took the cash, and it puts that cash into their custody. A Branch Admin
   * taking an over-the-counter payment uses `COLLECTIONS_POST`, which credits
   * branch cash rather than opening an agent custody balance.
   */
  FIELD_COLLECTIONS_RECORD: "field.collections.record",
  /**
   * Confirm or reject a field collection captured offline.
   *
   * **Withheld from Field Employee.** An agent who could confirm their own
   * capture could launder a fabricated one, which is precisely the fraud the
   * `PENDING_VERIFICATION` state exists to catch.
   */
  FIELD_COLLECTIONS_VERIFY: "field.collections.verify",

  /** See cash handovers and the derived agent cash balances behind them. */
  CASH_HANDOVERS_VIEW: "cash.handovers.view",
  /**
   * Create and submit a handover of one's own collected cash.
   *
   * The agent's half of the transfer. Withheld from Branch Admin because a
   * Branch Admin holds no custody balance to hand over.
   */
  CASH_HANDOVERS_SUBMIT: "cash.handovers.submit",
  /**
   * Receive an agent's cash at the branch — the act that posts the custody
   * journal (Dr branch cash, Cr agent cash).
   *
   * **Withheld from Field Employee.** Submitting and receiving are the two
   * sides of one transfer; one person holding both could sign for cash they
   * never handed over, and Scenario 43 needs an agent account that is refused
   * exactly this.
   */
  CASH_HANDOVERS_RECEIVE: "cash.handovers.receive",
  /**
   * Reverse a received handover.
   *
   * **Withheld from Branch Admin**, on the same reasoning as
   * `COLLECTIONS_REVERSE` and `LOANS_DISBURSEMENTS_CONFIRM`: it unwinds a
   * committed custody journal and moves cash back out of the branch's books.
   */
  CASH_HANDOVERS_REVERSE: "cash.handovers.reverse",

  /** See reconciliations, their differences and their discrepancy state. */
  CASH_RECONCILIATION_VIEW: "cash.reconciliation.view",
  /**
   * Count the cash and record the reconciliation.
   *
   * Held by Branch Admin: counting a drawer is branch work. Recording a
   * shortage is not the same as forgiving one — that is `RESOLVE` below.
   */
  CASH_RECONCILIATION_PERFORM: "cash.reconciliation.perform",
  /**
   * Resolve a shortage or excess.
   *
   * **Withheld from Branch Admin.** Approving a discrepancy decides who bears
   * a loss, which is the approval authority's act rather than the branch's —
   * and a branch that could both count the cash and forgive the difference is
   * an unreviewed control. Scenario 30 needs an account that reaches the
   * screen and is refused this, so granting it would make it unprovable.
   */
  CASH_RECONCILIATION_RESOLVE: "cash.reconciliation.resolve",

  /**
   * Module 13 — overdue and recovery.
   *
   * Four families rather than one, because the story gives them different
   * authorities and denies them separately (Scenarios 42, 43, 44).
   *
   * `overdue.*` is a read of derived data. `penalties.*` decides what a
   * borrower owes. `recovery.cases.*` and `recovery.actions.*` are the work of
   * chasing the debt. `recovery.settlements.*` and `recovery.writeoff.*` give
   * money back. Collapsing them would let the officer who agreed terms with a
   * borrower also forgive the balance.
   */
  OVERDUE_VIEW: "overdue.view",
  /**
   * Assess penal interest from the configured rule.
   *
   * Deterministic and replayable: the same basis assessed twice returns the
   * original rather than charging twice.
   */
  PENALTIES_ASSESS: "penalties.assess",
  /**
   * Waive or adjust an assessed penalty.
   *
   * **Withheld from Branch Admin.** Deciding a borrower owes a charge and
   * forgiving that charge are the two halves of a control. Scenario 20 needs an
   * account that reaches the screen and is refused this, so granting it would
   * make the refusal unprovable — the same reasoning as
   * `CASH_RECONCILIATION_RESOLVE` above.
   */
  PENALTIES_WAIVE: "penalties.waive",
  RECOVERY_CASES_VIEW: "recovery.cases.view",
  RECOVERY_CASES_CREATE: "recovery.cases.create",
  /**
   * Assign or reassign a case.
   *
   * **Withheld from Field Employee.** An officer who could reassign could hand
   * away a case they were accountable for, or take one they were never given.
   * Scenario 42 is the denial this makes provable.
   */
  RECOVERY_CASES_ASSIGN: "recovery.cases.assign",
  /** Record a contact, outcome, follow-up or promise. Moves no money. */
  RECOVERY_ACTIONS_RECORD: "recovery.actions.record",
  RECOVERY_CASES_ESCALATE: "recovery.cases.escalate",
  RECOVERY_CASES_CLOSE: "recovery.cases.close",
  RECOVERY_NOTICES_ISSUE: "recovery.notices.issue",
  RECOVERY_SETTLEMENTS_PROPOSE: "recovery.settlements.propose",
  /**
   * Approve a settlement, authorising the waiver of the remainder.
   *
   * **Withheld from Branch Admin**, on the same split as `PENALTIES_WAIVE`.
   */
  RECOVERY_SETTLEMENTS_APPROVE: "recovery.settlements.approve",
  /**
   * Write off an unrecoverable loan.
   *
   * The most irreversible act in the module: it posts a loss to the ledger and
   * moves the loan to WRITTEN_OFF. **Granted to no role by the seed** — it is
   * held only by an explicitly configured role, which is what keeps Scenario 43
   * provable.
   */
  RECOVERY_WRITEOFF_POST: "recovery.writeoff.post",
  RECOVERY_SYNC: "recovery.sync",

  /**
   * Module 15 — reports and analytics.
   *
   * Split per report category rather than one `reports.view`, for the reason
   * Module 14 split eight ways: the categories carry different sensitivities.
   * A branch supervisor reads the collection and field reports daily; the
   * financial report exposes the organization's ledger. One code covering both
   * would make it impossible to grant the operational half without the
   * financial one, and would make Scenario 49 — a user who reaches the reports
   * area and is refused the financial report specifically — unprovable.
   *
   * Viewing and exporting are separate for the same reason. A report on screen
   * is bounded by the session; an exported file leaves the system and is
   * forwarded, and Scenario 51 needs an account that can read a report and is
   * refused the file. `REPORTS_EXPORT_PII` splits again inside that: an export
   * with customer names and mobile numbers in it is a different disclosure from
   * one with loan numbers and totals, which is what Scenario 35 turns on.
   *
   * Nothing here grants a write. Reports are read-only views of authoritative
   * data (Rules 5, 6, 17) — the only writes in the module are saved-report
   * definitions, which is what `REPORTS_SAVED_MANAGE` covers.
   */
  REPORTS_DASHBOARD_VIEW: "reports.dashboard.view",
  REPORTS_PORTFOLIO_VIEW: "reports.portfolio.view",
  REPORTS_APPLICATIONS_VIEW: "reports.applications.view",
  REPORTS_DISBURSALS_VIEW: "reports.disbursals.view",
  REPORTS_COLLECTIONS_VIEW: "reports.collections.view",
  REPORTS_FIELD_VIEW: "reports.field.view",
  REPORTS_OVERDUE_VIEW: "reports.overdue.view",
  /**
   * The ledger-oriented reports.
   *
   * **Withheld from Branch Admin by the seed.** Scenarios 28 and 49 both need
   * an account that reaches the reports area and is refused this one.
   */
  REPORTS_FINANCIAL_VIEW: "reports.financial.view",
  /** Download any authorized report as a file. Separate from viewing it. */
  REPORTS_EXPORT: "reports.export",
  /**
   * Include unmasked customer PII in an export.
   *
   * **Withheld from Branch Admin by the seed.** Without it an export still
   * succeeds — names and mobile numbers are masked rather than the file being
   * refused, which is what Scenario 35 describes.
   */
  REPORTS_EXPORT_PII: "reports.export.pii",
  REPORTS_SAVED_VIEW: "reports.saved.view",
  /** Create, edit or deactivate a saved report definition. */
  REPORTS_SAVED_MANAGE: "reports.saved.manage",

  /**
   * Module 16 — Notifications.
   *
   * Note the absence: there is no permission for reading your own notification
   * centre. Rule 53 gives every user the notifications addressed to them, and
   * gating that would mean an unpermissioned user silently misses the mandatory
   * operational alerts Rule 47 says cannot be suppressed. `/notifications` and
   * the header bell require authentication only — which is also why they carry
   * no `permission` in the sidebar's nav items.
   *
   * `NOTIFICATIONS_VIEW` is therefore *not* that. It gates reading other users'
   * notification content inside Delivery Monitoring: without it the monitoring
   * screen still lists deliveries and their status, but not message bodies,
   * which is how Rule 55 minimises notification content by permission.
   *
   * Each surface splits view / manage / delete. The splits are not symmetry for
   * its own sake — Scenario 10 needs a role that can deactivate a referenced
   * template, Scenario 11 needs one whose deletion is refused, and Scenario 45
   * needs one that can see a failed delivery and is refused the retry. A merged
   * `manage` would make all three unprovable.
   */
  NOTIFICATIONS_VIEW: "notifications.view",
  /**
   * Change your own preferences. The route carries no user parameter at all, so
   * Scenario 19 holds structurally rather than by a permission check.
   */
  NOTIFICATIONS_PREFERENCES_MANAGE: "notifications.preferences.manage",
  NOTIFICATIONS_TEMPLATES_VIEW: "notifications.templates.view",
  NOTIFICATIONS_TEMPLATES_MANAGE: "notifications.templates.manage",
  /** **Withheld from Branch Admin by the seed** (Scenarios 11, 43). */
  NOTIFICATIONS_TEMPLATES_DELETE: "notifications.templates.delete",
  NOTIFICATIONS_RULES_VIEW: "notifications.rules.view",
  /** **Withheld from Branch Admin by the seed** (Scenarios 41, 44). */
  NOTIFICATIONS_RULES_MANAGE: "notifications.rules.manage",
  /** **Withheld from Branch Admin by the seed.** */
  NOTIFICATIONS_RULES_DELETE: "notifications.rules.delete",
  NOTIFICATIONS_DELIVERIES_VIEW: "notifications.deliveries.view",
  /**
   * Manually re-enqueue a failed delivery.
   *
   * **Withheld from Branch Admin by the seed**, which is what makes Scenario 45
   * provable: an account that can open Delivery Monitoring and is refused the
   * retry. Still bounded by the rule's attempt cap — it re-enqueues, it never
   * bypasses Rules 19 and 20.
   */
  NOTIFICATIONS_DELIVERIES_RETRY: "notifications.deliveries.retry",

  /**
   * Module 17 — Settings, Audit & Maintenance.
   *
   * Three surfaces, each splitting view from the thing that changes state, for
   * the same reason the notification codes above do: a merged `manage` would
   * make the denial scenarios unprovable. Every page is gated on its `*.view`
   * code and never on `*.manage`, so a Branch Admin reaches the screen and is
   * refused at the button — which is what makes the refusal observable in an
   * e2e test rather than an invisible 404.
   *
   * `SETTINGS_BRANCH_MANAGE` is the one code a Branch Admin *does* hold. It is
   * bounded by scope, not by authority: the service narrows every write through
   * `resolveBranchScope`, so holding it grants a branch its own settings and
   * never another branch's (Scenario 44).
   */
  SETTINGS_VIEW: "settings.view",
  /** **Withheld from Branch Admin by the seed** — org-scoped settings. */
  SETTINGS_MANAGE: "settings.manage",
  /** Held by Branch Admin, bounded to their own branch (Scenario 44). */
  SETTINGS_BRANCH_MANAGE: "settings.branch.manage",
  /**
   * Edit or deactivate a setting the registry marks protected, and see its
   * unmasked value.
   *
   * **Withheld from Branch Admin by the seed**, which is what makes Scenario 64
   * provable: an account that can list settings and is refused the protected
   * one. Authority comes from the registry definition, never from the row's
   * `isProtected` snapshot.
   */
  SETTINGS_PROTECTED_MANAGE: "settings.protected.manage",
  SETTINGS_CHANGES_VIEW: "settings.changes.view",
  SETTINGS_CHANGES_SUBMIT: "settings.changes.submit",
  /**
   * Approve or reject a pending configuration change.
   *
   * **Withheld from Branch Admin by the seed.** Note this is separate from the
   * maker-checker rule itself: even a Super Admin holding this code is refused
   * approval of a change they submitted (Scenario 11). The permission decides
   * who may approve at all; the self-approval check decides which ones.
   */
  SETTINGS_CHANGES_APPROVE: "settings.changes.approve",
  SETTINGS_CALENDAR_VIEW: "settings.calendar.view",
  /** **Withheld from Branch Admin by the seed** (Scenario 19). */
  SETTINGS_CALENDAR_MANAGE: "settings.calendar.manage",

  /**
   * Read the audit trail. Branch-confined for a caller carrying a branchId
   * (Scenario 36) — and see `AuditQueryService` for why that confinement has a
   * NULL fallback rather than a plain equality.
   */
  AUDIT_VIEW: "audit.view",
  /**
   * Export audit records to CSV.
   *
   * **Withheld from Branch Admin by the seed**, which is what makes Scenario 42
   * provable: an account that can read the trail and is refused the export. The
   * export is itself audit logged before a byte is written (Rule 57).
   */
  AUDIT_EXPORT: "audit.export",
  /**
   * See unmasked before/after values on an audit event.
   *
   * **Withheld from Branch Admin by the seed** (Scenario 39). Masking here is a
   * second layer, not the only one: `AuditService.sanitizeMetadata` already
   * drops credential-shaped keys at write time, so this code widens what a
   * reader sees of what was stored — it can never reveal a plaintext secret,
   * because none was ever recorded (Rule 50).
   */
  AUDIT_SENSITIVE_VIEW: "audit.sensitive.view",

  MAINTENANCE_JOBS_VIEW: "maintenance.jobs.view",
  /** **Withheld from Branch Admin by the seed.** */
  MAINTENANCE_JOBS_RUN: "maintenance.jobs.run",
  /**
   * Retry a failed maintenance run.
   *
   * **Withheld from Branch Admin by the seed**, and separately granted to the
   * seeded `MAINT_OPERATOR` role confined to BR001. That second role is not
   * redundant: Scenario 45 is a *scope* denial, and proving it needs an account
   * that HOLDS this code and is still refused another branch's job. Without it
   * Scenario 45 is indistinguishable from a plain authority denial.
   */
  MAINTENANCE_JOBS_RETRY: "maintenance.jobs.retry",
  /** **Withheld from Branch Admin by the seed.** */
  MAINTENANCE_EOD_RUN: "maintenance.eod.run",
  /**
   * Enable or disable maintenance mode.
   *
   * **Withheld from Branch Admin by the seed.** Holding this also exempts the
   * caller from the maintenance-mode block itself — otherwise enabling it would
   * lock out the only people who can turn it off. That exemption is in the
   * guard, which runs *after* authorization, so it can never grant access the
   * caller did not already have (Rule 78, Scenario 33).
   */
  MAINTENANCE_MODE_MANAGE: "maintenance.mode.manage",

  /**
   * Read retention policies (Scenario 57).
   *
   * Separate from the manage code so an operator can see what retention governs
   * their data without being able to change it — the same view/manage split the
   * settings codes use.
   */
  RETENTION_POLICIES_VIEW: "retention.policies.view",
  /**
   * Create, edit, activate or deactivate a retention policy (Scenario 55).
   *
   * **Withheld from Branch Admin by the seed.** Retention is an
   * organization-wide compliance decision with no branch dimension — a policy
   * shortening how long ledger evidence is kept cannot sensibly be a
   * branch-local choice, which is also why `RetentionPolicy` has no `branchId`.
   */
  RETENTION_POLICIES_MANAGE: "retention.policies.manage",
  /**
   * Run a purge.
   *
   * **Withheld from every seeded role, Super Admin included.** Rule 76 makes
   * immutable evidence unpurgeable regardless of who asks, so this code gates
   * only the categories a policy may legitimately purge. Granting it is a
   * deliberate act, matching how `write-off` is withheld in Module 13.
   */
  RETENTION_PURGE_RUN: "retention.purge.run",

  /**
   * Export the organization's configuration as a portable document.
   *
   * Separate from `settings.view` because an export is a bulk surface: it
   * carries every configured setting at once, where the settings screen shows
   * them one at a time. A protected value is masked in the export exactly as it
   * is on the screen, so this code never widens what its holder can see.
   */
  SETTINGS_EXPORT: "settings.export",
  /**
   * Import a configuration document (Scenarios 59-62).
   *
   * **Withheld from Branch Admin by the seed.** An import writes many settings
   * in one act, so it is gated separately from `settings.manage` — holding the
   * single-setting write does not imply authority over a bulk replacement.
   * A protected setting inside the payload additionally requires
   * `settings.protected.manage` (Rule 84).
   */
  SETTINGS_IMPORT: "settings.import",
} as const;

/**
 * Account lifecycle.
 *
 * Only ACTIVE may authenticate or carry authorization; every other state is a
 * refusal with a different reason, which is why they are separate values rather
 * than one `isActive` flag. `PENDING` is "provisioned, no password set yet" and
 * `INACTIVE` is "deliberately switched off" — conflating them would make those
 * two indistinguishable in every list filter and audit trail.
 */
export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  LOCKED: "LOCKED",
  SUSPENDED: "SUSPENDED",
  PENDING: "PENDING",
} as const;

export type UserAccountStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

/**
 * Role lifecycle. `DRAFT` is what makes the source-defined
 * "Create Role → Assign Module Permissions → Save & Activate" sequence
 * representable: a role exists and is configurable before it grants anything.
 * Only ACTIVE roles contribute permissions.
 */
export const ROLE_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;

export type RoleLifecycleStatus =
  (typeof ROLE_STATUS)[keyof typeof ROLE_STATUS];

/**
 * Organization and branch lifecycle. Both enums are ACTIVE | INACTIVE — there
 * is deliberately no third state: "deleted" is either a physical delete or a
 * refusal, never a status a query has to remember to exclude.
 */
export const RECORD_LIFECYCLE = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
} as const;

export type RecordLifecycle =
  (typeof RECORD_LIFECYCLE)[keyof typeof RECORD_LIFECYCLE];

/**
 * Outcome of one GPS check-in attempt.
 *
 * Unlike {@link SESSION_STATE}, this IS stored — a check-in is a durable record
 * of what happened at a point in time, not a state derived from timestamps, so
 * a later event must not be able to change how an earlier attempt reads.
 */
export const GPS_VERIFICATION_STATUS = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
} as const;

export type GpsVerificationStatus =
  (typeof GPS_VERIFICATION_STATUS)[keyof typeof GPS_VERIFICATION_STATUS];

/** Device location-permission state. `UNKNOWN` is the fail-closed default. */
export const GPS_PERMISSION_STATUS = {
  GRANTED: "GRANTED",
  DENIED: "DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  UNKNOWN: "UNKNOWN",
} as const;

export type GpsPermissionStatus =
  (typeof GPS_PERMISSION_STATUS)[keyof typeof GPS_PERMISSION_STATUS];

/** Network state at the moment of the attempt. */
export const GPS_NETWORK_STATUS = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
} as const;

export type GpsNetworkStatus =
  (typeof GPS_NETWORK_STATUS)[keyof typeof GPS_NETWORK_STATUS];

/**
 * Why a check-in failed, split by cause so each mode is separately queryable.
 *
 * The first three mirror the browser's `GeolocationPositionError` codes 1/2/3;
 * the rest are server-side verdicts on a position that was actually returned.
 */
export const GPS_FAILURE_REASON = {
  PERMISSION_DENIED: "PERMISSION_DENIED",
  POSITION_UNAVAILABLE: "POSITION_UNAVAILABLE",
  TIMEOUT: "TIMEOUT",
  ACCURACY_REJECTED: "ACCURACY_REJECTED",
  STALE_LOCATION: "STALE_LOCATION",
  INVALID_COORDINATES: "INVALID_COORDINATES",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  NETWORK_LOST: "NETWORK_LOST",
  PERSISTENCE_FAILED: "PERSISTENCE_FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type GpsFailureReason =
  (typeof GPS_FAILURE_REASON)[keyof typeof GPS_FAILURE_REASON];

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  MAX_PAGE_SIZE: 100,
} as const;

/** Money is handled in minor units (paise) to avoid float drift. */
export const CURRENCY = {
  CODE: "INR",
  MINOR_UNITS: 100,
} as const;

/**
 * Module 15 — the report categories.
 *
 * These are the nine surfaces the module ships, and they are what a saved
 * report's `reportType` names. They deliberately do **not** reuse the
 * `report_type` enum already in the database (`BRANCH`, `DAILY_COLLECTION`,
 * `WEEKLY`, `MONTHLY`, `LOAN`, `OUTSTANDING`, `EMPLOYEE_PERFORMANCE`, `CASH`):
 * that enum predates the specification, mixes a period (`WEEKLY`) with a
 * subject (`LOAN`) with an audience (`BRANCH`), and cannot express "overdue and
 * recovery" at all. Carrying both vocabularies would mean every saved report
 * had a type in one scheme and a screen in the other.
 *
 * // TODO(open-question): Questions 1-3 — the mandatory MVP report list and
 * // which reports are statutory or regulatory is unresolved. These nine are
 * // the categories the specification's own menu names; a statutory report
 * // added later becomes a tenth value here rather than a reinterpretation of
 * // an existing one.
 */
export const REPORT_CATEGORY = {
  DASHBOARD: "DASHBOARD",
  PORTFOLIO: "PORTFOLIO",
  APPLICATIONS: "APPLICATIONS",
  DISBURSALS: "DISBURSALS",
  COLLECTIONS: "COLLECTIONS",
  FIELD_COLLECTIONS: "FIELD_COLLECTIONS",
  OVERDUE_RECOVERY: "OVERDUE_RECOVERY",
  FINANCIAL: "FINANCIAL",
} as const;

export type ReportCategory =
  (typeof REPORT_CATEGORY)[keyof typeof REPORT_CATEGORY];

/**
 * The date column a report's range filter is applied to.
 *
 * Rule 10 requires every report to declare its basis and Rule 11 forbids a
 * report from silently mixing two. Naming them here rather than letting each
 * service pick a column is what makes that enforceable: a report declares one
 * of these values, and the service maps it to exactly one column.
 *
 * A report does **not** let the caller choose freely. Each category permits a
 * fixed set — an application report filtered by disbursal date would silently
 * exclude every application that was never disbursed.
 *
 * // TODO(open-question): Questions 6-7 — whether users may select a basis per
 * // report, or whether each report is fixed to one, is unresolved. The
 * // conservative reading is applied: each category declares its permitted
 * // bases and rejects anything else.
 */
export const REPORT_DATE_BASIS = {
  /** `loan_applications.submitted_at` — when the application was made. */
  APPLICATION_DATE: "APPLICATION_DATE",
  /** `loans.disbursement_date` — when money left the organization. */
  DISBURSAL_DATE: "DISBURSAL_DATE",
  /** `emis.due_date` — DATE-only, Asia/Kolkata. What the borrower owes, when. */
  DUE_DATE: "DUE_DATE",
  /** `collections.collection_date` — the business date money was taken. */
  COLLECTION_DATE: "COLLECTION_DATE",
  /** `journal_entries.entry_date` — the accounting business date. */
  ACCOUNTING_DATE: "ACCOUNTING_DATE",
  /** `cash_handovers.business_date` / reconciliation business date. */
  BUSINESS_DATE: "BUSINESS_DATE",
} as const;

export type ReportDateBasis =
  (typeof REPORT_DATE_BASIS)[keyof typeof REPORT_DATE_BASIS];

/** The file formats a report can be exported as. */
export const REPORT_EXPORT_FORMAT = {
  CSV: "CSV",
  PDF: "PDF",
} as const;

export type ReportExportFormat =
  (typeof REPORT_EXPORT_FORMAT)[keyof typeof REPORT_EXPORT_FORMAT];

/** Who can see a saved report definition. */
export const REPORT_VISIBILITY = {
  /** Only the owner. */
  PRIVATE: "PRIVATE",
  /** Anyone in the organization holding the category's view permission. */
  SHARED: "SHARED",
} as const;

export type ReportVisibility =
  (typeof REPORT_VISIBILITY)[keyof typeof REPORT_VISIBILITY];

/**
 * Bounds on what a single report request may ask for.
 *
 * Rule 32 requires a configured date-range limit and Rule 33 a documented
 * maximum result size, both so that one request cannot execute an unbounded
 * query (Scenario 62). These are the documented values.
 *
 * // TODO(open-question): Questions 29, 30, 32 and 45 — the real maximum export
 * // size, date range and performance targets are unresolved. 366 days covers a
 * // full financial year including a leap year, which is the longest range an
 * // operational report has been asked for; 10,000 rows is roughly a 1-2MB CSV.
 * // Both are deliberately conservative: raising a limit is safe, lowering one
 * // breaks a report someone already relies on.
 */
export const REPORT_LIMITS = {
  /** Inclusive maximum span of `fromDate`..`toDate`, in days. */
  MAX_DATE_RANGE_DAYS: 366,
  /** Rows above this in one export are refused, never silently truncated. */
  MAX_EXPORT_ROWS: 10_000,
} as const;

/**
 * The widgets the operational home screen (Module 18) is built from.
 *
 * A widget is a *unit of authorization and of failure*, which is why these are
 * named values rather than an implicit consequence of what the page happens to
 * render. Rule 6 makes each widget permission-controlled and Rule 33 requires
 * one widget's failure to leave the others intact; both are only enforceable
 * against a code that a permission and an error state can be attached to.
 *
 * These are deliberately *not* the same list as `REPORT_CATEGORY`. A report
 * category is a query someone runs; a widget is a panel someone is shown. The
 * two overlap in subject and diverge in purpose — `QUICK_ACTIONS` is a widget
 * and could never be a report, and `FINANCIAL` is a report no home screen shows.
 *
 * // TODO(open-question): Question 1 — the mandatory MVP widget list is
 * // unresolved. These seven are the field groups the specification's own
 * // "Dashboard — Fields" section names, minus Performance Summary, which needs
 * // per-employee arithmetic no owning module currently exposes (Questions
 * // 16-18). It becomes an eighth value here rather than a reinterpretation of
 * // an existing one.
 */
export const DASHBOARD_WIDGET_CODE = {
  LOAN_SUMMARY: "LOAN_SUMMARY",
  COLLECTION_SUMMARY: "COLLECTION_SUMMARY",
  OVERDUE_RECOVERY: "OVERDUE_RECOVERY",
  CASH_SUMMARY: "CASH_SUMMARY",
  OPERATIONAL_ALERTS: "OPERATIONAL_ALERTS",
  QUICK_ACTIONS: "QUICK_ACTIONS",
  RECENT_ACTIVITY: "RECENT_ACTIVITY",
} as const;

export type DashboardWidgetCode =
  (typeof DASHBOARD_WIDGET_CODE)[keyof typeof DASHBOARD_WIDGET_CODE];

/**
 * What happened when a widget tried to load.
 *
 * Rules 34-36 turn on the difference between these four, and the reason they
 * are four rather than a boolean is Scenario 36: a widget that failed must not
 * be shown as a zero, and Scenario 35: a widget that genuinely has no rows must
 * not be shown as broken. `NO_DATA` and `FAILED` are the two halves of that
 * distinction; collapsing them would make one of the two scenarios unprovable.
 *
 * The type that carries these (`DashboardWidget<T>` in `@lms/types`) attaches
 * data to `AVAILABLE` and `STALE` only, so this distinction is structural
 * rather than a convention a renderer has to remember.
 */
export const DASHBOARD_WIDGET_STATUS = {
  /** Loaded, and has rows. */
  AVAILABLE: "AVAILABLE",
  /** Loaded successfully against an empty result. A valid state, not an error. */
  NO_DATA: "NO_DATA",
  /** Did not load. Carries no value — never a zero. */
  FAILED: "FAILED",
  /** Loaded, but from a source that is knowably behind. Carries its reason. */
  STALE: "STALE",
} as const;

export type DashboardWidgetStatus =
  (typeof DASHBOARD_WIDGET_STATUS)[keyof typeof DASHBOARD_WIDGET_STATUS];

/**
 * How current a widget's data is (Rules 31-32, Scenario 38).
 *
 * Nothing on the dashboard is cached today, so every widget reports `LIVE`
 * except an alert set that lost one of its queries. `CACHED` and
 * `ASYNC_REFRESH_PENDING` from the specification's own list are deliberately
 * absent: naming a state nothing can produce would let a screen claim to handle
 * staleness it has never actually seen.
 *
 * // TODO(open-question): Questions 24-26 — whether expensive metrics are
 * // precomputed, the acceptable cache duration per widget category, and
 * // whether the UI shows the freshness state explicitly are all unresolved. If
 * // a cache is added, its states are added here and `STALE` is where it
 * // reports; the shape does not have to change to accommodate one.
 */
export const DASHBOARD_FRESHNESS = {
  /** Computed during this request. */
  LIVE: "LIVE",
  /** Served from something older than this request. */
  STALE: "STALE",
  /** No value could be obtained at all. */
  UNAVAILABLE: "UNAVAILABLE",
} as const;

export type DashboardFreshness =
  (typeof DASHBOARD_FRESHNESS)[keyof typeof DASHBOARD_FRESHNESS];

/**
 * The period a range-bounded widget is filtered to (Scenario 4).
 *
 * `TODAY`, `THIS_WEEK` and `THIS_MONTH` are resolved on the server from the
 * Asia/Kolkata business date, never from the browser's clock — the same reason
 * the overdue book refuses an `asOf` parameter. Only `CUSTOM` carries dates,
 * and those are bounded by `REPORT_LIMITS.MAX_DATE_RANGE_DAYS`.
 *
 * Widgets that describe an as-of-now position (what is outstanding, what is
 * overdue) ignore this entirely and say so in their caption, rather than
 * accepting a filter and silently not applying it.
 */
export const DASHBOARD_PERIOD_TYPE = {
  TODAY: "TODAY",
  THIS_WEEK: "THIS_WEEK",
  THIS_MONTH: "THIS_MONTH",
  CUSTOM: "CUSTOM",
} as const;

export type DashboardPeriodType =
  (typeof DASHBOARD_PERIOD_TYPE)[keyof typeof DASHBOARD_PERIOD_TYPE];
