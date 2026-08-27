# User Story — Organizations & Branches

## Epic

Organization & Branch Administration

## Feature

Organization & Branch Management

## User Story

As a Super Admin  
I want to manage organization information and branches  
So that the LMS can maintain the organizational structure under which customers, employees, loans, collections, accounting records and reports are operated.

As a Super Admin  
I want to add, edit and manage branches  
So that operational records can be assigned to the correct branch and branch-level access can be enforced.

As an authorized Branch Admin  
I want to view my branch information and branch-scoped operational data  
So that I can operate only within the branch assigned to me.

**Source boundary:** The consolidated LMS baseline identifies **Company & Branch Management** as a core LMS capability. The Super Admin flow exposes **Company Settings — Org Info, Logo, Config** and **Branch Management — Add / Edit / Delete Branches**. The source does not provide a detailed organization CRUD flow or detailed branch form fields, so unsupported fields and workflows remain explicitly marked as Open Questions. fileciteturn1file7 fileciteturn1file10

## Rules & Business Constraints

1. Every organization is a top-level tenant/business scope for LMS records.
2. Every branch belongs to exactly one organization.
3. Every organization-scoped and branch-scoped record must carry the applicable organization scope.
4. Every branch-scoped record must carry both organization and branch scope.
5. A user must not be able to access records belonging to another organization.
6. A Branch Admin must not be able to see another branch's records within the same organization unless an explicit permission allows cross-branch access.
7. Super Admin has system-wide control according to the source flow.
8. Organization information is exposed through Company Settings — Org Info, Logo, Config.
9. Branch Management is exposed to Super Admin with Add / Edit / Delete Branches.
10. The source does not define whether Branch Admin can add, edit or delete branches; this remains an Open Question.
11. Branch code/identifier must be unique within the organization.
12. Organization code/identifier must be unique within the LMS scope if such a field is finalized.
13. A branch cannot be created without a valid parent organization.
14. A branch cannot be assigned to an organization outside the current authorized scope.
15. Organization and branch records must have an explicit lifecycle state.
16. Active organizations/branches can be used for applicable operational transactions.
17. Inactive organizations/branches must not receive new operational transactions.
18. Existing historical records must remain queryable according to the user's permission and reporting scope after deactivation.
19. Deletion is blocked when an organization or branch is referenced by downstream records.
20. Downstream references include, where applicable, users/employees, customers, guarantors, loan applications, loans, collections, accounting entries, reports, notifications and audit records.
21. Where deletion is blocked, the record must be deactivated rather than destructively deleted.
22. Deactivation must not silently delete historical data.
23. Reactivation, if supported, must be permission-controlled and audit logged.
24. Organization/branch edits must not silently move historical financial transactions to another branch.
25. Changing a branch's organization is not permitted when it would invalidate existing downstream references unless a controlled migration process is explicitly approved.
26. Branch scope is an authorization boundary, not merely a UI filter.
27. Server-side authorization must enforce organization and branch scope.
28. Client-supplied organization_id or branch_id must never override authenticated authorization scope.
29. Branch Admin actions must remain within the authenticated Branch Admin's assigned branch.
30. Field Employee / Collection Agent operations must remain within the applicable organization and branch scope.
31. Reports must respect organization and branch permissions.
32. Collections and cash reconciliation must remain branch-scoped.
33. Accounting and ledger records must preserve their organization and branch context.
34. Money is always stored as integer paise; organization and branch management has no monetary fields but must preserve financial scope.
35. EMI due dates are DATE only and interpreted in Asia/Kolkata; organization and branch management has no EMI date field.
36. Every money movement posts double-entry lines that sum to zero; organization/branch CRUD itself creates no money movement.
37. Payment posting is idempotent on `Idempotency-Key`; organization/branch CRUD does not replace payment idempotency.
38. The ledger is append-only; organization/branch management must never edit or delete posted ledger lines.
39. Corrections to financial history are reversal entries, never ledger edits/deletes.
40. Receipt numbers are gapless per branch/agent and must work offline; branch lifecycle changes must not create duplicate receipt-number scopes.
41. Branch deactivation must not cause historical receipt numbers to be renumbered.
42. Organization/branch actions are audit logged.
43. Deletion attempts and deletion-blocked outcomes are audit logged.
44. Activation/deactivation actions are audit logged.
45. Organization and branch records must not be physically deleted when retained audit/history requires the reference.
46. A branch must not become inactive while an active operational dependency requires the branch unless the finalized business policy explicitly permits controlled deactivation.
47. An inactive branch cannot be selected for new loan applications, new customer onboarding, new assignments or new collection transactions.
48. Existing loans and historical transactions belonging to an inactive branch remain part of that branch's historical data.
49. If an organization is deactivated, its branches must not be treated as independently active for new transactions.
50. The exact organization form fields, branch form fields, branch status values and organization status behavior are not fully defined by the uploaded diagrams and must be finalized before implementation.

## Background

Given the user is logged into the LMS  
And the user has permission to manage organization/branch configuration  
And the user belongs to an authorized organization scope  
And the system maintains downstream records that reference organization and branch

The Super Admin flow shows Company Settings for **Org Info, Logo, Config** and Branch Management for **Add / Edit / Delete Branches**. The detailed child workflow for Company Settings is not expanded, while Branch Management is explicitly listed as Add/Edit/Delete. fileciteturn1file10

The Branch Admin flow exposes Branch Management on the Branch Admin dashboard, but the source explicitly leaves the internal Branch Management permissions and workflow unresolved. Therefore, this document treats Super Admin branch administration as source-defined and Branch Admin branch-management actions as permission/Open-Question dependent. fileciteturn1file1

## Feature: Organization & Branch Management

### Menu

Super Admin → Company Settings → Organization  
Super Admin → Branch Management

Branch Admin → Branch Management / Branch Information, subject to finalized permissions

Actions: List, View Details, Add, Edit, Activate, Deactivate, Delete where permitted, View Branch Scope

# Organization — Fields

## Organization Information

| Field Name            | Mandatory |
| --------------------- | --------: |
| Organization Name *   |         * |
| Organization Code *   |         * |
| Organization Logo     |           |
| Organization Status * |         * |
| Configuration         |           |

**Source limitation:** The source explicitly names Org Info, Logo and Config but does not enumerate the exact organization fields. The fields above therefore represent the minimum logical structure; exact field names must be finalized.

## Organization Configuration

| Field Name               | Mandatory |
| ------------------------ | --------: |
| Configuration Name / Key |           |
| Configuration Value      |           |
| Status                   |           |

**Open Question:** The source does not define which configuration values belong under Company Settings.

# Branch — Fields

## Branch Information

| Field Name      | Mandatory |
| --------------- | --------: |
| Organization *  |         * |
| Branch Name *   |         * |
| Branch Code *   |         * |
| Branch Status * |         * |
| Address         |           |
| Contact Number  |           |
| Contact Email   |           |

**Source limitation:** The Super Admin diagram confirms Add / Edit / Delete Branches but does not define the detailed branch form fields. Address/contact fields remain proposed structural fields and must be confirmed.

## Branch Operational Scope

| Field Name               | Mandatory |
| ------------------------ | --------: |
| Organization Scope *     |         * |
| Branch Scope *           |         * |
| Receipt Sequence Scope * |         * |

The exact receipt-sequence implementation is governed by the finalized financial rule that receipt numbers are gapless per branch/agent and must work offline.

# Table Only (Not for UI)

| Internal Field           | Allowed Values / Storage                                     |
| ------------------------ | ------------------------------------------------------------ |
| `organization_id`        | Unique organization identifier                               |
| `organization_code`      | Unique business identifier within finalized global scope     |
| `organization_name`      | Organization display name                                    |
| `organization_status`    | `ACTIVE`, `INACTIVE`                                         |
| `logo_reference`         | Secure file/storage reference, nullable                      |
| `configuration`          | Organization configuration data according to approved schema |
| `branch_id`              | Unique branch identifier                                     |
| `branch_code`            | Unique within organization                                   |
| `branch_name`            | Branch display name                                          |
| `branch_status`          | `ACTIVE`, `INACTIVE`                                         |
| `branch.organization_id` | Parent organization reference                                |
| `address_reference`      | Approved address representation                              |
| `contact_reference`      | Approved branch contact representation                       |
| `created_at`             | Creation timestamp                                           |
| `updated_at`             | Last update timestamp                                        |
| `deactivated_at`         | Nullable deactivation timestamp                              |
| `deactivation_reason`    | Nullable controlled reason                                   |
| `audit_reference`        | Immutable audit-event reference                              |

# Organization and Branch State Rules

## Active Organization

An active organization can contain active branches and can participate in applicable LMS operations subject to permission and scope.

## Inactive Organization

An inactive organization cannot be used as the scope for new operational transactions.

Existing historical records remain preserved and accessible according to authorization.

## Active Branch

An active branch can be selected for applicable customer, loan, collection and operational activities.

## Inactive Branch

An inactive branch cannot receive new operational transactions.

Historical branch records remain preserved.

## Delete

Delete is permitted only when there are no downstream references and the finalized deletion policy allows physical deletion.

If downstream references exist, deletion is blocked and deactivation is used instead.

# Gherkin Scenarios

## Organization Listing and Viewing

### Scenario 1: Super Admin lists organizations

Given the Super Admin has permission to view organization configuration  
When the Super Admin opens the Organization list  
Then the system displays organizations within the Super Admin's authorized scope  
And inactive organizations are clearly identified  
And the list access is audit logged.

### Scenario 2: Super Admin views organization details

Given an organization exists  
And the Super Admin has permission to view it  
When the Super Admin selects the organization  
Then the system displays its organization information  
And its status is shown  
And the organization's configuration scope is shown according to permission  
And the view is audit logged.

### Scenario 3: Unauthorized user cannot view organization details

Given the user does not have organization-management permission  
When the user attempts to open organization details  
Then the system denies access  
And no protected organization configuration is returned  
And the denial is audit logged.

## Organization Creation

### Scenario 4: Super Admin adds an organization

Given the Super Admin has permission to create organizations  
And the required organization information is valid  
When the Super Admin submits the organization  
Then the system creates the organization in `ACTIVE` state according to the finalized default  
And assigns a unique organization identifier  
And records the organization creation in the audit log.

**Open Question:** The source does not explicitly show organization creation as a separate flow; Company Settings is the source-defined organization configuration area.

### Scenario 5: Duplicate organization identifier is rejected

Given an organization already uses the submitted organization identifier  
When the Super Admin attempts to create another organization with the same identifier  
Then the system rejects the request  
And the existing organization is not modified  
And the duplicate attempt is audit logged.

### Scenario Outline: Organization mandatory field validation

Given the Super Admin is adding an organization  
When the Super Admin submits without `<field>`  
Then the system shows "<message>"  
And the organization is not created  
And the validation failure is audit logged.

Examples:

| field               | message                         |
| ------------------- | ------------------------------- |
| Organization Name   | Organization Name is required   |
| Organization Code   | Organization Code is required   |
| Organization Status | Organization Status is required |

## Organization Editing

### Scenario 6: Super Admin edits organization information

Given an organization exists  
And the Super Admin has permission to edit it  
When the Super Admin changes an allowed organization field  
Then the system validates the updated value  
And saves the change  
And preserves the organization identifier  
And records the change in the audit log.

### Scenario 7: Organization edit cannot change historical transaction scope

Given the organization has downstream customers, loans, collections or accounting records  
When the Super Admin edits organization configuration  
Then existing downstream records retain their original organization scope  
And historical financial records are not rewritten  
And the change is audit logged.

### Scenario 8: Unauthorized user cannot edit organization

Given the user lacks organization-edit permission  
When the user submits an organization update  
Then the system denies the operation  
And the organization remains unchanged  
And the denial is audit logged.

## Organization Activation and Deactivation

### Scenario 9: Active organization can be used for new operations

Given the organization is `ACTIVE`  
And the applicable branch is also `ACTIVE`  
When an authorized user creates an applicable new operational record  
Then the system permits the organization/branch scope  
And the created record carries the correct organization and branch scope.

### Scenario 10: Inactive organization cannot receive new operational transactions

Given the organization is `INACTIVE`  
When an authorized user attempts to create a new branch-scoped operational transaction under that organization  
Then the system rejects the transaction  
And no new operational record is committed  
And the failure is audit logged.

### Scenario 11: Organization deactivation preserves historical records

Given the organization has historical customers, loans, collections and accounting records  
When the Super Admin deactivates the organization  
Then historical records remain preserved  
And historical organization references remain intact  
And the organization becomes unavailable for new applicable transactions  
And the deactivation is audit logged.

### Scenario 12: Organization reactivation is permission controlled

Given the organization is `INACTIVE`  
And the user does not have reactivation permission  
When the user attempts to reactivate the organization  
Then the system denies the action  
And the organization remains `INACTIVE`  
And the denial is audit logged.

## Branch Listing and Viewing

### Scenario 13: Super Admin lists branches

Given the Super Admin has branch-management permission  
When the Super Admin opens Branch Management  
Then the system lists branches within the authorized organization scope  
And branch status is displayed  
And inactive branches are distinguishable from active branches  
And the access is audit logged.

### Scenario 14: Super Admin views branch details

Given a branch exists  
And the Super Admin has permission to view the branch  
When the Super Admin opens branch details  
Then the system displays the branch information  
And the parent organization is displayed  
And the branch status is displayed  
And the view is audit logged.

### Scenario 15: Branch Admin cannot see another branch's records

Given the Branch Admin is assigned to Branch A  
And Branch B exists in the same organization  
When the Branch Admin opens branch-scoped lists  
Then Branch B's records are not returned  
And Branch A's records remain accessible according to permission  
And the scope enforcement is audit logged when access is denied.

This follows the LMS requirement that records remain scoped by organization and branch and the Branch Admin is a branch-level operational role. fileciteturn1file7

### Scenario 16: Branch Admin cannot switch to another branch by client input

Given the Branch Admin is assigned to Branch A  
When the client submits Branch B as the requested scope  
Then the server rejects or ignores the unauthorized branch scope  
And the request remains restricted to Branch A  
And the attempted scope violation is audit logged.

## Branch Creation

### Scenario 17: Super Admin adds a branch

Given the Super Admin has permission to add branches  
And the selected organization is valid and active  
And the branch information is valid  
When the Super Admin submits the branch  
Then the system creates the branch under the selected organization  
And the branch is assigned a unique branch identifier  
And the branch is available according to its lifecycle status  
And the creation is audit logged.

The Super Admin flow explicitly exposes Branch Management → Add Branches. fileciteturn1file10

### Scenario 18: Branch cannot be created under an inactive organization

Given the selected organization is `INACTIVE`  
When the Super Admin attempts to create a branch under that organization  
Then the system rejects the creation  
And no branch is created  
And the failure is audit logged.

### Scenario 19: Duplicate branch code is rejected

Given Branch A already exists under Organization A with branch code `BR001`  
When the user attempts to create another branch under Organization A with branch code `BR001`  
Then the system rejects the creation  
And the existing branch remains unchanged  
And the duplicate attempt is audit logged.

### Scenario Outline: Branch mandatory field validation

Given the user is adding a branch  
When the user submits without `<field>`  
Then the system shows "<message>"  
And the branch is not created  
And the validation failure is audit logged.

Examples:

| field         | message                   |
| ------------- | ------------------------- |
| Organization  | Organization is required  |
| Branch Name   | Branch Name is required   |
| Branch Code   | Branch Code is required   |
| Branch Status | Branch Status is required |

## Branch Editing

### Scenario 20: Super Admin edits branch information

Given an active branch exists  
And the Super Admin has edit permission  
When the Super Admin changes an allowed branch field  
Then the system validates the change  
And saves the updated information  
And the branch identifier remains stable  
And the edit is audit logged.

### Scenario 21: Branch edit does not move historical records

Given a branch has historical customers, loans, collections and accounting records  
When the Super Admin edits branch information  
Then historical records remain associated with their original branch  
And financial history is not rewritten  
And the edit is audit logged.

### Scenario 22: Unauthorized branch edit is denied

Given the user does not have branch-edit permission  
When the user attempts to edit a branch  
Then the system denies the action  
And the branch remains unchanged  
And the denial is audit logged.

## Branch Deactivation and Active/Inactive Behaviour

### Scenario 23: Active branch can receive new applicable transactions

Given a branch is `ACTIVE`  
And its organization is `ACTIVE`  
And the user has permission for the requested operation  
When the user creates an applicable branch-scoped record  
Then the operation is permitted  
And the new record stores the correct organization and branch scope  
And the action is audit logged.

### Scenario 24: Inactive branch cannot receive a new customer

Given Branch A is `INACTIVE`  
When an authorized user attempts to create a new customer under Branch A  
Then the system rejects the operation  
And no new customer is created under the inactive branch  
And the failure is audit logged.

### Scenario 25: Inactive branch cannot receive a new loan application

Given Branch A is `INACTIVE`  
When a user attempts to create a new loan application under Branch A  
Then the system rejects the application creation  
And no new loan application is committed  
And the failure is audit logged.

### Scenario 26: Inactive branch cannot receive new collection activity

Given Branch A is `INACTIVE`  
When a user attempts to post a new collection transaction to Branch A  
Then the system rejects the operation  
And no collection transaction is committed  
And the failure is audit logged.

### Scenario 27: Branch deactivation preserves historical records

Given Branch A contains historical customers, loans, receipts, collections and accounting records  
When the Super Admin deactivates Branch A  
Then the historical records remain preserved  
And their organization and branch scope remains unchanged  
And Branch A cannot receive new applicable transactions  
And the deactivation is audit logged.

### Scenario 28: Branch reactivation restores eligibility for new transactions

Given Branch A is `INACTIVE`  
And its parent organization is `ACTIVE`  
And the user has permission to reactivate branches  
When the user activates Branch A  
Then Branch A becomes `ACTIVE`  
And eligible new operations may use Branch A subject to normal permissions  
And the activation is audit logged.

## Deletion Safeguards

### Scenario 29: Branch deletion is allowed when there are no downstream references

Given a branch exists  
And the branch has no downstream records  
And the finalized policy permits physical deletion  
And the Super Admin has delete permission  
When the Super Admin deletes the branch  
Then the system removes the branch according to the approved deletion policy  
And the deletion is audit logged.

### Scenario 30: Branch deletion is blocked when referenced downstream

Given Branch A is referenced by one or more customers, users, loans, collections, accounting entries or audit records  
When the Super Admin attempts to delete Branch A  
Then the system blocks deletion  
And no referenced historical data is deleted  
And the system instructs the user to deactivate the branch instead  
And the blocked deletion is audit logged.

### Scenario 31: Organization deletion is blocked when branches exist

Given an organization contains one or more branches  
When the Super Admin attempts to delete the organization  
Then the system blocks the deletion  
And the organization remains available for controlled deactivation  
And the blocked deletion is audit logged.

### Scenario 32: Organization deletion is blocked by downstream references

Given an organization has downstream customers, loans, collections, accounting or audit records  
When the Super Admin attempts to delete the organization  
Then the system blocks deletion  
And historical references remain intact  
And the system requires deactivation or an approved migration process  
And the attempt is audit logged.

### Scenario 33: Deactivation is used instead of destructive deletion

Given a branch has downstream dependencies  
When the Super Admin needs to stop further operational use  
Then the Super Admin can deactivate the branch if authorized  
And historical records remain preserved  
And future operational selection of the branch is blocked  
And the deactivation is audit logged.

## Permission Denial

### Scenario 34: Branch Admin attempts unauthorized branch creation

Given the Branch Admin does not have branch-create permission  
When the Branch Admin attempts to add a branch  
Then the system denies the action  
And no branch is created  
And the denial is audit logged.

The source exposes Branch Management on the Branch Admin dashboard but explicitly leaves the detailed Branch Admin branch-management permissions unresolved. fileciteturn1file1

### Scenario 35: Branch Admin attempts another branch's edit

Given the Branch Admin belongs to Branch A  
And Branch B exists  
And the Branch Admin does not have cross-branch edit permission  
When the Branch Admin attempts to edit Branch B  
Then the system denies the operation  
And Branch B remains unchanged  
And the denial is audit logged.

## Scope Integrity

### Scenario 36: New branch-scoped record receives correct organization and branch

Given the user is operating under Organization A and Branch A  
When the user creates an applicable branch-scoped record  
Then the system stores Organization A and Branch A as the authoritative scope  
And client-supplied alternative scope values cannot override the authenticated scope  
And the creation is audit logged.

### Scenario 37: Cross-organization access is denied

Given Organization A and Organization B are separate organizations  
And the user is authorized only for Organization A  
When the user attempts to retrieve a Branch B record belonging to Organization B  
Then the system denies the request  
And no Organization B data is returned  
And the denial is audit logged.

### Scenario 38: Cross-branch report access is denied

Given a Branch Admin belongs to Branch A  
And a report contains Branch B data  
When the Branch Admin requests the Branch B report without cross-branch permission  
Then the system denies access  
And Branch B data is not included  
And the denial is audit logged.

## Receipt and Financial Scope

### Scenario 39: Branch deactivation does not renumber historical receipt numbers

Given Branch A has issued receipts with gapless branch/agent receipt numbering  
When Branch A is deactivated  
Then previously issued receipt numbers remain unchanged  
And no historical receipt number is renumbered  
And the branch deactivation is audit logged.

### Scenario 40: Branch reactivation does not reuse historical receipt numbers

Given Branch A has historical receipt numbers  
And Branch A is later reactivated  
When a new collection requires a receipt  
Then the receipt sequence continues according to the finalized gapless per-branch/agent sequence policy  
And historical receipt numbers are not reused  
And the receipt transaction is audit logged.

### Scenario 41: Organization/branch management does not create financial entries

Given a Super Admin creates, edits or deactivates an organization or branch  
When the configuration action commits  
Then no debit or credit ledger line is created merely because of the organization/branch action  
And no loan balance is changed  
And the configuration action is audit logged.

### Scenario 42: Branch scope is preserved on financial history

Given a collection or other financial transaction was posted under Branch A  
When branch configuration is later edited  
Then the historical transaction remains associated with Branch A  
And the transaction's financial history is not overwritten  
And any corrective financial change follows the append-only reversal principle.

## Offline and Synchronization

### Scenario 43: Offline collection retains branch scope

Given a Field Employee is assigned to Branch A  
And the Field Employee performs an offline collection  
When the collection is stored locally for synchronization  
Then the queued transaction retains the authorized Organization A / Branch A scope  
And the client cannot change the scope to another branch during synchronization  
And the eventual sync must validate the scope server-side.

The Field Employee flow explicitly supports offline collection, local storage, queueing and later synchronization. fileciteturn0file5

### Scenario 44: Offline synchronization to a deactivated branch is rejected

Given a Field Employee has a queued offline transaction for Branch A  
And Branch A becomes inactive before synchronization  
When synchronization occurs  
Then the server validates the branch state and authorization  
And the system does not silently post an unauthorized new transaction to the inactive branch  
And the synchronization conflict/failure is audit logged  
And the exact conflict resolution follows the finalized offline policy.

The source defines offline queueing and synchronization but leaves detailed synchronization conflict handling as an Open Question. fileciteturn0file5turn1file7

## Failure Paths

### Scenario 45: Organization creation fails during persistence

Given all organization validations pass  
When the database transaction fails before commit  
Then the organization is not partially created  
And no dependent branch is created from the failed operation  
And the failure is audit logged.

### Scenario 46: Branch creation fails during persistence

Given all branch validations pass  
When branch persistence fails before commit  
Then the branch is not partially created  
And no incomplete branch is selectable for operational transactions  
And the failure is audit logged.

### Scenario 47: Branch deletion fails safely

Given a branch deletion request is authorized  
And the deletion operation encounters a persistence failure  
When the operation fails  
Then the branch is not reported as deleted unless the deletion actually committed  
And downstream references remain intact  
And the failure is audit logged.

### Scenario 48: Deactivation failure leaves the prior state unchanged

Given an active branch is being deactivated  
When the state transition cannot be committed  
Then the branch remains in its previous authoritative state  
And the system does not falsely display the branch as inactive  
And the failure is audit logged.

## Active / Inactive Behavior Across Downstream Modules

### Scenario 49: Inactive branch remains visible in historical loan reports

Given Branch A has been deactivated  
And Branch A has historical loans  
When an authorized user generates a historical loan report including Branch A  
Then the report can include Branch A's historical data according to report permissions  
And the branch is identified as inactive where status is displayed  
And no new transaction is created by report generation.

### Scenario 50: Inactive branch is excluded from new operational selection

Given Branch A is `INACTIVE`  
When an authorized user opens a branch selector for a new customer, loan, assignment or collection transaction  
Then Branch A is not selectable for new operational work  
And active eligible branches remain available according to scope and permission.

## Audit Logging

### Scenario 51: Organization creation is audit logged

Given the user has permission to create an organization  
When the organization is created successfully  
Then an immutable audit event records the action  
And the actor and organization scope are recorded  
And sensitive configuration values are not exposed unnecessarily.

### Scenario 52: Branch edit is audit logged

Given the user has permission to edit a branch  
When the branch is successfully updated  
Then an immutable audit event records the action  
And the affected branch and organization are identifiable  
And the previous/current values are retained according to the audit policy.

### Scenario 53: Deactivation is audit logged

Given an authorized user deactivates a branch  
When the deactivation commits  
Then the system records the actor, branch, organization, time and outcome  
And the action is immutable for audit purposes.

### Scenario 54: Blocked deletion is audit logged

Given a branch has downstream references  
When deletion is attempted  
Then the deletion is blocked  
And the blocked attempt is recorded in the audit log  
And the referenced business data remains intact.

# Acceptance Criteria

- Organization management is scoped to the authorized organization context.
- Branches belong to exactly one organization.
- Organization and branch scope is enforced server-side.
- Branch Admin cannot see another branch's records without explicit cross-branch permission.
- Super Admin can access Branch Management according to the source-defined administrative flow.
- Branch Management supports Add / Edit / Delete as source-defined actions, subject to deletion safeguards.
- Company Settings exposes organization information, logo and configuration as defined by the source.
- Organization mandatory fields are validated before creation.
- Branch mandatory fields are validated before creation.
- Organization/branch identifiers are unique according to the finalized uniqueness scope.
- Inactive organizations cannot receive new applicable operational transactions.
- Inactive branches cannot receive new customer, loan, collection or other applicable operational transactions.
- Historical records remain preserved after deactivation.
- Organization deletion is blocked when downstream dependencies exist.
- Branch deletion is blocked when downstream dependencies exist.
- Deactivation is used instead of destructive deletion when downstream references exist.
- Reusable financial history is never silently rewritten because of organization/branch changes.
- Historical financial records retain their original organization and branch scope.
- Receipt numbering remains gapless per branch/agent and historical receipt numbers are never renumbered.
- Offline Field Employee transactions retain their authorized organization and branch scope during queueing and synchronization.
- Offline synchronization must revalidate organization and branch state before posting.
- Money is represented as integer paise.
- Organization/branch management creates no financial ledger entries by itself.
- Any financial correction remains subject to append-only ledger and reversal-entry rules.
- All successful actions are audit logged.
- All denied actions are audit logged.
- All blocked deletion attempts are audit logged.
- All activation/deactivation actions are audit logged.
- Organization and branch configuration does not grant permissions; authorization remains controlled by Module 3.
- Exact organization fields, branch fields and Branch Admin branch-management permissions remain Open Questions where the source does not define them.

---

# Source Traceability

- The LMS consolidated baseline identifies **Company & Branch Management** as a core system capability and describes Super Admin as having full system control and Branch Admin as the branch-level operational role. fileciteturn1file7
- The Super Admin flow explicitly shows **Company Settings — Org Info, Logo, Config** and **Branch Management — Add / Edit / Delete Branches**. fileciteturn1file10
- The Super Admin flow states that the detailed Company Settings child workflow is not expanded and that Branch Management's detailed validation/dependency/deletion behavior is not defined in the source. fileciteturn1file10
- The Branch Admin flow exposes Branch Management but explicitly marks its internal workflow and permissions as an Open Question. fileciteturn1file1
- The Field Employee flow establishes branch-relevant offline collection and synchronization behavior that must preserve scope during offline operations. fileciteturn0file5
- The finalized LMS baseline states that report access is permission-based and that report visibility must respect authorization. fileciteturn1file7

# End of Module 2
