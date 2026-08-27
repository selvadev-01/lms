yudfdavs# Module 10 — Repayment Schedule

## User Story — Repayment Schedule

### Epic

Loan Repayment Management

### Feature

Repayment Schedule Generation, Viewing and Controlled Regeneration

### User Story

As an authorized LMS user
I want to view the repayment schedule generated for a disbursed loan
So that I can see every EMI due date, amount, outstanding balance and payment status.

As the system
I want to generate the repayment schedule from the finalized loan terms after disbursement
So that EMI tracking and collection operate from one authoritative schedule.

## Rules & Business Constraints

1. A repayment schedule is generated only after successful loan disbursement.
2. The schedule must be generated from finalized loan terms applicable at disbursement.
3. Every EMI due date is stored as a DATE only; no time component is allowed.
4. EMI due dates use the Asia/Kolkata business date.
5. Money is always stored and calculated as integer paise. Floating-point values must never be used.
6. The repayment schedule contains all EMI dates and amounts.
7. EMI calculation follows the configured loan product and interest method.
8. The exact EMI formula and rounding policy are governed by the Calculation Engine rules.
9. The amortisation schedule must sum exactly to the contractual total payable.
10. Rounding residue must be handled deterministically.
11. The schedule is the authoritative basis for EMI tracking and collection.
12. A generated EMI is not automatically a payment.
13. Schedule generation must not create a collection receipt.
14. Schedule generation must not itself create a customer payment ledger movement.
15. Every record is scoped by organization and branch.
16. Organization and branch scope are enforced server-side.
17. A Branch Admin cannot view another branch's repayment schedule.
18. A Field Employee may view only schedules for assigned loans.
19. A customer may view only their own schedule where customer access is enabled.
20. Cross-organization schedules must never be visible.
21. Deletion is blocked once downstream collection, allocation or financial references exist.
22. Financially relevant schedule history is never physically deleted.
23. Corrections after financial activity must preserve historical traceability.
24. Arbitrary editing of generated EMI rows is not allowed.
25. Loan-term changes must not silently mutate an authoritative schedule.
26. Allowed regeneration must preserve the old version as superseded with audit traceability.
27. Generation failure must not falsely activate collection.
28. Generation failure must have a defined retry/recovery path.
29. Concurrent generation must not create duplicate EMI rows.
30. Generation must be idempotent for the same loan/disbursement version.
31. Stale clients cannot overwrite a newer schedule.
32. EMI due status must use authoritative business-date evaluation.
33. Part-payments must not rewrite the contractual EMI amount.
34. Active/inactive behavior must not allow an ineligible loan to enter a new collection cycle.
35. Permission denials are audit logged.
36. Generation, regeneration, retry and failure actions are audit logged.
37. All actions are audit logged.

## Background

Given the user is logged into the system
And the user has permission to view or manage repayment schedules
And the loan belongs to the user's authorized organization and branch
And the loan has been successfully disbursed
And the finalized loan terms are available

The flow is:

Loan Disbursement
→ Repayment Schedule Generated & Shared
→ EMI Calculation / Schedule
→ Collection Cycle Begins
→ EMI Due Date Arrives
→ EMI Paid or Missed

# Feature: Repayment Schedule Management

## Menu

Loan Management
→ Loans
→ Repayment Schedule

Route: `/loans/:id/repayment-schedule`

Actions: List, View Details, Generate, Retry Generation, Regenerate Where Allowed, View EMI Details, View Payment Status

## Repayment Schedule — Fields

### Loan Summary

- Loan ID *
- Customer *
- Loan Status *
- Principal Amount *
- Interest Rate *
- Interest Method *
- Loan Duration *
- Repayment Frequency *
- Disbursement Date *

### Schedule Summary

- Total EMI Count *
- Total Payable *
- Total Principal *
- Total Interest *
- Total Paid
- Outstanding Amount *
- Next EMI Date

### EMI Schedule

- Installment Number *
- Due Date *
- Opening Principal Balance
- EMI Amount *
- Principal Component
- Interest Component
- Paid Amount
- Outstanding Amount *
- Status *
- Paid Date

## Table Only (Not for UI)

```text
organization_id
branch_id
loan_id
disbursement_id
schedule_version
schedule_status
installment_number
due_date
opening_principal_paise
emi_amount_paise
principal_component_paise
interest_component_paise
paid_amount_paise
outstanding_amount_paise
emi_status
generated_at
generated_by
superseded_at
superseded_by
version
```

### Core Constraints

```text
All money values = integer paise
due_date = DATE
timezone/business date = Asia/Kolkata

SUM(principal_component_paise) = financed principal amount
SUM(EMI amounts) = exact contractual total payable
```

## Schedule / EMI States

```text
SCHEDULE_GENERATED
        ↓
COLLECTION_ACTIVE
        ↓
PENDING
        ↓
DUE
        ↓
PARTIALLY_PAID / PAID
        ↓
OVERDUE
        ↓
CLOSED / SETTLED
```

The exact persisted enum and transition rules must align with the EMI Collection and Overdue modules.

# Gherkin Scenarios

## List / View

### Scenario 1: View generated repayment schedule

Given a disbursed loan has a successfully generated repayment schedule
When the user opens the repayment schedule
Then the system displays the loan summary
And displays every installment number, due date, EMI amount and status
And all money values are derived from integer paise values.

### Scenario 2: List schedules within branch scope

Given multiple loans exist across Branch A and Branch B
And the Branch Admin belongs to Branch A
When the Branch Admin views repayment schedules
Then only Branch A schedules are returned
And Branch B schedules are excluded.

### Scenario 3: View schedule details

Given the user has access to the loan
When the user opens an EMI row
Then the system displays due date, EMI amount, principal component, interest component, paid amount and outstanding amount.

### Scenario 4: Customer views own repayment schedule

Given customer schedule access is enabled
And the loan belongs to the authenticated customer
When the customer opens the repayment schedule
Then only that customer's own loan schedule is displayed
And schedules belonging to other customers are inaccessible.

### Scenario 5: Field Employee views assigned loan schedule

Given a Field Employee has been assigned a loan
When the Field Employee opens the repayment schedule
Then the schedule is displayed for that assigned loan
And schedules for unassigned loans are denied.

## Generate

### Scenario 6: Generate repayment schedule after successful disbursement

Given the loan has been successfully disbursed
And the finalized loan terms are available
When the system generates the repayment schedule
Then all EMI dates and amounts are generated
And the schedule is linked to the loan and disbursement
And collection tracking can begin after successful generation.

### Scenario 7: Schedule generation before disbursement is blocked

Given the loan has not been successfully disbursed
When a user or process attempts to generate the authoritative repayment schedule
Then the system blocks the operation
And no active collection schedule is created.

### Scenario 8: Schedule uses finalized loan terms

Given finalized principal, interest method, rate, duration and repayment frequency are available
When the schedule is generated
Then the system uses those authoritative terms
And does not use stale client-side values.

### Scenario 9: EMI due dates are DATE-only

Given a repayment schedule is generated
When EMI due dates are stored
Then every due date is stored without a time component
And due-date processing uses the Asia/Kolkata business date.

### Scenario 10: Money is generated as integer paise

Given a schedule is generated
When EMI amounts and components are calculated
Then all monetary values are persisted as integer paise
And floating-point persistence is not used.

## Mandatory Field Validation

### Scenario Outline: Mandatory source data validation

Given the system is preparing to generate a repayment schedule
When the authoritative loan data is missing <field>
Then schedule generation fails with "<message>"
And no partial authoritative schedule is activated

Examples:

| field               | message                         |
| ------------------- | ------------------------------- |
| Principal Amount    | Principal Amount is required    |
| Interest Rate       | Interest Rate is required       |
| Interest Method     | Interest Method is required     |
| Loan Duration       | Loan Duration is required       |
| Repayment Frequency | Repayment Frequency is required |
| Disbursement Date   | Disbursement Date is required   |

## Calculation Integrity

### Scenario 11: Principal components reconcile exactly

Given a loan principal has been used to generate a schedule
When all principal components are summed
Then the total equals the financed principal exactly
And no paise difference remains unexplained.

### Scenario 12: Total payable reconciles exactly

Given the repayment schedule has been generated
When all EMI amounts are summed
Then the result equals the exact contractual total payable
And no rounding difference remains outside the schedule.

### Scenario 13: Rounding residue is deterministic

Given EMI calculation produces a rounding residue
When the schedule is generated
Then the residue is handled according to the configured Calculation Engine rule
And the same inputs always produce the same schedule
And the total schedule remains mathematically exact.

### Scenario 14: Recalculation with identical inputs is deterministic

Given two generation attempts use identical authoritative loan inputs
When the calculation engine generates the schedule
Then the resulting installment dates and paise amounts are identical
And no random rounding difference occurs.

## Edit / Regeneration

### Scenario 15: Direct edit of an EMI amount is blocked

Given an authoritative repayment schedule exists
When a user attempts to directly edit an individual EMI amount
Then the system blocks the arbitrary edit
And the original schedule remains unchanged.

### Scenario 16: Regenerate schedule before downstream transactions where allowed

Given the finalized business policy allows regeneration
And no downstream collection or financial reference blocks the operation
When an authorized user regenerates the schedule
Then the new schedule is generated from the authoritative terms
And the previous version is preserved as superseded
And the regeneration is audit logged.

### Scenario 17: Regeneration after payment activity is blocked

Given one or more EMI rows have downstream payment or allocation references
When a user attempts ordinary schedule regeneration
Then the system blocks the operation
And historical repayment data remains unchanged.

### Scenario 18: Unauthorized user cannot regenerate schedule

Given the user lacks repayment-schedule management permission
When the user attempts to generate or regenerate a schedule
Then the system denies the action
And no schedule state changes
And the denial is audit logged.

## Delete / Deactivate

### Scenario 19: Delete schedule referenced by collections is blocked

Given the repayment schedule has one or more downstream collection references
When a user attempts to delete the schedule
Then deletion is blocked
And the schedule history remains available.

### Scenario 20: Delete completed EMI record is blocked

Given an EMI has payment or ledger-linked downstream activity
When a user attempts to delete that EMI record
Then the system blocks deletion
And the financial history remains intact.

### Scenario 21: Deactivate does not erase repayment history

Given a loan or schedule becomes inactive under a valid lifecycle action
When the user views historical repayment data
Then existing schedule and transaction history remain visible to authorized users
And no historical installment is physically removed.

### Scenario 22: Inactive loan cannot start a new ordinary schedule

Given the loan is inactive or otherwise not eligible for repayment processing
When the system attempts to generate a new ordinary schedule
Then generation is blocked
And collection is not activated.

## EMI Status / Due Processing

### Scenario 23: Future EMI remains pending

Given an EMI due date is in the future according to Asia/Kolkata business date
When the system evaluates the installment
Then the EMI remains pending
And it is not marked overdue.

### Scenario 24: EMI reaches its due date

Given the current Asia/Kolkata business date equals the EMI due date
When due-date processing occurs
Then the installment becomes due according to the EMI lifecycle
And it becomes available for collection.

### Scenario 25: Partial payment preserves contractual EMI

Given an EMI receives a partial payment
When the payment allocation is completed
Then the original contractual EMI amount remains unchanged
And paid and outstanding amounts are updated according to collection allocation rules.

### Scenario 26: Fully paid EMI

Given the EMI outstanding amount reaches zero after valid allocation
When payment processing completes
Then the EMI status becomes paid
And the paid amount and outstanding amount reconcile exactly.

### Scenario 27: Missed EMI enters downstream overdue flow

Given an EMI remains unpaid after its due date
When the applicable grace/overdue processing conditions are reached
Then the installment enters the overdue lifecycle
And penalty/recovery processing follows the applicable downstream module rules.

## Failure / Retry

### Scenario 28: Schedule generation failure

Given the loan was successfully disbursed
When schedule generation fails
Then the system does not falsely mark the schedule as generated
And collection activation is not falsely completed
And the failure is audit logged.

### Scenario 29: Retry failed schedule generation

Given a previous generation attempt failed
And the authoritative loan terms remain valid
When an authorized retry is initiated
Then the system retries generation
And creates only one authoritative schedule
And the retry is audit logged.

### Scenario 30: Partial generation is rolled back or isolated

Given schedule generation fails after processing begins
When the failure occurs before authoritative completion
Then incomplete EMI rows are not exposed as an active repayment schedule
And the system preserves a consistent authoritative state.

### Scenario 31: Duplicate generation request

Given a schedule generation request is already processing or has completed
When the same logical request is retried
Then the system returns the authoritative existing result
And duplicate EMI rows are not created.

## Permission Denial

### Scenario 32: Wrong role attempts schedule management

Given the user lacks permission to manage repayment schedules
When the user attempts generation, regeneration or protected schedule actions
Then the system returns permission denied
And no protected state changes
And the denial is audit logged.

## Branch / Organization Scoping

### Scenario 33: Branch Admin cannot view another branch schedule

Given Branch Admin A belongs to Branch A
And the loan belongs to Branch B
When Branch Admin A requests the repayment schedule
Then access is denied
And no Branch B repayment data is returned.

### Scenario 34: Cross-organization access is denied

Given the repayment schedule belongs to Organization B
And the authenticated user belongs to Organization A
When the user requests the schedule
Then the system denies access
And no protected data is returned.

### Scenario 35: Client cannot override branch scope

Given the authenticated user belongs to Branch A
When the client submits a request containing Branch B
Then the server ignores or rejects the unauthorized branch value
And server-side scope remains authoritative.

## Stale Data / Offline / Sync Conflict

### Scenario 36: Stale schedule generation request

Given the client holds an older version of the loan terms
And the authoritative loan terms have changed
When the client requests schedule generation using stale data
Then the server rejects or resolves the stale request
And the schedule is not generated from outdated terms.

### Scenario 37: Offline view uses cached data only as non-authoritative

Given a Field Employee is offline
And a repayment schedule was previously cached for an assigned loan
When the employee views the schedule
Then the application may display the cached schedule
And clearly treats it as potentially stale
And no offline edit can overwrite the authoritative schedule.

### Scenario 38: Sync conflict does not overwrite authoritative schedule

Given a device contains stale repayment schedule metadata
And the server has a newer authoritative version
When synchronization occurs
Then the stale version does not overwrite the server version
And the conflict is recorded according to the synchronization policy.

### Scenario 39: Server-side due-date evaluation

Given a client device has an incorrect clock
When the system determines whether an EMI is due
Then the authoritative server/business-date evaluation is used
And the client clock does not independently change EMI state.

## Concurrency

### Scenario 40: Concurrent schedule generation

Given two authorized processes attempt to generate the schedule for the same disbursement
When both requests execute concurrently
Then only one authoritative schedule is created
And the other request receives the authoritative result or conflict response
And duplicate EMI rows are not created.

### Scenario 41: Concurrent regeneration conflict

Given two users attempt to regenerate an eligible schedule simultaneously
When one regeneration becomes authoritative
Then the second stale request cannot overwrite it
And version/history information remains consistent.

## Audit

### Scenario 42: Schedule generation is audit logged

Given a repayment schedule is generated
When generation completes
Then the audit trail records the loan, organization, branch, actor/process, timestamp and schedule version.

### Scenario 43: Schedule regeneration is audit logged

Given an authorized schedule regeneration occurs
When the new version is activated
Then the audit trail records the previous and new schedule versions
And the reason and actor are retained where required.

### Scenario 44: Failed generation is audit logged

Given schedule generation fails
When the failure is handled
Then the audit trail records the failure context
And the authoritative schedule state is not falsely reported as successful.

### Scenario 45: Permission denial is audit logged

Given a user attempts an unauthorized repayment-schedule action
When access is denied
Then the denial is recorded in the audit history.

# Acceptance Criteria

- A repayment schedule is generated only after successful loan disbursement.
- The generated schedule contains all EMI due dates and amounts.
- EMI due dates are stored as DATE only.
- EMI due-date evaluation uses Asia/Kolkata business date.
- All money values are integer paise.
- Floating-point money storage is prohibited.
- The schedule uses authoritative finalized loan terms.
- Principal components reconcile exactly to the financed principal.
- EMI totals reconcile exactly to the contractual total payable.
- Rounding behavior is deterministic and follows the Calculation Engine rules.
- The schedule becomes the authoritative basis for EMI tracking.
- Generation does not create an EMI payment or collection receipt.
- Branch and organization scoping are enforced server-side.
- Branch Admins cannot access another branch's repayment schedules.
- Field Employees can view only assigned loan schedules.
- Customers can view only their own schedules where customer access is enabled.
- Unauthorized users cannot generate, regenerate or access protected schedules.
- Direct arbitrary editing of generated EMI amounts is blocked.
- Regeneration cannot silently overwrite historical schedules.
- Deletion is blocked when downstream references exist.
- Financially referenced schedule history is preserved.
- Inactive or ineligible loans cannot enter a new ordinary repayment schedule flow.
- Duplicate generation cannot create duplicate EMI rows.
- Stale clients cannot overwrite newer schedules.
- Failed generation does not falsely activate collection.
- Retry/recovery of failed generation is controlled and idempotent.
- All generation, regeneration, failure, denial and relevant schedule actions are audit logged.

# Open Questions

1. What is the exact canonical interest formula for each supported interest method?
2. Which loan products use Flat, Reducing and Custom Rate interest?
3. What exact EMI formula applies to each repayment frequency?
4. What is the exact rounding precision before conversion to integer paise?
5. Is rounding residue absorbed into the first installment or last installment?
6. Can the final EMI differ from previous EMIs?
7. How are leap years and month-end due dates handled?
8. Is the first EMI due date based on disbursement date or a configured cycle date?
9. Are holidays and weekends considered when generating due dates?
10. What is the canonical persisted schedule status enum?
11. What is the canonical persisted EMI status enum?
12. Is schedule generation synchronous, asynchronous, or part of the disbursement transaction?
13. What retry policy applies to generation failure?
14. Who can manually retry or regenerate a schedule?
15. Under what exact conditions is regeneration allowed?
16. Does a term change require new sanction or customer agreement?
17. How is an old schedule represented after regeneration?
18. What database uniqueness constraint prevents duplicate installments?
19. What idempotency or deterministic generation key is used?
20. What versioning mechanism detects stale schedule requests?
21. Can an individual EMI ever be manually adjusted?
22. How are waivers, deferrals and loan restructuring handled?
23. What happens to future EMI rows after foreclosure, closure, write-off or disbursement reversal?
24. Does part-payment reduce EMI amount or loan duration?
25. When is the schedule recalculated after part-payment?
26. Can customers download the schedule as PDF?
27. Is the schedule shared through SMS, email or mobile app?
28. What notification is sent when the schedule is generated?
29. Can Field Employees cache schedules offline, and for how long?
30. What conflict response is returned for stale schedule versions?
31. What retention period applies to superseded schedules and completed EMI history?

# End of Module 10
