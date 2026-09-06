/**
 * The canonical permission catalog.
 *
 * Permission rows are per-organization (`@@id([orgId, permissionId])`), not a
 * global table, so every organization needs its own copy of this list or no role
 * inside it can grant anything and its first administrator is locked out. This
 * file is the one place that list is written down; the seed imports it and
 * `PermissionService.syncCatalogForOrg` upserts from it, so a new organization
 * is one call away from a working catalog rather than a hand-copied array.
 *
 * `code` is the value `@RequirePermissions()` and the guards compare against.
 * `module` and `action` exist because `@@unique([orgId, module, action])` makes
 * them a second identity for the row — a code of `roles.assign_permissions` must
 * decompose to exactly one (module, action) pair, and the pair must be unique.
 * They are written out rather than derived by splitting `code` on the last dot,
 * because `field.checkin.view` decomposes to `(field, checkin_view)` — the
 * mapping is a convention, not a parse.
 */
export interface PermissionSpec {
  code: string;
  module: string;
  action: string;
  description: string;
}

export const PERMISSION_CATALOG: readonly PermissionSpec[] = [
  // --- Module 01: Authentication & Session Management ---
  {
    code: 'dashboard.view',
    module: 'dashboard',
    action: 'view',
    description: 'Open the dashboard for the assigned scope.',
  },
  {
    code: 'sessions.revoke',
    module: 'sessions',
    action: 'revoke',
    description: "End another user's session.",
  },

  // --- Lending domain (seeded ahead of their modules) ---
  {
    code: 'loans.view',
    module: 'loans',
    action: 'view',
    description: 'View loans within the assigned scope.',
  },
  {
    code: 'loans.approve',
    module: 'loans',
    action: 'approve',
    description: 'Approve a loan application.',
  },
  {
    code: 'collections.record',
    module: 'collections',
    action: 'record',
    description: 'Record a collection against a loan.',
  },

  // --- Field operations ---
  {
    code: 'field.checkin',
    module: 'field',
    action: 'checkin',
    description: 'Perform a GPS check-in. Field Employees only.',
  },
  {
    code: 'field.checkin.view',
    module: 'field',
    action: 'checkin_view',
    description: "Review another user's check-in history.",
  },

  // --- Module 02: Organizations & Branches ---
  {
    code: 'organizations.view',
    module: 'organizations',
    action: 'view',
    description: "Read the caller's own organization.",
  },
  {
    code: 'organizations.update',
    module: 'organizations',
    action: 'update',
    description: 'Edit Company Settings. Never the organization code.',
  },
  {
    code: 'branches.view',
    module: 'branches',
    action: 'view',
    description: 'List and open branches within the assigned scope.',
  },
  {
    code: 'branches.create',
    module: 'branches',
    action: 'create',
    description: 'Create a branch.',
  },
  {
    code: 'branches.update',
    module: 'branches',
    action: 'update',
    description: 'Edit branch details.',
  },
  {
    code: 'branches.delete',
    module: 'branches',
    action: 'delete',
    description: 'Physically delete a branch nothing references.',
  },
  {
    code: 'branches.activate',
    module: 'branches',
    action: 'activate',
    description: 'Toggle branch status in either direction.',
  },

  // --- Module 03: Users, Employees, Roles & Permissions ---
  //
  // `users.*` and `employees.*` are separate families over the same `users`
  // table. That is deliberate, not duplication: Scenarios 22 and 25 require a
  // Branch Admin who reaches Employee Management and is refused Admin
  // Management, and one permission family cannot express that distinction.
  // The controller picks the family; the service applies the `employeeCode`
  // filter that keeps each surface to its own records.
  {
    code: 'users.view',
    module: 'users',
    action: 'view',
    description: 'List and open administrator accounts.',
  },
  {
    code: 'users.create',
    module: 'users',
    action: 'create',
    description: 'Create an administrator account.',
  },
  {
    code: 'users.update',
    module: 'users',
    action: 'update',
    description: 'Edit an administrator name or email.',
  },
  {
    code: 'users.delete',
    module: 'users',
    action: 'delete',
    description: 'Physically delete a user nothing references.',
  },
  {
    code: 'users.activate',
    module: 'users',
    action: 'activate',
    description: 'Activate or deactivate a user account.',
  },
  {
    code: 'users.assign_role',
    module: 'users',
    action: 'assign_role',
    description: "Change a user's role assignments.",
  },
  {
    code: 'employees.view',
    module: 'employees',
    action: 'view',
    description: 'List and open employees within the assigned scope.',
  },
  {
    code: 'employees.create',
    module: 'employees',
    action: 'create',
    description: 'Add an employee.',
  },
  {
    code: 'employees.update',
    module: 'employees',
    action: 'update',
    description: 'Edit employee details.',
  },
  {
    code: 'employees.assign',
    module: 'employees',
    action: 'assign',
    description: "Change an employee's branch assignment.",
  },
  {
    code: 'employees.activate',
    module: 'employees',
    action: 'activate',
    description: 'Activate or deactivate an employee.',
  },
  {
    code: 'employees.delete',
    module: 'employees',
    action: 'delete',
    description: 'Physically delete an employee nothing references.',
  },
  {
    code: 'roles.view',
    module: 'roles',
    action: 'view',
    description: 'Open Role & Permission Management.',
  },
  {
    code: 'roles.create',
    module: 'roles',
    action: 'create',
    description: 'Create a role.',
  },
  {
    code: 'roles.update',
    module: 'roles',
    action: 'update',
    description: 'Rename a role or edit its description.',
  },
  {
    code: 'roles.delete',
    module: 'roles',
    action: 'delete',
    description: 'Delete a role no user holds.',
  },
  {
    code: 'roles.activate',
    module: 'roles',
    action: 'activate',
    description: 'Activate or deactivate a role.',
  },
  {
    code: 'roles.assign_permissions',
    module: 'roles',
    action: 'assign_permissions',
    description: "Change a role's module permissions.",
  },
  {
    code: 'permissions.view',
    module: 'permissions',
    action: 'view',
    description: 'Read the permission catalog for the role editor.',
  },

  // --- Module 04: Customers & KYC ---
  //
  // Split into four families — `customers`, `customers.kyc`, `customers.documents`
  // and `customers.guarantors` — because the story gives them different
  // authorities. Branch Admin is the source-named KYC approver but is
  // deliberately refused `customers.delete` and `customers.convert`, which is
  // what gives Scenarios 23 and 29 an account that reaches the screen and is
  // still denied the action. One flat `customers.*` family could not express
  // that.
  {
    code: 'customers.view',
    module: 'customers',
    action: 'view',
    description: 'Open Customer Management and search customers in scope.',
  },
  {
    code: 'customers.create',
    module: 'customers',
    action: 'create',
    description: 'Register a KYC or LOCAL customer.',
  },
  {
    code: 'customers.update',
    module: 'customers',
    action: 'update',
    description: "Edit a customer's profile and address.",
  },
  {
    code: 'customers.delete',
    module: 'customers',
    action: 'delete',
    description: 'Physically delete a customer nothing references.',
  },
  {
    code: 'customers.activate',
    module: 'customers',
    action: 'activate',
    description: 'Activate or deactivate a customer.',
  },
  {
    code: 'customers.mobile.verify',
    module: 'customers',
    action: 'mobile_verify',
    description:
      "Send and confirm a LOCAL customer's mobile verification code.",
  },
  {
    code: 'customers.convert',
    module: 'customers',
    action: 'convert',
    description: 'Convert a LOCAL customer to KYC, retaining the record.',
  },
  {
    code: 'customers.kyc.view',
    module: 'customers',
    action: 'kyc_view',
    description: "Read a customer's KYC record and review history.",
  },
  {
    code: 'customers.kyc.submit',
    module: 'customers',
    action: 'kyc_submit',
    description: 'Submit a customer KYC record for review.',
  },
  {
    code: 'customers.kyc.approve',
    module: 'customers',
    action: 'kyc_approve',
    description: 'Approve KYC, reject it, or return it for revision.',
  },
  {
    code: 'customers.documents.upload',
    module: 'customers',
    action: 'documents_upload',
    description: 'Upload or replace a customer KYC document.',
  },
  {
    code: 'customers.documents.verify',
    module: 'customers',
    action: 'documents_verify',
    description: 'Mark an individual KYC document verified or rejected.',
  },
  {
    code: 'customers.documents.download',
    module: 'customers',
    action: 'documents_download',
    description: 'Download the stored file behind a KYC document.',
  },
  {
    code: 'customers.guarantors.view',
    module: 'customers',
    action: 'guarantors_view',
    description: "Read a customer's guarantors and their consent state.",
  },
  {
    code: 'customers.guarantors.manage',
    module: 'customers',
    action: 'guarantors_manage',
    description:
      'Add or edit a guarantor, record consent, and submit guarantor KYC.',
  },
  {
    code: 'customers.guarantors.deactivate',
    module: 'customers',
    action: 'guarantors_deactivate',
    description:
      'Deactivate or reactivate a guarantor. Separate from manage so a role can edit without withdrawing.',
  },
  {
    code: 'customers.guarantors.delete',
    module: 'customers',
    action: 'guarantors_delete',
    description:
      'Physically delete a guarantor — refused when a loan references them.',
  },
  {
    code: 'customers.guarantors.documents.upload',
    module: 'customers',
    action: 'guarantors_documents_upload',
    description: "Upload a document to a guarantor's KYC pack.",
  },
  {
    code: 'customers.guarantors.documents.verify',
    module: 'customers',
    action: 'guarantors_documents_verify',
    description: 'Verify or reject a single guarantor KYC document.',
  },
  {
    code: 'customers.guarantors.documents.download',
    module: 'customers',
    action: 'guarantors_documents_download',
    description:
      'Read a guarantor KYC document, including the stored file behind it.',
  },
  {
    code: 'customers.guarantors.kyc.review',
    module: 'customers',
    action: 'guarantors_kyc_review',
    description:
      "Approve, reject or return a guarantor's KYC. Separate from customers.kyc.approve: the borrower's approver need not be the guarantor's.",
  },

  // --- Module 06: Loan Products & Configuration ---
  //
  // Read and write are split so a Branch Admin can be given the read — they must
  // see which schemes exist in order to pick one on an application — without any
  // ability to change the product configuration. The source is explicit that
  // Branch Admin is not a configuration owner, so every write below is
  // Super-Admin-only in the seed.
  {
    code: 'loans.products.view',
    module: 'loans',
    action: 'products_view',
    description: 'View loan products.',
  },
  {
    code: 'loans.products.manage',
    module: 'loans',
    action: 'products_manage',
    description: 'Create or edit a loan product.',
  },
  {
    code: 'loans.products.activate',
    module: 'loans',
    action: 'products_activate',
    description:
      'Activate or deactivate a loan product. Separate from products.manage: correcting a name is not thereby permission to withdraw a product from lending.',
  },
  {
    code: 'loans.schemes.view',
    module: 'loans',
    action: 'schemes_view',
    description: 'View loan schemes and their duration options.',
  },
  {
    code: 'loans.schemes.manage',
    module: 'loans',
    action: 'schemes_manage',
    description: 'Create or edit a loan scheme and its duration options.',
  },
  {
    code: 'loans.schemes.activate',
    module: 'loans',
    action: 'schemes_activate',
    description:
      'Activate or deactivate a loan scheme, which controls whether new applications may select it.',
  },

  // --- Module 07: Loan Applications ---
  //
  // The lifecycle is split finely — create, submit, review, modify_terms,
  // reject — rather than one `applications.manage`, because the source's own
  // review flow separates these decisions and the seed needs to grant a Branch
  // Admin most of them while withholding two.
  //
  // There is deliberately no `applications.approve` here: `loans.approve`
  // already exists and already means exactly this. A second code for the same
  // decision is how two permissions end up half-granted.
  {
    code: 'loans.applications.view',
    module: 'loans',
    action: 'applications_view',
    description: 'View loan applications within the assigned scope.',
  },
  {
    code: 'loans.applications.create',
    module: 'loans',
    action: 'applications_create',
    description: 'Create a loan application and edit it while it is a draft.',
  },
  {
    code: 'loans.applications.submit',
    module: 'loans',
    action: 'applications_submit',
    description:
      'Submit a completed application for review, or return one that was sent back for more information.',
  },
  {
    code: 'loans.applications.review',
    module: 'loans',
    action: 'applications_review',
    description:
      'Take an application into review and request more information from the branch.',
  },
  {
    code: 'loans.applications.modify_terms',
    module: 'loans',
    action: 'applications_modify_terms',
    description:
      'Adjust the rate or duration of an application under review. Separate from approval: repricing an application is not deciding it.',
  },
  {
    code: 'loans.applications.reject',
    module: 'loans',
    action: 'applications_reject',
    description: 'Reject an application, recording a reason.',
  },
  {
    code: 'loans.applications.override_rate',
    module: 'loans',
    action: 'applications_override_rate',
    description:
      "Set an application rate that differs from its scheme's, under the Custom Rate interest type.",
  },
  {
    code: 'loans.applications.delete_draft',
    module: 'loans',
    action: 'applications_delete_draft',
    description:
      'Delete a draft application that has no documents or review history. Submitted applications can never be deleted.',
  },
  {
    code: 'loans.applications.documents.view',
    module: 'loans',
    action: 'applications_documents_view',
    description: "Read the list of an application's supporting documents.",
  },
  {
    code: 'loans.applications.documents.upload',
    module: 'loans',
    action: 'applications_documents_upload',
    description: 'Attach a supporting document to an application.',
  },
  {
    code: 'loans.applications.documents.verify',
    module: 'loans',
    action: 'applications_documents_verify',
    description:
      'Verify or reject an application document. Separate from uploading: attaching evidence is not reviewing it.',
  },
  {
    code: 'loans.applications.documents.download',
    module: 'loans',
    action: 'applications_documents_download',
    description:
      'Read the stored file behind an application document. Separate from documents.view, which lists metadata only.',
  },

  // Module 08 — approval workflow beyond the decision itself.
  //
  // Still no `applications.approve`: `loans.approve` remains the one code for
  // that decision, for the reason given above.
  //
  // Assessment is split view from record on the documents.view/verify pattern —
  // a CIBIL score is the borrower's financial position, so reaching an
  // application does not entitle a caller to read one.
  {
    code: 'loans.applications.assessment.view',
    module: 'loans',
    action: 'applications_assessment_view',
    description:
      "Read an application's credit assessment, including the CIBIL score and income check.",
  },
  {
    code: 'loans.applications.assessment.record',
    module: 'loans',
    action: 'applications_assessment_record',
    description:
      'Record a credit assessment, superseding the previous one. Never edits a prior finding.',
  },
  {
    code: 'loans.applications.sanction.issue',
    module: 'loans',
    action: 'applications_sanction_issue',
    description:
      'Issue the sanction letter for an approved application, committing the organization to its terms.',
  },
  {
    code: 'loans.applications.sanction.record_response',
    module: 'loans',
    action: 'applications_sanction_record_response',
    description:
      "Record the customer's acceptance or decline of a sanction letter. Transcription, not a decision.",
  },
  {
    code: 'loans.applications.agreement.record',
    module: 'loans',
    action: 'applications_agreement_record',
    description:
      'Record that the signed loan agreement was received. Does not disburse.',
  },

  // Module 09 — disbursal. The first codes in this catalog that gate money
  // movement rather than a decision about it.
  //
  // Split five ways rather than one `loans.disbursements.manage`, because the
  // acts differ in what they risk. Scheduling a date and picking an account is
  // clerical and reversible; confirming is the irreversible one — it posts the
  // ledger entry, activates the loan and generates the repayment schedule.
  // Rule 28 is explicit that approval permission must not imply disbursement
  // permission, and a single combined code would make that impossible to
  // express.
  {
    code: 'loans.disbursements.view',
    module: 'loans',
    action: 'disbursements_view',
    description:
      'Read the disbursal queue, a disbursement and its ledger posting. Reading does not entitle scheduling.',
  },
  {
    code: 'loans.disbursements.schedule',
    module: 'loans',
    action: 'disbursements_schedule',
    description:
      'Schedule a disbursement date and funding account against a signed agreement. Moves no money.',
  },
  {
    code: 'loans.disbursements.record_transfer',
    module: 'loans',
    action: 'disbursements_record_transfer',
    description:
      'Record that a bank or cash transfer was made, or that it failed. Transcription of an external event.',
  },
  {
    code: 'loans.disbursements.confirm',
    module: 'loans',
    action: 'disbursements_confirm',
    description:
      'Confirm the disbursement: posts the ledger entry, activates the loan and generates the repayment schedule. Irreversible.',
  },
  {
    code: 'loans.disbursements.cancel',
    module: 'loans',
    action: 'disbursements_cancel',
    description:
      'Cancel a scheduled disbursement before any transfer. Never available once funds have moved.',
  },

  // Module 10 — the repayment schedule.
  //
  // `schedules_view` is a separate code from `disbursements_view` because the
  // audiences diverge: collection and recovery staff read a schedule for the
  // whole life of the loan and have no business reading the disbursal record
  // that produced it. Folding the two together would have forced every
  // collections officer to be granted sight of funding accounts and transfer
  // references.
  {
    code: 'loans.schedules.view',
    module: 'loans',
    action: 'schedules_view',
    description:
      "Read a loan's repayment schedule and its installments. Reading does not entitle regenerating.",
  },
  {
    code: 'loans.schedules.export',
    module: 'loans',
    action: 'schedules_export',
    description:
      'Download a repayment schedule as CSV or PDF. Reads the same authoritative rows as the screen.',
  },
  {
    code: 'loans.schedules.regenerate',
    module: 'loans',
    action: 'schedules_regenerate',
    description:
      "Supersede the live schedule with a new version. Rewrites the borrower's remaining due dates and amounts, and is refused once any payment, penalty or recovery case references it.",
  },
  {
    code: 'loans.schedules.retry',
    module: 'loans',
    action: 'schedules_retry',
    description:
      'Generate the schedule for an active loan that has none, after a failed generation. Supersedes nothing.',
  },

  // Module 11 — EMI collection.
  //
  // `collections.record` is NOT repeated here: it is declared above, alongside
  // `loans.approve`, where Module 01 seeded it. Declaring it twice would break
  // the `@@unique([orgId, module, action])` sync.
  //
  // The split mirrors disbursal's: viewing, the money-moving act, and the
  // irreversible correction are three separate authorities.
  {
    code: 'collections.view',
    module: 'collections',
    action: 'view',
    description:
      'View collections and their allocation, receipt and ledger posting, within the branch scope.',
  },
  {
    code: 'collections.post',
    module: 'collections',
    action: 'post',
    description:
      'Post a collection: allocate it across outstanding dues, mint a receipt and write the double-entry ledger. The act that moves money.',
  },
  {
    code: 'collections.reverse',
    module: 'collections',
    action: 'reverse',
    description:
      "Reverse a posted collection, re-opening the borrower's settled obligation and posting an opposite ledger entry. The original is preserved; nothing is edited or deleted.",
  },
  {
    code: 'collections.sync',
    module: 'collections',
    action: 'sync',
    description:
      'Submit a collection captured offline on a field device for server-side validation and posting.',
  },

  // Module 12 — field collection and cash custody.
  //
  // Two families rather than one `field.*` block, because they answer to
  // different people. `field.collections.*` is the agent's side: capturing a
  // payment in front of a customer, which puts cash into that agent's custody.
  // `cash.*` is the branch's side: taking custody of the money and proving it
  // adds up. A single code spanning both would let the person who took the cash
  // also sign for having received it, which is the control this module exists
  // to provide.
  //
  // The `action` values carry family prefixes — `collections_view`, not `view` —
  // because the `field` module already holds `checkin` and `checkin_view`, and
  // `@@unique([orgId, module, action])` would otherwise collide. Same reason
  // Module 14's actions are prefixed.
  {
    code: 'field.collections.view',
    module: 'field',
    action: 'collections_view',
    description:
      'View field collections, their GPS and device evidence, and their custody state, within the branch scope. A Field Employee without verify authority sees only their own.',
  },
  {
    code: 'field.collections.record',
    module: 'field',
    action: 'collections_record',
    description:
      'Record a collection taken in the field, placing the cash into the collecting agent’s custody. The act of the person who physically took the money.',
  },
  {
    code: 'field.collections.verify',
    module: 'field',
    action: 'collections_verify',
    description:
      'Confirm or reject a field collection captured offline. Withheld from Field Employees: an agent who could confirm their own capture could launder a fabricated one.',
  },
  {
    code: 'cash.handovers.view',
    module: 'cash',
    action: 'handovers_view',
    description:
      'View cash handovers and the derived agent cash balances behind them, within the branch scope.',
  },
  {
    code: 'cash.handovers.submit',
    module: 'cash',
    action: 'handovers_submit',
    description:
      "Create and submit a handover of one's own collected cash. The agent's half of the transfer.",
  },
  {
    code: 'cash.handovers.receive',
    module: 'cash',
    action: 'handovers_receive',
    description:
      'Receive an agent’s cash at the branch, posting the custody journal that debits branch cash and credits agent cash. Withheld from Field Employees: one person holding both sides could sign for cash they never handed over.',
  },
  {
    code: 'cash.handovers.reverse',
    module: 'cash',
    action: 'handovers_reverse',
    description:
      'Reverse a received handover, unwinding the committed custody journal and returning the cash to the agent’s balance. The original is preserved; nothing is edited or deleted.',
  },
  {
    code: 'cash.reconciliation.view',
    module: 'cash',
    action: 'reconciliation_view',
    description:
      'View reconciliations, their expected and counted figures, and their discrepancy state.',
  },
  {
    code: 'cash.reconciliation.perform',
    module: 'cash',
    action: 'reconciliation_perform',
    description:
      'Count received cash and record the reconciliation. Recording a shortage is not the same authority as forgiving one.',
  },
  {
    code: 'cash.reconciliation.resolve',
    module: 'cash',
    action: 'reconciliation_resolve',
    description:
      'Resolve a cash shortage or excess. Deciding who bears a loss is the approval authority’s act; a branch that could both count the cash and forgive the difference would be an unreviewed control.',
  },

  // Master data — the admin-maintained option lists behind dropdowns.
  //
  // Split view from manage because reading is universal and writing is not:
  // every form that renders a dropdown needs the values, while changing them
  // reshapes what every user in the org can select.
  {
    code: 'master_data.view',
    module: 'master_data',
    action: 'view',
    description:
      'Read the option lists behind dropdown fields. Needed by any form that renders one.',
  },
  {
    code: 'master_data.manage',
    module: 'master_data',
    action: 'manage',
    description:
      'Add, edit, reorder, deactivate and delete option values. Changes what every user in the organization can choose.',
  },

  // Module 14 — accounting and ledger.
  //
  // Eight codes rather than one `accounting.manage`, on the same reasoning as
  // disbursal's five-way split: reading a trial balance, reshaping the chart of
  // accounts, authoring a draft journal, posting it and reversing a posted one
  // are five different authorities with five different blast radii.
  //
  // The split that carries the most weight is `journals.create` versus
  // `journals.post`, and it is deliberately NOT implied. Rule 28 restricts
  // manual journals to explicitly authorized roles, and Scenario 44 needs an
  // account that can author a draft and is refused the posting — which a single
  // code cannot express.
  //
  // The `action` values carry their family prefix (`accounts_view` rather than
  // `view`) because this module has three of them and `@@unique([orgId, module,
  // action])` is per module. Elsewhere in this file a bare verb suffices
  // because the module has only one family.
  {
    code: 'accounting.accounts.view',
    module: 'accounting',
    action: 'accounts_view',
    description:
      'Read the chart of accounts, an individual account and its hierarchy. Reading does not entitle editing.',
  },
  {
    code: 'accounting.accounts.manage',
    module: 'accounting',
    action: 'accounts_manage',
    description:
      'Create, edit, activate and deactivate accounts. Reshapes what every posting in the organization can reference; an account with posted lines can only ever be deactivated, never deleted.',
  },
  {
    code: 'accounting.journals.view',
    module: 'accounting',
    action: 'journals_view',
    description:
      'Read journal entries, their lines and their source transaction reference, within the branch scope. Includes validating a draft without saving it.',
  },
  {
    code: 'accounting.journals.create',
    module: 'accounting',
    action: 'journals_create',
    description:
      'Author, edit and discard a draft journal. Writes nothing to the authoritative ledger — a draft is not a posting.',
  },
  {
    code: 'accounting.journals.post',
    module: 'accounting',
    action: 'journals_post',
    description:
      'Post a journal to the authoritative ledger by hand, outside every source module. The act that moves money, and undoable only by a reversing entry.',
  },
  {
    code: 'accounting.journals.reverse',
    module: 'accounting',
    action: 'journals_reverse',
    description:
      'Reverse a posted journal by writing the opposite entry. The original is preserved and marked reversed; nothing is edited or deleted, and a journal may be reversed only once.',
  },
  {
    code: 'accounting.ledger.view',
    module: 'accounting',
    action: 'ledger_view',
    description:
      'Read the general ledger and the trial balance, within the branch scope.',
  },
  {
    code: 'accounting.ledger.reconcile',
    module: 'accounting',
    action: 'ledger_reconcile',
    description:
      'Run the source-to-journal reconciliation and read its findings. Spans every branch and every source module; detects missing and duplicate postings, and repairs nothing.',
  },

  // --- Module 13: Overdue & Recovery ---
  //
  // Two modules' worth of authority, deliberately not collapsed into one.
  //
  // Reading who is overdue is a different act from working the case, working
  // the case is different from deciding what a borrower owes, and deciding what
  // they owe is different again from forgiving it. The source separates them in
  // Scenarios 42, 43 and 44 — three distinct denials — and a single
  // `recovery.manage` would make all three the same person.
  //
  // The `action` values are prefixed per family because `Permission` carries
  // `@@unique([orgId, module, action])`: `recovery.cases.view` and
  // `recovery.settlements.view` would otherwise collide on `view`. Modules 12
  // and 14 prefix for the same reason.
  {
    code: 'overdue.view',
    module: 'overdue',
    action: 'view',
    description:
      'Read the overdue book: which loans are past due, by how many days, and what they owe. Derived from the authoritative schedule and business date, never from a stored figure.',
  },
  {
    code: 'penalties.assess',
    module: 'penalties',
    action: 'assess',
    description:
      'Assess penal interest against an overdue loan from the configured rule. Deterministic and replayable; assessing the same basis twice returns the original rather than charging twice.',
  },
  {
    code: 'penalties.waive',
    module: 'penalties',
    action: 'waive',
    description:
      'Waive or adjust an assessed penalty. Withheld from the staff who assess: deciding a borrower owes a charge and forgiving that charge are the two halves of a control, and one person holding both is an unreviewed write-off.',
  },
  {
    code: 'recovery.cases.view',
    module: 'recovery',
    action: 'cases_view',
    description:
      'View recovery cases, their assignment history and their recorded activity, within the branch scope. A Recovery Officer without assignment authority sees only the cases assigned to them.',
  },
  {
    code: 'recovery.cases.create',
    module: 'recovery',
    action: 'cases_create',
    description:
      'Open a recovery case against an overdue loan. At most one case may be open per loan.',
  },
  {
    code: 'recovery.cases.assign',
    module: 'recovery',
    action: 'cases_assign',
    description:
      'Assign or reassign a recovery case to an officer. Withheld from Recovery Officers: an officer who could reassign would be able to hand away a case they were accountable for, or take one they were not given.',
  },
  {
    code: 'recovery.actions.record',
    module: 'recovery',
    action: 'actions_record',
    description:
      'Record a contact attempt, outcome, follow-up or promise to pay against an assigned case. Moves no money and reduces no balance.',
  },
  {
    code: 'recovery.cases.escalate',
    module: 'recovery',
    action: 'cases_escalate',
    description:
      'Escalate an unresolved case to the next stage of the recovery workflow, recording the reason. Preserves the prior history.',
  },
  {
    code: 'recovery.cases.close',
    module: 'recovery',
    action: 'cases_close',
    description:
      'Close a recovery case, recording its resolution type and closure reason. Refused while mandatory obligations remain unresolved.',
  },
  {
    code: 'recovery.notices.issue',
    module: 'recovery',
    action: 'notices_issue',
    description:
      'Issue a legal notice against a recovery case and record its reference and notice period.',
  },
  {
    code: 'recovery.settlements.propose',
    module: 'recovery',
    action: 'settlements_propose',
    description:
      'Propose a settlement: what the borrower will pay and what would be forgiven. Proposing commits nothing and posts nothing.',
  },
  {
    code: 'recovery.settlements.approve',
    module: 'recovery',
    action: 'settlements_approve',
    description:
      'Approve a proposed settlement, authorising the waiver of the remainder. Withheld from the staff who propose: agreeing terms with a borrower and forgiving the balance are two halves of one control.',
  },
  {
    code: 'recovery.writeoff.post',
    module: 'recovery',
    action: 'writeoff_post',
    description:
      'Write off an unrecoverable loan, posting the loss to the ledger and moving the loan to WRITTEN_OFF. The most irreversible act in the module; withheld from every role the seed grants by default.',
  },
  {
    code: 'recovery.sync',
    module: 'recovery',
    action: 'sync',
    description:
      'Synchronise recovery activity captured offline. Validates authorization, scope and current case state server-side; a conflict is surfaced, never silently applied over newer data.',
  },

  // --- Module 15: Reports & Analytics ---
  //
  // One code per report category, plus two for export and two for saved
  // definitions. The categories differ in sensitivity — the financial report
  // exposes the ledger while the collection report does not — so a single
  // `reports.view` would make it impossible to grant the operational reports
  // without the financial one.
  {
    code: 'reports.dashboard.view',
    module: 'reports',
    action: 'dashboard_view',
    description:
      'Open the reporting dashboard and its KPIs for the assigned scope. Every figure is recomputed from authoritative source data at request time.',
  },
  {
    code: 'reports.portfolio.view',
    module: 'reports',
    action: 'portfolio_view',
    description:
      'Run the loan portfolio report: active loans, disbursed principal and authoritative outstanding balances within the assigned scope.',
  },
  {
    code: 'reports.applications.view',
    module: 'reports',
    action: 'applications_view',
    description:
      'Run the application report: volume and state progression by canonical application status.',
  },
  {
    code: 'reports.disbursals.view',
    module: 'reports',
    action: 'disbursals_view',
    description:
      'Run the disbursal report: approved and disbursed loans by date, branch and product.',
  },
  {
    code: 'reports.collections.view',
    module: 'reports',
    action: 'collections_view',
    description:
      'Run the repayment and collection report: amounts due and received, payment modes, allocation components and reversals.',
  },
  {
    code: 'reports.field.view',
    module: 'reports',
    action: 'field_view',
    description:
      'Run the field collection and reconciliation report: agent collections, handovers, pending cash, shortages and excesses.',
  },
  {
    code: 'reports.overdue.view',
    module: 'reports',
    action: 'overdue_view',
    description:
      'Run the overdue and recovery report: aging, delinquency buckets, NPA status, recovery assignments and promises.',
  },
  {
    code: 'reports.financial.view',
    module: 'reports',
    action: 'financial_view',
    description:
      "Run the ledger-oriented financial reports, which reconcile to Module 14. Withheld from the Branch Admin by the seed: it exposes the organization's accounting rather than one branch's operations.",
  },
  {
    code: 'reports.export',
    module: 'reports',
    action: 'export',
    description:
      'Download an authorized report as a file. Separate from viewing it: a report on screen is bounded by the session, an exported file leaves the system and is forwarded.',
  },
  {
    code: 'reports.export.pii',
    module: 'reports',
    action: 'export_pii',
    description:
      'Include unmasked customer names and mobile numbers in an export. Without it the export still succeeds, with those fields masked rather than the file refused.',
  },
  {
    code: 'reports.saved.view',
    module: 'reports',
    action: 'saved_view',
    description:
      'See saved report definitions: those owned by the caller, plus those shared within the organization.',
  },
  {
    code: 'reports.saved.manage',
    module: 'reports',
    action: 'saved_manage',
    description:
      'Create, edit or deactivate a saved report definition. The only write in the module — reports themselves are read-only views and cannot alter a source record.',
  },

  // --- Module 16: Notifications ---
  //
  // Note what is deliberately absent: there is no permission gating a user's own
  // notification centre. Rule 53 grants every user the right to see the
  // notifications addressed to them, and gating that would mean an
  // unpermissioned user silently misses the mandatory operational alerts Rule 47
  // says cannot be suppressed. `/notifications` requires authentication only.
  {
    code: 'notifications.view',
    module: 'notifications',
    action: 'view',
    description:
      "Read the *content* of other users' notifications in Delivery Monitoring. Not needed to read your own — every authenticated user sees their own notification centre. Without it the monitoring screen still lists deliveries, showing status and recipient but not the message body, which is how Rule 55 keeps notification content minimised by permission rather than by channel alone.",
  },
  {
    code: 'notifications.preferences.manage',
    module: 'notifications',
    action: 'preferences_manage',
    description:
      'Change your own notification preferences. Scoped to the caller by the route, which carries no user parameter at all — so Scenario 19\'s "User A cannot modify User B\'s preferences" holds structurally and not by a permission check. Never lets a preference suppress a mandatory notification (Rules 47, 48).',
  },
  {
    code: 'notifications.templates.view',
    module: 'notifications',
    action: 'templates_view',
    description:
      'List and open notification templates within the authorized organization scope (Scenario 9).',
  },
  {
    code: 'notifications.templates.manage',
    module: 'notifications',
    action: 'templates_manage',
    description:
      'Create, edit, activate or deactivate a notification template. Editing bumps the version and never rewrites already-created notification content (Rule 40, Scenario 8). Deliberately separate from deleting: Scenario 10 needs a role that can deactivate a referenced template while Scenario 11 refuses it deletion.',
  },
  {
    code: 'notifications.templates.delete',
    module: 'notifications',
    action: 'templates_delete',
    description:
      'Delete an unreferenced, non-system notification template (Scenario 48). Split from `manage` so that the common administrative role can maintain templates without being able to destroy one, and so Scenario 11 has a role whose deletion is refused on authority rather than only on dependency.',
  },
  {
    code: 'notifications.rules.view',
    module: 'notifications',
    action: 'rules_view',
    description:
      'List and open notification event rules within the authorized organization and branch scope.',
  },
  {
    code: 'notifications.rules.manage',
    module: 'notifications',
    action: 'rules_manage',
    description:
      'Create, edit or deactivate a notification event rule: its source event, recipient strategy, channel and template (Scenario 14). A branch-confined holder may only touch rules in their own branch — naming another branch is refused (Scenario 41).',
  },
  {
    code: 'notifications.rules.delete',
    module: 'notifications',
    action: 'rules_delete',
    description:
      'Delete a notification event rule that no notification history references. Split from `manage` for the same reason as templates.',
  },
  {
    code: 'notifications.deliveries.view',
    module: 'notifications',
    action: 'deliveries_view',
    description:
      'Open Delivery Monitoring: delivery attempts, provider references, failure classifications and retry schedules, within the authorized branch scope (Scenario 40).',
  },
  {
    code: 'notifications.deliveries.retry',
    module: 'notifications',
    action: 'deliveries_retry',
    description:
      "Manually re-enqueue a failed delivery. Separate from viewing it because Scenario 45 requires a role that can see a failure and is refused the retry. A manual retry is still bounded by the rule's configured attempt cap — it re-enqueues, it never bypasses Rules 19 and 20.",
  },

  // --- Module 17: Settings, Audit & Maintenance ---
  {
    code: 'settings.view',
    module: 'settings',
    action: 'view',
    description:
      'List and open configured settings within the authorized organization and branch scope (Scenarios 1, 3). Protected values are masked without `settings.protected.manage`.',
  },
  {
    code: 'settings.manage',
    module: 'settings',
    action: 'manage',
    description:
      'Create, edit, activate or deactivate an organization-scoped setting. Only codes defined in the validation registry may be written — an unknown code is refused rather than stored (Rules 8, 9).',
  },
  {
    code: 'settings.branch.manage',
    module: 'settings',
    action: 'branch_manage',
    description:
      "Create or edit a branch-scoped setting. Bounded by scope rather than authority: the service narrows every write through the shared branch-scope helper, so this grants a caller their own branch and never another branch's (Scenario 44).",
  },
  {
    code: 'settings.protected.manage',
    module: 'settings',
    action: 'protected_manage',
    description:
      "Edit or deactivate a setting the registry marks protected, and read its unmasked value. Authority comes from the registry definition, never from the row's stored `is_protected` snapshot (Scenario 64).",
  },
  {
    code: 'settings.changes.view',
    module: 'settings',
    action: 'changes_view',
    description:
      'Open the configuration change queue and read a change request, its base version and its approval history.',
  },
  {
    code: 'settings.changes.submit',
    module: 'settings',
    action: 'changes_submit',
    description:
      'Propose a change to a setting whose code requires maker-checker approval. The active configuration stays effective until the change is approved (Scenario 9).',
  },
  {
    code: 'settings.changes.approve',
    module: 'settings',
    action: 'changes_approve',
    description:
      'Approve or reject a pending configuration change. Separate from the maker-checker rule itself: a holder is still refused approval of a change they submitted (Scenario 11).',
  },
  {
    code: 'settings.calendar.view',
    module: 'settings',
    action: 'calendar_view',
    description:
      'Read the business calendar, its working days, holidays and EOD window for the authorized scope.',
  },
  {
    code: 'settings.calendar.manage',
    module: 'settings',
    action: 'calendar_manage',
    description:
      'Maintain working days, holidays and the EOD window. The timezone is accepted only as Asia/Kolkata; every other value is refused rather than silently coerced (Rule 16, Scenario 19).',
  },
  {
    code: 'audit.view',
    module: 'audit',
    action: 'view',
    description:
      'List and open audit events within the authorized organization and branch scope, filtered server-side (Scenarios 36, 38). Reading an event can never modify it — the table is append-only at the database level.',
  },
  {
    code: 'audit.export',
    module: 'audit',
    action: 'export',
    description:
      'Export audit records to CSV. Separate from reading them because Scenario 42 requires a role that can open the trail and is refused the export. The export is itself audit logged before any data is written (Rule 57).',
  },
  {
    code: 'audit.sensitive.view',
    module: 'audit',
    action: 'sensitive_view',
    description:
      'See unmasked before/after values on an audit event (Scenario 39). Widens what a reader sees of what was stored; it can never reveal a plaintext credential, because credential-shaped keys are dropped at write time (Rule 50).',
  },
  {
    code: 'maintenance.jobs.view',
    module: 'maintenance',
    action: 'jobs_view',
    description:
      'List and open maintenance runs within the authorized scope, including step-level progress (Scenarios 26, 27). Failure detail is restricted by permission.',
  },
  {
    code: 'maintenance.jobs.run',
    module: 'maintenance',
    action: 'jobs_run',
    description:
      'Start a supported maintenance operation manually. A duplicate request for the same scope and business date is recognized idempotently rather than started twice (Scenarios 22, 66).',
  },
  {
    code: 'maintenance.jobs.retry',
    module: 'maintenance',
    action: 'jobs_retry',
    description:
      'Retry a failed, retryable maintenance run. The retry reuses the original execution identity and skips steps that already succeeded, so completed deterministic work is not repeated (Scenarios 24, 30).',
  },
  {
    code: 'maintenance.eod.run',
    module: 'maintenance',
    action: 'eod_run',
    description:
      'Start or retry end-of-day processing for a business date. A failed run never advances the business date (Scenario 23).',
  },
  {
    code: 'maintenance.mode.manage',
    module: 'maintenance',
    action: 'mode_manage',
    description:
      'Enable or disable maintenance mode for an organization or a single branch. Holding this also exempts the caller from the block itself, so enabling it cannot lock out the people who can turn it off — an exemption applied after authorization, never instead of it (Rule 78, Scenario 33).',
  },
  {
    code: 'retention.policies.view',
    module: 'retention',
    action: 'policies_view',
    description:
      'List and open data retention policies for the organization, including the day counts and whether a category is protected immutable evidence (Scenario 57).',
  },
  {
    code: 'retention.policies.manage',
    module: 'retention',
    action: 'policies_manage',
    description:
      'Create, edit, activate or deactivate a retention policy (Scenario 55). Retention is an organization-wide compliance decision with no branch dimension. A policy that has governed real processing cannot be deleted, only deactivated or replaced (Scenario 56).',
  },
  {
    code: 'retention.purge.run',
    module: 'retention',
    action: 'purge_run',
    description:
      'Run a purge under an active retention policy. Immutable financial, ledger and audit evidence is refused regardless of who holds this, and a legal hold blocks the held record separately (Rule 76, Scenario 58).',
  },
  {
    code: 'settings.export',
    module: 'settings',
    action: 'export',
    description:
      'Export the organization configuration as a portable document. A protected value is masked exactly as it is on the settings screen, so this never widens what its holder can see (Rule 56).',
  },
  {
    code: 'settings.import',
    module: 'settings',
    action: 'import',
    description:
      'Import a configuration document. The whole payload is validated against the registry before anything is activated, and an entry older than the current server configuration is a conflict rather than a silent overwrite (Rules 83, 84; Scenarios 59-62).',
  },
] as const;

/** Every code in the catalog, for the seed's grant lists and for tests. */
export const ALL_PERMISSION_CODES: readonly string[] = PERMISSION_CATALOG.map(
  (spec) => spec.code,
);
