# Module 11 — EMI Collection

## User Story — EMI Collection

### Epic

Loan Repayment Management

### Feature

EMI Due Collection, Payment Posting, Allocation, Reversal and Receipt Management

### User Story

As an authorized collection user  
I want to collect and post EMI payments against a loan repayment schedule  
So that customer repayments are accurately allocated, receipted and recorded in the ledger.

As the system  
I want every payment posting to be idempotent and financially balanced  
So that duplicate charges, duplicate receipts and unbalanced accounting entries cannot occur.

---

## Rules & Business Constraints

1. EMI collection is performed only against an eligible loan and its authoritative repayment obligations.
2. Every collection record is scoped by `organization_id` and `branch_id`.
3. Organization and branch scope must be enforced server-side.
4. A Branch Admin cannot view, create, edit or post collections for another branch.
5. A Field Employee can collect only for loans assigned or made available to that employee under the applicable assignment rules.
6. A collection amount is always stored as integer paise. Floating-point money is prohibited.
7. Payment posting requires an `Idempotency-Key`.
8. The same logical payment request with the same idempotency key must not create duplicate payment postings.
9. Reusing an idempotency key with a materially different request must be rejected.
10. Every successful money movement posts double-entry ledger lines whose total debits equal total credits.
11. For a normal cash receipt, the debit account is the configured Cash/Bank Clearing asset account and the credit accounts are the applicable receivable accounts.
12. The exact credit split follows the payment appropriation result.
13. Part-payment appropriation order is strictly: **penalty → interest → principal → fees**.
14. The appropriation order must be deterministic and replayable.
15. A payment may settle one or more due obligations according to the authoritative allocation rules.
16. A partial payment must not rewrite the contractual EMI amount.
17. The original contractual EMI remains in the repayment schedule; paid and outstanding amounts are tracked separately.
18. A receipt number must be unique and gapless within the configured branch/agent sequence.
19. Receipt numbering must work when a field agent operates offline; client-generated receipts must later reconcile without duplicate or conflicting receipt numbers.
20. A receipt must not be reused for another payment.
21. A posted collection cannot be edited in place.
22. A correction to a posted collection is performed through a reversal, never by editing or deleting the financial posting.
23. Ledger entries are append-only; corrections are reversal entries, never edits or deletes.
24. Reversal must preserve a link to the original collection and original ledger entries.
25. A reversed collection must not continue to count as an active payment.
26. Collection posting must fail atomically if receipt creation, payment allocation or ledger posting fails.
27. No partial financial posting may remain authoritative after a failed transaction.
28. Only authorized roles may collect, post, reverse or void collections according to RBAC.
29. A payment must not be posted to a loan belonging to another organization or branch.
30. A payment must not be posted against an inactive, closed, foreclosed, written-off or otherwise ineligible loan unless a separately authorized lifecycle rule explicitly permits it.
31. A fully settled loan must not accept an ordinary additional EMI collection.
32. Duplicate collection detection must consider idempotency, receipt identity and authoritative payment references.
33. Client-supplied amounts must be validated against integer paise and positive-value rules.
34. Client device time is not authoritative for financial posting.
35. The authoritative server/business date uses Asia/Kolkata.
36. EMI due dates remain DATE-only; collection timestamp does not alter the contractual due date.
37. A payment posted after the due date does not automatically change penalty calculations outside the applicable penalty/accrual rules.
38. Penalty, interest, principal and fee balances used for allocation must come from authoritative server-side balances.
39. Offline-created collections remain non-authoritative until successfully synchronized and posted.
40. Offline sync must preserve client-generated identifiers and idempotency information.
41. A sync conflict must not silently overwrite an existing server payment.
42. If a collection is already posted, a repeated sync must resolve idempotently.
43. Deletion is blocked when the collection is referenced downstream.
44. Financial records must be retained; deactivation or reversal is used instead of destructive deletion.
45. Active/inactive behavior must be enforced before posting.
46. Failed payment posting, reversal failure and permission denial are audit logged.
47. All actions are audit logged.

---

## Background

Given the user is logged into the system  
And the user has permission to collect or manage EMI payments  
And the loan belongs to the user's authorized organization and branch  
And the loan has an authoritative repayment schedule  
And the loan is eligible for collection

The collection lifecycle is:

`Created → Synced → Posted → Reversed`

For online collections, the record may proceed directly from creation to authoritative posting.  
For offline field collections, the record is created locally, synchronized, validated and then posted.

---

# Feature: EMI Collection Management

## Menu

Loan Management  
→ EMI Collection

Suggested routes:

`/collections`  
`/collections/:id`  
`/loans/:loanId/collections`

Actions: List, View Details, Create, Calculate Allocation, Post Payment, Print/View Receipt, Reverse, Sync Offline Collection, Retry Failed Posting

---

## EMI Collection — Fields

### Collection Details

```text
Receipt Number *
Collection Date *
Loan ID *
Customer *
Branch *
Collection Agent
Payment Mode *
Collected Amount *
Idempotency Key *
Status *
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

### Payment Reference

```text
Payment Reference
External Transaction Reference
Collector Device ID
Offline Transaction UUID
Original Collection ID (for reversal)
Reversal Reason
```

### Ledger Posting

```text
Posting Status *
Debit Account *
Credit Account(s) *
Total Debit *
Total Credit *
Journal Reference
```

---

## Table Only (Not for UI)

```text
organization_id
branch_id
collection_id
loan_id
customer_id
agent_id
receipt_number
receipt_sequence_scope
collection_date
created_at
posted_at
payment_mode
collected_amount_paise
penalty_paid_paise
interest_paid_paise
principal_paid_paise
fees_paid_paise
unallocated_amount_paise
idempotency_key
request_fingerprint
external_reference
offline_transaction_uuid
device_id
collection_status
reversal_of_collection_id
reversal_reason
journal_id
version
synced_at
posted_by
reversed_at
reversed_by
```

### Money and Ledger Constraints

```text
All money = integer paise

collected_amount_paise
=
penalty_paid_paise
+ interest_paid_paise
+ principal_paid_paise
+ fees_paid_paise
+ unallocated_amount_paise

For each posted money movement:

SUM(debit_paise) = SUM(credit_paise)
```

---

## Collection States

```text
CREATED
   ↓
SYNCED
   ↓
POSTED
   ↓
REVERSED
```

Failure states may be represented separately for processing purposes, but a failed attempt must not be treated as a successful financial posting.

---

# Gherkin Scenarios

## List / View

### Scenario 1: List collections within authorized branch scope

Given collections exist in Branch A and Branch B  
And the Branch Admin belongs to Branch A  
When the Branch Admin opens the EMI Collection list  
Then only collections belonging to Branch A are returned  
And Branch B collections are not returned.

### Scenario 2: View collection details

Given an authorized user selects a collection  
When the user opens the collection details  
Then the system displays receipt number, loan, customer, collection amount, payment mode and status  
And displays the penalty, interest, principal and fee allocation  
And displays the associated ledger posting status.

### Scenario 3: View posted collection ledger details

Given a collection has been successfully posted  
When an authorized user views its accounting details  
Then the system displays the journal reference  
And displays the debit and credit accounts  
And total debits equal total credits.

### Scenario 4: View only assigned collections as Field Employee

Given a Field Employee is authorized only for assigned loans  
When the employee opens EMI collections  
Then only collections within the employee's permitted assignment scope are visible  
And unauthorized loan collections are not returned.

---

## Add / Create

### Scenario 5: Create an EMI collection

Given the loan is eligible for collection  
And an outstanding repayment obligation exists  
When the authorized user enters a valid collection amount and payment details  
Then the system creates the collection request  
And assigns or validates the receipt identity  
And preserves the required idempotency information.

### Scenario 6: Generate allocation for full payment

Given an EMI has outstanding penalty, interest, principal and fees  
When a payment equal to or greater than the required payable amount is processed  
Then the system calculates allocation using the authoritative balances  
And applies amounts in the order penalty, interest, principal and fees.

### Scenario 7: Generate allocation for part-payment

Given an EMI or loan has outstanding penalty, interest, principal and fees  
When the customer makes a partial payment  
Then the system allocates the payment in this exact order:

1. Penalty
2. Interest
3. Principal
4. Fees
   And no later category receives payment while an earlier applicable category remains unpaid.

### Scenario 8: Payment allocation is deterministic

Given the same outstanding balances and the same payment amount  
When allocation is calculated more than once  
Then the same allocation result is produced  
And the result is replayable from authoritative balances and rules.

---

## Mandatory Field Validation

### Scenario Outline: Mandatory collection field validation

Given the user is creating an EMI collection  
When the user submits without <field>  
Then the system shows "<message>"  
And the collection is not posted

Examples:

| field            | message                      |
| ---------------- | ---------------------------- |
| Loan ID          | Loan is required             |
| Collection Date  | Collection Date is required  |
| Payment Mode     | Payment Mode is required     |
| Collected Amount | Collected Amount is required |
| Idempotency Key  | Idempotency Key is required  |

---

## Amount Validation

### Scenario 9: Reject zero collection amount

Given the user is creating an EMI collection  
When the collected amount is zero  
Then the system rejects the request  
And no receipt or ledger posting is created.

### Scenario 10: Reject negative collection amount

Given the user is creating an EMI collection  
When the collected amount is negative  
Then the system rejects the request  
And no financial posting occurs.

### Scenario 11: Reject non-integer-paise money representation

Given the client submits a monetary value  
When the value cannot be represented as valid integer paise according to the API contract  
Then the system rejects the request  
And floating-point persistence is not performed.

---

## Idempotency

### Scenario 12: Post payment with an Idempotency-Key

Given a valid collection request has been prepared  
When the payment is posted with a unique Idempotency-Key  
Then the system posts the collection once  
And returns the authoritative collection result.

### Scenario 13: Retry the same payment request

Given a payment was successfully posted using Idempotency-Key "KEY-001"  
When the same logical request is retried with Idempotency-Key "KEY-001"  
Then the system returns the existing authoritative result  
And no duplicate collection is created  
And no duplicate receipt is created  
And no duplicate ledger journal is posted.

### Scenario 14: Reuse idempotency key with different request

Given Idempotency-Key "KEY-001" was used for an existing payment request  
When a materially different payment request is submitted with Idempotency-Key "KEY-001"  
Then the system rejects the request as an idempotency conflict  
And the original financial posting remains unchanged.

---

## Receipt Numbering

### Scenario 15: Assign a gapless receipt number

Given a valid collection is ready to be posted  
When the system assigns the next receipt number for the applicable branch/agent sequence  
Then the receipt number is unique within that sequence  
And the sequence follows the configured gapless numbering rule.

### Scenario 16: Duplicate receipt number is rejected

Given a receipt number already belongs to an authoritative collection  
When another collection attempts to use the same receipt number  
Then the system rejects the duplicate  
And the existing collection remains unchanged.

### Scenario 17: Offline agent creates collection with client-generated identity

Given a Field Employee is offline  
When the employee creates a collection on the device  
Then the device generates a stable offline transaction UUID  
And preserves the receipt identity and idempotency information required for synchronization  
And the offline record remains non-authoritative until server posting succeeds.

### Scenario 18: Offline receipt sync preserves uniqueness

Given an offline collection contains a previously generated receipt identity  
When the device synchronizes the collection  
Then the server validates the receipt sequence and transaction identity  
And does not create a duplicate authoritative receipt  
And any conflict is surfaced instead of silently renumbering a posted transaction.

---

## Payment Posting and Double Entry

### Scenario 19: Post a normal collection with balanced double entry

Given a valid payment allocation has been calculated  
When the collection is posted  
Then the system creates double-entry ledger lines  
And the debit account is the configured Cash/Bank Clearing asset account for the payment mode  
And the credit entries are the applicable penalty receivable, interest receivable, principal receivable and fee receivable accounts according to the allocation  
And total debit paise equals total credit paise.

### Scenario 20: Post part-payment with appropriation split

Given a customer pays an amount that is insufficient to settle all outstanding components  
When the collection is posted  
Then the system debits Cash/Bank Clearing for the collected amount  
And credits penalty receivable first for the allocated penalty amount  
And then credits interest receivable  
And then credits principal receivable  
And then credits fee receivable only for any remaining applicable amount  
And total debit equals total credit.

### Scenario 21: Payment posting is atomic

Given a valid collection request is being posted  
When receipt creation, allocation or ledger posting fails  
Then the authoritative transaction is not partially committed  
And the collection is not marked as posted  
And no unbalanced ledger journal remains.

### Scenario 22: Fully paid EMI after collection

Given the posted allocation reduces the EMI outstanding amount to zero  
When payment processing completes  
Then the EMI is marked paid according to the EMI lifecycle  
And the contractual EMI amount remains unchanged  
And paid and outstanding amounts reconcile exactly.

### Scenario 23: Partially paid EMI after collection

Given the posted allocation is less than the total applicable outstanding amount  
When payment processing completes  
Then the EMI or applicable obligation remains partially paid  
And the remaining outstanding amount is retained for future collection  
And the contractual amount is not overwritten.

---

## Edit

### Scenario 24: Edit an unposted collection where allowed

Given a collection exists but has not yet been posted  
And the user has permission to edit the pending collection  
When the user changes an allowed non-financial field  
Then the system validates the updated data  
And preserves the audit history.

### Scenario 25: Edit posted collection is blocked

Given a collection has been posted  
When a user attempts to edit the collection amount, allocation or financial reference  
Then the system blocks the edit  
And instructs the user to use the authorized reversal/correction flow  
And the original ledger remains unchanged.

### Scenario 26: Edit stale collection request is rejected

Given a user opened an editable collection version  
And another authorized process updated or posted it  
When the user submits the stale version  
Then the system rejects the stale update  
And the newer authoritative version remains unchanged.

---

## Delete / Deactivate

### Scenario 27: Delete posted collection is blocked

Given a collection has been posted  
When a user attempts to delete the collection  
Then deletion is blocked  
And the financial history remains preserved.

### Scenario 28: Delete collection referenced downstream is blocked

Given a collection is referenced by an EMI allocation, receipt, ledger journal, reversal or downstream report  
When a user attempts to delete it  
Then deletion is blocked  
And the user must use the appropriate lifecycle action instead.

### Scenario 29: Inactive or ineligible loan cannot accept ordinary collection

Given the loan is inactive, closed, foreclosed, written-off or otherwise ineligible for ordinary EMI collection  
When a user attempts to post a new ordinary EMI payment  
Then the system blocks the posting  
And no receipt or ledger entry is created.

### Scenario 30: Fully settled loan rejects duplicate ordinary EMI payment

Given the loan has no remaining eligible EMI balance  
When a user attempts another ordinary EMI collection  
Then the system rejects the collection  
And no duplicate financial posting occurs.

---

## Reversal

### Scenario 31: Reverse a posted collection

Given a collection has been successfully posted  
And the user has permission to reverse it  
When the user submits a valid reversal reason  
Then the original collection remains preserved  
And a reversal record is created referencing the original collection  
And reversal ledger lines are posted instead of editing the original lines.

### Scenario 32: Reversal posts opposite double-entry lines

Given the original collection debited Cash/Bank Clearing and credited applicable receivable accounts  
When the collection is reversed  
Then the reversal credits Cash/Bank Clearing for the reversed amount  
And debits the same applicable receivable accounts for the corresponding reversed allocation  
And total reversal debits equal total reversal credits  
And the original journal remains unchanged.

### Scenario 33: Reverse already reversed collection

Given a collection has already been reversed  
When a user attempts to reverse it again  
Then the system rejects the duplicate reversal  
And no additional reversal journal is created.

### Scenario 34: Reversal failure remains consistent

Given a reversal is being processed  
When the reversal ledger posting fails  
Then the original collection remains authoritative  
And the collection is not incorrectly marked reversed  
And no partial reversal is committed.

---

## Permission Denial

### Scenario 35: Wrong role attempts to create collection

Given the user lacks EMI collection permission  
When the user attempts to create or post a collection  
Then the system returns permission denied  
And no collection or ledger posting is created  
And the denial is audit logged.

### Scenario 36: Wrong role attempts reversal

Given the user lacks collection reversal permission  
When the user attempts to reverse a posted collection  
Then the system denies the action  
And the original collection remains unchanged  
And the denial is audit logged.

---

## Branch / Organization Scoping

### Scenario 37: Branch Admin cannot collect for another branch

Given Branch Admin A belongs to Branch A  
And the target loan belongs to Branch B  
When Branch Admin A attempts to create or post a collection  
Then the system denies the action  
And no Branch B financial record is created.

### Scenario 38: Cross-organization collection access is denied

Given the target loan belongs to Organization B  
And the authenticated user belongs to Organization A  
When the user requests or posts a collection for that loan  
Then the system denies access  
And no Organization B data is exposed or modified.

### Scenario 39: Client cannot override branch scope

Given the authenticated user is scoped to Branch A  
When the client submits Branch B identifiers in the request  
Then the server validates scope independently  
And rejects the unauthorized branch operation.

---

## Offline / Sync / Conflict

### Scenario 40: Offline collection is created locally

Given a Field Employee is offline  
And the employee is authorized for the loan  
When the employee records a collection  
Then the device stores the collection in a local queue  
And assigns a stable client-generated UUID  
And preserves the receipt and idempotency metadata required for replay.

### Scenario 41: Offline collection syncs successfully

Given an offline collection has not yet been posted  
When network connectivity is restored  
And synchronization succeeds  
Then the server validates permissions, scope, loan state, receipt identity and payment data  
And posts the collection exactly once  
And returns the authoritative collection status.

### Scenario 42: Duplicate offline sync is idempotent

Given an offline collection was already successfully posted  
When the device retries synchronization due to a lost response  
Then the server returns the existing authoritative result  
And no duplicate receipt or ledger journal is created.

### Scenario 43: Offline sync conflict is detected

Given the offline transaction conflicts with an existing authoritative payment or receipt  
When synchronization occurs  
Then the system does not silently overwrite the server record  
And returns a conflict requiring the defined resolution path  
And the conflicting financial state is audit logged.

### Scenario 44: Stale loan state blocks offline posting

Given a Field Employee created a collection while offline  
And the loan became closed, foreclosed or otherwise ineligible before synchronization  
When the collection is synchronized  
Then the server rejects or routes the transaction according to the authorized exception policy  
And the stale client state does not override the authoritative loan state.

---

## Failure Paths

### Scenario 45: Payment provider/reference validation failure

Given a collection requires a valid external payment reference  
When the supplied reference fails validation  
Then the system rejects posting  
And no receipt is finalized  
And no ledger movement is created.

### Scenario 46: Allocation failure

Given the collected amount is valid  
When authoritative component balances cannot be allocated consistently  
Then posting fails  
And no partial financial transaction is committed  
And the failure is audit logged.

### Scenario 47: Ledger imbalance detection

Given the system prepares ledger lines for a collection  
When total debit paise does not equal total credit paise  
Then the posting is rejected  
And no authoritative journal is committed  
And the imbalance is treated as a processing failure.

### Scenario 48: Receipt sequence failure

Given a collection is ready for posting  
When a unique valid receipt number cannot be assigned according to the sequence rules  
Then the collection is not posted  
And the failure is retained for controlled retry  
And no duplicate receipt is created.

---

## Audit

### Scenario 49: Collection creation is audit logged

Given an authorized user creates a collection request  
When the request is accepted  
Then the audit history records the actor, organization, branch, loan, timestamp and action.

### Scenario 50: Payment posting is audit logged

Given a collection is successfully posted  
When the financial transaction completes  
Then the audit history records the collection ID, receipt number, actor/process, posting time and resulting status.

### Scenario 51: Reversal is audit logged

Given a posted collection is reversed  
When reversal completes  
Then the audit history records the original collection, reversal record, actor, reason and timestamp.

### Scenario 52: Failed or denied action is audit logged

Given a collection operation fails or is denied  
When the system handles the outcome  
Then the audit history records the action, actor/process and failure or denial context.

---

# Acceptance Criteria

- EMI collections can be created only for authorized and eligible loans.
- Every collection is scoped by organization and branch.
- Branch and organization scoping are enforced server-side.
- A Branch Admin cannot access or post collections for another branch.
- Field Employees are restricted to authorized loan assignments.
- All money is represented as integer paise.
- Floating-point money storage is prohibited.
- Every money-posting request requires an Idempotency-Key.
- Retrying the same logical request does not create duplicate collections, receipts or ledger journals.
- Reusing an idempotency key for a different request is rejected.
- Part-payment appropriation order is penalty → interest → principal → fees.
- Allocation is deterministic and replayable.
- A partial payment does not rewrite the contractual EMI amount.
- Receipt numbers are unique and follow the configured gapless branch/agent sequence.
- Offline collection identity is preserved through synchronization.
- A posted collection cannot be edited in place.
- A posted collection cannot be physically deleted.
- Financial corrections use reversal entries.
- The ledger is append-only.
- Every posted collection creates balanced double-entry lines.
- Normal receipt posting debits the configured Cash/Bank Clearing asset account and credits the applicable receivable accounts according to allocation.
- Every posted collection has total debit equal to total credit.
- Reversals create opposite balanced entries and preserve the original journal.
- Posting and reversal are atomic.
- Failed posting cannot leave partial authoritative financial records.
- Inactive, closed, foreclosed, written-off or otherwise ineligible loans cannot accept ordinary EMI collections unless explicitly permitted by a defined lifecycle rule.
- Fully settled loans reject duplicate ordinary EMI collections.
- Offline collections remain non-authoritative until successfully synchronized and posted.
- Duplicate offline sync is idempotent.
- Sync conflicts do not silently overwrite authoritative records.
- Stale client state cannot override authoritative server loan state.
- List, view, create, edit where permitted, delete blocking, reversal, offline sync and failure paths are covered.
- Permission denials are enforced and audit logged.
- All actions are audit logged.

# Open Questions

1. Which payment modes are supported: cash, bank transfer, UPI, card, gateway, cheque or others?
2. What is the exact canonical receipt number format?
3. Is receipt numbering gapless per branch, per agent, or both through separate sequences?
4. How are offline receipt numbers reserved before the agent goes offline?
5. Can an offline receipt number be reassigned if an offline transaction is abandoned?
6. How are unused reserved receipt numbers handled while maintaining the gapless requirement?
7. Is a receipt generated at collection creation, sync, or final posting?
8. What exact status enum is persisted for collection records?
9. Are `CREATED`, `SYNCED`, `POSTED`, and `REVERSED` the exact canonical values?
10. Is there a separate `FAILED` status?
11. Can a pending/unposted collection be cancelled, and by whom?
12. What is the maximum allowed collection amount relative to outstanding balance?
13. If a customer overpays, is the excess rejected, held as unapplied credit, or handled as advance payment?
14. If unapplied credit is allowed, which ledger account receives it?
15. Does payment allocation operate per EMI, oldest due balance first, or across the entire loan?
16. When multiple overdue EMIs exist, what is the ordering rule before applying penalty → interest → principal → fees?
17. Are fees always collected after principal, or are some fee types separately prioritized?
18. Are penalty balances generated before collection or calculated during posting?
19. Is penal interest accrued by a daily job or deterministically calculated on read/posting?
20. What exact receivable account names and account codes are used for principal, interest, penalty and fees?
21. Does each payment mode use a different debit account?
22. Is cash first posted to a field-agent cash-in-hand account before branch cash reconciliation?
23. Does UPI/bank collection debit a bank clearing account or the final bank account directly?
24. What approval is required for a collection reversal?
25. What reversal window is allowed?
26. Can a reversed collection be recollected using the same receipt number?
27. What is the required reversal reason list?
28. Can a reversal be partial, or only full reversal?
29. If partial reversal is supported, how is allocation reversed?
30. What is the exact API behavior when an idempotency key is reused with a different request fingerprint?
31. What is the idempotency retention period?
32. Which response code is used for idempotency conflicts?
33. What is the maximum offline queue age before a collection must be manually reviewed?
34. How are GPS/location or customer-signature requirements linked to field collection?
35. Is customer acknowledgment mandatory for cash collections?
36. Is a digital or printed receipt required?
37. Can the customer receive a receipt by SMS, email or mobile app?
38. What happens if receipt delivery fails after financial posting succeeds?
39. Can a Branch Admin edit an unposted collection created by a Field Employee?
40. Can an agent edit their own offline collection before sync?
41. What exact optimistic-lock/versioning mechanism is used for collection conflicts?
42. What response code is used for stale-version conflicts?
43. Can collections be backdated, and who can authorize this?
44. What business date is used for an offline collection created before midnight but synced after midnight?
45. Is the original device capture date retained separately from authoritative posting date?
46. Are closed loans ever allowed to receive recovery collections through a separate workflow?
47. How are write-off recoveries handled?
48. How are foreclosure settlements handled?
49. How does this module integrate with Module 12 Field Collection & Cash Reconciliation without duplicating cash custody workflows?
50. Which reports consume collection status before and after reversal?

# End of Module 11
