# Module 12 — Field Collection & Cash Reconciliation

## User Story — Field Collection & Cash Reconciliation

### Epic

Loan Repayment Management

### Feature

Field Cash Collection, Agent Cash Custody, Branch Handover and Reconciliation

### User Story

As a Field Employee  
I want to record cash collected from assigned borrowers while working in the field  
So that every customer payment is traceable from collection through branch handover and reconciliation.

As a Branch Cashier or authorized Branch User  
I want to reconcile cash handed over by field agents against recorded collections  
So that shortages, excesses, duplicate cash records and unreconciled balances are identified and resolved.

As the system  
I want field cash custody to remain traceable through an auditable lifecycle  
So that collected cash cannot disappear between the customer receipt and branch settlement.

---

## Rules & Business Constraints

1. Every field collection, cash handover and reconciliation record is scoped by `organization_id` and `branch_id`.
2. Organization and branch scope are enforced server-side.
3. A Branch Admin cannot view, approve, reconcile or modify another branch's field cash records.
4. A Field Employee can create and view only collections and cash custody records within the employee's authorized assignment and branch scope.
5. Field collection is the operational custody workflow for cash and must integrate with Module 11 EMI Collection without duplicating the authoritative customer payment posting.
6. All money is represented as integer paise. Floating-point money is prohibited.
7. A field collection that posts customer money must use the Module 11 idempotency rules and require an `Idempotency-Key` when it reaches authoritative payment posting.
8. The same logical field payment must not create duplicate customer collections, receipts or ledger postings.
9. Receipt numbers are gapless according to the configured branch/agent sequence and must work offline.
10. Offline-created field collections must use stable client-generated UUIDs.
11. Offline records remain non-authoritative until synchronization and server validation succeed.
12. A lost network response followed by retry must resolve idempotently.
13. A sync conflict must not silently overwrite an authoritative server record.
14. Client device time is not authoritative for financial posting or reconciliation.
15. The authoritative business date uses Asia/Kolkata.
16. EMI due dates remain DATE-only and are not altered by collection timestamps.
17. Every cash movement that reaches the accounting layer posts balanced double-entry lines where total debits equal total credits.
18. When a field agent receives cash from a customer, the debit account is the configured Field Agent Cash-in-Hand asset account and the credit accounts are the applicable penalty, interest, principal and fee receivable accounts according to payment allocation.
19. The allocation order for part-payment is strictly: **penalty → interest → principal → fees**.
20. When an agent hands cash to the branch, the debit account is the configured Branch Cash-in-Hand/Branch Cash asset account and the credit account is the Field Agent Cash-in-Hand account.
21. A cash handover must not create a second customer repayment.
22. Customer repayment and cash custody transfer are separate accounting events.
23. Cash custody movements must be traceable from collection to handover and reconciliation.
24. The expected cash balance for an agent is derived from authoritative posted cash collections minus authoritative cash handovers and other approved cash adjustments.
25. A field agent cannot arbitrarily edit an already posted cash collection.
26. Corrections to posted financial records use reversal entries; original ledger entries are never edited or deleted.
27. The ledger is append-only.
28. A collection that has been handed over or reconciled cannot be physically deleted.
29. Deletion is blocked whenever downstream references exist.
30. Deactivation, reversal or controlled closure is used instead of destructive deletion.
31. A cash handover amount must be positive integer paise.
32. A handover amount greater than the agent's eligible authoritative cash balance must be rejected unless an explicitly approved excess-cash workflow exists.
33. A reconciliation compares expected cash against actual counted cash and produces a deterministic difference.
34. A shortage or excess must not be silently auto-corrected.
35. Any discrepancy requires a recorded reason and an authorized resolution according to the branch policy.
36. Reconciliation approval cannot silently change historical collection amounts.
37. An unresolved discrepancy must remain traceable until resolved or formally closed.
38. A reversed customer collection must affect agent cash expectations according to the authoritative reversal and custody rules.
39. A field agent cannot collect for a closed, foreclosed, written-off, inactive or otherwise ineligible loan unless an explicit exception workflow permits it.
40. GPS/location capture, if required by policy, is supporting evidence and does not replace authorization or server-side validation.
41. GPS capture failure must follow the configured failure policy and cannot be silently represented as a successful GPS check-in.
42. If offline GPS evidence is captured, the device must preserve the capture metadata for later synchronization where supported.
43. A stale client must not overwrite a newer cash handover or reconciliation state.
44. Concurrent handover or reconciliation actions must not double-count the same cash.
45. All collection, sync, handover, reconciliation, discrepancy, reversal, approval, rejection and denial actions are audit logged.

---

## Background

Given the user is logged into the system  
And the user has permission to perform field collection or cash reconciliation  
And the user belongs to the authorized organization and branch  
And the loan belongs to the user's permitted scope  
And the field collection workflow is active for the loan

The operational lifecycle is:

`Field Collection Created`
→ `Offline Queue or Online Validation`
→ `Customer Payment Posted`
→ `Agent Cash-in-Hand Updated`
→ `Cash Handover Created`
→ `Branch Cash Received`
→ `Reconciliation`
→ `Reconciled / Discrepancy Pending / Resolved`

---

# Feature: Field Collection & Cash Reconciliation Management

## Menu

Collections  
→ Field Collections

Collections  
→ Cash Handover

Collections  
→ Cash Reconciliation

Suggested routes:

`/field-collections`  
`/field-collections/:id`  
`/cash-handovers`  
`/cash-handovers/:id`  
`/cash-reconciliation`  
`/cash-reconciliation/:id`

Actions: List, View Details, Create Field Collection, Sync Offline Collection, Post Collection, Create Cash Handover, Receive Cash, Reconcile, Record Shortage/Excess, Resolve Discrepancy, Reverse Where Authorized, Retry Failed Sync

---

## Field Collection — Fields

### Collection Details

```text
Receipt Number *
Collection Date *
Loan ID *
Customer *
Branch *
Field Employee *
Payment Mode *
Collected Amount *
Idempotency Key *
Collection Status *
```

### Allocation Summary

```text
Penalty Paid
Interest Paid
Principal Paid
Fees Paid
Total Allocated *
Unallocated Amount
```

### Field Evidence

```text
Offline Transaction UUID
Device ID
GPS Latitude
GPS Longitude
GPS Accuracy
GPS Capture Status
Customer Acknowledgment Reference
Notes
```

---

## Cash Handover — Fields

### Handover Details

```text
Handover ID *
Branch *
Field Employee *
Business Date *
Expected Cash Balance *
Cash Handed Over *
Difference *
Handover Status *
```

### Handover Evidence

```text
Receiving User *
Handover Date/Time *
Notes
Acknowledgment Reference
```

---

## Cash Reconciliation — Fields

### Reconciliation Details

```text
Reconciliation ID *
Branch *
Field Employee *
Business Date *
Expected Cash *
Actual Cash Counted *
Difference *
Reconciliation Status *
```

### Discrepancy Resolution

```text
Discrepancy Type
Reason *
Resolution Action
Resolved By
Resolved At
Approval Reference
```

---

## Table Only (Not for UI)

```text
organization_id
branch_id
field_collection_id
loan_id
customer_id
agent_id
receipt_number
collection_date
collected_amount_paise
penalty_paid_paise
interest_paid_paise
principal_paid_paise
fees_paid_paise
idempotency_key
request_fingerprint
offline_transaction_uuid
device_id
gps_latitude
gps_longitude
gps_accuracy
gps_capture_status
collection_status
journal_id
handover_id
reconciliation_id
created_at
synced_at
posted_at
version

cash_handover_id
handover_business_date
expected_cash_paise
handed_over_cash_paise
difference_paise
handover_status
received_by
received_at
handover_journal_id

reconciliation_id
reconciliation_business_date
expected_cash_paise
actual_cash_paise
difference_paise
discrepancy_type
discrepancy_reason
resolution_action
reconciliation_status
resolved_by
resolved_at
approved_by
version
```

---

## Money and Reconciliation Constraints

```text
All money = integer paise

Agent Expected Cash
=
Posted Cash Collections
- Posted Cash Handovers
± Authorized Cash Adjustments

Collection Allocation:

collected_amount_paise
=
penalty_paid_paise
+ interest_paid_paise
+ principal_paid_paise
+ fees_paid_paise
+ unallocated_amount_paise

Reconciliation Difference:

difference_paise
=
actual_cash_paise
- expected_cash_paise
```

---

## Field Collection and Cash Custody States

### Field Collection

```text
CREATED
   ↓
QUEUED_FOR_SYNC
   ↓
SYNCED
   ↓
POSTED
   ↓
REVERSED
```

### Cash Handover

```text
CREATED
   ↓
SUBMITTED
   ↓
RECEIVED
   ↓
RECONCILED
```

### Reconciliation

```text
PENDING
   ↓
RECONCILED
   ├── MATCHED
   └── DISCREPANCY_PENDING
              ↓
           RESOLVED
```

The exact persisted enums must align with the state machine and API specifications.

---

# Gherkin Scenarios

## List / View

### Scenario 1: List field collections within branch scope

Given field collections exist in Branch A and Branch B  
And the Branch Admin belongs to Branch A  
When the Branch Admin opens the Field Collections list  
Then only Branch A collections are returned  
And Branch B collections are excluded.

### Scenario 2: Field Employee views own field collections

Given a Field Employee has recorded multiple authorized collections  
When the employee opens the Field Collections list  
Then the employee can view collections within the employee's authorized scope  
And collections belonging to unauthorized agents or branches are not returned.

### Scenario 3: View field collection details

Given an authorized user selects a field collection  
When the user opens the collection details  
Then the system displays the receipt, loan, customer, amount and allocation  
And displays synchronization and posting status  
And displays available GPS and device evidence where captured.

### Scenario 4: View cash handover details

Given a cash handover exists for a Field Employee  
When an authorized branch user opens the handover  
Then the system displays expected cash, handed-over cash and difference  
And displays the receiving user and handover status.

### Scenario 5: View reconciliation details

Given a reconciliation record exists  
When an authorized user opens the reconciliation  
Then the system displays expected cash, actual counted cash and difference  
And displays whether the result is matched or discrepancy pending.

---

## Add / Create Field Collection

### Scenario 6: Create online field cash collection

Given the Field Employee is authorized for the loan  
And the loan is eligible for collection  
When the employee records a valid cash collection  
Then the system validates the loan, scope and payment details  
And creates the collection request  
And prepares the payment for authoritative posting.

### Scenario 7: Field cash collection posts customer payment

Given a valid field cash collection is ready to post  
When the payment is successfully posted  
Then the system debits the configured Field Agent Cash-in-Hand asset account for the collected amount  
And credits the applicable penalty, interest, principal and fee receivable accounts according to the allocation  
And total debit equals total credit  
And the customer repayment is recorded exactly once.

### Scenario 8: Part-payment allocation in field collection

Given a borrower has outstanding penalty, interest, principal and fees  
When the Field Employee collects an amount insufficient to settle all balances  
Then the system applies the amount in this exact order:

1. Penalty
2. Interest
3. Principal
4. Fees
   And the allocation is determined server-side.

---

## Mandatory Field Validation

### Scenario Outline: Mandatory field collection validation

Given the Field Employee is creating a field collection  
When the employee submits without <field>  
Then the system shows "<message>"  
And the collection is not posted

Examples:

| field            | message                      |
| ---------------- | ---------------------------- |
| Loan ID          | Loan is required             |
| Collection Date  | Collection Date is required  |
| Field Employee   | Field Employee is required   |
| Payment Mode     | Payment Mode is required     |
| Collected Amount | Collected Amount is required |
| Idempotency Key  | Idempotency Key is required  |

---

## GPS / Field Evidence

### Scenario 9: GPS check-in succeeds

Given GPS capture is required by the configured field collection policy  
When the Field Employee performs a GPS check-in successfully  
Then the application records the captured latitude, longitude and available accuracy metadata  
And associates the evidence with the collection attempt according to policy.

### Scenario 10: GPS check-in failure

Given GPS capture is required by the configured field collection policy  
When the device cannot obtain a valid GPS location  
Then the application records the GPS capture as failed  
And does not falsely mark the GPS check-in as successful  
And the collection follows the configured failure policy.

### Scenario 11: GPS permission denied by device

Given GPS capture is required  
When the Field Employee denies device location permission  
Then the application informs the user that GPS evidence could not be captured  
And records the failure condition where the policy requires it  
And the collection is blocked or routed through the configured exception process.

### Scenario 12: GPS unavailable while offline

Given the Field Employee is offline  
And GPS capture is attempted  
When a location cannot be obtained  
Then the offline record preserves the GPS capture status  
And synchronization does not convert the failed capture into a successful one.

---

## Offline Collection / Sync

### Scenario 13: Create collection while offline

Given the Field Employee has no network connectivity  
When the employee records a valid field collection  
Then the device creates a stable client-generated transaction UUID  
And stores the collection in the local synchronization queue  
And preserves receipt and idempotency metadata  
And the record remains non-authoritative until server posting succeeds.

### Scenario 14: Sync offline field collection successfully

Given an offline field collection is queued  
When connectivity is restored  
And server validation succeeds  
Then the server validates organization, branch, assignment, loan state and payment data  
And posts the customer payment exactly once  
And returns the authoritative collection status.

### Scenario 15: Retry offline sync after lost response

Given the server successfully posted an offline collection  
And the device did not receive the response  
When the device retries synchronization using the same transaction identity and idempotency data  
Then the system returns the existing authoritative result  
And no duplicate receipt or ledger journal is created.

### Scenario 16: Offline sync conflict

Given an offline collection conflicts with an existing authoritative receipt or payment  
When synchronization occurs  
Then the system does not overwrite the existing financial record  
And returns a conflict for controlled resolution  
And the conflict is audit logged.

### Scenario 17: Stale loan state during offline sync

Given a Field Employee recorded a collection while offline  
And the loan became closed or otherwise ineligible before synchronization  
When the device syncs the collection  
Then the authoritative server state is applied  
And the stale client state does not override the loan lifecycle  
And the transaction is rejected or routed through an approved exception workflow.

---

## Idempotency

### Scenario 18: Post field collection with Idempotency-Key

Given a valid field collection is ready for posting  
When the request contains a unique Idempotency-Key  
Then the system posts the payment once  
And returns the authoritative result.

### Scenario 19: Retry same field collection

Given a field collection was successfully posted  
When the same logical request is retried with the same Idempotency-Key  
Then the existing result is returned  
And no duplicate customer payment is created  
And no duplicate receipt or journal is created.

### Scenario 20: Same idempotency key with different payload

Given an Idempotency-Key already belongs to a posted field collection  
When a materially different collection request uses the same key  
Then the system rejects the request as an idempotency conflict  
And the original financial transaction remains unchanged.

---

## Cash Custody and Handover

### Scenario 21: Calculate expected cash balance for Field Employee

Given a Field Employee has authoritative posted cash collections  
And has completed one or more authoritative cash handovers  
When the system calculates expected cash  
Then the expected balance equals posted cash collections minus posted cash handovers plus or minus authorized adjustments  
And all values are calculated in integer paise.

### Scenario 22: Create cash handover

Given the Field Employee has an eligible positive cash balance  
When the employee submits a cash handover amount  
Then the system creates the handover request  
And validates that the amount does not exceed the eligible authoritative cash balance unless an approved exception exists.

### Scenario 23: Receive full cash handover at branch

Given a valid cash handover is submitted  
And the actual cash received equals the handover amount  
When the authorized branch user receives the cash  
Then the system debits the configured Branch Cash-in-Hand/Branch Cash asset account  
And credits the Field Agent Cash-in-Hand asset account  
And total debit equals total credit  
And no second customer repayment is created.

### Scenario 24: Receive partial cash handover

Given the Field Employee has an expected cash balance greater than the cash handed over  
When the branch receives only part of the expected amount  
Then the system records the received amount  
And calculates the remaining agent cash balance  
And leaves the unreconciled difference traceable.

### Scenario 25: Reject handover greater than expected balance

Given the Field Employee has an authoritative expected cash balance  
When the employee submits a handover greater than the eligible balance  
Then the system rejects the handover  
And no custody-transfer journal is posted  
Unless an explicitly approved excess-cash workflow applies.

---

## Cash Reconciliation

### Scenario 26: Reconcile exact cash match

Given a handover is ready for reconciliation  
When actual counted cash equals expected cash  
Then the reconciliation difference is zero  
And the reconciliation status becomes matched/reconciled according to the canonical state rules.

### Scenario 27: Detect cash shortage

Given expected cash is greater than actual counted cash  
When reconciliation is performed  
Then the system records a negative shortage difference  
And the status becomes discrepancy pending  
And the discrepancy requires a reason and authorized resolution.

### Scenario 28: Detect cash excess

Given actual counted cash is greater than expected cash  
When reconciliation is performed  
Then the system records the excess difference  
And the status becomes discrepancy pending  
And the excess is not silently treated as a normal customer payment.

### Scenario 29: Resolve cash discrepancy

Given a reconciliation has a pending shortage or excess  
And the authorized user provides the required reason and resolution action  
When the resolution is approved according to policy  
Then the discrepancy status is updated to resolved  
And the original expected, actual and difference values remain historically traceable  
And any required accounting adjustment follows a separately authorized financial rule.

### Scenario 30: Unauthorized user cannot resolve discrepancy

Given a user lacks discrepancy-resolution permission  
When the user attempts to resolve a shortage or excess  
Then the system denies the action  
And the discrepancy remains pending  
And the denial is audit logged.

---

## Edit

### Scenario 31: Edit unposted field collection where allowed

Given a field collection has been created but is not yet authoritatively posted  
And the user has permission to edit the pending record  
When the user changes an allowed field  
Then the system validates the updated data  
And preserves the audit history.

### Scenario 32: Edit posted field collection is blocked

Given a field collection has been posted  
When a user attempts to change the amount or financial allocation  
Then the system blocks the edit  
And requires the authorized reversal or correction workflow  
And the original ledger entries remain unchanged.

### Scenario 33: Edit stale handover version is rejected

Given a user opened an editable cash handover  
And another authorized user received or updated the handover  
When the first user submits a stale version  
Then the system rejects the stale update  
And the newer authoritative state remains unchanged.

---

## Delete / Deactivate

### Scenario 34: Delete posted field collection is blocked

Given a field collection has been posted  
When a user attempts to delete it  
Then deletion is blocked  
And the financial history remains preserved.

### Scenario 35: Delete handed-over collection is blocked

Given a field collection has been linked to a cash handover or reconciliation  
When a user attempts to delete the collection  
Then deletion is blocked  
And the custody trail remains intact.

### Scenario 36: Delete reconciliation referenced downstream is blocked

Given a reconciliation has an approved resolution or downstream accounting reference  
When a user attempts to delete it  
Then deletion is blocked  
And the historical record remains available to authorized users.

### Scenario 37: Inactive or ineligible loan blocks ordinary field collection

Given the loan is inactive, closed, foreclosed, written-off or otherwise ineligible  
When a Field Employee attempts an ordinary new field collection  
Then the system blocks the operation  
And no receipt or customer-payment ledger entry is created.

---

## Reversal and Correction

### Scenario 38: Reverse posted field collection

Given a field collection was successfully posted  
And the user has reversal permission  
When the user submits a valid reversal reason  
Then the original collection remains preserved  
And a reversal record is created referencing the original collection  
And reversal ledger entries are posted instead of editing the original journal.

### Scenario 39: Reverse customer payment with balanced entries

Given the original field collection debited Field Agent Cash-in-Hand  
And credited the applicable penalty, interest, principal and fee receivable accounts  
When the collection is reversed  
Then the reversal credits Field Agent Cash-in-Hand  
And debits the corresponding receivable accounts  
And total reversal debits equal total reversal credits.

### Scenario 40: Prevent duplicate reversal

Given a field collection has already been reversed  
When another reversal is requested for the same original collection  
Then the system rejects the duplicate reversal  
And no additional reversal journal is created.

### Scenario 41: Cash custody reversal consistency

Given a field collection has downstream handover or reconciliation references  
When reversal is requested  
Then the system evaluates the downstream custody state  
And does not silently create an inconsistent agent cash balance  
And the reversal follows the defined controlled correction workflow.

---

## Permission Denial

### Scenario 42: Wrong role attempts field collection

Given the user lacks field collection permission  
When the user attempts to create or post a field collection  
Then the system returns permission denied  
And no collection or ledger posting is created  
And the denial is audit logged.

### Scenario 43: Wrong role attempts cash handover receipt

Given the user lacks permission to receive agent cash  
When the user attempts to receive a cash handover  
Then the system denies the action  
And no custody-transfer journal is posted  
And the denial is audit logged.

### Scenario 44: Wrong role attempts reconciliation

Given the user lacks reconciliation permission  
When the user attempts to reconcile or resolve a discrepancy  
Then the system denies the action  
And no reconciliation state is changed  
And the denial is audit logged.

---

## Branch / Organization Scoping

### Scenario 45: Branch Admin cannot view another branch's field collections

Given Branch Admin A belongs to Branch A  
And a field collection belongs to Branch B  
When Branch Admin A requests the collection  
Then access is denied  
And no Branch B collection data is returned.

### Scenario 46: Branch user cannot receive another branch's cash handover

Given a cash handover belongs to Branch B  
And the receiving user belongs only to Branch A  
When the user attempts to receive the handover  
Then the system denies the operation  
And no custody movement is posted.

### Scenario 47: Cross-organization reconciliation is denied

Given a reconciliation belongs to Organization B  
And the authenticated user belongs to Organization A  
When the user requests or modifies the reconciliation  
Then the system denies access  
And no Organization B financial data is exposed.

### Scenario 48: Client cannot override branch scope

Given the authenticated Field Employee belongs to Branch A  
When the client submits Branch B identifiers in a collection or handover request  
Then the server independently validates branch scope  
And rejects the unauthorized operation.

---

## Concurrency / Conflict

### Scenario 49: Concurrent handover does not double-count cash

Given two users attempt to process the same agent cash balance concurrently  
When one handover becomes authoritative  
Then the second conflicting operation cannot double-transfer the same cash  
And the resulting cash balance remains consistent.

### Scenario 50: Concurrent reconciliation conflict

Given two authorized users attempt to reconcile the same handover  
When one reconciliation is finalized first  
Then the second stale operation is rejected or resolved by version conflict  
And the finalized reconciliation is not overwritten.

### Scenario 51: Stale offline collection cannot overwrite server state

Given a device contains a stale field collection record  
And the server has a newer authoritative version  
When synchronization occurs  
Then the stale device record does not overwrite the server record  
And the conflict is handled through the defined synchronization rules.

---

## Failure Paths

### Scenario 52: Field collection posting failure

Given a valid field collection is being posted  
When receipt creation, payment allocation or ledger posting fails  
Then the customer payment is not partially committed  
And the collection is not falsely marked posted  
And the failure is audit logged.

### Scenario 53: Cash handover posting failure

Given a valid cash handover is being received  
When the custody-transfer ledger posting fails  
Then the handover is not falsely marked received  
And no partial double-entry movement remains authoritative.

### Scenario 54: Reconciliation calculation failure

Given expected cash and actual cash are being reconciled  
When the system cannot calculate a consistent authoritative result  
Then reconciliation is not finalized  
And the failure remains visible for controlled retry or investigation.

### Scenario 55: GPS failure does not become silent success

Given GPS evidence capture fails  
When the collection is later synchronized  
Then the server retains the reported GPS capture status  
And does not represent the failed capture as successful GPS evidence.

---

## Audit

### Scenario 56: Field collection creation is audit logged

Given an authorized Field Employee creates a field collection  
When the collection request is accepted  
Then the audit history records the actor, organization, branch, loan and timestamp.

### Scenario 57: Offline synchronization is audit logged

Given an offline collection is synchronized  
When synchronization succeeds or fails  
Then the audit history records the device or process context, transaction identity and outcome.

### Scenario 58: Cash handover is audit logged

Given cash is handed over from a Field Employee to the branch  
When the handover is received  
Then the audit history records the agent, receiving user, branch, amount and resulting status.

### Scenario 59: Reconciliation and discrepancy actions are audit logged

Given a reconciliation is performed or a discrepancy is resolved  
When the action completes  
Then the audit history records expected cash, actual cash, difference, actor and resolution context.

### Scenario 60: Permission denial or failure is audit logged

Given a field collection, handover or reconciliation action is denied or fails  
When the system handles the outcome  
Then the audit history records the action, actor/process and denial or failure context.

---

# Acceptance Criteria

- Field collection and cash reconciliation are separate but integrated workflows.
- Customer payment posting is not duplicated when cash is handed over to the branch.
- Every field collection and custody record is scoped by organization and branch.
- Server-side branch and organization scoping prevents cross-branch and cross-organization access.
- Field Employees can act only within their authorized assignment scope.
- All money is stored and processed as integer paise.
- Floating-point money storage is prohibited.
- Money-posting requests use idempotency controls.
- Duplicate retries cannot create duplicate customer payments, receipts or journals.
- Part-payment appropriation is penalty → interest → principal → fees.
- Allocation is deterministic and server-authoritative.
- Receipt identity remains unique and supports offline operation.
- Offline field collections use stable client-generated UUIDs.
- Offline collections remain non-authoritative until synchronization and posting succeed.
- Sync conflicts do not silently overwrite authoritative records.
- GPS success and GPS failure are explicitly represented where GPS evidence is required.
- GPS failure is never silently represented as successful check-in.
- A successful field cash collection debits Field Agent Cash-in-Hand and credits the applicable receivable accounts according to allocation.
- Every customer-payment journal is balanced.
- A branch cash handover debits Branch Cash-in-Hand/Branch Cash and credits Field Agent Cash-in-Hand.
- A handover does not create a second customer repayment.
- Agent expected cash is derived from authoritative collections, handovers and approved adjustments.
- Cash handovers cannot exceed eligible authoritative cash balance unless an explicit approved exception applies.
- Reconciliation calculates and preserves expected cash, actual cash and difference.
- Shortages and excesses are not silently auto-corrected.
- Discrepancies require a traceable reason and authorized resolution.
- Posted collections cannot be edited or physically deleted.
- Financial corrections use reversal entries.
- The ledger is append-only.
- Deletion is blocked when records are referenced downstream.
- Inactive or ineligible loans cannot accept ordinary field collections.
- Concurrent handovers and reconciliations cannot double-count cash.
- Stale clients cannot overwrite newer authoritative states.
- List, view, add, edit where permitted, delete blocking, deactivation/correction, permission denial, branch scoping, offline, sync conflict and failure paths are covered.
- All actions are audit logged.

# Open Questions

1. Is cash the only payment mode supported in this module, or can field agents collect UPI, bank transfer or other modes?
2. Is Field Agent Cash-in-Hand a separate ledger account per agent, per branch, or one shared control account with agent-level subledger tracking?
3. What exact account name and account code is used for Branch Cash-in-Hand?
4. Does branch receipt move cash directly to Branch Cash-in-Hand, Bank Clearing or a central cash account?
5. Is every field collection posted to the customer ledger immediately, or only after branch confirmation?
6. If customer payment posting occurs immediately, how are fraudulent or disputed field collections handled before handover?
7. What exact receipt number reservation strategy guarantees gapless numbering while agents work offline?
8. Are receipt numbers preallocated to agents before they go offline?
9. What happens to unused or abandoned offline receipt numbers?
10. Is the receipt sequence per branch, per agent, or a combined branch-agent sequence?
11. What is the canonical field collection status enum?
12. What is the canonical cash handover status enum?
13. What is the canonical reconciliation status enum?
14. Can a Field Employee hand over cash to another Field Employee?
15. Can cash be handed over at a different branch from the collection branch?
16. Is partial handover allowed, and does the remainder stay as agent cash-in-hand?
17. Is there a mandatory daily end-of-day handover requirement?
18. What happens if an agent carries unreconciled cash across business days?
19. What is the maximum permitted unreconciled cash balance or aging period?
20. Who can approve a cash shortage or excess?
21. What discrepancy types are supported: shortage, excess, counterfeit, damaged notes, disputed collection, other?
22. Can an accounting adjustment resolve a shortage or excess, and which debit/credit accounts apply?
23. Are discrepancy adjustments handled in Module 14 Accounting & Ledger instead of this module?
24. Can a collection reversal occur after cash has been handed over?
25. If yes, what exact workflow maintains consistency between customer receivable reversal and cash custody?
26. Can a cash handover itself be reversed after branch receipt?
27. Is partial reversal of a field collection allowed?
28. Is GPS mandatory for every field collection or configurable by organization, branch, agent or product?
29. What GPS accuracy threshold is considered valid?
30. What happens when GPS is unavailable but collection is otherwise valid?
31. Is manual supervisor override allowed for GPS failure?
32. Are geofencing or customer-address distance checks required?
33. Is customer signature, OTP or photo evidence required for field cash collection?
34. How long may a field collection remain in the offline queue?
35. What happens when the device syncs after the business date changes?
36. Which date is authoritative for an offline collection: capture date, agent-declared business date or server posting date?
37. Are backdated field collections permitted, and who can authorize them?
38. What exact optimistic-locking/version field is used for handover and reconciliation conflicts?
39. What API response is returned for stale-version conflicts?
40. What idempotency retention period applies to field collections?
41. How does Module 12 consume or reference Module 11 EMI Collection IDs?
42. Does Module 11 own the receipt and payment record while Module 12 owns only field/cash custody metadata?
43. Which reports consume unreconciled cash and discrepancy data?
44. Are field collection targets or agent cash limits required in this module?
45. What notifications are required for overdue handovers, shortages, excesses and unresolved discrepancies?
46. What backup/recovery procedure applies if an offline device is lost before synchronization?

# End of Module 12
