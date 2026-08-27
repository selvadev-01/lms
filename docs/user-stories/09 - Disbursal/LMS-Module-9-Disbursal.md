# User Story — Disbursal

## Epic

Loan Disbursement

## Feature

Disbursement Scheduling, Fund Transfer, Ledger Posting and Repayment Schedule Initiation

## User Story

As a Branch Admin or authorized disbursement operator
I want to schedule and record an approved loan disbursement
So that the sanctioned loan funds are transferred correctly and the loan can enter repayment.

As an authorized disbursement operator
I want the transfer and ledger posting to be atomic and auditable
So that the LMS never marks a loan as disbursed without a corresponding financial record.

## Rules & Business Constraints

1. Disbursal starts only after the customer has agreed to the sanction and the Loan Agreement is signed. fileciteturn8file0turn8file4
2. The source sequence is Loan Agreement → Disbursement Scheduled — Date & Account Set → Fund Transfer — Bank / Cash → Disbursement Complete — Record in Ledger → Loan Disbursement — Funds Transferred. fileciteturn8file3
3. Disbursement must not be available for a rejected application.
4. Disbursement must not be available when the customer has declined the sanction.
5. Disbursement must not be available before the Loan Agreement is signed.
6. Disbursement amount must match the approved/disbursement amount; the P0 wireframe explicitly requires the amount to match the approved loan amount. fileciteturn8file1
7. Money is always stored as integer paise. Never float.
8. Disbursement Date is required and must satisfy configured business-date rules. fileciteturn8file1
9. Disbursement Account is required and must be an authorized account. fileciteturn8file1
10. Transfer Method supports Bank and Cash. fileciteturn8file1
11. Transaction Reference is required for bank transfer where applicable and must be unique/idempotent. fileciteturn8file1
12. Transfer Date is required and valid.
13. Every money movement posts double-entry ledger lines that sum exactly to zero.
14. The disbursement transaction must not be committed unless its corresponding ledger posting succeeds.
15. Ledger is append-only. Corrections are reversal entries, never edits/deletes.
16. A failed transfer must not mark the loan as disbursed.
17. A failed ledger commit must not mark the loan as disbursed.
18. A duplicate transaction reference must not create a second disbursement. fileciteturn8file11
19. Disbursement retry must be idempotent and must not double-transfer or double-post.
20. Payment posting is idempotent on Idempotency-Key; the final disbursement API must use an idempotency mechanism consistent with the project money-posting rule.
21. Receipt numbers are gapless per branch/agent for collection transactions; disbursement does not consume collection receipt numbers.
22. Every record is scoped by organization and branch.
23. The authenticated organization and branch scope are enforced server-side.
24. A Branch Admin cannot disburse a loan belonging to another branch.
25. A user cannot override organization/branch scope through request payloads.
26. The disbursement account must be authorized for the user's organization/branch.
27. The operator must have explicit disbursement permission.
28. Approval permission alone must not automatically grant disbursement permission unless the final RBAC matrix says so.
29. Maker-checker/self-disbursement restrictions, if required by the final RBAC matrix, must be enforced server-side.
30. Deletion is blocked when disbursement or downstream references exist.
31. Disbursed financial records are never physically deleted.
32. Deactivation is not a substitute for reversing a financial transaction.
33. A financial correction uses a reversal/adjustment entry.
34. The original disbursement ledger entry remains immutable.
35. Repayment Schedule is generated only after successful disbursement. fileciteturn8file3
36. Collection Cycle begins after the repayment schedule is generated/shared.
37. Disbursal must not generate an EMI payment or collection receipt.
38. EMI due dates are DATE-only and use Asia/Kolkata.
39. The schedule must use the finalized loan terms captured at disbursement.
40. A change to loan terms after approval must not silently change the disbursement amount or schedule.
41. If approved terms change before disbursement, the final policy must determine whether re-approval/sanction is required; do not assume.
42. Disbursement is a financial operation and must be fully auditable.
43. All successful and failed disbursement actions are audit logged.
44. Permission denials are audit logged.
45. Transfer failures are audit logged.
46. Ledger failures are audit logged.
47. A stale client must revalidate loan status, agreement status, amount and account authorization before commit.
48. Concurrent disbursement attempts must result in one authoritative committed disbursement.
49. A loan already disbursed cannot be disbursed again through the ordinary action.
50. Repayment schedule generation failure must not leave an ambiguous financial state; the disbursement itself must remain financially recorded and the schedule generation must be retryable according to the final transaction boundary.
51. The source does not fully define whether schedule generation is part of the same transaction or an asynchronous post-disbursement operation; this remains an Open Question.
52. Offline authoritative disbursement is not defined by the source and must not be assumed.
53. An offline cached disbursement form cannot bypass current server validation.
54. Stale offline data must be rejected or reconciled before money movement.
55. Disbursement confirmation must be atomic from the user's perspective: no success response unless the authoritative disbursement state is committed.
56. Bank transfer reference uniqueness must be enforced at the correct organization/branch scope.
57. Cash disbursement requires a defined cash account and cash-control process.
58. The source permits Bank/Cash but does not define cash denomination counting for disbursement; do not import collection-specific cash-count rules.
59. The disbursement account and ledger accounts must be valid and active at transaction time.
60. Any disbursement reversal must create reversing double-entry lines summing to zero.
61. Reversal must not edit the original transaction.
62. The loan must not return to an undistributed state merely because a financial reversal exists; the exact post-reversal lifecycle is an Open Question.
63. All actions are audit logged.

## Background

Given the user is logged into the LMS
And the user has disbursement permission
And the loan belongs to the user's authorized organization and branch
And the customer has agreed to the sanction
And the Loan Agreement is signed
And the approved loan amount is available
And an authorized disbursement account is available

The source flow is:

Loan Agreement
→ Disbursement Scheduled — Date & Account Set
→ Fund Transfer — Bank / Cash
→ Disbursement Complete — Record in Ledger
→ Loan Disbursement — Funds Transferred
→ Repayment Schedule Generated & Shared
→ Collection Cycle Begins

fileciteturn8file3turn8file4

## Feature: Loan Disbursal Management

### Menu

Loan Management
→ Loans
→ Disbursement

Actions: List/View Eligible Loans, View Details, Schedule Disbursement, Edit Schedule Before Transfer, Record Transfer, Confirm Disbursement, Retry Failed Transfer, View Ledger, View Repayment Schedule

### Disbursement — Fields

Loan Summary
Loan ID *
Customer *
Loan Type *
Loan Scheme *
Principal *
Interest
Duration
EMI

Agreement
Agreement Status *
Signed Date

Disbursement Schedule
Disbursement Date *
Disbursement Account *

Fund Transfer
Transfer Method *
Amount *
Transaction Reference
Transfer Date *

Confirmation
Customer
Loan
Amount
Method
Reference

The P0 screen defines these fields and the confirmation flow. fileciteturn8file1

### Table Only (Not for UI)

```text
organization_id
branch_id
loan_id
disbursement_id
disbursement_date
disbursement_account_id
transfer_method
amount_paise
transaction_reference
transfer_date
status
ledger_transaction_id
created_by
confirmed_by
created_at
confirmed_at
version
```

Money fields are integer paise.

Required ledger invariant:

```text
SUM(all debit lines) = SUM(all credit lines)
Net ledger movement = 0
```

The exact debit/credit account mapping is not named in the source. The scenarios therefore use:

```text
Debit  = configured loan-disbursement/loan receivable account
Credit = configured bank/cash funding account
```

The final chart-of-accounts mapping must be confirmed before implementation.

### Disbursement States

```text
SCHEDULED
    ↓
TRANSFER_PENDING
    ↓
TRANSFER_COMPLETED
    ↓
DISBURSED
```

Failure states may include:

```text
TRANSFER_FAILED
LEDGER_FAILED
```

These implementation states are derived from the source's scheduled → transfer → complete → disbursed flow; the exact persisted enum is not explicitly specified.

## Gherkin Scenarios

### List / View

#### Scenario 1: List eligible loans for disbursement

Given the user has disbursement permission
And eligible approved loans exist in the user's branch
When the user opens the Disbursement screen
Then the system lists only loans eligible for disbursement
And loans outside organization/branch scope are excluded
And the action is audit logged.

#### Scenario 2: View disbursement details

Given an eligible loan exists
When the user opens its disbursement details
Then the system displays Loan ID, customer, principal, interest, duration, EMI and agreement status
And the authorized disbursement actions are displayed.

#### Scenario 3: Branch Admin cannot view another branch loan

Given Branch Admin A belongs to Branch A
And the loan belongs to Branch B
When Branch Admin A requests the disbursement screen
Then access is denied
And no protected loan/disbursement data is returned
And the denial is audit logged.

#### Scenario 4: Cross-organization disbursement is denied

Given the loan belongs to Organization B
And the user belongs to Organization A
When the user requests the disbursement
Then the system denies access
And no financial operation is created
And the denial is audit logged.

### Add / Schedule

#### Scenario 5: Schedule valid disbursement

Given the customer has agreed to the sanction
And the Loan Agreement is signed
And the loan is approved
When the user enters a valid disbursement date and authorized account
Then the system creates the disbursement schedule
And the loan remains undistributed until the transfer is confirmed
And the schedule action is audit logged.

#### Scenario Outline: Mandatory field validation

Given the Disbursement form is open
When the user submits without <field>
Then the system shows "<message>"
And no disbursement is committed

Examples:
| field | message |
| Disbursement Date | Disbursement Date is required |
| Disbursement Account | Disbursement Account is required |
| Transfer Method | Transfer Method is required |
| Amount | Amount is required |
| Transfer Date | Transfer Date is required |

#### Scenario 6: Invalid amount is rejected

Given the approved loan amount is ₹100,000
When the user enters ₹99,999 as the disbursement amount
Then the system rejects the request
And no transfer is committed
And the loan is not marked as disbursed.

The P0 wireframe explicitly requires the amount to match the approved loan amount. fileciteturn8file1

#### Scenario 7: Zero or negative amount is rejected

Given the disbursement form is open
When the user enters zero or a negative amount
Then the system rejects the amount
And no financial transaction is created.

#### Scenario 8: Agreement not signed blocks disbursement

Given the customer agreement has not been signed
When the user attempts to schedule or confirm disbursement
Then the system shows that disbursement is unavailable
And no transfer occurs
And the attempt is audit logged.

The source explicitly defines this error path. fileciteturn8file11

#### Scenario 9: Rejected loan cannot be disbursed

Given the loan application is rejected
When the user attempts disbursement
Then the system denies the operation
And no financial transaction is created
And the denial is audit logged.

#### Scenario 10: Customer-declined sanction cannot be disbursed

Given the customer declined the sanction
When the user attempts disbursement
Then the system denies the operation
And the loan remains outside the disbursement path.

### Edit

#### Scenario 11: Edit scheduled disbursement

Given a disbursement is scheduled but funds have not been transferred
And the user has permission to edit the schedule
When the user changes the valid disbursement date or authorized account
Then the schedule is updated
And the change is audit logged.

#### Scenario 12: Edit after transfer is blocked

Given the fund transfer has completed
When the user attempts to edit the disbursement amount, account or transaction reference
Then the system blocks the edit
And the original financial record remains unchanged
And the attempt is audit logged.

#### Scenario 13: Wrong role cannot edit disbursement

Given the user lacks disbursement-edit permission
When the user attempts to edit the scheduled disbursement
Then the system denies the action
And the disbursement remains unchanged
And the denial is audit logged.

### Fund Transfer

#### Scenario 14: Bank transfer

Given a valid scheduled disbursement exists
And the transfer method is Bank
When the operator enters a valid amount, transfer date and transaction reference
And confirms the transfer
Then the system records the bank transfer
And the transaction reference is stored
And the transfer is eligible for ledger posting.

#### Scenario 15: Cash transfer

Given a valid scheduled disbursement exists
And the transfer method is Cash
When the operator selects an authorized cash account
And enters the valid disbursement amount
And confirms the transfer
Then the system records the cash disbursement
And the transaction is eligible for ledger posting.

#### Scenario 16: Bank transaction reference is required

Given the transfer method is Bank
When the operator submits without a transaction reference where the configured rule requires one
Then the system rejects the transfer
And no disbursement is committed.

#### Scenario 17: Duplicate transaction reference

Given transaction reference TXN-123 has already been used
When the operator attempts to use TXN-123 for another disbursement
Then the system rejects the request
And no second disbursement is created.

The source explicitly defines this duplicate-reference error. fileciteturn8file11

#### Scenario 18: Unauthorized account

Given the selected disbursement account is not authorized for the user's organization/branch
When the operator confirms the transfer
Then the system rejects the transaction
And no ledger entry is created
And the denial is audit logged.

### Ledger / Double Entry

#### Scenario 19: Successful disbursement posts balanced ledger

Given the fund transfer succeeds
When the system commits the disbursement
Then it posts the configured debit account for the disbursement amount
And it posts the configured credit bank/cash account for the same amount
And total debit equals total credit
And the ledger transaction is recorded
And the ledger entries are immutable.

#### Scenario 20: Ledger posting failure

Given the transfer operation cannot complete the required ledger commit
When the system attempts to finalize the disbursement
Then the system does not mark the loan as disbursed
And the financial failure is reported
And the failure is audit logged.

The source explicitly defines this error behavior. fileciteturn8file11

#### Scenario 21: No unbalanced ledger transaction

Given a disbursement amount is ₹100,000
When the ledger transaction is generated
Then debit lines total ₹100,000
And credit lines total ₹100,000
And the transaction is rejected if the totals do not balance.

#### Scenario 22: Ledger is append-only

Given a disbursement has posted successfully
When a user attempts to edit a ledger line
Then the system denies the edit
And the original ledger remains unchanged
And any correction must use a reversal/adjustment transaction.

### Confirmation / Success

#### Scenario 23: Confirm disbursement

Given all preconditions are satisfied
When the operator confirms the disbursement
Then the system commits the transfer and ledger transaction
And marks the loan as disbursed
And records the disbursement event
And audit logs the complete operation.

#### Scenario 24: Successful disbursement generates repayment schedule

Given the disbursement is successfully completed
When post-disbursement processing runs
Then the repayment schedule is generated and shared
And the collection cycle becomes active.

The source explicitly places Repayment Schedule after Loan Disbursement. fileciteturn8file3

#### Scenario 25: Repayment schedule generation failure

Given the disbursement has been successfully financially recorded
When repayment schedule generation fails
Then the financial disbursement remains recorded
And the schedule is not falsely marked generated
And the system exposes a retry/recovery path according to the finalized processing design
And the failure is audit logged.

### Failure

#### Scenario 26: Transfer failure

Given a valid disbursement is being processed
When the fund transfer fails
Then the system shows "Disbursement failed"
And no loan disbursement is committed
And the user can retry.

The source explicitly states that no loan disbursement is committed after transfer failure. fileciteturn8file11

#### Scenario 27: Loading state prevents duplicate action

Given the operator has confirmed the disbursement
When processing is underway
Then the UI disables duplicate confirmation
And displays "Processing disbursement..."
And a second request cannot create another financial transaction.

The P0 wireframe explicitly defines this loading state. fileciteturn8file11

#### Scenario 28: Network timeout after successful server commit

Given the server successfully commits the disbursement
When the client times out before receiving the response
And the client retries
Then the server returns the existing authoritative result
And no duplicate transfer or ledger transaction is created.

### Permission

#### Scenario 29: Wrong role attempts disbursement

Given the user lacks disbursement permission
When the user attempts to confirm disbursement
Then the system returns permission denied
And no financial transaction is created
And the denial is audit logged.

#### Scenario 30: Approval permission does not imply disbursement

Given a user can approve loans but does not have disbursement permission
When the user attempts disbursement
Then the system denies the action
And the loan remains undistributed.

### Scope

#### Scenario 31: Branch scope on disbursement account

Given the loan belongs to Branch A
And the selected account belongs to Branch B
When the operator confirms disbursement
Then the system rejects the cross-branch transaction
And no ledger posting occurs.

#### Scenario 32: Organization scope

Given the loan belongs to Organization A
And the selected account belongs to Organization B
When the operator confirms disbursement
Then the server rejects the operation
And no financial transaction is created.

#### Scenario 33: Client cannot override branch

Given the authenticated user belongs to Branch A
When the request supplies Branch B
Then the server rejects or ignores the unauthorized branch value
And the operation uses only authoritative server-side scope.

### Active / Inactive

#### Scenario 34: Inactive account cannot receive disbursement

Given the configured disbursement account is inactive
When the operator attempts to confirm the transfer
Then the system rejects the account
And no ledger transaction is created.

#### Scenario 35: Inactive loan cannot be disbursed

Given the loan is no longer eligible for disbursement
When the operator attempts confirmation
Then the system denies the operation
And the loan remains undistributed.

#### Scenario 36: Existing scheduled disbursement after account deactivation

Given a disbursement was scheduled using an account that was subsequently deactivated
When the operator confirms the transfer
Then the server revalidates the account
And prevents use of an unauthorized inactive account
And requires the finalized rescheduling path.

### Delete / Deactivate

#### Scenario 37: Delete scheduled disbursement with no transfer

Given a scheduled disbursement exists
When the user attempts deletion
Then the system applies the finalized deletion policy
And does not delete a record if retention/audit rules prohibit it.

The source does not explicitly define deletion of scheduled disbursements; this policy remains an Open Question.

#### Scenario 38: Delete completed disbursement is blocked

Given a disbursement has been financially completed
When the user attempts deletion
Then deletion is blocked
And the ledger and audit history remain intact.

#### Scenario 39: Deactivation does not reverse money

Given a disbursement has completed
When an administrator attempts to deactivate the disbursement record
Then deactivation does not remove or alter the financial transaction
And any financial correction must use the reversal process.

### Offline / Sync

#### Scenario 40: Offline disbursement is not authoritative

Given the operator loses network connectivity
When the operator attempts to confirm a disbursement
Then the system does not treat the offline action as an authoritative money movement
And the transaction must be confirmed against the server.

#### Scenario 41: Stale agreement status

Given the client cached Agreement Status = SIGNED
And the server state has changed before confirmation
When the operator confirms disbursement
Then the server revalidates agreement status
And rejects an invalid stale request
And no money movement occurs.

#### Scenario 42: Stale amount

Given the client cached an approved amount
And the authoritative loan amount changed before confirmation
When the operator submits the old amount
Then the server rejects the stale amount
And no transfer is committed.

#### Scenario 43: Offline conflict is not silently overwritten

Given a client has stale disbursement data
And the server has a newer disbursement state
When synchronization occurs
Then the system detects the conflict
And does not silently overwrite the authoritative financial state
And the conflict is audit logged.

### Concurrency

#### Scenario 44: Concurrent disbursement attempts

Given two authorized operators attempt to disburse the same loan
When both requests reach the server
Then only one disbursement succeeds
And the other request receives an already-processed/conflict result
And no duplicate ledger transaction is created.

#### Scenario 45: Concurrent schedule edit and confirmation

Given one operator edits a scheduled disbursement
And another confirms it concurrently
When the requests conflict
Then the finalized concurrency/version policy determines one authoritative state
And the transfer cannot use silently stale terms.

#### Scenario 46: Duplicate Idempotency-Key

Given a disbursement request has successfully committed using an Idempotency-Key
When the same request is submitted again with the same key
Then the server returns the original result
And no second financial transaction is created.

### Audit

#### Scenario 47: Schedule creation is audit logged

Given a user schedules a disbursement
When the schedule is saved
Then the audit event records actor, loan, organization, branch, date/account and timestamp.

#### Scenario 48: Transfer is audit logged

Given a fund transfer succeeds
When the transfer is recorded
Then the audit trail records method, amount, reference, actor and timestamp.

#### Scenario 49: Ledger posting is audit logged

Given a disbursement ledger transaction is created
When posting succeeds
Then the transaction is traceable to the disbursement and loan
And the audit record is immutable.

#### Scenario 50: Permission denial is audit logged

Given a user lacks disbursement permission
When they attempt the operation
Then the denial is recorded
And no protected state changes.

#### Scenario 51: Failure is audit logged

Given a transfer or ledger operation fails
When the failure is returned
Then the failure reason and operation context are recorded in the audit history.

#### Scenario 52: Reversal is audit logged

Given a completed disbursement requires financial correction
When an authorized reversal is posted
Then the reversal is audit logged
And the original transaction remains unchanged
And debit/credit lines of the reversal balance to zero.

## Acceptance Criteria

- Disbursement is available only after customer agreement and signed Loan Agreement.
- Disbursement Date is mandatory.
- Disbursement Account is mandatory and authorized.
- Transfer Method supports Bank and Cash.
- Amount is mandatory and integer paise.
- Amount must match the approved/disbursement amount.
- Bank transaction reference is required where applicable and must be unique.
- Transfer Date is mandatory and valid.
- Failed transfers do not mark the loan as disbursed.
- Failed ledger commits do not mark the loan as disbursed.
- Duplicate transaction references do not create duplicate disbursements.
- Duplicate retries do not create duplicate transfers or ledger entries.
- Every successful money movement creates balanced double-entry lines whose debit and credit totals sum to zero.
- Ledger entries are append-only.
- Corrections use reversal entries, never edits/deletes.
- Successful disbursement marks the loan as disbursed.
- Repayment Schedule is generated/shared after disbursement.
- Collection Cycle begins after repayment schedule generation.
- Organization scope is enforced server-side.
- Branch scope is enforced server-side.
- Unauthorized users cannot disburse.
- Inactive/unauthorized accounts cannot be used.
- Completed disbursements cannot be deleted.
- Offline/stale requests cannot bypass authoritative server validation.
- Concurrent requests cannot create duplicate financial movements.
- All actions are audit logged.

# Decisions Taken

Recorded because each one closes an Open Question below, and because a later
refactor could undo any of them without any test obviously failing.

## D-DIS-1 — The amount is never the caller's

`Disbursement.amountPaise` is read from `SanctionLetter.sanctionedAmountPaise`
inside the transaction, every time. `recordTransfer` accepts an amount **only**
so a mismatch can be reported (Scenario 6) — the figure posted is always the
sanctioned one, and the schedule endpoint has no amount field at all.

This is what makes Rule 6 true by construction rather than by a comparison
somebody has to remember. It also answers Q-36 (can the amount ever differ from
approved) with _no_, and Q-37/38/39/40 (fee and insurance deduction) do not
arise: nothing is deducted, so gross and net are the same figure. Partial
disbursal (Q-46 to Q-50) is likewise not supported — one application yields one
`Loan` and one non-cancelled `Disbursement`.

## D-DIS-2 — Two state machines, not one

```
application:   AGREEMENT_SIGNED -> DISBURSEMENT_PENDING -> DISBURSED
disbursement:  SCHEDULED -> PROCESSING -> COMPLETED   (FAILED, CANCELLED exit)
```

They answer different questions: the application's says how far the borrower has
got, the disbursement's says what happened to one attempt at paying them. A
failed transfer returns the disbursement to `SCHEDULED` and leaves the
application at `DISBURSEMENT_PENDING`, so a retry needs no re-scheduling and a
failed attempt cannot un-sign an agreement (Rule 16).

Answers Q-1 to Q-7. All five `DisbursementStatus` values are persisted;
`DISBURSED` is the _application's_ state, `COMPLETED` the disbursement's.

## D-DIS-3 — Everything commits together

The disbursement claim, the balanced journal entry, the loan activation and the
repayment schedule are one transaction. Rules 14 and 17 forbid marking a loan
disbursed without its ledger posting, and generating the schedule in the same
breath makes the ambiguous state of Scenario 25 **unreachable** rather than
recoverable.

Answers Q-77 to Q-82: schedule generation is synchronous, in the same
transaction, and if it fails the disbursal rolls back — a loan that cannot
produce a schedule must not be funded, because the borrower would owe money on
no defined terms.

## D-DIS-4 — Minimal ledger, three accounts

```
Dr  1100 Loan Receivable      amountPaise
  Cr  1200 Bank / 1210 Cash     amountPaise
```

Two lines, one entry, net zero (Q-DOM-33, Q-16 to Q-22). Both are asset
accounts: a disbursal moves value between them rather than incurring a
liability. Branch and loan ride on the `AccountDimension` of each line, not on
per-branch accounts, so a consolidated trial balance stays a sum rather than a
join (Q-23 to Q-28).

Module 14 owns the real chart of accounts, its CRUD and reversals. Scenario 52
(reversal is audit logged) is therefore **out of scope here** and deferred with
Q-DOM-27.

Two invariants live in the database, not only in the service, because
"append-only" that one code path respects is not append-only:

- `journal_lines_balanced` — a **deferred** constraint trigger, so the check
  runs once at COMMIT rather than rejecting a balanced entry mid-write.
- `journal_lines_append_only` / `journal_entries_append_only` — every edit and
  delete refused, except the single legal `POSTED -> REVERSED` transition
  Module 14 will need (Rule 15, Scenario 22).

## D-DIS-5 — Idempotency is a required client-minted key

`Disbursement.idempotencyKey` with `@@unique([orgId, idempotencyKey])`,
mirroring the column `Collection` already carries. A replayed confirm returns
the original result **as a success**, never an error — the same treatment a
duplicate GPS check-in gets (Scenarios 28, 46; Q-31 to Q-35).

The replay check runs **before** the version check, deliberately. A client
retrying after a timeout holds the version from before the successful commit,
so checking the version first would reject the retry with a conflict instead of
returning what it had already achieved. Reordering those two lines looks like
tidying and would break Scenario 28.

`transactionReference` is separately unique per organization (Q-29, Q-30),
nullable so cash disbursals coexist.

## D-DIS-6 — `confirm` is its own permission, withheld from Branch Admin

Five codes, not one: `loans.disbursements.{view, schedule, record_transfer,
confirm, cancel}`. Branch Admin holds four. `confirm` stays with the approval
authority.

Rule 28 requires that approval permission not imply disbursement permission,
and Scenarios 29/30 need an account that demonstrably holds everything else and
is still refused. Granting `confirm` to Branch Admin would silently make both
unprovable — the same load-bearing omission as `loans.approve` and
`loans.applications.sanction.issue` (Q-8 to Q-13).

Maker-checker beyond this split is **not** implemented (Q-12): the source does
not require it, and the schedule/confirm split already separates the clerk from
the authority. No amount-based limits or second-level thresholds (Q-14, Q-15).

## D-DIS-7 — Every gate runs twice

`disbursalReadiness` answers advisorily so the UI can explain itself;
`confirm` re-runs all of it inside the transaction against freshly read rows.
Both share one implementation, so the advisory answer cannot drift from the
authoritative one.

That second run is what catches a client which cached `AGREEMENT_SIGNED`, an
amount that changed underneath it, or an account deactivated between scheduling
and confirming (Rules 47, 53, 54; Scenarios 36, 41, 42). Deleting it because
"readiness already checked" would reopen all three.

## What is deliberately not here

- **Reversal of a completed disbursement** (Scenario 52, Q-130 to Q-142) —
  Module 14. The database already refuses to edit or delete a posted entry, so
  the only path Module 14 can take is a reversing entry, which is the intent.
- **Offline capture** (Scenarios 40, 43, Q-174 to Q-180) — Module 12. Rule 52
  says offline disbursal must not be assumed, so nothing here assumes it.
- **Notifications and receipts** (Q-85 to Q-95) — Module 16. Every point a
  notification would fire already writes an audit record, and those records are
  the seam Module 16 will read. Disbursal consumes no receipt numbers (Rule 21).
- **Bank integration** (Q-98 to Q-107) — the LMS _records_ an externally
  executed transfer; it does not execute one. `recordTransfer` is transcription,
  which is why it posts no ledger line of its own.

# Open Questions

1. What is the exact canonical disbursement status enum?
2. Is `SCHEDULED` persisted?
3. Is `TRANSFER_PENDING` persisted?
4. Is `TRANSFER_COMPLETED` persisted?
5. Is `DISBURSED` the canonical loan state or disbursement state?
6. Are `TRANSFER_FAILED` and `LEDGER_FAILED` persisted states?
7. Is disbursement confirmation separate from transfer completion?
8. What exact disbursement permissions exist?
9. Can Branch Admin disburse?
10. Can Super Admin disburse?
11. Can a Field Employee disburse?
12. Is maker-checker required for disbursement?
13. Can the loan approval user also disburse?
14. Are disbursement limits based on amount?
15. Is second-level authorization required above a threshold?
16. What exact chart-of-accounts mapping is used for loan disbursement?
17. Is the debit account the loan receivable/principal account?
18. Is the credit account the bank/cash funding account?
19. Does disbursement create one ledger transaction or multiple transactions?
20. Does bank transfer require a separate bank-clearing account?
21. How is cash disbursement represented in the ledger?
22. What account is used for cash disbursement?
23. Is the disbursement account a branch cash/bank account master?
24. Can one branch have multiple disbursement accounts?
25. Can a disbursement account be organization-wide?
26. What exact account authorization rules apply?
27. Can a bank account be used across branches?
28. Can a cash account be used across branches?
29. What is the unique key for transaction references?
30. Is transaction reference uniqueness global, organization, branch, account or transfer-method scoped?
31. Is Idempotency-Key mandatory for disbursement confirmation?
32. Is Idempotency-Key mandatory for schedule creation?
33. How long are idempotency records retained?
34. What happens when the same Idempotency-Key is reused with a different payload?
35. What is the canonical response for duplicate disbursement?
36. Can the disbursement amount ever differ from approved amount?
37. If fees are deducted from disbursement, does the transfer amount differ from principal?
38. If insurance/charges are deducted, how are they represented?
39. Does customer receive gross or net disbursement?
40. Does the ledger record gross principal or net cash transfer?
41. Are processing fees posted during disbursement?
42. Are fees included in the loan amount?
43. Are taxes applicable?
44. Are withholding amounts applicable?
45. If deductions exist, what is the double-entry structure?
46. Can partial disbursement occur?
47. If partial disbursement is supported, what is the lifecycle?
48. Can multiple disbursements occur against one loan?
49. Is partial disbursement supported by the source?
50. If not, must the system reject a second disbursement?
51. Can disbursement date be backdated?
52. Can disbursement date be future-dated?
53. What business-date rules apply?
54. Is disbursement allowed on holidays?
55. Is branch business calendar used?
56. Is organization business calendar used?
57. Does Asia/Kolkata govern the disbursement date?
58. Are timestamps stored UTC while dates are local?
59. What happens if the loan agreement expires?
60. Does signed agreement have a validity period?
61. Can a customer withdraw after signing?
62. What happens if customer acceptance is revoked?
63. Can a sanction expire before disbursement?
64. Can an approved loan remain undistributed indefinitely?
65. Is there a disbursement SLA?
66. Is automatic expiry required?
67. Can an expired approval be resubmitted?
68. Does a change to loan amount require re-approval?
69. Does a change to interest rate require re-approval?
70. Does a change to duration require re-approval?
71. Does a change to scheme require re-approval?
72. Does any term change invalidate the signed agreement?
73. Must a new agreement be signed after term changes?
74. What exact loan terms are snapshotted at disbursement?
75. Is the EMI schedule generated from approved or disbursed terms?
76. What happens if EMI calculation fails after disbursement?
77. What happens if repayment schedule generation fails?
78. Is schedule generation synchronous?
79. Is schedule generation asynchronous?
80. Is schedule generation part of the same database transaction?
81. If schedule generation fails, should disbursement remain committed?
82. How is schedule retry triggered?
83. Can collection begin before schedule generation?
84. What exact event activates collection?
85. Does disbursement generate a notification?
86. Who receives disbursement notification?
87. Is SMS required?
88. Is App Push required?
89. Is email required?
90. Is the transaction reference sent to the customer?
91. Is a disbursement receipt generated?
92. Is a PDF generated?
93. Is a printed document required?
94. Is disbursement receipt different from collection receipt?
95. Does disbursement consume receipt numbers?
96. Confirmed by whom?
97. Can Branch Admin manually confirm bank transfer?
98. Is bank integration required?
99. Is bank transfer actually executed by LMS or merely recorded?
100. What external banking integration is used?
101. If LMS only records an external transfer, when is the transfer considered successful?
102. Is external transaction status polled?
103. Is webhook confirmation required?
104. What happens when external bank status is pending?
105. Can a pending transfer be retried?
106. How is duplicate external transfer prevented?
107. How is bank transfer reconciliation performed?
108. Is cash disbursement physically counted?
109. Does cash disbursement require dual authorization?
110. Does cash disbursement require cash-vault reconciliation?
111. Does cash disbursement require a branch cash register?
112. What happens if cash is unavailable?
113. What happens if bank account balance is insufficient?
114. Is balance validation performed before transfer?
115. Is balance validation authoritative?
116. What happens if balance changes between validation and transfer?
117. Does transfer failure automatically retry?
118. Who can retry?
119. How many retries are allowed?
120. Is exponential backoff required?
121. Does failed transfer create an audit event?
122. Does failed transfer create a ledger entry?
123. If ledger posting fails after external transfer succeeds, how is reconciliation handled?
124. Is compensating reversal required?
125. Is a clearing account required for this failure case?
126. Can a financial transaction be marked disbursed before ledger posting?
127. Is ledger posting synchronous?
128. What happens if audit logging fails?
129. Is audit logging transactionally coupled?
130. Can a completed disbursement be reversed?
131. Who can reverse a disbursement?
132. What reason is required for reversal?
133. Does reversal require approval?
134. Does reversal return the loan to pre-disbursement state?
135. Does reversal create a new loan status?
136. What happens to generated repayment schedule after reversal?
137. What happens to already-created EMI records after reversal?
138. Can a disbursement be reversed after an EMI payment?
139. If yes, what is the accounting treatment?
140. Are reversals allowed across accounting periods?
141. Are backdated reversals allowed?
142. How are reversal dates determined?
143. What happens if the bank transfer was successful but LMS confirmation failed?
144. How does reconciliation identify an externally successful but internally incomplete transfer?
145. Is there a disbursement reconciliation report?
146. Can admins search by transaction reference?
147. Can admins search by loan ID?
148. Can admins search by customer?
149. Can admins search by date?
150. Can admins search by branch?
151. Can admins search by account?
152. Are disbursement records exportable?
153. Who can export them?
154. Are PII fields masked?
155. Is transaction reference considered sensitive?
156. What retention period applies to disbursement records?
157. Can scheduled disbursements be deleted?
158. Can failed disbursements be deleted?
159. Can failed attempts be archived?
160. Is `INACTIVE` applicable to disbursement records?
161. What is the exact active/inactive behavior?
162. Can an inactive disbursement account be reactivated?
163. What happens to scheduled disbursements when an account is deactivated?
164. Does the system automatically require rescheduling?
165. Can users select an inactive account via a direct API request?
166. What exact server-side scope checks apply?
167. Is branch ownership immutable after scheduling?
168. Can a scheduled disbursement be transferred to another branch?
169. If a loan branch changes before disbursement, what happens?
170. Does branch transfer require rescheduling?
171. Does branch transfer invalidate account selection?
172. What happens to approval authority after branch transfer?
173. Can a loan be disbursed centrally?
174. What is the offline policy for disbursement?
175. Can schedule creation occur offline?
176. Can transfer recording occur offline?
177. Can cash disbursement be captured offline?
178. If offline capture is allowed, what client-generated ID is used?
179. What conflict resolution strategy applies?
180. How is duplicate offline transfer prevented?
181. How is stale agreement state detected?
182. How is stale amount detected?
183. How is stale account authorization detected?
184. Is optimistic locking required?
185. What version field is used?
186. Can two devices schedule the same loan?
187. Can two devices confirm the same loan?
188. What happens when one device succeeds and the other is offline?
189. Does the UI hide disbursement when offline?
190. What exact error should stale clients receive?
191. What exact HTTP conflict status is used?
192. Are all disbursement actions audit logged?
193. What exact audit fields are required?
194. Are before/after values required for schedule edits?
195. Is the audit trail immutable?
196. Can audit events be corrected?
197. What is the audit retention period?
198. Can auditors view ledger linkage?
199. Can auditors view external transfer references?
200. What is the final canonical disbursement state machine?

# End of Module 9
