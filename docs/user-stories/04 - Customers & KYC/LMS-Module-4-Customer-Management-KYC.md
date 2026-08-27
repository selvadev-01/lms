# LMS Module 4 — Customer Management & KYC

## Epic

Customer Onboarding & KYC Management

## User Stories

As a Branch Admin, I want to create and manage customer records so that customers can be onboarded and linked to the LMS loan lifecycle.

As a Branch Admin, I want to verify KYC documents so that only customers satisfying applicable KYC requirements become active KYC customers.

As an authorized LMS user, I want to search and view customer profiles and active loans so that I can operate within my organization and branch scope.

As an authorized administrator, I want Local Customer onboarding to follow a controlled alternate path so that eligible customers can enter the common loan lifecycle without corrupting the standard KYC model.

## Source-Defined Customer Management

Branch Admin Customer Management:

Customer Search → View Profile / Edit → View Active Loans

Create Customer → Personal Info → KYC Upload & Verification → Address Details → Document Upload → Add Guarantors → KYC Approved?

KYC Approved = No → KYC Upload & Verification

KYC Approved = Yes → Customer Created & Active

The source explicitly identifies Branch Admin as the KYC approval authority. fileciteturn3file8

## Customer Types

| Type  | KYC Documents | KYC Verification | Mobile Verification  |
| ----- | ------------- | ---------------- | -------------------- |
| KYC   | Required      | Required         | Registration control |
| LOCAL | Skipped       | Skipped          | Required             |

Local Customer is an explicit customer type. It must not be represented as a missing or disabled KYC record. Local Customers require Name, Mobile and Address, skip standard KYC onboarding, and still follow normal loan approval, agreement, disbursement and repayment controls. fileciteturn3file1 fileciteturn3file2

## Core Business Rules

1. Every customer has a unique customer ID.
2. Customers are organization scoped.
3. Branch-scoped users can access only authorized branch customers.
4. Client-supplied organization/branch values cannot override server authorization.
5. Customer type is explicit: KYC or LOCAL.
6. KYC customers require applicable KYC verification before activation.
7. KYC documents include ID, Address and Photo according to the source.
8. Invalid/incomplete KYC returns for revision.
9. Branch Admin performs KYC approval.
10. KYC approval is auditable.
11. Local Customers require Name, Mobile and Address.
12. Local Customers require mobile verification.
13. Local Customers skip standard KYC document upload and verification.
14. Local Customers do not bypass loan approval, sanction, agreement, disbursement or repayment.
15. Supporting documents may still be required for a Local Customer's loan.
16. Guarantor requirements remain configurable by loan/business rule.
17. KYC bypass does not automatically remove guarantor requirements.
18. Guarantor KYC and consent are recorded where applicable.
19. Customer search supports Name, ID and Phone. fileciteturn3file7
20. Customer profile edits are permission controlled.
21. Customer creation, profile changes, KYC actions, guarantor changes and customer-type changes are audit logged.
22. Historical loans, payments, receipts and audit records must not be deleted by customer profile changes.
23. Destructive deletion of customers with financial history must be blocked or replaced by the approved non-destructive lifecycle.
24. KYC documents must be protected by authorization and secure storage.
25. Offline cached customer data is not authoritative server state.
26. Offline synchronization must enforce the customer's organization/branch scope.
27. Customer creation from other modules must reuse Customer Management rules rather than duplicate them.

## Customer Status

The source explicitly defines `Customer Created & Active`. The complete status dictionary is not source-defined.

Recommended implementation states requiring confirmation:

| Status                | Meaning                        |
| --------------------- | ------------------------------ |
| DRAFT                 | Registration started           |
| PENDING_KYC           | Awaiting KYC completion/review |
| KYC_REVISION_REQUIRED | KYC correction required        |
| ACTIVE                | Customer active                |
| INACTIVE              | Customer inactive              |

## KYC Status

| Status            | Meaning                                                |
| ----------------- | ------------------------------------------------------ |
| NOT_REQUIRED      | LOCAL customer                                         |
| PENDING           | Awaiting review                                        |
| REVISION_REQUIRED | Correction/resubmission required                       |
| APPROVED          | Branch Admin approved                                  |
| REJECTED          | Only if final status model requires separate rejection |

The source defines the revision loop and approval path but not a complete canonical status enum. fileciteturn3file1

## Customer Fields

### Core

- Customer ID
- Customer Type
- Full Name
- Mobile Number
- Email
- Date of Birth
- Gender
- Organization
- Branch
- Status
- Created At
- Updated At

The source specifically requires Name, Mobile and Address for Local Customers. Exact additional demographic fields remain undefined. fileciteturn3file2

### Address

- Address Line 1
- Address Line 2
- City/Town
- State
- Postal Code
- Country
- Address Type

The source contains Address Details but does not define its exact fields. fileciteturn3file8

### KYC Document

- Document ID
- Customer ID
- Document Type
- Document Number
- Secure File Reference
- Version
- Uploaded By
- Uploaded At
- Verification Status
- Verification Reason
- Verified By
- Verified At

The source identifies ID, Address and Photo as KYC documents. Application/loan documents such as Income and Collateral must not automatically be treated as the same domain category. fileciteturn3file9

### Guarantor

- Guarantor ID
- Customer ID
- Name
- Mobile
- Address
- Relationship
- KYC Reference
- Consent Status
- Consent Timestamp
- Status

Exact guarantor fields are not fully defined by the source.

## Standard KYC Flow

```text
Lead / Walk-in
  ↓
Customer Registration
  ↓
Customer Type = KYC
  ↓
Personal & Contact Info
  ↓
KYC Document Upload
  ↓
KYC Verification
  ↓
Branch Admin KYC Review
  ↓
KYC Approved?
  ├─ No → Request Revision → KYC Upload
  └─ Yes → Customer Created & Active
```

The standard path requires ID, Address and Photo and supports revision for invalid/incomplete KYC. fileciteturn3file1

## Local Customer Flow

```text
Lead / Walk-in
  ↓
Customer Registration
  ↓
Customer Type = LOCAL
  ↓
Basic Details
Name + Mobile + Address
  ↓
Mobile Verification
  ↓
Guarantor Required?
  ├─ Yes → Add Guarantor
  └─ No
  ↓
Common Loan Lifecycle
```

Local Customer onboarding intentionally skips standard KYC but does not bypass financial controls. fileciteturn3file3

## Customer Search

The source supports:

- Name
- Customer ID
- Phone

Search must enforce organization and branch authorization even for direct ID lookups. fileciteturn3file7

## Customer Profile

Minimum source-supported profile operations:

- View customer
- Edit customer
- View active loans
- View applicable KYC status
- View applicable guarantor information

The exact profile layout, tabs and editable fields are not defined by the source. fileciteturn3file8

## Local → KYC Conversion

The source leaves this unresolved.

If conversion is approved later:

1. Retain the existing customer record.
2. Change `customer_type` from LOCAL to KYC.
3. Preserve existing loans and financial history.
4. Start the standard KYC workflow.
5. Require applicable KYC documents.
6. Require Branch Admin review/approval.
7. Audit the previous and new customer types.

The source explicitly asks who can perform conversion and whether the existing record should be upgraded rather than creating a second customer. fileciteturn3file0

# Gherkin Scenarios

## Registration

### Scenario 1 — Create KYC customer

Given an authorized user starts customer registration
When the user selects KYC
Then the standard KYC workflow is required
And the customer cannot become active through KYC until approval.

### Scenario 2 — Create Local Customer

Given an authorized user starts customer registration
When the user selects LOCAL
Then standard KYC upload and verification are skipped
And Name, Mobile and Address are required
And mobile verification is required.

### Scenario 3 — Customer type required

Given registration is open
When the user submits without customer type
Then creation is rejected.

### Scenario 4 — Mandatory Local Customer fields

Given customer type is LOCAL
When Name, Mobile or Address is missing
Then creation is rejected.

### Scenario 5 — Duplicate customer

Given a possible duplicate exists
When a user attempts creation
Then the system flags the duplicate according to configured duplicate rules
And does not silently create a duplicate active customer.

## KYC

### Scenario 6 — Upload KYC

Given customer type is KYC
When ID, Address and Photo are uploaded
Then the documents are stored
And remain pending until verification.

### Scenario 7 — Missing KYC

Given customer type is KYC
When required KYC documents are missing
Then approval is blocked.

### Scenario 8 — Request KYC revision

Given KYC is invalid or incomplete
When Branch Admin requests revision
Then the customer enters revision-required state
And a reason is recorded.

### Scenario 9 — Approve KYC

Given applicable KYC requirements are complete
And Branch Admin has approval permission
When Branch Admin approves
Then the customer becomes ACTIVE
And the action is audited.

### Scenario 10 — Unauthorized KYC approval

Given the user lacks KYC approval permission
When the user attempts approval
Then the operation is denied.

### Scenario 11 — Replace KYC document

Given a KYC document already exists
When an authorized user uploads a replacement
Then a new document version is stored
And the previous version remains auditable.

### Scenario 12 — Unauthorized KYC document access

Given the user lacks document permission
When the user requests the document
Then access is denied.

## Local Customer

### Scenario 13 — Local skips KYC

Given customer type is LOCAL
When onboarding proceeds
Then standard KYC upload and verification are not required.

### Scenario 14 — Local mobile verification

Given customer type is LOCAL
When the mobile number is submitted
Then mobile verification must succeed before onboarding continues.

### Scenario 15 — Local does not bypass approval

Given a Local Customer is onboarded
When a loan is created
Then the normal approval lifecycle still applies.

### Scenario 16 — Local supporting documents

Given a loan product requires supporting documents
When a Local Customer applies
Then the required supporting documents can be uploaded.

### Scenario 17 — Local guarantor

Given the applicable business rule requires a guarantor
When a Local Customer is onboarded
Then guarantor handling is required.

## Search/Profile

### Scenario 18 — Search by name

Given the user has customer-search permission
When the user searches by name
Then matching authorized customers are returned.

### Scenario 19 — Search by ID

Given the user has customer-search permission
When the user searches by customer ID
Then the customer is returned only if within authorized scope.

### Scenario 20 — Search by phone

Given the user has customer-search permission
When the user searches by phone
Then matching authorized customers are returned.

### Scenario 21 — Cross-branch access denied

Given Branch Admin A belongs to Branch A
And a customer belongs to Branch B
When Branch Admin A requests the customer
Then access is denied.

### Scenario 22 — View active loans

Given the user can view the customer
When the customer profile is opened
Then permitted active loans are displayed.

### Scenario 23 — Unauthorized profile edit

Given the user lacks edit permission
When the user edits the profile
Then the operation is denied.

## Guarantor

### Scenario 24 — Add guarantor

Given the applicable loan/business rule requires a guarantor
When an authorized user adds one
Then the guarantor is linked to the customer.

### Scenario 25 — Guarantor consent

Given guarantor consent is required
When consent is provided
Then the consent status and applicable timestamp are recorded.

### Scenario 26 — Guarantor KYC

Given guarantor KYC is required
When guarantor KYC is submitted
Then it is stored separately from customer KYC.

## Conversion

### Scenario 27 — LOCAL to KYC

Given LOCAL to KYC conversion is permitted
When an authorized user starts conversion
Then the existing customer record is retained
And customer type becomes KYC
And KYC workflow becomes required.

### Scenario 28 — Conversion preserves loans

Given a Local Customer has loan history
When converted to KYC
Then existing loans remain linked to the same customer.

### Scenario 29 — Unauthorized conversion

Given the user lacks conversion permission
When conversion is attempted
Then it is denied.

## Security / Scope

### Scenario 30 — Cross-organization access

Given User A belongs to Organization A
And the customer belongs to Organization B
When User A requests the customer
Then access is denied.

### Scenario 31 — Client cannot override branch

Given the user is scoped to Branch A
When the client submits Branch B
Then the server ignores/rejects the unauthorized branch.

### Scenario 32 — Document URL protection

Given a document belongs to a customer outside the user's scope
When direct document access is attempted
Then access is denied.

## Audit / History

### Scenario 33 — Customer creation audit

When customer creation succeeds
Then actor, customer, organization, branch, type, timestamp and outcome are recorded.

### Scenario 34 — KYC approval audit

When KYC approval succeeds
Then approving actor, timestamp and result are recorded.

### Scenario 35 — Customer type audit

When KYC or LOCAL is selected
Then the selected customer type is retained in the audit/history.

### Scenario 36 — Profile change preserves history

When customer profile data changes
Then historical loan/payment records remain unchanged.

### Scenario 37 — Destructive deletion blocked

Given a customer has financial history
When deletion is requested
Then destructive deletion is blocked or replaced by the approved non-destructive lifecycle.

## Failure / Concurrency

### Scenario 38 — Customer creation failure

Given validation succeeds
When persistence fails
Then no incomplete active customer is created.

### Scenario 39 — KYC approval failure

Given KYC is ready
When the approval transaction fails
Then the customer does not falsely become ACTIVE.

### Scenario 40 — Concurrent KYC updates

Given two users modify the same KYC record
When their updates conflict
Then the system prevents an invalid final state.

### Scenario 41 — Concurrent profile edits

Given two users edit the same customer
When their updates conflict
Then the finalized concurrency policy prevents silent loss of committed data.

## Offline

### Scenario 42 — Cached customer

Given Field Employee is offline
And authorized customer data is cached
When the employee opens the customer
Then cached data is displayed as offline data, not live server state.

### Scenario 43 — Offline scope enforcement

Given cached data belongs to Branch A
When an offline request attempts Branch B
Then synchronization rejects the unauthorized scope.

### Scenario 44 — Stale customer data

Given customer data changes while the Field Employee is offline
When the queued operation synchronizes
Then the server validates current authoritative state before committing.

The Field Employee flow explicitly contains cached customer data and identifies offline/server conflict behavior as unresolved. fileciteturn3file15

# Acceptance Criteria

- Customer Management is available to authorized users.
- Search supports Name / ID / Phone.
- Customer profile supports view/edit and active-loan access according to permissions.
- Customer type is explicit.
- KYC customers require applicable KYC verification.
- KYC uses ID, Address and Photo as source-defined document categories.
- Invalid/incomplete KYC can be returned for revision.
- Branch Admin is the KYC approval authority.
- Approved KYC customers become active.
- LOCAL customers require Name, Mobile and Address.
- LOCAL customers require mobile verification.
- LOCAL customers skip standard KYC onboarding.
- LOCAL customers still follow common loan approval, agreement, disbursement and repayment controls.
- Supporting documents can be required for LOCAL loan applications.
- Guarantor requirements remain configurable.
- Customer/KYC/guarantor/type changes are auditable.
- Organization and branch authorization is enforced server-side.
- KYC documents are protected from unauthorized access.
- Historical financial records remain intact after customer profile changes.
- Offline customer data is treated as cached/non-authoritative.
- Offline synchronization validates current server state and authorization scope.

# Open Questions

1. Is LOCAL allowed for every organization/branch?
2. What minimum identity verification is required beyond mobile verification?
3. Is a guarantor mandatory for LOCAL or scheme-dependent?
4. Can LOCAL customers use every loan scheme?
5. Which loan products require supporting documents for LOCAL?
6. Who can convert LOCAL to KYC?
7. Should conversion update the existing customer or create another record?
8. What exact customer statuses are required?
9. What exact KYC statuses are required?
10. What exact customer registration fields are required?
11. What exact address fields are required?
12. What exact KYC document types are mandatory?
13. Are document numbers mandatory?
14. What file size/type validation is required?
15. What document retention period applies?
16. What duplicate-detection rules apply?
17. Can the same mobile belong to multiple customers?
18. Can the same identity document belong to multiple customers?
19. Can a customer move between branches?
20. Who can change customer branch ownership?
21. Can customers be deactivated?
22. Can customers with active loans be deactivated?
23. Is destructive customer deletion ever allowed?
24. Which profile edits require re-KYC?
25. Does changing mobile require re-verification?
26. Does changing address require re-KYC?
27. Is customer email verification required?
28. Is DOB mandatory?
29. Is gender mandatory?
30. Can Branch Admin approve a customer they created?
31. Is maker-checker separation required for KYC?
32. Can Super Admin approve KYC?
33. Can Field Employees create/edit customers?
34. Can customers self-register?
35. What is the exact Lead → Customer relationship?
36. What permission is required for Verify & Create Customer Record from Loan Management? fileciteturn3file7
37. Should Loan Management reuse the Customer Management use case/API?
38. How are offline customer edits reconciled?
39. How is stale customer state detected?
40. What happens when a customer is deactivated while cached on a Field Employee device?
41. What happens when KYC changes while a device is offline?
42. What search fields are indexed?
43. Should search support partial matching?
44. Should mobile/KYC data be masked in search results?
45. What concurrency strategy applies to profile/KYC updates?
46. Is bulk customer import required?
47. Is customer export required?
48. Who can export KYC information?
49. What exact audit fields are required for customer/KYC changes?
50. What are the exact retention and archival rules?

# Source Traceability

- Customer Management is a core LMS module. fileciteturn3file11
- Branch Admin Customer Management contains Search, Profile/Edit, Active Loans, Create Customer, Personal Info, KYC, Address, Documents, Guarantors and KYC approval. fileciteturn3file8
- Branch Admin is the finalized KYC approval authority. fileciteturn3file8
- Standard KYC requires ID, Address and Photo and supports revision. fileciteturn3file1
- LOCAL is an explicit alternate onboarding type and skips standard KYC while preserving the common loan lifecycle. fileciteturn3file2
- Guarantor requirements remain configurable and supporting documents may still be required for Local Customers. fileciteturn3file2
- Customer search supports Name / ID / Phone. fileciteturn3file7
- Offline Field Employee flow uses cached customer data and leaves server-conflict handling unresolved. fileciteturn3file15

# End of Module 4
