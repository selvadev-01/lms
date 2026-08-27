# Module 13 — Overdue & Recovery

## User Story — Overdue & Recovery

### Epic

Loan Repayment Management

### Feature

Overdue Identification, Delinquency Tracking, Recovery Actions, Settlement and Write-off Support

### User Story

As a Recovery Officer or authorized Branch User  
I want to identify overdue loans and manage recovery actions against delinquent borrowers  
So that missed repayments are followed up consistently and outstanding amounts are recovered within defined business and compliance rules.

As the system  
I want overdue status, penalty accrual and recovery activity to be derived from authoritative loan and repayment data  
So that delinquency records are deterministic, traceable and cannot be manipulated manually.

---

## Rules & Business Constraints

1. Every overdue and recovery record is scoped by `organization_id` and `branch_id`.
2. Organization and branch scope must be enforced server-side.
3. A Branch Admin cannot view, assign, modify or recover another branch's overdue accounts unless explicitly granted cross-branch permission.
4. Overdue status is derived from authoritative repayment obligations, payments and business dates.
5. EMI due dates are DATE only, with no time component.
6. Business-date evaluation uses Asia/Kolkata.
7. A repayment becomes overdue only according to the canonical EMI and overdue state rules.
8. Recovery users must not manually mark an EMI overdue if the authoritative schedule does not support that state.
9. Partial payment affects the outstanding balance but does not alter the original contractual EMI amount.
10. Payment allocation remains strictly: **penalty → interest → principal → fees**.
11. All money is stored and calculated as integer paise. Floating-point money is prohibited.
12. Penal interest accrual must be deterministic and replayable.
13. The canonical accrual method must be defined consistently: scheduled job or deterministic calculation from authoritative dates and balances.
14. Recovery calculations must not depend on non-deterministic client device time.
15. Recovery actions do not themselves create customer payment entries.
16. Any recovery payment is posted through the authoritative collection/payment workflow.
17. Every money movement posts balanced double-entry ledger lines where total debits equal total credits.
18. For recovery cash collection, the debit account is the configured cash/clearing asset account and credits are the applicable penalty, interest, principal and fee receivable accounts according to the authoritative allocation.
19. Payment posting requires an `Idempotency-Key`.
20. Retrying the same logical recovery payment must not create duplicate collections, receipts or ledger journals.
21. Receipt numbers follow the configured gapless branch/agent sequence and must support offline operation where field recovery is enabled.
22. A recovery action may be created only by an authorized role.
23. Recovery actions must have a defined lifecycle and cannot be silently overwritten.
24. A completed recovery action cannot be edited in place where it is referenced downstream; a follow-up or corrective action must be created instead.
25. Recovery assignment changes must preserve historical assignment information.
26. A recovery action may be reassigned only by an authorized role.
27. A closed, foreclosed or written-off loan must follow its defined lifecycle rules; ordinary recovery actions must not bypass loan state controls.
28. Written-off loans may still require recovery tracking if the loan lifecycle explicitly supports post-write-off recovery.
29. NPA classification must follow the canonical loan state rules and cannot be manually applied without authorization.
30. A recovery settlement or closure cannot change historical posted payments.
31. Any financial correction uses reversal entries; posted ledger entries are never edited or deleted.
32. The ledger is append-only.
33. Deletion is blocked when an overdue case, recovery action, notice, payment, settlement, ledger entry or downstream report references the record.
34. Deactivation or closure is used instead of destructive deletion where applicable.
35. An inactive Recovery Officer cannot receive new recovery assignments.
36. An inactive or deactivated recovery user retains historical audit references but cannot perform new actions.
37. A stale client update must not overwrite a newer recovery status or assignment.
38. Offline recovery activity remains pending synchronization until server validation succeeds.
39. Offline sync conflicts must not silently overwrite authoritative recovery data.
40. If field recovery GPS evidence is required, GPS failure must be explicitly recorded and follow the configured exception policy.
41. Recovery notes and outcome records must be immutable or versioned according to audit requirements.
42. Sensitive customer and recovery data must be visible only to authorized roles within the permitted organization and branch scope.
43. All overdue identification, accrual, assignment, follow-up, promise-to-pay, settlement, payment, reversal, closure, rejection, conflict and permission-denial actions are audit logged.

---

## Background

Given the user is logged into the system  
And the user has permission to manage overdue or recovery activities  
And the loan belongs to the user's authorized organization and branch  
And the loan has an authoritative repayment schedule  
And overdue status is calculated using the authoritative business date in Asia/Kolkata

The recovery lifecycle is:

`Current`
→ `Overdue`
→ `Recovery Assigned`
→ `Contact / Follow-up`
→ `Promise to Pay / Payment / No Resolution`
→ `Resolved / Continued Recovery / Escalated`
→ `Closed / Foreclosed / Written-off / NPA according to loan lifecycle`

Recovery activity does not replace the authoritative loan state machine.

---

# Feature: Overdue & Recovery Management

## Menu

Collections  
→ Overdue Accounts

Collections  
→ Recovery Cases

Collections  
→ Recovery Actions

Suggested routes:

`/overdues`  
`/overdues/:loanId`  
`/recovery-cases`  
`/recovery-cases/:id`  
`/recovery-actions/:id`

Actions: List, View Details, Assign Recovery Officer, Reassign, Create Follow-up, Record Contact Outcome, Record Promise to Pay, Record Recovery Outcome, Initiate Authorized Collection, Sync Offline Activity, Close Recovery Case, Escalate, Reverse Payment Where Authorized

---

## Overdue Account — Fields

### Loan and Customer Details

```text
Loan ID *
Loan Number *
Customer *
Organization *
Branch *
Loan Status *
Overdue Status *
```

### Overdue Details

```text
Oldest Unpaid EMI Due Date *
Days Past Due *
Overdue Principal
Overdue Interest
Overdue Penalty
Overdue Fees
Total Overdue *
```

### Classification

```text
Delinquency Bucket
NPA Status
Recovery Priority
```

---

## Recovery Case — Fields

### Assignment

```text
Recovery Case ID *
Loan *
Branch *
Assigned Recovery Officer
Assignment Date
Recovery Status *
Priority
```

### Recovery Activity

```text
Action Type *
Action Date *
Outcome *
Next Follow-up Date
Promise-to-Pay Date
Promise-to-Pay Amount
Notes
```

### Field Evidence

```text
Offline Activity UUID
Device ID
GPS Latitude
GPS Longitude
GPS Accuracy
GPS Capture Status
Customer Acknowledgment Reference
```

---

## Recovery Resolution — Fields

```text
Resolution Type *
Resolution Date *
Outstanding Before Resolution
Recovered Amount
Remaining Outstanding
Closure Reason
Approval Reference
```

---

## Table Only (Not for UI)

```text
organization_id
branch_id
loan_id
customer_id
overdue_case_id
recovery_case_id
assigned_user_id
assignment_history
oldest_due_date
days_past_due
overdue_principal_paise
overdue_interest_paise
overdue_penalty_paise
overdue_fees_paise
total_overdue_paise
delinquency_bucket
npa_status
recovery_priority
recovery_status
action_id
action_type
outcome_code
promise_to_pay_date
promise_to_pay_amount_paise
next_follow_up_date
offline_activity_uuid
device_id
gps_latitude
gps_longitude
gps_accuracy
gps_capture_status
version
created_at
updated_at
closed_at
closed_by
```

---

## Money and State Constraints

```text
All money = integer paise

Total Overdue
=
overdue_principal_paise
+ overdue_interest_paise
+ overdue_penalty_paise
+ overdue_fees_paise

Recovery Payment Allocation:

penalty
→ interest
→ principal
→ fees

For every posted recovery payment:

SUM(debit_paise) = SUM(credit_paise)
```

---

# Gherkin Scenarios

## List / View

### Scenario 1: List overdue accounts within branch scope

Given overdue accounts exist in Branch A and Branch B  
And the Branch Admin belongs to Branch A  
When the Branch Admin opens the Overdue Accounts list  
Then only Branch A overdue accounts are returned  
And Branch B records are not returned.

### Scenario 2: View overdue account details

Given an authorized user selects an overdue loan  
When the user opens the overdue details  
Then the system displays the oldest unpaid due date and days past due  
And displays overdue principal, interest, penalty, fees and total overdue  
And displays the current loan and recovery status.

### Scenario 3: View recovery case history

Given a recovery case has assignment and activity history  
When an authorized user opens the case  
Then the system displays the assignment history  
And displays recorded follow-ups and outcomes in chronological order  
And preserves historical actors and timestamps.

### Scenario 4: Recovery Officer views assigned cases only

Given a Recovery Officer is assigned cases within the authorized branch  
When the officer opens the recovery list  
Then only permitted assigned cases are visible  
And unauthorized branch or officer assignments are excluded.

---

## Overdue Identification

### Scenario 5: Mark EMI overdue from authoritative due date

Given an EMI remains unpaid after its due date  
And the authoritative business date is later than the due date according to Asia/Kolkata  
When the overdue evaluation runs  
Then the EMI is marked overdue according to the canonical EMI state rules  
And the overdue status is derived rather than manually fabricated.

### Scenario 6: Partially paid EMI remains overdue when balance remains

Given an EMI is due  
And only part of its authoritative outstanding amount has been paid  
When the overdue evaluation runs after the due date  
Then the remaining unpaid balance is treated according to the overdue rules  
And the original contractual EMI amount remains unchanged.

### Scenario 7: Fully paid EMI is not shown as overdue

Given an EMI has been fully settled  
When the overdue evaluation runs  
Then the EMI is not classified as overdue  
And the related overdue totals exclude the settled obligation.

### Scenario 8: Overdue calculation is deterministic

Given the same repayment schedule, payments, accrual inputs and business date  
When overdue totals are recalculated  
Then the same overdue result is produced  
And the result is replayable from authoritative data.

---

## Mandatory Field Validation

### Scenario Outline: Mandatory recovery action validation

Given an authorized user is creating a recovery action  
When the user submits without <field>  
Then the system shows "<message>"  
And the recovery action is not created

Examples:

| field           | message                     |
| --------------- | --------------------------- |
| Loan            | Loan is required            |
| Action Type     | Action Type is required     |
| Action Date     | Action Date is required     |
| Outcome         | Outcome is required         |
| Recovery Status | Recovery Status is required |

---

## Recovery Assignment

### Scenario 9: Assign overdue case to Recovery Officer

Given an overdue case is available for assignment  
And the selected Recovery Officer is active and authorized for the branch  
When an authorized user assigns the case  
Then the system records the new assignment  
And preserves the assignment history  
And the assignment is audit logged.

### Scenario 10: Reassign recovery case

Given a recovery case is assigned to Recovery Officer A  
When an authorized user reassigns the case to Recovery Officer B  
Then the previous assignment remains in history  
And Recovery Officer B becomes the current assignee  
And the reassignment is audit logged.

### Scenario 11: Reject assignment to inactive user

Given a selected Recovery Officer is inactive or deactivated  
When a user attempts to assign a new recovery case  
Then the system rejects the assignment  
And no active assignment is created for that user.

### Scenario 12: Stale assignment update is rejected

Given two authorized users open the same recovery case  
And one user changes the assignment first  
When the second user submits a stale assignment update  
Then the system rejects the stale update or raises a version conflict  
And the newer authoritative assignment remains unchanged.

---

## Recovery Actions and Follow-up

### Scenario 13: Record customer contact attempt

Given a Recovery Officer is assigned to the case  
When the officer records a contact attempt and outcome  
Then the system stores the action type, date and outcome  
And preserves the actor and audit context  
And the recovery case history is updated.

### Scenario 14: Record successful customer contact

Given the Recovery Officer contacts the borrower  
When the officer records a successful contact outcome  
Then the system stores the outcome and any permitted follow-up information  
And does not alter financial balances.

### Scenario 15: Record promise to pay

Given the borrower agrees to make a future payment  
When the Recovery Officer records a promise to pay  
Then the system stores the promise amount and promised date where required  
And records the next follow-up date  
And the promise does not itself reduce the outstanding balance.

### Scenario 16: Promise-to-pay missed

Given a promise-to-pay date has passed  
And the promised payment was not authoritatively posted  
When the recovery evaluation runs  
Then the case remains open according to the recovery rules  
And the missed promise is visible in recovery history.

### Scenario 17: Record no-contact outcome

Given the Recovery Officer attempted customer contact  
When the customer could not be reached  
Then the system records the unsuccessful outcome  
And allows a permitted next follow-up action  
And the loan financial balances remain unchanged.

---

## Penal Interest / Penalty

### Scenario 18: Calculate overdue penalty deterministically

Given an overdue balance and the configured penalty rules are available  
When penalty is accrued or recalculated  
Then the result is calculated from authoritative dates, balances and configuration  
And all money values are integer paise  
And the same inputs produce the same result.

### Scenario 19: Prevent duplicate penalty accrual

Given penalty has already been authoritatively accrued for a specific eligible period  
When the accrual process is retried  
Then the system does not create duplicate penalty for the same authoritative accrual basis  
And the retry resolves consistently.

### Scenario 20: Penalty correction uses reversal or controlled adjustment

Given an authoritative penalty posting requires correction  
When an authorized correction is performed  
Then the original ledger history is preserved  
And the correction is represented through reversal or an authorized adjusting entry  
And the original posting is not edited or deleted.

---

## Recovery Payment

### Scenario 21: Post recovery payment

Given an authorized recovery user initiates a valid customer payment  
When the payment is posted through the authoritative collection workflow  
Then the system requires an Idempotency-Key  
And records the customer payment exactly once.

### Scenario 22: Recovery payment double entry

Given a recovery payment is successfully posted  
When the accounting journal is created  
Then the system debits the configured Cash/Bank Clearing asset account for the collected amount  
And credits penalty, interest, principal and fee receivable accounts according to the authoritative allocation  
And total debit equals total credit.

### Scenario 23: Recovery part-payment appropriation

Given the customer makes a partial recovery payment  
When the payment is allocated  
Then the system applies the amount in this exact order:

1. Penalty
2. Interest
3. Principal
4. Fees
   And no later applicable component receives payment while an earlier component remains unpaid.

### Scenario 24: Retry same recovery payment idempotently

Given a recovery payment was successfully posted using an Idempotency-Key  
When the same logical request is retried with the same key  
Then the existing authoritative result is returned  
And no duplicate payment, receipt or journal is created.

### Scenario 25: Idempotency conflict

Given an Idempotency-Key already belongs to a recovery payment  
When a materially different payment request uses the same key  
Then the system rejects the request as an idempotency conflict  
And the original payment remains unchanged.

---

## Offline Recovery

### Scenario 26: Record recovery activity while offline

Given a Recovery Officer is working offline  
When the officer records an authorized non-financial recovery activity  
Then the device assigns a stable offline activity UUID  
And stores the activity in the local synchronization queue  
And the activity remains pending server validation.

### Scenario 27: Sync offline recovery activity

Given an offline recovery activity is queued  
When connectivity is restored  
And synchronization succeeds  
Then the server validates user authorization, organization, branch, case and current state  
And records the activity once  
And returns the authoritative result.

### Scenario 28: Duplicate offline sync

Given an offline recovery activity was already accepted by the server  
When the device retries synchronization after a lost response  
Then the system returns the existing authoritative result  
And no duplicate activity is created.

### Scenario 29: Offline recovery sync conflict

Given an offline activity conflicts with a newer authoritative case state  
When synchronization occurs  
Then the system does not silently overwrite the newer state  
And returns a conflict or controlled resolution requirement  
And the conflict is audit logged.

### Scenario 30: GPS capture failure during field recovery

Given GPS evidence is required for a field recovery action  
When the device cannot obtain valid GPS data  
Then the application records the GPS capture as failed  
And does not falsely record successful GPS evidence  
And the action follows the configured exception policy.

---

## Edit

### Scenario 31: Edit pending recovery action where permitted

Given a recovery action is pending and not finalized  
And the user has permission to edit it  
When the user updates an allowed field  
Then the system validates the update  
And preserves the audit history.

### Scenario 32: Edit finalized recovery action is blocked

Given a recovery action has been finalized or referenced downstream  
When a user attempts to alter its historical outcome or financial linkage  
Then the system blocks the direct edit  
And requires a follow-up or authorized correction action.

### Scenario 33: Edit closed case is blocked

Given a recovery case is closed  
When a user attempts to modify the closed case directly  
Then the system blocks the change  
Unless an authorized reopen workflow explicitly permits it.

---

## Delete / Deactivate

### Scenario 34: Delete recovery case referenced downstream is blocked

Given a recovery case has follow-up actions, payments, notices, approvals or reports referencing it  
When a user attempts to delete the case  
Then deletion is blocked  
And the historical recovery trail remains preserved.

### Scenario 35: Delete finalized recovery action is blocked

Given a recovery action is finalized and audit logged  
When a user attempts to delete it  
Then deletion is blocked  
And a corrective follow-up must be used if necessary.

### Scenario 36: Deactivate Recovery Officer

Given a Recovery Officer is active  
When an authorized administrator deactivates the officer  
Then the officer cannot receive new assignments  
And historical assignments remain visible  
And existing open cases follow the configured reassignment process.

### Scenario 37: Ineligible loan blocks ordinary recovery payment

Given the loan state does not permit an ordinary recovery payment  
When a user attempts to post one  
Then the system rejects the payment  
And no receipt or ledger entry is created  
Unless an explicit authorized lifecycle exception applies.

---

## Escalation / Closure

### Scenario 38: Escalate unresolved recovery case

Given a recovery case meets the configured escalation criteria  
When an authorized user escalates the case  
Then the system records the escalation event and reason  
And preserves the prior recovery history  
And the new status follows the configured workflow.

### Scenario 39: Close resolved recovery case

Given the recovery objective is resolved according to policy  
When an authorized user closes the case  
Then the system records the resolution type and closure reason  
And preserves the full recovery history.

### Scenario 40: Prevent closure with unresolved required obligations

Given a recovery case has mandatory unresolved conditions  
When a user attempts to close the case  
Then the system rejects closure  
And identifies the blocking condition according to the configured workflow.

### Scenario 41: Recovery case after loan foreclosure or write-off

Given the loan transitions to foreclosed or written-off  
When an authorized user accesses the recovery case  
Then the system applies the corresponding loan lifecycle rules  
And does not permit ordinary actions that contradict the authoritative loan state.

---

## Permission Denial

### Scenario 42: Wrong role attempts recovery assignment

Given the user lacks recovery assignment permission  
When the user attempts to assign or reassign a case  
Then the system denies the action  
And no assignment state is changed  
And the denial is audit logged.

### Scenario 43: Wrong role attempts recovery payment

Given the user lacks permission to initiate or post recovery payment  
When the user attempts the payment operation  
Then the system denies the action  
And no receipt or ledger posting is created  
And the denial is audit logged.

### Scenario 44: Wrong role attempts case closure

Given the user lacks recovery closure permission  
When the user attempts to close or escalate the case  
Then the system denies the action  
And the case remains unchanged  
And the denial is audit logged.

---

## Branch / Organization Scoping

### Scenario 45: Branch Admin cannot access another branch's overdue case

Given Branch Admin A belongs to Branch A  
And an overdue case belongs to Branch B  
When Branch Admin A requests the case  
Then the system denies access  
And Branch B recovery data is not exposed.

### Scenario 46: Recovery Officer cannot record action for unauthorized branch

Given a Recovery Officer is authorized only for Branch A  
And a recovery case belongs to Branch B  
When the officer attempts to record an action  
Then the system denies the action  
And no Branch B recovery record is created.

### Scenario 47: Cross-organization recovery access is denied

Given a recovery case belongs to Organization B  
And the authenticated user belongs to Organization A  
When the user requests or modifies the case  
Then the system denies access  
And no Organization B data is exposed or modified.

---

## Reversal / Failure Paths

### Scenario 48: Reverse recovery payment

Given a recovery payment was posted successfully  
And the user has reversal permission  
When a valid reversal reason is submitted  
Then the original payment remains preserved  
And a reversal record references the original payment  
And opposite balanced ledger lines are posted.

### Scenario 49: Recovery payment reversal double entry

Given the original payment debited Cash/Bank Clearing  
And credited the applicable receivable accounts  
When the payment is reversed  
Then the reversal credits Cash/Bank Clearing  
And debits the corresponding receivable accounts  
And total reversal debit equals total reversal credit.

### Scenario 50: Recovery payment posting failure

Given a recovery payment is being posted  
When receipt generation, allocation or ledger posting fails  
Then no partial authoritative payment remains  
And the payment is not marked posted  
And the failure is audit logged.

### Scenario 51: Overdue calculation failure

Given the system evaluates overdue status  
When authoritative schedule or balance data is inconsistent  
Then the system does not silently fabricate an overdue result  
And the calculation failure is retained for controlled investigation.

### Scenario 52: Recovery action conflict

Given a recovery case is updated by another authorized process  
When a stale client submits a conflicting status or assignment change  
Then the stale update is rejected  
And the authoritative state remains unchanged.

---

## Audit

### Scenario 53: Overdue status transition is audit logged

Given an EMI or loan becomes overdue according to authoritative rules  
When the overdue state is recorded  
Then the audit history records the transition basis, actor/process and timestamp.

### Scenario 54: Recovery assignment is audit logged

Given a recovery case is assigned or reassigned  
When the assignment completes  
Then the audit history records the previous and new assignee, actor and timestamp.

### Scenario 55: Recovery activity is audit logged

Given a Recovery Officer records contact, follow-up or outcome  
When the action is accepted  
Then the audit history records the actor, action type, case and timestamp.

### Scenario 56: Recovery payment and reversal are audit logged

Given a recovery payment is posted or reversed  
When the financial action completes  
Then the audit history records the payment, receipt, actor/process and resulting status.

### Scenario 57: Failed or denied recovery action is audit logged

Given a recovery action fails or is denied  
When the system handles the outcome  
Then the audit history records the action, actor/process and failure or denial context.

---

# Acceptance Criteria

- Overdue status is derived from authoritative repayment obligations and business date rules.
- EMI due dates are DATE-only and evaluated using Asia/Kolkata business-date rules.
- Every overdue and recovery record is scoped by organization and branch.
- Server-side authorization prevents cross-branch and cross-organization access.
- Recovery Officers can access only authorized cases.
- All monetary values are represented as integer paise.
- Floating-point money is prohibited.
- Penal interest or penalty accrual is deterministic and replayable.
- Part-payment allocation is penalty → interest → principal → fees.
- Recovery actions do not duplicate customer payment records.
- Recovery payments use the authoritative collection workflow and require an Idempotency-Key.
- Retried payment requests cannot create duplicate payments, receipts or journals.
- Every recovery payment posts balanced double-entry lines.
- Normal recovery payment debits the configured Cash/Bank Clearing account and credits applicable receivable accounts according to allocation.
- Recovery assignments preserve historical assignment data.
- Inactive recovery users cannot receive new assignments.
- Promise-to-pay records do not themselves reduce financial balances.
- Offline recovery activities use stable client-generated UUIDs.
- Duplicate offline sync is idempotent.
- Sync conflicts do not silently overwrite authoritative recovery data.
- GPS failure is explicitly represented where GPS evidence is required.
- Finalized recovery actions cannot be silently edited.
- Deletion is blocked when records are referenced downstream.
- Posted financial corrections use reversal entries.
- The ledger is append-only.
- Loan lifecycle rules prevent ordinary recovery actions that contradict closed, foreclosed, written-off or other ineligible states.
- Recovery case closure is blocked when mandatory unresolved conditions remain.
- Stale updates cannot overwrite newer authoritative assignments or statuses.
- Permission denials are enforced and audit logged.
- List, view, add, edit where permitted, delete blocking, deactivation, branch scoping, offline sync, conflicts, reversal and failure paths are covered.
- All actions are audit logged.

# Open Questions

1. What is the exact overdue definition: immediately after the due date, after end-of-day, or after a grace period?
2. What is the canonical `days_past_due` calculation?
3. Are delinquency buckets configurable, and what are the exact bucket ranges?
4. What exact event moves a loan into NPA status?
5. Is NPA classification automatic, approval-based or both?
6. Does the overdue engine run as a daily batch, on-read, on-write, or a combination?
7. Is penal interest accrued by a daily job or calculated deterministically on demand?
8. What exact formula and rate basis apply to penal interest?
9. Is penalty calculated on overdue principal only, EMI outstanding, or another balance?
10. Are penalty caps, grace periods or waivers supported?
11. Does a partial payment cure overdue status only when the entire EMI is settled, or under another rule?
12. When multiple EMIs are overdue, is recovery payment allocated to the oldest overdue EMI first?
13. If multiple obligations exist, what is the exact ordering before penalty → interest → principal → fees is applied?
14. What recovery action types are supported?
15. What recovery outcomes are supported?
16. What is the canonical recovery case status enum?
17. What is the exact escalation workflow?
18. Who can assign, reassign, escalate and close a recovery case?
19. Can Recovery Officers reassign cases themselves?
20. Are promises to pay binding workflow objects with reminders and breach states?
21. What happens automatically when a promise-to-pay date is missed?
22. Are legal notices or legal recovery actions part of this module or outside LMS scope?
23. Are field recovery visits handled by this module or by Module 12 Field Collection?
24. Is GPS mandatory for all recovery visits or configurable?
25. What GPS accuracy threshold is valid?
26. Can a supervisor override GPS failure?
27. Are customer signatures, photographs or documents required during recovery visits?
28. Which payment modes are supported for recovery collections?
29. How does post-write-off recovery work, and which ledger accounts are used?
30. How does foreclosure settlement interact with recovery cases?
31. Can a recovery payment exceed overdue balance, and how is excess handled?
32. Is advance payment allowed through recovery?
33. What exact receipt numbering strategy is used for offline recovery collections?
34. Are receipt numbers shared with Module 11 and Module 12 or maintained separately?
35. What is the idempotency retention period?
36. What API response code is used for idempotency conflicts?
37. Can finalized recovery notes be amended through versioned corrections?
38. What retention and immutability rules apply to recovery notes and evidence?
39. What notifications are required for new assignments, missed promises, escalation and NPA transitions?
40. Which roles may see sensitive recovery notes?
41. What reports consume recovery priority, aging and outcome data?
42. What happens to open recovery cases when a Recovery Officer is deactivated?
43. Are automatic reassignment rules required?
44. Can a closed recovery case be reopened, and who can authorize it?
45. Which discrepancy or accounting adjustments belong to Module 14 rather than this module?
46. What exact state transitions connect overdue cases to the Loan states `active`, `NPA`, `closed`, `foreclosed` and `written-off`?

# End of Module 13
