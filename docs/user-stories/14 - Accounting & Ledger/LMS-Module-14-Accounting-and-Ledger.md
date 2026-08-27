# Module 14 — Accounting & Ledger

## User Story — Accounting & Ledger

### Epic

Financial Accounting & Control

### Feature

Chart of Accounts, Double-Entry Posting, Journal Management, Reversals and Financial Integrity

### User Story

As an authorized Finance User  
I want every financial event in the LMS to create traceable, balanced accounting entries  
So that loan, collection, disbursal, recovery and adjustment transactions reconcile to an immutable financial ledger.

As the system  
I want the ledger to be append-only and every correction to be represented by reversal or authorized adjusting entries  
So that financial history remains complete, auditable and reproducible.

---

## Rules & Business Constraints

1. Every accounting record is scoped by `organization_id` and `branch_id`, unless the configured chart-of-accounts structure explicitly defines an organization-level account with branch-level postings.
2. Organization and branch scope must be enforced server-side.
3. A Branch Admin cannot view, create, post, reverse or modify another branch's accounting records unless explicitly granted cross-branch permission.
4. All money is represented as integer paise. Floating-point money is prohibited.
5. Every authoritative money movement creates balanced double-entry lines.
6. For every journal entry:

   `SUM(debit_paise) = SUM(credit_paise)`

7. A journal cannot be posted if its debit and credit totals do not exactly balance.
8. A posted journal is immutable.
9. The ledger is append-only.
10. Posted ledger lines must never be edited or deleted.
11. Corrections to posted financial entries must use reversal entries or explicitly authorized adjusting entries.
12. A reversal must reference the original journal or financial transaction.
13. A reversal must not destroy or overwrite the original journal.
14. A journal can be reversed only once unless a defined correction workflow explicitly supports reversal-of-reversal.
15. Duplicate posting of the same source financial event is prohibited.
16. Money-posting operations require an `Idempotency-Key` where the source operation is externally or API initiated.
17. Retrying the same logical money-posting request with the same Idempotency-Key must not create duplicate journals.
18. Reusing an Idempotency-Key for a materially different financial request must be rejected as a conflict.
19. Source modules remain the owners of their business transactions; Module 14 is the authoritative accounting representation of financial postings.
20. A collection payment posts accounting entries based on the authoritative payment allocation.
21. Part-payment allocation order remains: **penalty → interest → principal → fees**.
22. A disbursal posting must debit the configured loan receivable/principal asset account and credit the configured funding bank/cash/payable account according to the approved disbursal model.
23. A normal customer collection posts a debit to the configured Cash/Bank Clearing asset account and credits the applicable penalty, interest, principal and fee receivable accounts according to the allocation.
24. A field cash collection may debit the configured Field Agent Cash-in-Hand asset account instead of the final branch cash account.
25. A field cash handover posts a debit to the configured Branch Cash-in-Hand/Branch Cash asset account and a credit to Field Agent Cash-in-Hand.
26. A payment reversal posts the opposite debit and credit effect of the original journal while preserving the original journal.
27. Loan principal receivable, interest receivable, penalty receivable and fee receivable balances must remain separately traceable where required by the accounting model.
28. Manual journals are permitted only for explicitly authorized roles and configured use cases.
29. A manual journal must balance before posting.
30. A manual journal cannot bypass source-transaction controls by modifying historical source postings.
31. Manual financial adjustments require a reason and audit trail.
32. Branch-level financial posting must use accounts valid for the relevant organization and branch scope.
33. An inactive account cannot be used for new postings.
34. An account referenced by posted ledger lines cannot be physically deleted.
35. Accounts with downstream references must be deactivated instead of deleted.
36. An inactive account remains visible for historical reporting where authorized.
37. Account codes must be unique within the configured organization-level chart-of-accounts scope.
38. The account hierarchy must not contain circular parent-child relationships.
39. Posting to a non-postable parent/control account is blocked if the account model defines it as non-postable.
40. The accounting business date uses Asia/Kolkata.
41. EMI due dates remain DATE-only and are not altered by accounting timestamps.
42. Client device time is not authoritative for journal posting.
43. Journal posting must be atomic.
44. If any ledger line fails validation or persistence, the entire posting must fail.
45. No partial authoritative journal may remain after a failed posting.
46. Journal sequence/reference numbers must be unique according to the configured organization/branch numbering rules.
47. Accounting records must preserve source references, actor/process, timestamps and reversal relationships.
48. Reconciliation between source transactions and ledger journals must be deterministic.
49. Stale client updates must not overwrite posted journals or newer configuration.
50. Offline financial source events remain non-authoritative until successfully synchronized and posted by the server.
51. Offline retries must resolve idempotently.
52. Sync conflicts must not silently overwrite authoritative financial data.
53. Financial records must be retained according to the configured retention and compliance policy.
54. Deletion is blocked where referenced downstream.
55. All create, edit, post, reverse, deactivate, rejection, failure, conflict and permission-denial actions are audit logged.

---

## Background

Given the user is logged into the system  
And the user has permission to manage accounting or ledger records  
And the user belongs to the authorized organization and branch  
And the relevant source transaction or accounting configuration exists  
And all financial amounts are represented as integer paise  
And the authoritative accounting business date uses Asia/Kolkata

The accounting posting lifecycle is:

`Draft`
→ `Validated`
→ `Posted`
→ `Reversed`

A posted journal is never edited or deleted.

Corrections follow:

`Original Posted Journal`
→ `Reversal Journal`
→ optional `New Correct Journal` where an authorized correction requires reposting.

---

# Feature: Accounting & Ledger Management

## Menu

Finance  
→ Chart of Accounts

Finance  
→ Journal Entries

Finance  
→ General Ledger

Finance  
→ Reversals & Adjustments

Suggested routes:

`/finance/accounts`  
`/finance/accounts/:id`  
`/finance/journals`  
`/finance/journals/:id`  
`/finance/ledger`  
`/finance/reversals`

Actions: List, View Details, Add Account, Edit Account, Deactivate Account, Create Draft Journal, Validate, Post, View Ledger Lines, Reverse, Create Authorized Adjustment, View Source Transaction, Reconcile

---

# Chart of Accounts — Fields

## Account Identity

```text
Account Code *
Account Name *
Account Type *
Account Category
Parent Account
Postable *
Status *
```

## Scope

```text
Organization *
Branch Scope
Effective From
Effective To
```

## Control

```text
Allow Manual Posting
Control Account
Description
```

### Suggested Account Types

```text
ASSET
LIABILITY
EQUITY
INCOME
EXPENSE
```

The exact canonical enum must be finalized in the database and API specification.

---

# Journal Entry — Fields

## Journal Header

```text
Journal Reference *
Business Date *
Journal Type *
Description *
Source Module
Source Transaction ID
Idempotency Key
Status *
```

## Journal Lines

```text
Account *
Debit Amount
Credit Amount
Branch
Line Description
Source Component
```

## Reversal / Adjustment

```text
Original Journal Reference
Reversal Reason
Adjustment Reason
Approval Reference
```

---

# General Ledger — Fields

```text
Ledger Entry ID *
Journal Reference *
Business Date *
Account *
Debit Amount
Credit Amount
Running Balance
Organization *
Branch *
Source Module
Source Transaction ID
Reversal Of
Created At
Posted At
```

---

# Table Only (Not for UI)

```text
organization_id
branch_id
account_id
account_code
account_name
account_type
parent_account_id
is_postable
is_manual_posting_allowed
account_status
effective_from
effective_to
version

journal_id
journal_reference
journal_type
business_date
source_module
source_transaction_id
idempotency_key
request_fingerprint
journal_status
original_journal_id
reversal_reason
adjustment_reason
approval_reference
created_by
posted_by
created_at
posted_at
version

journal_line_id
line_number
account_id
debit_paise
credit_paise
source_component
line_description

ledger_entry_id
journal_id
account_id
business_date
debit_paise
credit_paise
running_balance_paise
reversal_of_ledger_entry_id
```

---

# Accounting Integrity Constraints

```text
All money = integer paise

For every journal:

SUM(debit_paise) = SUM(credit_paise)

Each line must satisfy:

NOT (
    debit_paise > 0
    AND
    credit_paise > 0
)

A valid journal must contain at least one debit line
and at least one credit line.

A posted journal:

cannot be edited
cannot be deleted

A reversal:

references the original journal
creates new opposite ledger lines
does not modify the original journal
```

---

# Standard Source Posting Rules

## 1. Loan Disbursal

For an approved disbursal:

```text
Debit   Loan Principal Receivable / Loans Outstanding
Credit  Funding Bank / Cash / Disbursal Payable
```

The exact credit account depends on the approved disbursal configuration.

## 2. Customer EMI Collection

For a normal collection:

```text
Debit   Cash / Bank Clearing

Credit  Penalty Receivable       = allocated penalty
Credit  Interest Receivable      = allocated interest
Credit  Principal Receivable     = allocated principal
Credit  Fee Receivable           = allocated fees
```

The allocation order is:

```text
Penalty → Interest → Principal → Fees
```

## 3. Field Cash Collection

For cash received by a Field Employee:

```text
Debit   Field Agent Cash-in-Hand

Credit  Penalty Receivable
Credit  Interest Receivable
Credit  Principal Receivable
Credit  Fee Receivable
```

Each credit amount equals the authoritative payment allocation.

## 4. Field Agent Cash Handover

When cash is transferred to the branch:

```text
Debit   Branch Cash-in-Hand / Branch Cash
Credit  Field Agent Cash-in-Hand
```

This is a custody transfer, not a second customer payment.

## 5. Payment Reversal

For a reversed normal collection:

```text
Debit   Penalty Receivable
Debit   Interest Receivable
Debit   Principal Receivable
Debit   Fee Receivable

Credit  Cash / Bank Clearing
```

Only accounts and amounts present in the original journal are reversed.

---

# Gherkin Scenarios

## Chart of Accounts — List / View

### Scenario 1: List accounts within authorized organization scope

Given accounts exist for Organization A and Organization B  
And the Finance User belongs to Organization A  
When the user opens the Chart of Accounts  
Then only Organization A accounts are returned  
And Organization B accounts are not exposed.

### Scenario 2: Branch user views permitted branch accounts

Given branch-specific accounts exist for Branch A and Branch B  
And the Branch Admin belongs to Branch A  
When the Branch Admin views accounts  
Then only accounts permitted for Branch A or organization-wide use are returned  
And unauthorized Branch B accounts are excluded.

### Scenario 3: View account details

Given an authorized user selects an account  
When the user opens account details  
Then the system displays account code, name, type, parent, posting capability and status  
And displays effective dates and permitted scope.

---

## Chart of Accounts — Add

### Scenario 4: Create a new postable account

Given the user has permission to manage the Chart of Accounts  
When the user submits a valid account code, account name and account type  
Then the system creates the account  
And the account is available for posting only if marked active and postable.

### Scenario 5: Reject duplicate account code

Given an account code already exists within the configured organization chart scope  
When the user creates another account with the same code  
Then the system rejects the request  
And no duplicate account is created.

### Scenario 6: Prevent circular account hierarchy

Given Account A is a parent or descendant relationship candidate  
When a user attempts to assign an account hierarchy that creates a cycle  
Then the system rejects the change  
And the account hierarchy remains acyclic.

---

## Mandatory Field Validation

### Scenario Outline: Mandatory account field validation

Given the user is creating an account  
When the user submits without <field>  
Then the system shows "<message>"  
And the account is not created

Examples:

| field        | message                  |
| ------------ | ------------------------ |
| Account Code | Account Code is required |
| Account Name | Account Name is required |
| Account Type | Account Type is required |
| Organization | Organization is required |
| Status       | Status is required       |

---

## Account Edit / Deactivate / Delete

### Scenario 7: Edit active account metadata

Given an active account has no restriction preventing the requested change  
When an authorized user edits an allowed non-historical attribute  
Then the system validates the change  
And preserves the audit history.

### Scenario 8: Prevent changing immutable account identity after posting where restricted

Given an account is referenced by posted ledger lines  
When a user attempts to change a protected identity or structural attribute  
Then the system blocks the change according to the configured accounting policy  
And historical ledger meaning remains preserved.

### Scenario 9: Deactivate account used by historical postings

Given an account has posted ledger references  
When an authorized user deactivates the account  
Then the account remains available for historical reporting  
And the account cannot be used for new postings.

### Scenario 10: Delete referenced account is blocked

Given an account is referenced by a posted journal or downstream configuration  
When a user attempts to delete the account  
Then deletion is blocked  
And the user must deactivate the account instead where permitted.

### Scenario 11: Inactive account blocks new posting

Given an account is inactive  
When a new journal attempts to post to the account  
Then the system rejects the journal  
And no ledger entry is created for that account.

---

# Journal Entry Management

## Create / Validate

### Scenario 12: Create balanced draft journal

Given an authorized Finance User enters valid journal lines  
When total debit equals total credit  
Then the system saves the journal as a valid draft  
And the journal is not yet part of the authoritative posted ledger.

### Scenario 13: Reject unbalanced draft journal

Given an authorized Finance User creates a journal  
When total debit does not equal total credit  
Then the system rejects posting  
And identifies that total debit must equal total credit  
And no authoritative ledger entries are created.

### Scenario 14: Reject line containing both debit and credit

Given a user enters a journal line  
When the same line contains both a positive debit and a positive credit amount  
Then the system rejects the line  
And requires a valid debit-only or credit-only representation.

### Scenario 15: Reject journal without debit or credit side

Given a journal contains only debit lines or only credit lines  
When the user validates the journal  
Then the system rejects the journal  
And no posting can occur.

### Scenario Outline: Mandatory journal field validation

Given the user is creating a journal  
When the user submits without <field>  
Then the system shows "<message>"  
And the journal is not posted

Examples:

| field         | message                               |
| ------------- | ------------------------------------- |
| Business Date | Business Date is required             |
| Journal Type  | Journal Type is required              |
| Description   | Description is required               |
| Account       | Account is required                   |
| Journal Lines | At least one journal line is required |

---

## Money Validation

### Scenario 16: Reject floating-point money persistence

Given a financial request contains a monetary amount  
When the amount does not satisfy the integer-paise API contract  
Then the system rejects the request  
And does not persist floating-point financial values.

### Scenario 17: Reject zero-value journal line

Given a user creates a journal line  
When both debit and credit amounts are zero  
Then the system rejects the line  
And the zero-value line is not posted.

### Scenario 18: Journal totals are calculated in integer paise

Given a journal contains multiple debit and credit lines  
When the system calculates totals  
Then totals are calculated using integer paise  
And exact equality is checked without floating-point rounding behavior.

---

# Posting Source Transactions

### Scenario 19: Post loan disbursal journal

Given an approved disbursal is ready for authoritative posting  
When the disbursal financial transaction succeeds  
Then the system debits the configured Loan Principal Receivable / Loans Outstanding account  
And credits the configured Funding Bank, Cash or Disbursal Payable account  
And total debit equals total credit.

### Scenario 20: Post normal EMI collection journal

Given a valid customer collection is posted  
When the authoritative allocation is available  
Then the system debits Cash/Bank Clearing for the collected amount  
And credits Penalty Receivable, Interest Receivable, Principal Receivable and Fee Receivable according to the allocation  
And total debit equals total credit.

### Scenario 21: Post field cash collection journal

Given a Field Employee receives customer cash  
When the collection is posted  
Then the system debits Field Agent Cash-in-Hand  
And credits the applicable penalty, interest, principal and fee receivable accounts  
And total debit equals total credit.

### Scenario 22: Post field cash handover journal

Given a Field Employee hands cash to the branch  
When the handover is authoritatively received  
Then the system debits Branch Cash-in-Hand / Branch Cash  
And credits Field Agent Cash-in-Hand  
And no second customer payment is created  
And total debit equals total credit.

### Scenario 23: Post part-payment allocation

Given a customer pays less than the total outstanding amount  
When the payment journal is created  
Then allocation is applied in the exact order penalty, interest, principal and fees  
And the journal credits only the amounts allocated to each component  
And total debit equals total credit.

---

# Idempotency

### Scenario 24: Post financial source event with Idempotency-Key

Given a source transaction is ready to create a money movement  
When the request includes a valid unique Idempotency-Key  
Then the system creates the journal once  
And stores the source and idempotency relationship.

### Scenario 25: Retry the same financial posting

Given a source transaction was already posted using an Idempotency-Key  
When the same logical request is retried with the same key  
Then the system returns the existing authoritative result  
And no duplicate journal or ledger lines are created.

### Scenario 26: Reuse idempotency key with different financial request

Given an Idempotency-Key is associated with an existing source request  
When a materially different request uses the same key  
Then the system rejects the request as an idempotency conflict  
And the original journal remains unchanged.

### Scenario 27: Duplicate source transaction is rejected

Given a source transaction already has an authoritative journal  
When another process attempts to post the same source event as a new financial event  
Then the system prevents duplicate authoritative posting  
And preserves the original journal reference.

---

# Journal Posting

### Scenario 28: Post valid balanced journal atomically

Given a draft journal is valid and balanced  
When an authorized user posts the journal  
Then all journal and ledger lines are committed atomically  
And the journal status becomes posted  
And total debit equals total credit.

### Scenario 29: Posting failure rolls back journal

Given a journal is being posted  
When any line fails validation or persistence  
Then the posting fails as one transaction  
And the journal is not partially posted  
And no partial authoritative ledger lines remain.

### Scenario 30: Post to inactive account is rejected

Given a draft journal references an inactive account  
When the user attempts to post  
Then the system rejects the posting  
And the journal remains unposted.

### Scenario 31: Branch scope mismatch is rejected during posting

Given a journal belongs to Branch A  
When a journal line references an account or source transaction not permitted for Branch A  
Then the system rejects the posting  
And no cross-branch ledger movement is created.

---

# View / General Ledger

### Scenario 32: View ledger entries by account

Given posted journals exist for an authorized account  
When the Finance User opens the General Ledger  
Then the system displays entries for the permitted account and scope  
And displays journal reference, business date, debit and credit amounts.

### Scenario 33: View journal source transaction

Given a posted journal originated from a loan, disbursal, collection or recovery transaction  
When an authorized user opens the journal details  
Then the system displays the source module and source transaction reference  
And the source relationship is traceable without allowing unauthorized source access.

### Scenario 34: Branch Admin cannot view another branch's ledger

Given ledger entries exist for Branch A and Branch B  
And the Branch Admin belongs only to Branch A  
When the Branch Admin queries the General Ledger  
Then only Branch A-permitted entries are returned  
And Branch B entries are not exposed.

---

# Edit / Immutability

### Scenario 35: Edit draft journal where permitted

Given a journal is still in draft state  
And the user has permission to edit it  
When the user changes allowed journal data  
Then the system validates the updated journal  
And records the change in the audit history.

### Scenario 36: Edit posted journal is blocked

Given a journal has been posted  
When a user attempts to edit the journal header, account lines or amounts  
Then the system blocks the edit  
And instructs the user to use reversal or an authorized adjustment  
And the original ledger remains unchanged.

### Scenario 37: Delete posted journal is blocked

Given a journal has been posted  
When a user attempts to delete it  
Then deletion is blocked  
And the journal remains permanently traceable through retention rules.

### Scenario 38: Delete draft journal referenced downstream is blocked

Given a draft journal is referenced by an approval, source workflow or downstream process  
When a user attempts to delete it  
Then deletion is blocked  
And the user must cancel or close it through the permitted lifecycle action.

---

# Reversal

### Scenario 39: Reverse posted journal

Given a journal has been successfully posted  
And the user has permission to reverse it  
When the user provides a valid reversal reason  
Then the original journal remains unchanged  
And a new reversal journal is created  
And the reversal references the original journal.

### Scenario 40: Reversal creates opposite debit and credit lines

Given the original journal contains debit and credit lines  
When the journal is reversed  
Then each reversal effect is opposite to the original financial effect  
And total reversal debit equals total reversal credit  
And the original journal remains immutable.

### Scenario 41: Prevent duplicate reversal

Given a journal has already been reversed  
When a user attempts to reverse the same original journal again  
Then the system rejects the duplicate reversal  
And no additional reversal journal is created.

### Scenario 42: Reversal posting failure

Given a reversal is being processed  
When the reversal journal fails validation or persistence  
Then the original journal remains posted and unchanged  
And the journal is not falsely marked reversed  
And no partial reversal remains authoritative.

---

# Authorized Adjustments

### Scenario 43: Create authorized adjusting journal

Given a financial adjustment is required  
And the user has permission to create an adjustment  
When the user provides a valid reason and balanced accounting lines  
Then the system creates an adjustment journal  
And preserves the adjustment reason and source context.

### Scenario 44: Manual adjustment without permission is denied

Given the user lacks manual adjustment permission  
When the user attempts to create or post an adjustment  
Then the system denies the action  
And no journal is posted  
And the denial is audit logged.

### Scenario 45: Adjustment cannot edit historical journal

Given a posted journal requires correction  
When an authorized adjustment is created  
Then the adjustment creates a new accounting event  
And the historical journal is not edited or deleted.

---

# Active / Inactive Behaviour

### Scenario 46: Active account can receive authorized postings

Given an account is active and postable  
When a valid authorized journal references the account  
Then the account may receive the posting  
Subject to organization and branch scope validation.

### Scenario 47: Inactive account remains available for history only

Given an account has been deactivated  
When an authorized user views historical ledger entries  
Then the account and historical postings remain visible  
And the account cannot be used for new postings.

---

# Permission Denial

### Scenario 48: Wrong role attempts account creation

Given the user lacks Chart of Accounts management permission  
When the user attempts to create an account  
Then the system denies the action  
And no account is created  
And the denial is audit logged.

### Scenario 49: Wrong role attempts journal posting

Given the user lacks journal posting permission  
When the user attempts to post a journal  
Then the system denies the action  
And the journal remains unposted  
And no ledger lines are created.

### Scenario 50: Wrong role attempts journal reversal

Given the user lacks reversal permission  
When the user attempts to reverse a posted journal  
Then the system denies the action  
And the original journal remains unchanged  
And the denial is audit logged.

---

# Branch / Organization Scoping

### Scenario 51: Branch user cannot post for another branch

Given the user belongs to Branch A  
And the source transaction belongs to Branch B  
When the user attempts to create or post the financial entry  
Then the system denies the operation  
And no Branch B journal is created.

### Scenario 52: Cross-organization journal access is denied

Given a journal belongs to Organization B  
And the authenticated user belongs to Organization A  
When the user requests or modifies the journal  
Then the system denies access  
And Organization B financial data is not exposed or modified.

### Scenario 53: Client-supplied branch cannot override server scope

Given the authenticated user is scoped to Branch A  
When the client submits Branch B in the journal request  
Then the server independently validates scope  
And rejects the unauthorized branch operation.

---

# Offline / Sync / Conflict

### Scenario 54: Offline source payment remains non-authoritative

Given a field collection or other supported source transaction is created while offline  
When the client stores the transaction locally  
Then the accounting journal is not treated as authoritatively posted until server synchronization succeeds.

### Scenario 55: Offline retry does not duplicate journal

Given an offline source transaction was successfully posted by the server  
And the client retries due to a lost response  
When synchronization repeats using the same stable transaction identity and idempotency data  
Then the system returns the existing journal result  
And no duplicate journal or ledger lines are created.

### Scenario 56: Sync conflict does not overwrite ledger

Given a stale or conflicting offline transaction reaches the server  
When it conflicts with an authoritative financial state  
Then the system rejects or routes the conflict according to the defined resolution rules  
And does not overwrite the authoritative journal.

### Scenario 57: Stale draft journal update is rejected

Given two authorized users open the same draft journal  
And one user updates it first  
When the other user submits a stale version  
Then the system rejects the stale update  
And the newer draft remains unchanged.

---

# Reconciliation

### Scenario 58: Source transaction reconciles to journal

Given an authoritative source transaction has been posted  
When an authorized reconciliation process checks the accounting records  
Then the system can trace the source transaction to its journal  
And the journal line totals balance exactly.

### Scenario 59: Detect missing journal for posted source event

Given a source transaction is marked financially posted  
When reconciliation cannot find the required authoritative journal  
Then the system flags the inconsistency  
And does not silently fabricate a balancing entry.

### Scenario 60: Detect duplicate journal for source event

Given a source transaction should map to one authoritative posting  
When reconciliation detects multiple conflicting authoritative journals  
Then the system flags the inconsistency for controlled investigation  
And does not automatically delete historical records.

---

# Failure Paths

### Scenario 61: Ledger imbalance is rejected

Given the system prepares a journal  
When total debit paise does not equal total credit paise  
Then the journal is rejected  
And no authoritative ledger entries are committed  
And the failure is audit logged.

### Scenario 62: Invalid source allocation blocks posting

Given a collection source event contains an allocation that does not reconcile to the collected amount  
When accounting posting is attempted  
Then the posting is rejected  
And no partial journal is committed.

### Scenario 63: Duplicate journal reference is rejected

Given a journal reference already belongs to an existing authoritative journal  
When another journal attempts to use the same reference  
Then the system rejects the duplicate reference  
And the existing journal remains unchanged.

### Scenario 64: Account configuration failure blocks posting

Given a required debit or credit account is missing, inactive or invalid  
When a source transaction attempts financial posting  
Then the posting fails atomically  
And no partial ledger entries remain.

---

# Audit

### Scenario 65: Account creation and deactivation are audit logged

Given an authorized user creates or deactivates an account  
When the action completes  
Then the audit history records the actor, organization, affected account and timestamp.

### Scenario 66: Journal posting is audit logged

Given a journal is successfully posted  
When the posting completes  
Then the audit history records the journal reference, source transaction, actor/process and posting timestamp.

### Scenario 67: Journal reversal is audit logged

Given a posted journal is reversed  
When reversal completes  
Then the audit history records the original journal, reversal journal, actor, reason and timestamp.

### Scenario 68: Failed or denied accounting action is audit logged

Given an accounting action fails or is denied  
When the system handles the outcome  
Then the audit history records the action, actor/process and failure or denial context.

---

# Acceptance Criteria

- Every accounting and ledger record is scoped by organization and applicable branch scope.
- Server-side authorization prevents unauthorized cross-branch and cross-organization accounting access.
- All money is represented as integer paise.
- Floating-point financial storage is prohibited.
- Every authoritative money movement creates balanced double-entry entries.
- Every journal satisfies exact equality between total debit and total credit.
- A posted journal is immutable.
- The ledger is append-only.
- Posted ledger entries cannot be edited or deleted.
- Corrections are represented through reversal or authorized adjusting entries.
- Every reversal references the original journal and preserves it unchanged.
- Duplicate reversal is prevented unless a defined correction workflow explicitly permits a subsequent event.
- Money-posting operations use Idempotency-Key controls where applicable.
- Retrying the same logical posting cannot create duplicate journals.
- Reusing an idempotency key for a different financial request is rejected.
- Duplicate posting of the same source financial event is prevented.
- Normal loan disbursal debits the configured Loan Principal Receivable/Loans Outstanding account and credits the configured funding account.
- Normal customer collection debits Cash/Bank Clearing and credits penalty, interest, principal and fee receivable accounts according to allocation.
- Field cash collection debits Field Agent Cash-in-Hand and credits applicable receivable accounts.
- Field cash handover debits Branch Cash-in-Hand/Branch Cash and credits Field Agent Cash-in-Hand.
- A field cash handover does not create a second customer repayment.
- Part-payment appropriation remains penalty → interest → principal → fees.
- Source transaction allocation must reconcile exactly to the accounting journal.
- Account codes are unique within the configured chart-of-accounts scope.
- Account hierarchy cannot contain circular references.
- Inactive accounts cannot receive new postings.
- Referenced accounts cannot be physically deleted.
- Inactive accounts remain available for authorized historical reporting.
- Journal posting and reversal are atomic.
- Failed postings cannot leave partial authoritative ledger entries.
- Posted journals cannot be edited or deleted.
- Draft journals can be edited only by authorized users and subject to concurrency controls.
- Manual journals and adjustments require explicit permission.
- Manual adjustments cannot overwrite historical journals.
- Offline source events remain non-authoritative until server synchronization and posting succeed.
- Duplicate offline retries are idempotent.
- Sync conflicts cannot overwrite authoritative financial records.
- Reconciliation can trace source transactions to authoritative journals.
- Missing or duplicate source-to-journal relationships are detectable.
- Permission denials, posting failures and conflicts are audit logged.
- All create, view, add, edit where permitted, deactivate, delete blocking, post, reverse, branch scoping, offline, sync conflict and failure paths are covered.
- All actions are audit logged.

# Open Questions

1. What is the final chart-of-accounts structure for the LMS?
2. Are accounts maintained only at organization level, only at branch level, or through both levels?
3. Which accounts are mandatory for every organization before transactions can be posted?
4. What are the exact account codes and names for:
   - Loan Principal Receivable
   - Interest Receivable
   - Penal Interest/Penalty Receivable
   - Fee Receivable
   - Cash/Bank Clearing
   - Field Agent Cash-in-Hand
   - Branch Cash-in-Hand
   - Funding Bank
   - Disbursal Payable
5. Are principal, interest, penalty and fee accounts assets/receivables, or is a separate revenue-recognition posting model required?
6. Does the LMS use cash basis, accrual basis, or a hybrid accounting model?
7. When interest accrues, is revenue recognized immediately through separate accrual journals?
8. How are EMI schedule generation and accounting accruals linked?
9. How are interest receivable and interest income related in the chart of accounts?
10. How are penalty receivable and penalty income related?
11. How are fees recognized: directly on collection or on accrual?
12. Is there a separate journal for loan disbursal fees?
13. Is a manual journal feature required in the MVP, or should all journals originate from source modules?
14. Which roles can create, approve and post manual journals?
15. Is maker-checker approval required before journal posting?
16. Which journal types are supported?
17. What is the canonical journal status enum?
18. What journal reference format and sequencing rules are required?
19. Is journal numbering gapless, and if so, at what scope?
20. Can journals be backdated, and which roles can authorize backdating?
21. What happens when a posting is requested for a closed accounting period?
22. Are accounting periods and period close part of Module 14 or Module 17 Settings, Audit & Maintenance?
23. Can a posted journal be reversed across a different accounting date or period?
24. Is partial journal reversal allowed?
25. Is reversal-of-reversal allowed?
26. What exact workflow handles a correction after a reversal?
27. Which adjusting journal types are permitted?
28. What approval and evidence are required for manual adjustments?
29. How are write-offs posted to the ledger?
30. How are recoveries after write-off posted?
31. How are foreclosure settlements posted?
32. How are waived EMIs, interest, penalties or fees posted?
33. How are discounts or settlement concessions posted?
34. How are cash shortages and excesses from Module 12 posted?
35. Which accounts are used for field-agent shortages and excesses?
36. Does branch cash handover always post immediately, or only after reconciliation?
37. Is Field Agent Cash-in-Hand maintained as a separate account per agent or one control account with subledger tracking?
38. What payment modes map to which debit accounts?
39. For UPI/bank payments, is the debit posted to clearing first or directly to bank?
40. What is the idempotency retention period for financial postings?
41. What API response code is used for idempotency conflicts?
42. What optimistic locking mechanism is used for draft journals?
43. Which source transaction statuses are considered financially final?
44. Can accounting entries be generated asynchronously, and if so, what consistency guarantees are required?
45. What happens if the source transaction succeeds but asynchronous journal posting fails?
46. Is a suspense account allowed for exceptional posting failures?
47. If a suspense account exists, who can clear it and under what approval?
48. What reconciliation frequency is required: real-time, daily EOD, or both?
49. What financial reports must reconcile directly to this ledger?
50. What retention and compliance rules apply to accounting records?
51. Are external accounting integrations required?
52. If external accounting export exists, is export state tracked per journal?
53. Which accounting controls belong in Module 17 versus this module?

# End of Module 14
