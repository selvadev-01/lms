# User Story — Guarantors

## Epic

Customer & Loan Guarantor Management

## Feature

Guarantor Registration, KYC, Consent & Customer/Loan Association

## User Story

As a Branch Admin
I want to add and manage guarantors for a customer
So that applicable loan/business requirements can be satisfied before the loan application proceeds.

As a Branch Admin
I want to capture guarantor KYC and consent
So that the guarantor relationship is documented and auditable.

As an authorized LMS user
I want to view guarantor information within my organization and branch scope
So that guarantor data is protected and available only to users who need it.

## Rules & Business Constraints

1. A guarantor is an explicit business entity/relationship and must not be represented merely as free-text inside a loan application.
2. A guarantor is associated with the applicable customer and, where the final model requires it, with the applicable loan/application relationship.
3. Guarantor requirement is determined by the applicable loan/business rule.
4. Guarantor requirement remains configurable for Local Customers; skipping standard customer KYC does not automatically remove the guarantor requirement. fileciteturn4file1
5. The source customer journey places Guarantor Added followed by Guarantor KYC & Consent before Loan Application. fileciteturn4file8
6. A guarantor cannot be added outside the authorized organization scope.
7. A branch-scoped user cannot access a guarantor belonging to another branch unless explicitly authorized.
8. The guarantor's customer association must use an authoritative customer ID.
9. Client-supplied organization_id or branch_id must never override authenticated authorization scope.
10. A guarantor record must not silently change customer ownership when the customer changes branch.
11. Guarantor information is protected personal information and must be access controlled.
12. Guarantor mobile number is mandatory when the guarantor flow requires mobile identification, as defined by the approved form.
13. Guarantor address is mandatory according to the current wireframe when a guarantor is required. fileciteturn4file17
14. Guarantor name is mandatory when Guarantor Required = Yes. fileciteturn4file17
15. Relationship is captured when the guarantor flow requires it; the source does not define an exhaustive relationship-value list. fileciteturn4file17
16. Consent is mandatory when consent is part of the guarantor flow. fileciteturn4file17
17. Guarantor KYC documents are required when guarantor KYC is applicable. fileciteturn4file17
18. Guarantor KYC is separate from the customer's KYC record.
19. Uploading a guarantor document does not itself mean the document is verified.
20. Guarantor KYC/verification status must be explicit.
21. Consent status must be explicit.
22. Consent must not be inferred from merely creating the guarantor record.
23. The actor and time of consent must be retained where the consent mechanism supports those values.
24. A guarantor cannot be treated as consented when the required consent action failed.
25. A guarantor with incomplete required KYC cannot be treated as fully verified.
26. A loan/application requiring a guarantor must not proceed past the applicable guarantor gate unless the required guarantor conditions are satisfied.
27. If a loan/business rule says a guarantor is not required, the system must not force a guarantor solely because the customer is Local.
28. The guarantor flow must converge into the common Loan Application lifecycle after the applicable requirements are satisfied. fileciteturn4file5
29. Guarantor management must not bypass loan credit assessment, Branch Admin review, approval, agreement, disbursement or repayment controls.
30. A guarantor is not the borrower and must not receive the customer's loan identity or account status.
31. Guarantor edits must not rewrite historical loan/financial records.
32. Replacing a guarantor must preserve an auditable history of the previous relationship when the relationship has already been used by an application/loan.
33. Deleting a guarantor is blocked when the guarantor is referenced by an active or historical loan/application requiring retention.
34. When deletion is blocked, deactivation or removal-from-future-use must be used instead if the finalized lifecycle supports it.
35. Deactivation must not delete historical guarantor references.
36. An inactive guarantor must not be selected for a new guarantor requirement.
37. Existing historical loan records continue to show the guarantor relationship according to retention rules.
38. If a guarantor is already attached to an active loan, removing the guarantor from the customer master must not silently remove the guarantor from the historical loan.
39. A guarantor may potentially guarantee more than one customer/loan, but this is not explicitly defined by the source and remains an Open Question.
40. Any limit on the number of guarantors per customer/loan must be controlled by business rule.
41. Any requirement for one or multiple guarantors must be explicit and deterministic.
42. A duplicate guarantor should be detected according to the finalized identity/duplicate policy.
43. Duplicate detection must not create a second guarantor merely because the same person is used for another permitted customer/loan relationship.
44. The exact duplicate key is not defined by the source and remains an Open Question.
45. Guarantor data is organization and branch scoped.
46. If a guarantor is shared across permitted relationships, each relationship must retain its own organization/branch authorization context.
47. Cross-organization guarantor association is prohibited unless explicitly supported by the final tenancy model.
48. A user cannot retrieve guarantor data using a direct identifier to bypass organization/branch authorization.
49. All guarantor CRUD/state/consent/KYC actions are audit logged.
50. Permission-denied guarantor actions are audit logged.
51. Deletion-blocked attempts are audit logged.
52. Guarantor KYC verification/rejection/revision actions are audit logged.
53. Consent capture/revocation, where revocation is supported, is audit logged.
54. Financial money movement is not created by guarantor CRUD itself.
55. If a guarantor action triggers no payment/disbursement, no debit/credit ledger lines are posted merely for the guarantor action.
56. Any later loan disbursal or payment remains subject to the financial module's double-entry rules.
57. Money throughout the LMS is integer paise; no guarantor monetary value may be stored as float.
58. Payment posting idempotency does not apply to ordinary guarantor CRUD; any later money-posting endpoint remains idempotent on Idempotency-Key.
59. Ledger entries remain append-only; guarantor changes must never edit or delete posted ledger entries.
60. Receipt numbers are unrelated to guarantor CRUD and must remain gapless per branch/agent for collection transactions.
61. Offline Field Employee cached customer data must not be treated as authoritative guarantor state.
62. If offline guarantor functionality is eventually supported, synchronization must revalidate customer/branch authorization and current guarantor state.
63. A stale offline guarantor update must not overwrite a newer server state without the finalized conflict strategy.
64. A persistence failure must not leave a half-created guarantor relation.
65. A KYC document upload failure must not mark the guarantor document as verified.
66. A consent capture failure must not mark consent as completed.
67. Concurrent guarantor edits must not silently lose a committed update.
68. Customer deactivation does not delete guarantor history.
69. Branch deactivation does not delete guarantor history.
70. Organization deactivation does not delete guarantor history.
71. Inactive organization/branch must prevent creation of new guarantor relationships for new operational transactions.
72. Historical guarantor relationships remain available to authorized reporting/audit functions after deactivation.
73. The exact guarantor role in credit assessment is not defined by the source; guarantor presence must not be treated as an automatic approval signal.
74. Guarantor consent is not equivalent to loan approval.
75. Guarantor KYC is not equivalent to borrower KYC.
76. Guarantor approval, if separately required, must be modeled explicitly rather than inferred.
77. The system must distinguish a guarantor's current status from a historical guarantor relationship.
78. All guarantor actions must respect the permission model from Module 3.
79. Deletion is blocked where referenced downstream; deactivation/removal-from-future-use is preferred.
80. Every action is audit logged.

## Background

Given the user is logged into the system
And the user has permission to manage guarantors
And the user is operating within an authorized organization and branch
And the applicable customer exists
And the applicable loan/business rule has determined whether a guarantor is required

The customer journey places Guarantor Added and Guarantor KYC & Consent after successful KYC handling and before Loan Application. For Local Customers, guarantor requirement remains configurable and is not automatically removed by the KYC bypass. fileciteturn4file8turn4file1

The wireframe defines a Guarantor section with:

- Guarantor Required? — Yes / No
- Guarantor Name *
- Mobile *
- Address *
- Relationship
- Consent
- KYC Documents
- Add Guarantor

It also defines conditional validation for name, mobile, address, consent and KYC documents. fileciteturn4file17

## Feature: Guarantor Management

### Menu

Customer Management
→ Customer Detail
→ Guarantors

Customer Management
→ Create / Edit Customer
→ Guarantor

Loan Application
→ Guarantor Requirement
→ Add / Select Guarantor

Actions: List, View Details, Add, Edit, Delete, Deactivate, Select for Application/Loan, Capture Consent, Upload KYC, Verify KYC, Request Revision

**Source note:** The source directly establishes Add Guarantor and Guarantor KYC & Consent, while the standalone Guarantor list/detail screens and exact CRUD menu actions are derived for implementation completeness. The screen inventory lists GUA-001 Guarantor List / Selection and GUA-002 Guarantor Detail / KYC. fileciteturn4file3

# Guarantor — Fields

## Guarantor Requirement

Guarantor Required? *
Yes
No

**Rule:** This decision is controlled by the applicable loan/business rule. It must not be inferred solely from customer type.

## Guarantor Identity

Guarantor Name *
Mobile *
Address *
Relationship

## Consent

Consent *
Consent Status
Consent Timestamp
Consent Captured By

## KYC

KYC Documents
KYC Status
Verification Reason
Verified By
Verified At

The exact KYC fields beyond the wireframe are implementation details and must be confirmed.

## Relationship

Relationship

The source includes Relationship but does not define allowed values. Do not hard-code an invented relationship enumeration until the business owner confirms it. fileciteturn4file17

# Table Only (Not for UI)

| Internal Field        | Allowed Values / Storage                                                               |
| --------------------- | -------------------------------------------------------------------------------------- |
| `guarantor_id`        | Unique guarantor identifier                                                            |
| `organization_id`     | Authoritative organization scope                                                       |
| `branch_id`           | Authoritative branch scope                                                             |
| `customer_id`         | Required borrower/customer reference                                                   |
| `loan_application_id` | Nullable until associated with an application                                          |
| `loan_id`             | Nullable until associated with a loan                                                  |
| `name`                | Required guarantor name                                                                |
| `mobile`              | Required mobile according to current wireframe                                         |
| `address`             | Required according to current wireframe                                                |
| `relationship_code`   | Controlled value once finalized; nullable if not required                              |
| `status`              | Proposed: `ACTIVE`, `INACTIVE`                                                         |
| `consent_status`      | Proposed: `PENDING`, `CONSENTED`, `NOT_REQUIRED`, `REVOKED` if revocation is supported |
| `consent_captured_at` | Nullable timestamp                                                                     |
| `consent_captured_by` | Actor identifier                                                                       |
| `kyc_status`          | Proposed: `NOT_REQUIRED`, `PENDING`, `APPROVED`, `REVISION_REQUIRED`, `REJECTED`       |
| `created_at`          | Creation timestamp                                                                     |
| `updated_at`          | Last update timestamp                                                                  |
| `deactivated_at`      | Nullable                                                                               |
| `deactivation_reason` | Nullable                                                                               |
| `created_by`          | Actor identifier                                                                       |
| `updated_by`          | Actor identifier                                                                       |

# Guarantor State Rules

## Active

An active guarantor can be selected for new applicable guarantor relationships when all required conditions are satisfied.

## Inactive

An inactive guarantor cannot be selected for a new guarantor relationship.

Historical relationships remain intact.

## KYC Pending

The guarantor has been added but applicable KYC verification is incomplete.

## KYC Revision Required

The guarantor's KYC requires correction/resubmission.

## KYC Approved

Applicable guarantor KYC has been verified.

## Consent Pending

The guarantor exists but required consent has not been successfully captured.

## Consent Completed

Required consent has been captured and recorded.

The exact canonical state enumeration is not fully defined by the source. The states above are implementation candidates based on the wireframe's status/validation model and must be finalized.

# Gherkin Scenarios

## List / View

### Scenario 1: Authorized user lists guarantors

Given the user has permission to view guarantors
And the user is authorized for the customer's organization and branch
When the user opens the customer guarantor list
Then the system displays guarantors within the authorized scope
And inactive guarantors are clearly identified
And the access is audit logged.

### Scenario 2: Authorized user views guarantor details

Given a guarantor exists
And the user has permission to view guarantor details
When the user opens the guarantor
Then the system displays permitted guarantor information
And the customer relationship is displayed
And applicable consent and KYC status are displayed
And the view is audit logged.

### Scenario 3: Unauthorized user cannot view guarantor

Given the user does not have guarantor-view permission
When the user requests guarantor details
Then the system denies access
And no protected guarantor information is returned
And the denial is audit logged.

### Scenario 4: Branch Admin cannot view another branch's guarantor

Given Branch Admin A belongs to Branch A
And the guarantor belongs to a customer in Branch B
When Branch Admin A requests the guarantor
Then the system denies access
And Branch B data is not returned
And the denial is audit logged.

### Scenario 5: Direct guarantor ID cannot bypass scope

Given the user is authorized only for Organization A
And the guarantor belongs to Organization B
When the user requests the guarantor using its direct ID
Then the system denies access
And no guarantor data is returned
And the scope violation is audit logged.

## Add

### Scenario 6: Add guarantor when required

Given an active customer exists
And the applicable loan/business rule requires a guarantor
And the user has guarantor-create permission
When the user enters valid guarantor information
And submits Add Guarantor
Then the system creates the guarantor relationship
And associates it with the customer
And stores the organization and branch scope
And the creation is audit logged.

### Scenario 7: Guarantor is not added when not required

Given the applicable loan/business rule says a guarantor is not required
When the user continues without a guarantor
Then the system does not require a guarantor
And the loan/application can continue to the next permitted stage
And no incomplete guarantor record is created.

### Scenario 8: Add guarantor to Local Customer

Given the customer type is LOCAL
And the applicable business rule requires a guarantor
When the user adds a guarantor
Then the system requires guarantor handling
And the Local Customer's skipped borrower KYC does not remove the guarantor requirement.

This follows the explicit Local Customer rule that guarantor requirement remains configurable. fileciteturn4file1

### Scenario 9: Guarantor mandatory field validation

Given Guarantor Required is Yes
When the user submits without a required guarantor field
Then the system rejects the submission
And the guarantor is not created
And the validation failure is audit logged.

### Scenario Outline: Guarantor mandatory field validation

Given Guarantor Required is Yes
When the user submits without <field>
Then the system shows "<message>"
And the guarantor is not created

Examples:
| field | message |
| Guarantor Name | Guarantor Name is required |
| Mobile | Mobile is required |
| Address | Address is required |
| Consent | Consent is required when consent is part of the flow |

The wireframe explicitly defines these conditional validation rules. fileciteturn4file17

### Scenario 10: Duplicate guarantor detection

Given a guarantor with the same configured identity attributes already exists
When the user attempts to add the same person again
Then the system applies the configured duplicate-detection rule
And does not silently create an invalid duplicate
And the result is audit logged.

The exact duplicate key is an Open Question.

## Edit

### Scenario 11: Edit guarantor details

Given an active guarantor exists
And the user has guarantor-edit permission
When the user edits an allowed guarantor field
Then the system validates the new value
And saves the update
And records the edit in the audit log.

### Scenario 12: Unauthorized guarantor edit

Given the user lacks guarantor-edit permission
When the user submits a guarantor update
Then the system denies the operation
And the guarantor remains unchanged
And the denial is audit logged.

### Scenario 13: Edit does not rewrite historical loan relationship

Given the guarantor is already referenced by an active or historical loan
When an allowed guarantor profile field is edited
Then the historical loan relationship remains intact
And the financial history is not rewritten
And the edit is audit logged.

### Scenario 14: Guarantor customer scope cannot be changed by client input

Given the guarantor belongs to Customer A
When the client submits Customer B as the target customer
Then the server does not use the unauthorized client-supplied relationship
And the guarantor relationship remains under the authoritative customer scope
And the attempted manipulation is audit logged.

## Consent

### Scenario 15: Capture guarantor consent

Given the guarantor is required
And consent is part of the applicable flow
When the guarantor provides valid consent
Then the system records consent
And records the applicable consent timestamp
And records the actor/mechanism where supported
And the action is audit logged.

### Scenario 16: Consent capture fails

Given consent is required
When the consent operation fails
Then the guarantor is not marked as consented
And the loan/application cannot bypass a consent-required gate
And the failure is audit logged.

### Scenario 17: Missing consent blocks required flow

Given consent is required
And guarantor consent has not been captured
When the user attempts to proceed through a guarantor-required gate
Then the system blocks progression
And identifies that consent is pending.

### Scenario 18: Consent is not inferred from record creation

Given a guarantor record has been created
And no consent has been captured
When the system evaluates the guarantor
Then consent remains pending
And the guarantor is not treated as consented merely because the record exists.

### Scenario 19: Unauthorized consent action is denied

Given the user lacks permission to capture/verify guarantor consent
When the user attempts to mark consent complete
Then the system denies the action
And consent remains unchanged
And the denial is audit logged.

## Guarantor KYC

### Scenario 20: Upload guarantor KYC

Given guarantor KYC is applicable
When the user uploads the required KYC documents
Then the documents are stored against the guarantor
And the KYC state remains pending until verification
And the upload is audit logged.

The source explicitly places Guarantor KYC & Consent before Loan Application. fileciteturn4file8

### Scenario 21: Missing guarantor KYC blocks applicable verification

Given guarantor KYC is applicable
When required KYC information is missing
Then the guarantor cannot be marked KYC approved
And the missing requirements are displayed
And the failure is audit logged.

### Scenario 22: Guarantor KYC is separate from customer KYC

Given the borrower has an approved KYC record
When guarantor KYC is processed
Then the guarantor's KYC status is maintained separately
And borrower KYC approval does not automatically approve guarantor KYC.

### Scenario 23: Request guarantor KYC revision

Given guarantor KYC is invalid or incomplete
When an authorized reviewer requests revision
Then the guarantor KYC enters revision-required state
And the reason is retained
And the guarantor can resubmit.

### Scenario 24: Approve guarantor KYC

Given guarantor KYC requirements are complete
And the user has guarantor-KYC approval permission
When the user approves the KYC
Then guarantor KYC becomes approved
And the approval is audit logged.

### Scenario 25: Unauthorized guarantor KYC approval

Given the user lacks guarantor-KYC approval permission
When the user attempts approval
Then the operation is denied
And the guarantor KYC state remains unchanged
And the denial is audit logged.

## Active / Inactive

### Scenario 26: Active guarantor can be selected

Given the guarantor is active
And applicable consent/KYC requirements are satisfied
When an authorized user selects the guarantor for a permitted application
Then the guarantor can be selected
And the relationship is recorded.

### Scenario 27: Inactive guarantor cannot be selected

Given the guarantor is inactive
When the user attempts to select the guarantor for a new application
Then the system blocks the selection
And no new relationship is created
And the blocked action is audit logged.

### Scenario 28: Deactivate guarantor

Given an active guarantor exists
And the user has deactivation permission
When the user deactivates the guarantor
Then the guarantor becomes inactive
And the guarantor cannot be selected for new applicable relationships
And historical relationships remain intact
And the deactivation is audit logged.

### Scenario 29: Unauthorized deactivation

Given the user lacks guarantor-deactivate permission
When the user attempts deactivation
Then the operation is denied
And the guarantor remains active
And the denial is audit logged.

### Scenario 30: Deactivated guarantor history remains visible

Given a guarantor has historical loan relationships
And the guarantor is inactive
When an authorized user views historical loan information
Then the historical guarantor relationship remains available
And the system does not delete historical guarantor data.

## Delete Safeguards

### Scenario 31: Delete unreferenced guarantor

Given a guarantor has no downstream application/loan references
And the finalized policy permits physical deletion
And the user has delete permission
When the user deletes the guarantor
Then the system deletes it according to the approved policy
And the deletion is audit logged.

### Scenario 32: Delete referenced guarantor is blocked

Given a guarantor is referenced by an active or historical loan/application
When the user attempts to delete the guarantor
Then the system blocks deletion
And the existing relationship remains intact
And the user is directed to deactivate/remove from future use if supported
And the blocked deletion is audit logged.

### Scenario 33: Delete guarantor with financial history cannot delete financial records

Given a guarantor is associated with a loan that has financial transactions
When the user attempts to delete the guarantor
Then the system does not delete the loan
And does not delete payments, receipts or ledger history
And the deletion is blocked or converted to a non-destructive action.

## Branch / Organization Scope

### Scenario 34: Create guarantor only in active authorized branch

Given the user is authorized for Branch A
And Branch A is active
And the customer belongs to Branch A
When the user creates a guarantor
Then the guarantor is created under Organization A and Branch A
And the scope is derived server-side.

### Scenario 35: Cannot create guarantor in inactive branch

Given Branch A is inactive
When the user attempts to create a new guarantor relationship for a new operational application in Branch A
Then the system rejects the operation
And no new guarantor relationship is committed
And the failure is audit logged.

### Scenario 36: Cross-organization guarantor association denied

Given the customer belongs to Organization A
And the user attempts to associate a guarantor under Organization B
When the request is submitted
Then the system denies the association
And no cross-organization relationship is created
And the denial is audit logged.

### Scenario 37: Branch Admin cannot view another branch's guarantor

Given Branch Admin A belongs to Branch A
And the guarantor relationship belongs to Branch B
When Branch Admin A requests the guarantor
Then access is denied
And no protected data is returned.

## Permission Denial

### Scenario 38: Wrong role attempts Add Guarantor

Given the user does not have guarantor-create permission
When the user submits Add Guarantor
Then the system denies the operation
And no guarantor is created
And the denial is audit logged.

### Scenario 39: Wrong role attempts Edit Guarantor

Given the user does not have guarantor-edit permission
When the user edits the guarantor
Then the system denies the operation
And no data is changed
And the denial is audit logged.

### Scenario 40: Wrong role attempts Delete Guarantor

Given the user does not have guarantor-delete permission
When the user deletes a guarantor
Then the system denies the operation
And the guarantor remains unchanged
And the denial is audit logged.

## Loan/Application Gate

### Scenario 41: Required guarantor gate blocks incomplete guarantor

Given the loan/business rule requires a guarantor
And the guarantor record exists
But required KYC or consent is incomplete
When the user attempts to continue to Loan Application
Then the system blocks progression
And identifies the incomplete guarantor requirement.

### Scenario 42: Completed guarantor gate permits Loan Application

Given the loan/business rule requires a guarantor
And required guarantor details are complete
And applicable KYC is approved
And required consent is complete
When the user continues
Then the system permits progression to Loan Application
And the guarantor relationship is available to the application.

### Scenario 43: No-guarantor rule permits Loan Application

Given the loan/business rule says a guarantor is not required
When the customer onboarding reaches the guarantor decision
Then the system allows continuation without a guarantor
And the user is not forced to create an unnecessary guarantor.

## Failure / Concurrency

### Scenario 44: Guarantor persistence failure

Given all guarantor validation passes
When database persistence fails
Then the guarantor relationship is not partially created
And no incomplete guarantor is presented as active
And the failure is audit logged.

### Scenario 45: KYC upload failure

Given a guarantor KYC document upload is in progress
When storage fails
Then the document is not marked uploaded/verified
And the guarantor KYC state remains unchanged
And the failure is audit logged.

### Scenario 46: Concurrent guarantor edits

Given two authorized users edit the same guarantor
When their updates conflict
Then the system applies the finalized concurrency policy
And does not silently overwrite a committed change
And the conflict is audit logged.

### Scenario 47: Concurrent delete and loan association

Given a guarantor is being deleted
And another transaction associates the guarantor with a loan
When the operations conflict
Then the system prevents deletion if the downstream reference commits
And the historical relationship remains intact
And the conflict is audit logged.

## Offline / Synchronization

### Scenario 48: Offline cached guarantor data is read-only unless supported

Given Field Employee is offline
And guarantor information is cached
When the Field Employee views the cached guarantor
Then the system identifies the data as cached
And does not treat it as authoritative server state.

The current Field Employee source explicitly defines cached customer data but does not explicitly define offline guarantor editing. fileciteturn4file17

### Scenario 49: Offline guarantor update cannot bypass scope

Given offline guarantor editing is enabled by a future finalized requirement
And the cached guarantor belongs to Branch A
When the client attempts to synchronize it to Branch B
Then the server rejects the unauthorized scope
And no cross-branch relationship is committed
And the conflict is audit logged.

### Scenario 50: Stale guarantor state is detected

Given a guarantor changes on the server while a device is offline
When the device synchronizes a stale update
Then the server validates the current authoritative guarantor state
And the finalized conflict strategy determines whether the update is rejected, merged or requires review
And the conflict is audit logged.

## Audit Logging

### Scenario 51: Guarantor creation is audit logged

Given an authorized user creates a guarantor
When creation succeeds
Then the audit record contains actor, customer, organization, branch, guarantor and outcome
And no sensitive credential data is recorded.

### Scenario 52: Guarantor edit is audit logged

Given an authorized user edits a guarantor
When the update succeeds
Then the audit record identifies the affected guarantor and actor
And previous/current values are retained according to audit policy.

### Scenario 53: Consent is audit logged

Given consent is captured
When the consent succeeds
Then the system records the consent event
And the actor/mechanism and timestamp are retained where supported.

### Scenario 54: KYC decision is audit logged

Given an authorized reviewer approves or requests revision of guarantor KYC
When the decision commits
Then the system records the decision, reason where applicable, actor and timestamp.

### Scenario 55: Deletion block is audit logged

Given the guarantor has downstream references
When deletion is attempted
Then the deletion is blocked
And the blocked attempt is recorded in the audit log.

# Acceptance Criteria

- Guarantor requirement is controlled by the applicable loan/business rule.
- Local Customer status does not automatically remove guarantor requirements.
- Guarantor Name is mandatory when guarantor is required.
- Guarantor Mobile is mandatory when guarantor is required.
- Guarantor Address is mandatory when guarantor is required.
- Relationship is captured where applicable.
- Consent is captured where required.
- Guarantor KYC is captured where applicable.
- Guarantor KYC is separate from borrower/customer KYC.
- Guarantor consent is not inferred from record creation.
- A required guarantor gate blocks progression when mandatory information, KYC or consent is incomplete.
- A completed guarantor requirement permits progression to Loan Application.
- A non-required guarantor does not block Loan Application.
- Guarantor records are organization and branch scoped.
- Branch Admin cannot access another branch's guarantors.
- Cross-organization guarantor association is denied.
- Client-supplied scope cannot override server authorization.
- Active guarantors can be selected where all applicable requirements are satisfied.
- Inactive guarantors cannot be selected for new relationships.
- Deactivation preserves historical guarantor relationships.
- Deletion is blocked when downstream application/loan references exist.
- Customer, loan, payment, receipt and ledger history is never deleted by guarantor deletion.
- All guarantor actions are permission controlled.
- Add/Edit/Delete/Deactivate denial is audit logged.
- KYC upload/approval/revision is audit logged.
- Consent capture is audit logged.
- Offline cached guarantor data is not treated as authoritative server state.
- Offline synchronization must enforce organization and branch scope.
- Persistence/storage failures do not create false active/verified/consented states.
- Concurrent changes cannot silently lose committed guarantor data.
- Money is integer paise across the LMS; guarantor CRUD itself does not create money movements.
- Any financial transaction triggered later by a loan/disbursement/collection follows the double-entry and idempotency rules.
- Ledger corrections remain append-only reversal entries.
- All actions are audit logged.

# Open Questions

1. Can one guarantor guarantee multiple customers?
2. Can one guarantor guarantee multiple active loans?
3. Is guarantor uniqueness global, organization-scoped or branch-scoped?
4. What exact fields identify a duplicate guarantor?
5. Is guarantor mobile unique?
6. Is guarantor address mandatory in every flow or only when Guarantor Required = Yes?
7. What exact relationship values are allowed?
8. Is relationship mandatory?
9. Is guarantor photo required?
10. What exact KYC documents are required for guarantors?
11. Is guarantor KYC always required or loan/product dependent?
12. Who verifies guarantor KYC?
13. Is Branch Admin the guarantor KYC authority, or does a different role approve it?
14. Is maker-checker required for guarantor KYC?
15. What exact consent mechanism is required?
16. Is consent electronic, OTP-based, signed document, checkbox, or another mechanism?
17. Can consent be revoked?
18. What happens to a loan if guarantor consent is revoked after loan activation?
19. Can a guarantor be replaced after loan approval?
20. Can a guarantor be removed after disbursement?
21. Can a guarantor be added after disbursement?
22. If replacement is allowed, who can approve it?
23. Is a new guarantor required to complete KYC before replacement is effective?
24. Is a guarantor required for all loans or only selected schemes?
25. Can a loan require multiple guarantors?
26. Is there a maximum guarantor count?
27. Can a Local Customer have zero guarantors?
28. Can a KYC Customer have zero guarantors?
29. Does guarantor requirement depend on loan amount?
30. Does guarantor requirement depend on customer type?
31. Does guarantor requirement depend on customer risk/CIBIL?
32. Does guarantor requirement depend on loan product?
33. Does guarantor presence affect credit scoring?
34. Does guarantor KYC affect credit assessment?
35. What is the guarantor's legal/business obligation in the LMS?
36. Is guarantor liability stored?
37. Is any guarantor financial exposure stored?
38. If guarantor liability amount is stored, must it be integer paise?
39. Can guarantor data be edited after the loan is active?
40. Which guarantor fields are editable after approval?
41. Which edits require re-consent?
42. Which edits require re-KYC?
43. Can guarantor mobile changes require verification?
44. Can guarantor address changes require re-KYC?
45. Can a guarantor belong to a different branch from the borrower?
46. Can a guarantor belong to a different organization from the borrower?
47. If cross-branch guarantors are allowed, what scope rules apply?
48. If a customer changes branch, does the guarantor relationship move automatically?
49. If the customer is deactivated, what happens to the guarantor relationship?
50. If the branch is deactivated, can existing guarantor relationships remain active for existing loans?
51. Is physical guarantor deletion ever permitted?
52. Is guarantor deactivation the only supported removal method?
53. What exact downstream references block deletion?
54. How long are historical guarantor relationships retained?
55. How long are guarantor KYC documents retained?
56. Can Field Employees view guarantor information?
57. Can Field Employees add guarantors?
58. Can Field Employees collect guarantor consent?
59. Can Field Employees operate guarantor workflows offline?
60. How should offline guarantor changes conflict with server changes?
61. Should guarantors have a standalone list/detail screen or only exist under Customer/Loan screens?
62. The screen inventory identifies GUA-001 Guarantor List / Selection and GUA-002 Guarantor Detail / KYC; confirm whether these are mandatory standalone screens or derived navigation views. fileciteturn4file3
63. Should guarantor search support Name, Mobile, ID or Customer?
64. Who can export guarantor data?
65. What masking rules apply to guarantor mobile/address?
66. What audit fields are required for guarantor changes?
67. What concurrency strategy applies to guarantor edits?
68. What notification is sent when guarantor KYC requires revision?
69. What notification is sent when guarantor consent is pending?
70. Does the guarantor receive a notification/confirmation after consent?
71. Is guarantor consent required before loan application creation or only before final review?
72. Is guarantor KYC required before loan application or before Branch Admin Review?
73. Does a guarantor need a customer master record of their own?
74. If a guarantor later becomes a borrower, should the existing guarantor identity be reused?
75. How should duplicate guarantor identity be merged?
76. Does the guarantor relationship have an explicit lifecycle separate from the guarantor person record?

# Source Traceability

- The Customer Journey explicitly places **Guarantor Added → Guarantor KYC & Consent → Loan Application** in the standard journey. fileciteturn4file8turn4file14
- The Local Customer journey explicitly keeps guarantor requirement configurable by loan/business rule. fileciteturn4file1turn4file5
- The wireframe explicitly defines Guarantor Required, Guarantor Name, Mobile, Address, Relationship, Consent and KYC Documents, with conditional validation rules. fileciteturn4file17
- The Module 4 customer-management document already establishes Add Guarantor, Guarantor Consent and Guarantor KYC as part of the customer onboarding domain. fileciteturn4file2
- The screen inventory identifies GUA-001 Guarantor List / Selection and GUA-002 Guarantor Detail / KYC, while marking them Direct/Derived according to the source coverage. fileciteturn4file3
- The source does not define the complete guarantor status model, duplicate policy, multi-loan guarantor rules, replacement/removal workflow, legal liability model, or exact consent mechanism. Those remain Open Questions rather than invented requirements.

# End of Module 5
