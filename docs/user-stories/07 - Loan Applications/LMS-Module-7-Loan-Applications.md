# User Story — Loan Applications

## Epic

Loan Application & Pre-Approval Lifecycle

## Feature

Loan Application Creation, EMI Preview, Document Submission, Completeness Review and Application Submission

## User Story

As a Branch Admin or authorized loan operator
I want to create and submit a loan application for a customer
So that the application can enter the LMS credit assessment and approval lifecycle.

As an authorized loan operator
I want to select the customer, loan type, active loan scheme, interest configuration and duration
So that the application is created using approved product configuration.

As an authorized reviewer
I want incomplete applications to return for additional information or documents
So that incomplete applications do not proceed to credit assessment.

## Rules & Business Constraints

1. Loan Application is a distinct lifecycle object that begins after the customer/guarantor onboarding prerequisites are satisfied.
2. Both KYC and LOCAL customers converge into the same Loan Application lifecycle. fileciteturn8file3turn8file18
3. The source-defined application captures Amount, Purpose and Scheme. fileciteturn8file3
4. Loan Type selection supports Personal, Business, Gold and Vehicle. fileciteturn7file9
5. Interest Selection supports Flat, Reducing and Custom Rate. fileciteturn7file9
6. Duration Selection supports Daily, Weekly, Monthly, Quarterly and Yearly. fileciteturn7file9
7. The selected loan scheme must be active and available to the authorized organization/branch context.
8. The selected frequency/duration must be supported by the selected scheme.
9. Loan amount is mandatory and must be greater than zero.
10. Loan amount is always stored as integer paise. Never float.
11. Purpose is mandatory.
12. Loan type is mandatory.
13. Loan scheme is mandatory.
14. Interest configuration must be valid before submission.
15. Duration must be valid before submission.
16. EMI calculation must complete successfully before application submission. fileciteturn8file0
17. EMI due dates are DATE-only and use Asia/Kolkata.
18. The application must select a customer using an authoritative customer ID.
19. Customer search supports Name, ID and Phone. fileciteturn7file2
20. If the customer is not found, the source allows Verify & Create Customer Record before continuing. fileciteturn7file9
21. Customer creation must use Module 4 Customer Management rules; Loan Application must not create a parallel customer model.
22. Customer selection must respect organization and branch scope.
23. A Branch Admin cannot use an application request to access a customer belonging to another branch.
24. A user cannot submit an application for a customer belonging to another organization.
25. A client-supplied organization_id or branch_id cannot override server-side authorization.
26. A customer must be eligible to proceed according to the finalized customer lifecycle; the source establishes Customer Created & Active before Guarantor and Loan Application.
27. Where a guarantor is required by the applicable loan/business rule, required guarantor handling must be completed before Loan Application proceeds.
28. Local Customer status does not automatically remove the guarantor requirement. fileciteturn8file5
29. Local Customers skip standard KYC onboarding but still go through loan scheme selection, interest/duration configuration, EMI preview and Branch Admin review. fileciteturn8file17
30. If supporting documents are required for the selected loan, the application must collect them even for a LOCAL customer. fileciteturn8file17
31. Standard KYC Customer and LOCAL Customer must not use separate duplicate loan lifecycles.
32. The application must support additional information/document requests.
33. The source defines incomplete applications as returning for Request More Information and Additional Documents before continuing to Credit Assessment. fileciteturn8file3turn8file19
34. Source-defined supporting document categories for the application include ID, Income and Collateral. fileciteturn8file14
35. Application completeness must be checked before Credit Assessment.
36. Credit Assessment includes CIBIL & Income Check. fileciteturn8file3
37. Loan Application Review includes verification and assessment.
38. The application approval decision has three source outcomes: More Info, Rejected and Approved. fileciteturn7file17
39. Application Rejected and Loan Rejected are unified as `REJECTED` with a separate rejection reason. This is a finalized business rule. fileciteturn7file0
40. A rejection must record a rejection reason.
41. Rejected applications must not proceed to sanction or disbursement.
42. Approval does not directly cause disbursement.
43. Approved applications proceed to Loan Sanction Letter.
44. Customer agreement is a separate decision after sanction.
45. Customer declining the sanction results in rejection and notification/archive behavior. fileciteturn7file17
46. A signed Loan Agreement is required before disbursement. fileciteturn7file17
47. Loan Application must not create a disbursement transaction.
48. Loan Application must not mark a loan as disbursed.
49. Loan Application does not itself post a money movement.
50. If a later approval/disbursement creates a money movement, that transaction must post double-entry lines whose debit and credit amounts sum to zero.
51. Payment posting idempotency on Idempotency-Key applies to money-posting endpoints; ordinary application CRUD is not a money posting.
52. Ledger is append-only; application edits must never edit or delete posted financial entries.
53. Historical application decisions and financial records must remain auditable.
54. All application actions are audit logged.
55. Permission-denied actions are audit logged.
56. Delete is not defined as a normal submitted-application lifecycle action in the source.
57. Destructive deletion of a submitted or downstream-referenced application must be blocked.
58. If draft deletion is eventually permitted, it must be restricted to an explicit draft state and permission; this is not currently source-defined.
59. Deactivation is not defined as a canonical Loan Application state in the source.
60. The application must not invent an `INACTIVE` lifecycle state unless the final state model approves it.
61. Active/inactive behavior for applications must therefore be treated as a configuration/record-retention question, not assumed as a source-defined lifecycle.
62. Submitted application state must remain distinct from active loan state.
63. An application must not become a loan merely by being submitted.
64. An application must not become disbursable without approval, sanction/customer agreement and signed agreement.
65. Editing an application after submission must respect its current state and permissions.
66. Source-defined review supports Modify Terms — Adjust Rate / Duration. fileciteturn7file17
67. Modify Terms must not silently overwrite the original submitted terms; the final versioning/audit mechanism must preserve the change history.
68. If terms are modified, EMI calculation must be recalculated before the revised application is approved.
69. Changing a scheme configuration after an application is created must not silently change the application's captured terms.
70. Historical application terms must be reproducible.
71. An inactive/deactivated loan scheme cannot be newly selected for a new application.
72. A stale client application must revalidate scheme status, customer status and required configuration at submission.
73. Offline Field Employees do not own authoritative application configuration.
74. If offline application creation is later enabled, the server must validate the queued application against current authoritative customer, scheme and branch state.
75. A stale offline application must not bypass a deactivated scheme or changed customer authorization.
76. Conflict resolution for offline Loan Application edits is not defined by the source and remains an Open Question.
77. Application IDs must be unique.
78. Application ID format is not defined by the source; the wireframe example is `APP-000123`. fileciteturn8file0
79. Client-generated UUID/idempotency strategy for application creation is not explicitly defined in the source; do not invent it as a final requirement.
80. Application submission must be atomic: failure must not leave a falsely submitted application.
81. Document upload failure must not falsely mark required documents as uploaded.
82. EMI calculation failure must block submission.
83. A concurrent edit must not silently overwrite a committed application change.
84. A concurrent approval/rejection against an already transitioned application must be rejected according to the finalized concurrency policy.
85. An application that has already been rejected cannot be approved without an explicit reopen/reconsideration lifecycle; such a lifecycle is not source-defined.
86. An application that has already been approved cannot be rejected through an ordinary duplicate request.
87. Branch scoping must be enforced for list, view, create, edit and review.
88. Organization scoping must be enforced for every application operation.
89. Customer information displayed in the application must follow Customer Management access rules.
90. Supporting documents must be access controlled.
91. Application documents must remain linked to the application and must not be silently replaced without audit history.
92. The source does not define a final document retention period.
93. Receipt numbers are not created during application submission and must remain gapless per branch/agent only for collection transactions.
94. All records remain organization and branch scoped according to the project rule; the exact database branch ownership of application records must be consistent with the finalized tenancy model.
95. Deletion is blocked where downstream references exist.
96. Deactivation, if later introduced, must prevent new operational use without deleting history.
97. All actions are audit logged.

## Background

Given the user is logged into the system
And the user has permission to create or manage loan applications
And the user is operating within an authorized organization and branch
And the customer is available within the authorized scope
And applicable customer/guarantor prerequisites are satisfied
And an active compatible loan scheme exists

The source Branch Admin flow is:

Create Loan Application
→ Select Customer
→ Select Loan Scheme & Type
→ Set Interest Rate & Duration
→ EMI Calculation Preview
→ Upload Loan Documents
→ Loan Approved?

The review branch then supports More Info → Upload Loan Documents, Rejected → Notify Customer, and Approved → Loan Sanctioned → Disbursement → EMI Schedule Generated. fileciteturn8file4turn7file15

The P0 wireframe defines the application as a six-step flow:

1. Customer
2. Loan Details
3. Scheme & Terms
4. EMI Preview
5. Documents
6. Review & Submit fileciteturn8file10

## Feature: Loan Application Management

### Menu

Loan Management
→ Loan Applications

Actions: List, View Details, Add, Edit/Continue Draft, Review, Request More Information, Modify Terms, Approve, Reject, Delete Draft if explicitly permitted, Deactivate only if finalized as a supported lifecycle action

The screen inventory defines:

- `APP-001` Loan Application List — `/loans/applications`
- `APP-002` Loan Application Detail / Review — `/loans/applications/:id`

APP-001 supports search, status/type/date filters and View, Review, Continue, Approve/Reject according to permission. APP-002 supports Request Info, Modify Terms, Approve and Reject. fileciteturn7file1

# Loan Application — Fields

## Step 1 — Customer

Customer Search *

Search by:

- Name
- Customer ID
- Phone

Customer ID *
Customer Name
Mobile
Customer Type
Active Loans

Customer selection is mandatory before application submission.

## Step 2 — Loan Details

Loan Amount *
Purpose *
Loan Type *

Allowed Loan Types:

- Personal
- Business
- Gold
- Vehicle

## Step 3 — Scheme & Terms

Loan Scheme *
Interest Type *
Interest Rate *
Duration *
Frequency *

Allowed Interest Types:

- Flat
- Reducing
- Custom Rate

Allowed Frequencies:

- Daily
- Weekly
- Monthly
- Quarterly
- Yearly

The exact distinction between scheme-configured interest and global Interest Configuration is unresolved in the source and must not be silently assumed.

## Step 4 — EMI Preview

EMI Calculation Preview

The source requires EMI calculation to succeed before submission. The precise displayed fields are not fully defined in the available wireframe text.

At minimum, the preview represents the proposed repayment calculation before submission.

## Step 5 — Documents

Document Upload

Source-defined categories:

- ID
- Income
- Collateral

Required Documents

Document Status

The exact document-type rules by loan product are not fully defined.

## Step 6 — Review & Submit

Customer Summary
Loan Details
Scheme & Terms
EMI Preview
Documents
Validation Summary

Actions:

Back
Save Draft
Submit Application

The P0 wireframe explicitly defines Save Draft and Submit Application. fileciteturn8file0

# Table Only (Not for UI)

The available source defines screen fields and the project-level financial rules, but it does not provide a complete canonical `loan_applications` database table in the material retrieved for this module.

The application record must therefore preserve, at minimum:

```text
organization scope
branch scope
application_id
customer_id
loan_product / loan_scheme reference
loan_type
loan_amount_paise
purpose
interest_type
interest_rate_bps
duration
frequency
status
rejection_reason
created_by
updated_by
created_at
updated_at
submitted_at
```

The exact column names, constraints, indexes, version fields and foreign-key structure must be finalized against the authoritative database specification.

Money fields are integer paise.
Interest rates are integer basis points.
EMI due dates are DATE-only in Asia/Kolkata.

# Application State Rules

## Draft

The P0 wireframe explicitly supports Save Draft, but the state name `DRAFT` is an implementation-level state and is not explicitly named in the system overview. fileciteturn8file0

A draft may be incomplete and must not enter credit assessment or approval.

## Submitted / Under Review

The source uses Loan Submission followed by Admin Review — Verification & Assessment. The state-machine document maps this operationally to `SUBMITTED` and `UNDER_REVIEW`. fileciteturn8file15

## More Info

The source supports:

Request More Info
→ Additional Docs Needed
→ Document Upload
→ Admin Review

The application returns to review after the requested information/documents are supplied.

## Approved

Approval is a source-defined outcome of the review decision.

Approval is followed by Loan Sanction Letter.

Approval does not mean disbursement.

## Rejected

Rejected is the finalized unified application/loan rejection status with a separate rejection reason.

A rejected application is not eligible for ordinary continuation.

## Sanctioned

The source issues a Loan Sanction Letter after approval.

The exact persistence model for a separate `SANCTIONED` application status is not fully defined, but the business step exists.

## Agreement Pending / Agreement Signed

Customer agreement and signed Loan Agreement are separate post-approval steps before disbursement.

These steps are part of the loan lifecycle rather than ordinary application-entry fields.

# Gherkin Scenarios

## List / View

### Scenario 1: List loan applications

Given the user has permission to view loan applications
And the user is within an authorized organization and branch
When the user opens Loan Applications
Then the system displays applications within the user's authorized scope
And the list supports the source-defined search/filter context
And the action is audit logged.

The screen inventory defines Application ID, customer, amount, scheme, status and branch as list data. fileciteturn7file1

### Scenario 2: View application details

Given an application exists within the user's scope
When the user opens the application
Then the system displays customer, amount, purpose, scheme, interest, duration, documents and assessment information according to permission
And the view is audit logged.

### Scenario 3: Cross-branch application is not visible

Given Branch Admin A belongs to Branch A
And an application belongs to Branch B
When Branch Admin A opens the application list
Then the Branch B application is not returned
And a direct request for the application is denied
And the access attempt is audit logged.

### Scenario 4: Cross-organization application is denied

Given an application belongs to Organization B
And the user belongs to Organization A
When the user requests the application
Then access is denied
And no application information is returned
And the denial is audit logged.

## Add / Create

### Scenario 5: Create application for existing customer

Given an active customer exists
And the customer is within the user's authorized scope
And the user has application-create permission
When the user selects the customer
And enters valid amount, purpose, loan type, scheme, interest, duration and frequency
And EMI calculation succeeds
And required documents are supplied
When the user submits the application
Then the system creates the application
And assigns a unique Application ID
And sets the application to the submitted/review lifecycle
And records the organization and branch scope
And audit logs the submission.

### Scenario 6: Create application for customer not found

Given the user is creating a loan application
When customer search returns no matching customer
Then the system offers the source-defined Verify & Create Customer Record path
And the loan application does not use an unverified customer reference.

The source explicitly contains Customer Found? → No → Verify & Create Customer Record. fileciteturn7file9

### Scenario 7: Submit without mandatory field

Given the application form is open
When the user submits without a mandatory field
Then the system rejects submission
And the application is not moved into the submitted/review lifecycle
And the validation error is displayed.

### Scenario Outline: Mandatory field validation

Given the Loan Application form is open
When the user submits without <field>
Then the system shows "<message>"
And the application is not submitted

Examples:
| field | message |
| Customer | Customer is required |
| Loan Amount | Loan Amount is required |
| Purpose | Purpose is required |
| Loan Type | Loan Type is required |
| Loan Scheme | Loan Scheme is required |
| Interest Type | Interest Type is required |
| Interest Rate | Interest Rate is required |
| Duration | Duration is required |
| Frequency | Frequency is required |

### Scenario 8: Invalid loan amount

Given the application form is open
When the user enters a loan amount less than or equal to zero
Then the system rejects the amount
And the application cannot be submitted.

The wireframe explicitly requires amount > 0. fileciteturn8file10

### Scenario 9: Invalid loan type

Given the application form is open
When the user submits a loan type outside Personal, Business, Gold or Vehicle
Then the system rejects the request
And the application is not submitted.

### Scenario 10: Inactive scheme cannot be selected

Given a loan scheme has been deactivated
When the user creates a new loan application
Then the inactive scheme is not available for selection
And a direct request using the inactive scheme is rejected
And the rejection is audit logged.

### Scenario 11: Unsupported duration/frequency combination

Given the selected scheme does not support the selected frequency/duration
When the user attempts submission
Then the system rejects the combination
And the application remains incomplete.

### Scenario 12: EMI calculation failure blocks submission

Given all visible application fields are valid
When EMI calculation fails
Then the system does not allow application submission
And displays the calculation failure
And no submitted application is created.

The wireframe explicitly requires EMI calculation to succeed before submission. fileciteturn8file0

## Edit / Draft

### Scenario 13: Save application draft

Given the user has application-create permission
When the user selects Save Draft
Then the system stores the entered information as a draft
And does not submit the application for review
And the draft can be continued by an authorized user.

The wireframe explicitly provides Save Draft. fileciteturn8file0

### Scenario 14: Edit draft application

Given a draft application exists
And the user has permission to edit it
When the user changes valid application information
Then the system saves the updated draft
And recalculates dependent EMI information when required
And audit logs the edit.

### Scenario 15: Unauthorized edit

Given an application is outside the user's scope or the user lacks edit permission
When the user attempts to modify the application
Then the system denies the operation
And the committed application remains unchanged
And the denial is audit logged.

### Scenario 16: Modify terms during review

Given an application is under Admin Review
And the reviewer has permission to modify terms
When the reviewer adjusts rate or duration
Then the system records the modified terms
And recalculates the EMI
And preserves the change history
And the revised application must pass validation before approval.

The source explicitly shows Modify Terms — Adjust Rate / Duration. fileciteturn7file17

## Documents

### Scenario 17: Upload required loan documents

Given the application requires supporting documents
When the user uploads valid documents
Then the documents are linked to the application
And the document requirement is marked satisfied according to the configured rule
And the upload is audit logged.

### Scenario 18: Missing required documents

Given the application requires supporting documents
When the user submits without the required documents
Then the system prevents submission
And identifies the missing documents.

### Scenario 19: Document upload failure

Given a required document upload is in progress
When document storage fails
Then the document is not marked as successfully uploaded
And the application is not falsely marked complete
And the failure is audit logged.

### Scenario 20: Unauthorized document access

Given the application document belongs to another organization or branch
When an unauthorized user requests it
Then access is denied
And the document is not returned
And the denial is audit logged.

## Review / Completeness

### Scenario 21: Complete application enters review

Given the required customer, loan details, scheme, terms, EMI calculation and documents are complete
When the application is submitted
Then the application enters the review lifecycle
And the reviewer can perform verification and assessment.

### Scenario 22: Incomplete application requests more information

Given the reviewer finds missing information
When the reviewer selects Request More Info
Then the application enters the More Info path
And the required information/documents are identified
And the application can return to review after completion.

The source explicitly defines More Info → Additional Docs Needed → Document Upload → Admin Review. fileciteturn7file17

### Scenario 23: More-info submission returns to review

Given an application is waiting for more information
When the requested information/documents are supplied
Then the application returns to Admin Review
And the reviewer can reassess completeness.

### Scenario 24: Credit assessment

Given an application is complete
When the application enters Credit Assessment
Then the assessment includes CIBIL and Income Check
And the result is available to the authorized reviewer.

The source explicitly identifies Credit Assessment — CIBIL & Income Check. fileciteturn8file3

## Approval / Rejection

### Scenario 25: Approve application

Given the application is under review
And credit assessment and required verification are complete
And the user has approval permission
When the user approves the application
Then the application moves to the approved outcome
And the Loan Sanction Letter step becomes available
And the approval is audit logged.

### Scenario 26: Reject application

Given the application is under review
And the user has approval/rejection permission
When the user rejects the application with a reason
Then the application status becomes `REJECTED`
And the rejection reason is stored
And the customer notification is triggered according to the notification flow
And the rejection is audit logged.

### Scenario 27: Rejection reason is mandatory

Given the user chooses Reject
When the user submits without a rejection reason
Then the system rejects the rejection action
And the application remains under review
And no rejection notification is sent.

The finalized business rule requires a separate rejection reason. fileciteturn7file0

### Scenario 28: Wrong role attempts approval

Given the user lacks approval permission
When the user attempts to approve the application
Then the system denies the action
And the application remains unchanged
And the denial is audit logged.

### Scenario 29: Wrong role attempts rejection

Given the user lacks rejection permission
When the user attempts to reject the application
Then the system denies the action
And the application remains unchanged
And the denial is audit logged.

### Scenario 30: Approval cannot directly disburse

Given an application has been approved
When approval completes
Then the system does not mark the loan as disbursed
And the next lifecycle step is Loan Sanction Letter
And customer agreement and signed Loan Agreement remain required before disbursement.

The source explicitly separates approval, sanction, customer agreement, signed agreement and disbursement. fileciteturn7file17

## Customer Agreement Boundary

### Scenario 31: Sanction letter issued after approval

Given an application has been approved
When the sanction step is executed
Then the Loan Sanction Letter is issued to the customer
And the sanction event is audit logged.

### Scenario 32: Customer declines sanction

Given the customer has received the sanction
When the customer does not agree
Then the application/loan lifecycle enters the unified `REJECTED` outcome
And the customer is notified
And the record is archived according to the defined retention behavior.

The source explicitly shows Customer Agrees? → No → Loan Rejected → Notify & Archive. fileciteturn7file17

### Scenario 33: Customer accepts sanction

Given the customer agrees to the sanction
When the acceptance is recorded
Then the workflow proceeds to Loan Agreement
And disbursement is not allowed until the agreement is signed.

## Delete / Deactivate Safeguards

### Scenario 34: Delete submitted application is blocked

Given an application has been submitted
When a user attempts destructive deletion
Then the system blocks deletion
And preserves the application history
And records the blocked deletion attempt in the audit log.

The source does not define destructive deletion of submitted applications.

### Scenario 35: Delete application with downstream references is blocked

Given an application has credit-assessment, review, approval, sanction or other downstream references
When deletion is requested
Then deletion is blocked
And the downstream history remains intact
And the attempt is audit logged.

### Scenario 36: Draft deletion policy

Given a draft application has no downstream references
When the user attempts deletion
Then the system applies the finalized draft-deletion policy
And does not allow deletion unless the user has explicit permission and draft deletion is enabled.

The source provides Save Draft but does not define draft deletion; therefore the final outcome remains an Open Question.

### Scenario 37: Deactivation is not an implicit application state

Given the source-defined application states do not include INACTIVE
When a user attempts to deactivate an application
Then the system does not silently invent an inactive lifecycle state
And the operation is rejected unless a finalized application-deactivation rule exists.

## Active / Inactive Behavior

### Scenario 38: Inactive scheme affects new applications

Given a scheme becomes inactive
When a new application is created
Then the scheme cannot be selected
And the application cannot use it through a forged request.

### Scenario 39: Existing application retains captured terms

Given an application was created using Scheme A
When Scheme A is later changed or deactivated
Then the existing application's captured terms do not silently change
And the application remains auditable against its original configuration.

### Scenario 40: Application does not become inactive because customer becomes inactive

Given an application exists
And the customer status changes
When an application operation is attempted
Then the server evaluates the applicable customer/application lifecycle rule
And does not silently change the application status to INACTIVE because that state is not source-defined.

The exact customer-deactivation impact on pending applications is an Open Question.

## Branch / Organization Scope

### Scenario 41: Create application in authorized branch

Given the user is authorized for Branch A
And the customer belongs to Branch A
When the user creates an application
Then the application is scoped to the authoritative organization and branch
And the client cannot override the scope.

### Scenario 42: Cross-branch customer cannot be used

Given the user is authorized for Branch A
And the selected customer belongs to Branch B
When the user submits the application
Then the server rejects the customer/application association
And no application is created for Branch A using Branch B data.

### Scenario 43: Client branch override is rejected

Given the authenticated user is scoped to Branch A
When the client submits Branch B in the application request
Then the server ignores or rejects the unauthorized branch
And the application cannot be created outside the user's scope.

### Scenario 44: Cross-organization scheme/customer combination denied

Given the customer belongs to Organization A
And the selected scheme belongs to Organization B
When the user submits the application
Then the server rejects the request
And no cross-organization application is created.

## Offline / Sync

### Scenario 45: Offline cached configuration is not authoritative

Given an offline client has cached loan scheme information
When the user starts an application offline
Then the cached scheme information is treated as a snapshot
And the client cannot make authoritative configuration changes.

### Scenario 46: Stale scheme rejected at synchronization

Given an application was prepared offline using an active scheme
And the scheme was deactivated on the server before synchronization
When the application synchronizes
Then the server revalidates the scheme
And the stale application is not silently accepted using an invalid scheme
And the final conflict behavior follows the approved synchronization policy.

### Scenario 47: Offline customer scope is revalidated

Given an application was prepared using cached customer data
And the customer's branch authorization changes before synchronization
When the application synchronizes
Then the server validates current customer organization/branch authorization
And rejects an unauthorized association.

### Scenario 48: Offline conflict is not silently overwritten

Given an offline application has changes
And the same application/customer/terms have changed on the server
When synchronization occurs
Then the system detects the conflict
And does not silently overwrite committed server state
And the conflict is audit logged.

The exact offline Loan Application conflict-resolution strategy is not defined by the source and remains an Open Question.

## Failure / Concurrency

### Scenario 49: Application submission persistence failure

Given the application passes validation
When database persistence fails during submission
Then the application is not falsely marked submitted
And no partial submitted record is exposed as authoritative
And the failure is audit logged.

### Scenario 50: EMI calculation service failure

Given the application contains valid visible fields
When the EMI calculation service fails
Then submission is blocked
And the user receives a retry/error state
And no application is marked complete.

### Scenario 51: Concurrent edit

Given two authorized users edit the same application
When conflicting updates are submitted
Then the finalized concurrency strategy prevents silent loss of a committed change
And the conflict is audit logged.

### Scenario 52: Concurrent approval and rejection

Given an application is under review
When one authorized request approves it
And another authorized request rejects it concurrently
Then only one valid lifecycle transition is committed
And the second conflicting transition is rejected
And both outcomes are audit logged.

### Scenario 53: Duplicate submit

Given the user submits an application
When the client repeats the same submission because of a timeout or retry
Then the system does not create duplicate application records
And returns the existing submission/result according to the finalized application-idempotency strategy.

The source does not explicitly finalize an application Idempotency-Key requirement, so the exact mechanism remains an Open Question.

## Audit

### Scenario 54: Application creation is audit logged

Given a new application is created
When creation succeeds
Then the audit event records actor, application, customer, organization, branch, timestamp and outcome.

### Scenario 55: Application edit is audit logged

Given an authorized user edits an application
When the edit succeeds
Then the audit log records the actor and affected application
And the changed fields are retained according to the audit policy.

### Scenario 56: More-info request is audit logged

Given a reviewer requests additional information
When the request succeeds
Then the request and actor are recorded in the audit history
And the application state reflects the More Info path.

### Scenario 57: Approval is audit logged

Given an authorized reviewer approves an application
When approval succeeds
Then the approval event is immutably recorded
And the application can be traced to the approving actor.

### Scenario 58: Rejection is audit logged

Given an authorized reviewer rejects an application
When rejection succeeds
Then the rejection reason, actor and timestamp are recorded
And the rejection event cannot be silently removed.

### Scenario 59: Permission denial is audit logged

Given a user attempts an unauthorized application action
When the server denies it
Then the denial is recorded in the audit trail
And no protected application state is changed.

### Scenario 60: Historical terms remain auditable

Given application terms were modified during review
When an authorized user views the application history
Then the system can distinguish the submitted terms from later modified terms according to the finalized audit/version model.

# Acceptance Criteria

- Authorized users can list loan applications.
- Authorized users can view application details within organization/branch scope.
- Application creation supports customer selection.
- Customer search supports Name / ID / Phone.
- A missing customer follows Verify & Create Customer Record rather than creating an invalid reference.
- Loan Amount is mandatory and greater than zero.
- Loan Amount is integer paise.
- Purpose is mandatory.
- Loan Type is mandatory.
- Supported loan types are Personal, Business, Gold and Vehicle.
- Loan Scheme is mandatory.
- Only active compatible schemes can be selected for new applications.
- Interest types are Flat, Reducing and Custom Rate.
- Supported frequencies are Daily, Weekly, Monthly, Quarterly and Yearly.
- EMI calculation must succeed before submission.
- EMI due dates are DATE-only and use Asia/Kolkata.
- Required documents must be uploaded before a complete application can be submitted.
- Supporting document categories include ID, Income and Collateral.
- Save Draft is supported by the source wireframe.
- Submitted applications enter the review lifecycle.
- Incomplete applications can request more information/documents.
- Credit Assessment includes CIBIL & Income Check.
- Review supports Modify Terms — Adjust Rate / Duration.
- Modified terms require recalculation before approval.
- Rejection uses unified `REJECTED` status with a rejection reason.
- Approval does not directly disburse the loan.
- Approved applications proceed to Loan Sanction Letter.
- Customer agreement remains a separate step.
- Signed Loan Agreement is required before disbursement.
- Submitted/referenced applications cannot be destructively deleted.
- Application `INACTIVE` is not invented as a lifecycle state without explicit approval.
- Deactivated schemes cannot be used for new applications.
- Existing application terms are not silently changed by later scheme configuration changes.
- Organization scope is enforced server-side.
- Branch scope is enforced server-side.
- Client-supplied organization/branch values cannot bypass authorization.
- Offline/stale application state is revalidated at synchronization/submission.
- Application persistence failures do not create false submitted records.
- Concurrent approval/rejection cannot create an invalid final state.
- All actions are audit logged.
- Any later money movement must use integer paise and double-entry ledger lines summing to zero.
- Payment posting remains idempotent on Idempotency-Key.
- Ledger remains append-only.

# Open Questions

1. What exact application statuses are canonical?
2. Is `DRAFT` an official persisted state or only a UI concept?
3. Is `SUBMITTED` distinct from `UNDER_REVIEW`?
4. Is `MORE_INFO` a persisted state or an action/event?
5. Is `SANCTIONED` an application state or a separate loan state?
6. What exact role is the final loan approval authority?
7. Is Branch Admin always the approval authority?
8. Can Super Admin approve loans?
9. Can custom roles approve loans?
10. Is maker-checker required for approval?
11. Can the application creator approve their own application?
12. What segregation-of-duties rules apply?
13. What exact application permissions exist?
14. Who can create applications?
15. Who can edit drafts?
16. Who can edit submitted applications?
17. Who can request more information?
18. Who can modify terms?
19. Who can approve?
20. Who can reject?
21. Who can delete drafts?
22. Is application deletion ever permitted?
23. Is application deactivation required?
24. If deactivation is required, what does it mean?
25. Can a rejected application be reopened?
26. If reopening is allowed, who can reopen it?
27. Can an approved application be reverted?
28. Can a More Info application expire?
29. Is there an application expiry period?
30. Is there a maximum number of More Info cycles?
31. What exact rejection-reason values are allowed?
32. Is rejection reason free text, controlled code, or both?
33. What exact loan amount minimum/maximum applies?
34. Are amount limits scheme-specific?
35. Are amount limits branch-specific?
36. Are amount limits organization-specific?
37. The wireframe says amount must satisfy configured scheme limits; where are those limits configured?
38. What exact purpose validation applies?
39. Is purpose free text or a controlled list?
40. Can loan purpose be edited after submission?
41. Can loan type be edited after submission?
42. Can loan scheme be changed after submission?
43. Can interest type be changed during review?
44. Can interest rate be changed during review?
45. Can duration be changed during review?
46. Can frequency be changed during review?
47. Does Modify Terms require a second approval?
48. Does Modify Terms require customer acknowledgement?
49. Does Modify Terms regenerate the sanction letter?
50. Does Modify Terms invalidate an existing credit assessment?
51. What exact EMI fields are shown in the preview?
52. What exact EMI calculation formula applies to each interest type?
53. How is EMI rounding handled?
54. Where is rounding residue placed?
55. Does the EMI preview show total payable?
56. Does it show total interest?
57. Does it show installment count?
58. Does it show first/last due date?
59. Are due dates calculated in Asia/Kolkata?
60. Are due dates DATE-only in persistence?
61. What exact document types are required by loan type/scheme?
62. Are ID, Income and Collateral all mandatory for every application?
63. Which documents are optional?
64. Who decides additional-document requirements?
65. Can documents be uploaded after submission?
66. Can documents be replaced?
67. Does replacement create a new version?
68. What is the document retention period?
69. Can Field Employees upload loan documents?
70. Can customers upload loan documents directly?
71. What file size/type restrictions apply?
72. What happens if document verification fails?
73. Is document verification part of Loan Application or another module?
74. Is CIBIL an external integration?
75. What happens when CIBIL lookup fails?
76. Is CIBIL score stored?
77. What exact income fields are required for credit assessment?
78. What happens when income verification fails?
79. Can an application proceed without CIBIL?
80. Can an application proceed without income verification?
81. Is credit assessment automated, manual, or both?
82. Is credit assessment a separate module/screen?
83. Who can modify assessment results?
84. Are assessment changes audit logged immutably?
85. What exact customer eligibility rules apply before application creation?
86. Can a customer have multiple simultaneous applications?
87. Is there a maximum number of active applications per customer?
88. Can a customer apply for multiple loan schemes simultaneously?
89. Can a customer have a pending application and active loan simultaneously?
90. Are duplicate applications detected?
91. What is the duplicate-application key?
92. Is duplicate detection based on customer + scheme + active application?
93. Can Local Customers apply for every loan scheme?
94. Can Local Customers apply for every loan type?
95. Are guarantors required by scheme?
96. Must guarantor KYC/consent be completed before application creation or before review?
97. What happens if a guarantor becomes inactive while the application is under review?
98. What happens if customer KYC changes while application is under review?
99. What happens if the customer is deactivated while the application is pending?
100. Can Branch Admin move an application between branches?
101. Who can change application branch ownership?
102. Can applications be transferred between branches?
103. If transferred, what happens to branch audit history?
104. Are loan schemes organization-wide or branch-specific?
105. How is branch scope represented in the application database?
106. What exact `branch_id` behavior applies to applications?
107. Is the application ID generated server-side?
108. Is a client-generated UUID required for offline application creation?
109. Is `Idempotency-Key` required for application submission?
110. What exact duplicate-submission strategy is required?
111. Can applications be created offline?
112. Can drafts be created offline?
113. Can complete applications be submitted offline?
114. What happens when an offline application references a deactivated scheme?
115. What happens when the customer changes branch while offline?
116. What happens when the customer becomes inactive while offline?
117. What happens when application terms change on the server while the device is offline?
118. What conflict resolution strategy applies?
119. Is optimistic locking required?
120. What version field is used for application concurrency?
121. What happens when approval and rejection requests race?
122. What happens when edit and approval requests race?
123. What happens when More Info and approval requests race?
124. Can a draft be physically deleted?
125. If yes, what audit record remains?
126. What retention period applies to rejected applications?
127. What retention period applies to drafts?
128. Should rejected applications remain searchable?
129. Should inactive/archived applications remain searchable?
130. What notification channels are mandatory for application rejection?
131. What notification is sent for More Info?
132. What notification is sent for approval?
133. Does the customer receive the sanction letter through SMS, app, email, or document delivery?
134. What exact audit fields are required for application actions?
135. Is application history immutable?
136. Can audit history be exported?
137. Who can export application data?
138. What PII masking is required on application lists?
139. Can Branch Admin see all branch applications?
140. Can Super Admin see all organization applications?
141. Can Field Employees view applications?
142. Can Field Employees create applications?
143. Can customers view their own applications?
144. Can customers withdraw an application?
145. If customer withdrawal is supported, what status should it use?
146. Can an application be cancelled before review?
147. If cancellation is supported, who can perform it?
148. Does cancellation use `REJECTED`, a separate `CANCELLED` status, or another lifecycle?
149. Can an application be automatically expired?
150. Does an application need an SLA timer for review?
151. What happens if an application remains under review too long?
152. Is application priority supported?
153. Is application assignment to a reviewer supported?
154. Is Branch Admin Review always manual?
155. Does credit assessment happen before or during Admin Review?
156. Does Modify Terms happen before or after Credit Assessment?
157. Does approval require all documents verified or merely uploaded?
158. Does approval require guarantor KYC/consent?
159. Does approval require customer mobile verification?
160. What exact conditions define Application Complete?
161. What exact conditions define Credit Assessment Complete?
162. What exact conditions define Approval Eligible?
163. What exact conditions define Disbursement Eligible?
164. What exact data is copied from application to loan at approval/disbursement?
165. Which application fields become immutable after approval?
166. Is the approved amount allowed to differ from requested amount?
167. If approved amount differs, how is the difference recorded?
168. Does changing approved amount require customer consent?
169. Does changing rate/duration after approval require a new sanction?
170. Does customer acceptance bind the approved terms exactly?
171. Is signed agreement generated automatically after acceptance?
172. Is the agreement document part of Module 7 or a later module?
173. How is sanction-letter generation handled?
174. Is sanction-letter generation part of approval workflow or agreement workflow?
175. What happens if sanction-letter generation fails?
176. What happens if customer notification fails after rejection?
177. Does notification failure change application status?
178. What happens if document storage succeeds but application submission fails?
179. What happens if application submission succeeds but notification fails?
180. What happens if EMI calculation succeeds but configuration changes before submission?
181. Must EMI be recalculated immediately before final submission?
182. What exact configuration version is captured with the application?
183. How is global Interest Configuration resolved against scheme-level interest?
184. Can the application override scheme interest?
185. Who can override scheme interest?
186. Are custom rates allowed for every scheme?
187. What custom-rate validation applies?
188. What rate precision is allowed?
189. What duration precision is allowed?
190. Are all frequencies integer durations?
191. Can duration be changed from months to weeks during review?
192. How are existing customer loans considered during application review?
193. Is prior repayment history shown?
194. Is overdue history shown?
195. Is customer outstanding balance shown?
196. Are active loans shown on the application screen?
197. Does credit assessment use existing-loan exposure?
198. Is debt-to-income calculated?
199. What other assessment fields are required?
200. What is the final canonical application state machine?

# Source Traceability

- The System Overview defines Loan Application as Amount / Purpose / Scheme → Loan Type → Interest → Duration → Customer Search → Loan Submission → Application Complete → Credit Assessment → Admin Review → Loan Approved? → Sanction/Agreement lifecycle. fileciteturn7file9
- The customer journey confirms that both KYC and LOCAL customers converge into Loan Application, and that incomplete applications can request more information/documents before Credit Assessment. fileciteturn8file3turn8file17
- The P0 wireframe defines the six-step Loan Application screen: Customer, Loan Details, Scheme & Terms, EMI Preview, Documents, Review & Submit. It explicitly defines Save Draft, Submit Application, submit validation, incomplete state, success state and error state. fileciteturn8file10
- The Branch Admin flow defines Create Loan Application → Select Customer → Select Loan Scheme & Type → Set Interest Rate & Duration → EMI Calculation Preview → Upload Loan Documents → Loan Approved?, with More Info looping back through document upload. fileciteturn8file4
- The screen inventory defines APP-001 Loan Application List and APP-002 Loan Application Detail / Review, including their routes, roles, data and primary actions. fileciteturn7file1
- The Loan Lifecycle source defines Admin Review, More Info, Modify Terms, rejection, approval, sanction, customer agreement and signed Loan Agreement before disbursement. fileciteturn7file17
- The finalized business rules unify Application Rejected and Loan Rejected as `REJECTED` with a rejection reason. fileciteturn7file0
- The source explicitly states that Local Customers still undergo loan scheme selection, interest/duration configuration, EMI preview and Branch Admin review, and do not bypass approval, agreement, disbursement or repayment. fileciteturn8file5
- The source does not fully define application database schema, draft deletion, application deactivation, offline application conflict resolution, final approval authority, exact credit-assessment fields, or the global-vs-scheme interest precedence. These are intentionally listed as Open Questions rather than invented requirements.

# End of Module 7
