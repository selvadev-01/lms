# User Story — Approval Workflow

## Epic

Loan Approval, Review & Sanction Workflow

## Feature

Admin Review, Credit Assessment, More Information, Term Modification, Approval, Rejection and Sanction

## User Story

As an authorized loan reviewer
I want to review a complete loan application and its assessment information
So that I can make a controlled approval or rejection decision.

As an authorized approval authority
I want to approve or reject a loan application with the required controls
So that only eligible applications proceed to sanction and customer agreement.

As an authorized reviewer
I want to request additional information or modify loan terms during review
So that incomplete or unsuitable applications can be corrected before the final decision.

## Rules & Business Constraints

1. Approval Workflow begins after Loan Application completeness and Credit Assessment.
2. Credit Assessment is CIBIL & Income Check. fileciteturn7file1
3. Admin Review is Verification & Assessment. fileciteturn7file5
4. The approval decision has three source outcomes: More Info, Rejected and Approved. fileciteturn7file5
5. More Info leads to Request More Info → Additional Docs Needed → Document Upload → Admin Review. fileciteturn7file5
6. Modify Terms supports Adjust Rate / Duration and returns to Admin Review. fileciteturn7file7
7. Approval does not directly cause disbursement.
8. Approved applications proceed to Loan Sanction Letter.
9. After sanction, Customer Agrees? is a separate decision.
10. Customer decline follows Loan Rejected → Notify & Archive. fileciteturn7file5
11. Customer acceptance proceeds to Loan Agreement — Signed by Customer.
12. Signed Loan Agreement is required before disbursement.
13. Application Rejected and Loan Rejected are unified as `REJECTED` with a separate rejection reason. fileciteturn7file12
14. Rejection reason is mandatory.
15. Rejected applications cannot proceed to sanction or disbursement.
16. Approval, sanction, customer acceptance, agreement signing and disbursement are separate lifecycle events.
17. Every record is scoped by organization and branch; scope is enforced server-side.
18. A Branch Admin cannot review or decide an application outside the authorized branch.
19. A user cannot cross organization boundaries through client-supplied IDs.
20. Approval/rejection permissions are checked server-side.
21. The exact final approval authority is not fully resolved by the source; do not invent an approval hierarchy. The Branch Admin flow establishes Branch Admin as the branch-level operational role. fileciteturn7file18
22. Maker-checker/self-approval rules remain subject to the final RBAC matrix.
23. More Info is not rejection and is not approval.
24. More Info must identify the information/documents required to continue.
25. Approval is blocked while mandatory requested information/documents remain incomplete.
26. Credit assessment must be available to the authorized reviewer before final approval.
27. Failed credit verification must not silently become a successful assessment.
28. Modified rate/duration must be validated and the applicable EMI must be recalculated before approval.
29. Original submitted terms must remain auditable after modification.
30. Scheme configuration changes must not silently rewrite an existing application's captured terms.
31. Money is always integer paise; never float.
32. Interest rates are integer basis points.
33. EMI due dates are DATE-only in Asia/Kolkata.
34. Approval Workflow itself does not post a money movement.
35. Any later money movement must use double-entry lines that sum to zero.
36. Payment posting is idempotent on Idempotency-Key.
37. Ledger is append-only; financial corrections are reversals/adjustments, never edits/deletes.
38. Approval, rejection, More Info, term modification and sanction actions are audit logged.
39. Approval audit records are immutable.
40. Submitted/reviewed applications with downstream references cannot be physically deleted.
41. Deletion is blocked when downstream references exist; deactivation is preferred where applicable.
42. `INACTIVE` is not introduced as an application lifecycle state unless explicitly approved.
43. Deactivated schemes cannot be selected for new applications.
44. Existing applications retain historically captured scheme/term information.
45. Stale client state must be revalidated before approval.
46. Concurrent approval/rejection must produce one valid committed outcome.
47. Concurrent term modification and approval must not allow approval against silently stale terms.
48. Approval and rejection transitions are atomic with their required decision data and audit event.
49. Notification failure must not create a false workflow state; notification follows the configured retry policy.
50. Loan Approved notification is SMS + App Push to Customer + Branch Admin. fileciteturn7file12
51. Loan Rejected notification is SMS + App Push to Customer + Branch Admin. fileciteturn7file12
52. Notification delivery is logged, retried up to three attempts, and final failure alerts Admin. fileciteturn7file12
53. Offline clients do not have authoritative approval authority unless explicitly granted by RBAC.
54. Offline/stale review data must be revalidated against current server state.
55. Duplicate approval/rejection requests must not create duplicate terminal decisions.
56. All actions are audit logged.

## Background

Given the user is logged into the LMS
And the user has permission to review or decide loan applications
And the application belongs to the user's authorized organization and branch
And the application has completed the required Loan Application steps
And required credit assessment information is available
And the application has not already reached a terminal decision

The source flow is:

Loan Submission → EMI Calculation → EMI Schedule Generated → Admin Review — Verification & Assessment → Loan Approved?

Decision branches:

- More Info → Request More Info → Additional Docs Needed → Document Upload → Admin Review
- Rejected → Application Rejected → Notify Customer
- Approved → Loan Sanction Letter → Customer Agrees?
  - No → Loan Rejected → Notify & Archive
  - Yes → Loan Agreement — Signed by Customer → Disbursement

fileciteturn7file16turn7file5

## Feature: Approval Workflow Management

### Menu

Loan Management
→ Loan Applications
→ Review / Approval

Actions: List, View Details, Review, Request More Info, Modify Terms, Approve, Reject, Issue Sanction Letter

### Approval Review — Fields

#### Application Summary

Application ID *
Customer *
Customer Type
Organization *
Branch *
Loan Type *
Loan Scheme *
Requested Amount *
Purpose

#### Credit Assessment

CIBIL Check
Income Check
Assessment Result
Assessment Notes

#### Loan Terms

Interest Type *
Interest Rate *
Duration *
Frequency *
Calculated EMI
Repayment Schedule Preview

#### Documents

ID Documents
Income Documents
Collateral Documents
Additional Requested Documents
Document Verification Status

#### Review Decision

Decision *
Decision Reason / Notes
Rejection Reason * when Decision = Reject
Additional Information Request when Decision = More Info

Allowed decision outcomes:

- More Info
- Rejected
- Approved

#### Modify Terms

Interest Rate
Duration

#### Sanction

Sanction Status
Sanction Letter
Issued Date
Customer Acceptance Status

The exact sanction data structure is not fully defined by the source.

### Table Only (Not for UI)

The approval workflow operates over the Loan Application and associated review/assessment data. The authoritative schema must preserve organization/branch scope, application identity, customer, scheme, terms, status, reviewer/decision information and timestamps.

Money fields are integer paise. Interest rates are integer basis points. EMI due dates are DATE-only in Asia/Kolkata.

Review decisions should preserve:

```text
approval_decision_id
application_id
decision
decision_reason
reviewer_id
organization_id
branch_id
created_at
```

Term modifications should preserve before/after values rather than silently replacing the original review history. Exact table names, constraints and version fields are not fully specified by the source.

## Approval State Rules

### Under Review

Application is in Verification & Assessment. Reviewer actions may include Request More Info, Modify Terms, Approve and Reject.

### More Info

Request More Info → Additional Docs Needed → Document Upload → Admin Review.

### Approved

Application passed the approval decision. Approval does not mean disbursement; the next business step is Loan Sanction Letter.

### Rejected

Unified `REJECTED` outcome with a separate rejection reason. No normal sanction/disbursement path.

### Sanctioned

Loan Sanction Letter has been issued after approval. Customer agreement remains pending.

### Customer Declined

Customer declines sanction → Loan Rejected → Notify & Archive.

### Customer Accepted

Customer accepts sanction → Loan Agreement → Signed by Customer → Disbursal.

## Gherkin Scenarios

### List / View / Scope

#### Scenario 1: List applications awaiting approval

Given the user has permission to review loan applications
When the user opens the review list
Then the system displays eligible applications within the authorized organization and branch
And out-of-scope applications are excluded
And the access is audit logged.

#### Scenario 2: View application review details

Given an eligible application exists within the user's scope
When the reviewer opens the application
Then the system displays application summary, customer, terms, assessment and documents according to permission
And available review actions are displayed.

#### Scenario 3: Branch Admin cannot view another branch application

Given the reviewer is authorized for Branch A
And the application belongs to Branch B
When the reviewer requests the application
Then access is denied
And no protected application data is returned
And the denial is audit logged.

#### Scenario 4: Cross-organization review is denied

Given the application belongs to Organization B
And the reviewer belongs to Organization A
When the reviewer requests the application
Then access is denied
And the application cannot be reviewed
And the denial is audit logged.

### Mandatory Validation

#### Scenario Outline: Approval decision mandatory

Given the application review screen is open
When the reviewer submits without <field>
Then the system shows "<message>"
And no decision is committed.

Examples:
| field | message |
| Decision | Decision is required |

#### Scenario Outline: Rejection reason mandatory

Given the reviewer selected Reject
When the reviewer submits without <field>
Then the system shows "<message>"
And the application remains under review.

Examples:
| field | message |
| Rejection Reason | Rejection Reason is required |

#### Scenario 5: More Info request requires details

Given the reviewer selects More Info
When the reviewer submits without identifying required information or documents
Then the system rejects the request
And the application remains under review.

#### Scenario 6: Approval blocked by missing documents

Given mandatory documents are missing
When the reviewer attempts approval
Then approval is blocked
And the missing requirements are displayed.

### Credit Assessment

#### Scenario 7: Credit Assessment includes CIBIL and Income Check

Given the application is under review
When the reviewer opens Credit Assessment
Then CIBIL Check and Income Check information are displayed
And the assessment result is available to the authorized reviewer.

#### Scenario 8: Incomplete credit assessment blocks approval

Given required credit assessment information is incomplete
When the reviewer attempts approval
Then approval is blocked
And the application remains under review.

#### Scenario 9: Failed credit verification is not treated as approval

Given CIBIL or income verification fails
When the reviewer attempts approval
Then the system does not treat the failed check as successful
And approval is blocked according to the finalized assessment policy
And the failure is audit logged.

### More Information

#### Scenario 10: Request More Info

Given the application is under review
And the reviewer identifies missing information or documents
When the reviewer selects More Info
Then the application enters the More Info path
And the requested information/documents are recorded
And the action is audit logged.

#### Scenario 11: More Info returns to review

Given the application is in the More Info path
And requested information/documents have been supplied
When the reviewer reopens the application
Then the application returns to Admin Review
And the reviewer can reassess it.

#### Scenario 12: More Info is not rejection

Given the reviewer selects More Info
When the request succeeds
Then the application does not become `REJECTED`
And no rejection notification is sent.

#### Scenario 13: Outstanding More Info blocks approval

Given an application has outstanding requested information
When the reviewer attempts approval
Then approval is blocked
And the outstanding requirements remain visible.

### Modify Terms

#### Scenario 14: Modify interest rate

Given the application is under review
And the reviewer has permission to modify terms
When the reviewer adjusts the interest rate
Then the new rate is validated and stored
And the previous rate remains auditable
And the action is audit logged.

#### Scenario 15: Modify duration

Given the application is under review
And the reviewer has permission to modify terms
When the reviewer adjusts duration
Then the new duration is validated and stored
And the previous duration remains auditable
And the action is audit logged.

#### Scenario 16: Invalid modified rate

Given the reviewer is modifying terms
When an invalid rate is submitted
Then the system rejects the modification
And the previous committed rate remains unchanged.

#### Scenario 17: Invalid modified duration

Given the reviewer is modifying terms
When an invalid duration is submitted
Then the system rejects the modification
And the previous committed duration remains unchanged.

#### Scenario 18: Modified terms return to Admin Review

Given rate or duration was modified successfully
When the modification is saved
Then the application remains in the review lifecycle
And the reviewer must reassess the revised terms before approval.

#### Scenario 19: Modified terms require current EMI

Given rate or duration was changed
When the reviewer attempts approval
Then the system requires the applicable EMI calculation to be current
And stale calculation data cannot be used for approval.

#### Scenario 20: Modified terms do not erase original terms

Given an application was submitted with original terms
When the reviewer modifies rate or duration
Then the original submitted values remain auditable
And the revised values are separately identifiable.

### Approval

#### Scenario 21: Approve eligible application

Given the application is under review
And required documents are complete
And credit assessment is complete
And the reviewer has approval permission
When the reviewer selects Approve
Then the application moves to the approved outcome
And the approval is audit logged
And the Loan Sanction Letter step becomes available.

#### Scenario 22: Approval invalid for already rejected application

Given the application is already `REJECTED`
When an approval request is submitted
Then the system rejects the transition
And the rejection history remains unchanged
And the attempt is audit logged.

#### Scenario 23: Approval cannot directly disburse

Given the application has been approved
When approval completes
Then the system does not mark the loan as disbursed
And the next step is Loan Sanction Letter
And customer agreement and signed Loan Agreement remain required.

#### Scenario 24: Wrong role attempts approval

Given the user lacks approval permission
When the user attempts to approve
Then the system denies the action
And the application remains unchanged
And the denial is audit logged.

#### Scenario 25: Stale approval request is rejected

Given the reviewer opened an application while it was under review
And another authorized action changed its state before approval
When the reviewer submits the stale approval
Then the server revalidates the current state
And rejects the stale transition
And does not overwrite the newer state.

### Rejection

#### Scenario 26: Reject application

Given the application is under review
And the reviewer has rejection permission
And a rejection reason is supplied
When the reviewer selects Reject
Then the application status becomes `REJECTED`
And the rejection reason is stored
And the rejection is audit logged
And the notification workflow is triggered.

#### Scenario 27: Rejection reason is mandatory

Given the reviewer selects Reject
When the reviewer submits without a rejection reason
Then rejection is blocked
And the application remains under review
And no rejection notification is sent.

#### Scenario 28: Wrong role attempts rejection

Given the user lacks rejection permission
When the user attempts to reject
Then the system denies the action
And the application remains unchanged
And the denial is audit logged.

#### Scenario 29: Rejected application cannot be approved

Given the application is already `REJECTED`
When approval is requested
Then the system rejects the transition
And the existing rejection remains authoritative.

### Sanction

#### Scenario 30: Issue sanction after approval

Given the application is approved
When the authorized sanction process executes
Then the Loan Sanction Letter is issued to the customer
And the sanction event is audit logged.

#### Scenario 31: Sanction cannot bypass approval

Given the application is still under review
When a user attempts to issue a sanction letter
Then the system denies the action
And the application remains under review
And the attempt is audit logged.

#### Scenario 32: Customer declines sanction

Given a sanction letter has been issued
When the customer declines
Then the lifecycle enters `REJECTED`
And the customer is notified
And the record follows Notify & Archive.

#### Scenario 33: Customer accepts sanction

Given a sanction letter has been issued
When the customer accepts
Then the workflow proceeds to Loan Agreement
And the agreement must be signed before disbursement.

#### Scenario 34: Signed agreement remains required

Given the customer accepted the sanction
When disbursement is requested before the Loan Agreement is signed
Then the system blocks disbursement
And the application/loan remains pending agreement.

### Delete / Deactivate Safeguards

#### Scenario 35: Delete reviewed application is blocked

Given an application has entered Admin Review
When destructive deletion is attempted
Then deletion is blocked
And review history is preserved
And the attempt is audit logged.

#### Scenario 36: Delete application with decision history is blocked

Given an application has approval or rejection history
When deletion is requested
Then deletion is blocked
And decision history remains intact.

#### Scenario 37: Unsupported application deactivation is rejected

Given the application lifecycle does not define INACTIVE
When a user attempts to set the application to INACTIVE
Then the system rejects the operation unless a finalized deactivation rule exists
And no unsupported lifecycle state is created.

### Active / Inactive Behavior

#### Scenario 38: Deactivated scheme cannot be used for new application

Given a loan scheme is inactive
When a new application is created
Then the scheme is unavailable
And a forged scheme ID is rejected server-side.

#### Scenario 39: Existing application retains captured terms

Given an application was created using Scheme A
When Scheme A becomes inactive
Then the application retains its captured terms
And the workflow does not silently replace the scheme.

#### Scenario 40: Stale scheme is revalidated before approval

Given the reviewer loaded an application while its scheme was active
And the scheme becomes inactive before approval
When the reviewer approves
Then the server revalidates current configuration
And applies the finalized stale-configuration policy
And does not silently approve invalid current configuration.

### Branch / Organization Scope

#### Scenario 41: Authorized branch can review

Given an application belongs to Branch A
And the reviewer is authorized for Branch A
When the reviewer opens it
Then the application is available for review
And the review remains within Branch A scope.

#### Scenario 42: Branch Admin cannot approve another branch application

Given the reviewer is a Branch Admin for Branch A
And the application belongs to Branch B
When the reviewer submits a direct approval request
Then the server denies the request
And the application state is unchanged
And the denial is audit logged.

#### Scenario 43: Organization override is rejected

Given the reviewer belongs to Organization A
When the request contains Organization B
Then the server rejects or ignores the unauthorized organization value
And no cross-organization approval occurs.

#### Scenario 44: Branch override is rejected

Given the reviewer is authorized for Branch A
When the request contains Branch B
Then the server rejects the unauthorized scope
And no approval decision is created.

### Offline / Sync

#### Scenario 45: Offline client cannot perform authoritative approval

Given the reviewer device is offline
When the reviewer attempts approval
Then the system does not treat the offline action as authoritative
And approval requires current server validation.

#### Scenario 46: Stale offline review is revalidated

Given cached review data is older than the server application state
When the reviewer reconnects and attempts a decision
Then the server validates current application state
And rejects a stale conflicting decision.

#### Scenario 47: Offline conflict is not silently merged

Given an offline client has a stale review decision
And the server has a newer state
When synchronization occurs
Then the conflict is detected
And the server state is not silently overwritten
And the conflict is audit logged.

### Failure / Concurrency

#### Scenario 48: Approval persistence failure

Given the application is eligible for approval
When approval persistence fails
Then the application is not falsely marked approved
And the failure is audit logged.

#### Scenario 49: Rejection persistence failure

Given the application is eligible for rejection
When rejection persistence fails
Then the application remains in its previous committed state
And no rejection notification is treated as authoritative
And the failure is audit logged.

#### Scenario 50: Concurrent approval and rejection

Given two authorized reviewers act on the same application
When Approve and Reject are submitted concurrently
Then only one valid terminal decision is committed
And the losing transition is rejected
And both attempts are audit logged.

#### Scenario 51: Concurrent term modification and approval

Given one reviewer modifies rate or duration
And another reviewer submits approval concurrently
When the requests conflict
Then the concurrency strategy prevents approval against silently stale terms
And the outcome is audit logged.

#### Scenario 52: Duplicate approval request

Given an application has already been approved
When the client retries approval
Then no duplicate approval or sanction is created
And the existing state remains authoritative.

#### Scenario 53: Duplicate rejection request

Given an application has already been rejected
When the client retries rejection
Then no duplicate terminal rejection is created
And the existing rejection reason remains authoritative.

### Notifications

#### Scenario 54: Approved notification

Given approval succeeds
When the approval event is committed
Then Loan Approved notification is sent to Customer and Branch Admin by the configured SMS + App Push channels
And delivery status is logged. fileciteturn7file12

#### Scenario 55: Rejected notification

Given rejection succeeds
When the rejection event is committed
Then Loan Rejected notification is sent to Customer and Branch Admin by the configured SMS + App Push channels
And delivery status is logged. fileciteturn7file12

#### Scenario 56: Notification failure retries

Given an approval or rejection notification fails
When a retry is available
Then the notification engine retries delivery
And records the retry outcome.

#### Scenario 57: Final notification failure alerts Admin

Given a notification has failed after the configured maximum attempts
When the final retry fails
Then the notification is marked failed
And Admin is alerted
And the workflow decision remains auditable. fileciteturn7file12

### Audit

#### Scenario 58: More Info is audit logged

Given a reviewer requests additional information
When the request succeeds
Then the audit record captures actor, application, requested information/documents, branch, organization and timestamp.

#### Scenario 59: Term modification is audit logged

Given a reviewer changes rate or duration
When the modification succeeds
Then the audit record captures previous and new values
And identifies actor and timestamp.

#### Scenario 60: Approval is immutably audit logged

Given an authorized reviewer approves an application
When approval succeeds
Then an immutable audit record captures actor, application, organization, branch, timestamp and outcome.

#### Scenario 61: Rejection is immutably audit logged

Given an authorized reviewer rejects an application
When rejection succeeds
Then an immutable audit record captures actor, application, organization, branch, timestamp and rejection reason.

#### Scenario 62: Sanction issuance is audit logged

Given an approved application exists
When the sanction letter is issued
Then the sanction event is recorded in the audit trail
And the event remains immutable.

#### Scenario 63: Permission denial is audit logged

Given a user lacks approval permission
When the user attempts approval
Then the server denies the action
And the denial is recorded in the audit trail.

## Acceptance Criteria

- Authorized reviewers can list and view applications within organization/branch scope.
- Credit Assessment includes CIBIL & Income Check.
- Admin Review is Verification & Assessment.
- Decision outcomes are More Info, Rejected and Approved.
- More Info identifies additional requirements and returns the application to review after completion.
- Approval is blocked while mandatory review requirements are incomplete.
- Rejection requires a rejection reason.
- Rejection uses unified `REJECTED` status.
- Approval leads to Loan Sanction Letter and does not directly disburse.
- Customer acceptance remains separate from approval.
- Customer decline follows Loan Rejected → Notify & Archive.
- Customer acceptance proceeds to signed Loan Agreement.
- Signed Loan Agreement is required before disbursement.
- Modify Terms supports Rate / Duration changes.
- Modified terms remain auditable and do not erase original terms.
- Stale and concurrent approval requests cannot overwrite newer state.
- Duplicate terminal decisions are prevented.
- Organization and branch scope are enforced server-side.
- Unauthorized users cannot review, approve or reject out-of-scope applications.
- Reviewed/referenced applications cannot be destructively deleted.
- Unsupported INACTIVE application state is not introduced without approval.
- Deactivated schemes cannot be selected for new applications.
- Offline clients cannot bypass server authority for approval.
- Approval/rejection notifications are logged and retried according to the notification policy.
- Audit history is immutable.
- All actions are audit logged.
- Money is integer paise.
- Interest rates are integer basis points.
- EMI due dates are DATE-only in Asia/Kolkata.
- Any downstream money movement uses double-entry lines summing to zero.
- Payment posting is idempotent on Idempotency-Key.
- Ledger remains append-only.

## Open Questions

1. What is the exact final approval authority for loans?
2. Is Branch Admin the final approval authority?
3. Can Super Admin approve loans?
4. Can custom roles approve loans?
5. Is maker-checker mandatory?
6. Can the application creator approve their own application?
7. What segregation-of-duties rules apply?
8. Are approval limits based on loan amount?
9. Is there an approval hierarchy or escalation path?
10. What exact canonical approval state enum is required?
11. Is `MORE_INFO` persisted or represented as an action/event?
12. Is `SANCTIONED` an application state or a separate sanction record?
13. Is `AGREEMENT_PENDING` an application state or loan state?
14. Can a More Info request expire?
15. Is there a maximum More Info cycle count?
16. Can a rejected application be reopened?
17. Who can reopen a rejected application?
18. Can an approved application be reversed before sanction?
19. Is rejection reason controlled, free text, or both?
20. What rejection reason codes are required?
21. Is decision reason required for approval?
22. What exact CIBIL data is stored?
23. What exact income-check data is stored?
24. What happens when CIBIL service is unavailable?
25. What happens when income verification is unavailable?
26. Can credit assessment be manually overridden?
27. Who can override credit assessment?
28. Does override require a reason and second approval?
29. What exact conditions make an application approval-ready?
30. Does guarantor KYC/consent have to be complete before approval?
31. What exact document verification status is required?
32. Can approval proceed with unverified documents?
33. Who can request additional documents?
34. Can a reviewer request documents not configured for the scheme?
35. What happens when a requested document is rejected?
36. Are document revisions versioned?
37. What is the approval SLA?
38. Is More Info subject to an SLA?
39. Is sanction issuance subject to an SLA?
40. Are reviewer performance metrics required?
41. Are approval queues prioritized?
42. Can applications be transferred between branches?
43. Who can transfer an application?
44. Does branch transfer require re-review?
45. Does branch transfer invalidate approval?
46. What exact RBAC permissions exist for review, More Info, Modify Terms, Approve, Reject and Sanction?
47. Is approval subject to re-authentication?
48. Is MFA required for approval?
49. Is approval available offline?
50. Can Field Employees ever approve applications?
51. What exact offline conflict strategy applies?
52. Is optimistic locking required?
53. What version field is authoritative?
54. Is Idempotency-Key required for approval/rejection/More Info/Modify Terms?
55. What happens when approval times out after server commit?
56. What happens when audit logging fails?
57. Must audit logging be in the same transaction as approval?
58. What fields are mandatory in approval audit records?
59. Are before/after values mandatory for term changes?
60. Can audit records ever be edited or deleted?
61. What is the audit retention period?
62. What happens if notification delivery fails permanently?
63. Does notification failure create an Admin task?
64. Does notification failure affect workflow state?
65. What exact sanction-letter fields are required?
66. Is sanction letter generated automatically?
67. What happens if sanction generation fails?
68. Does sanction have an expiry date?
69. Can sanction be reissued?
70. Can sanctioned terms differ from approved terms?
71. If sanctioned terms differ, does re-approval occur?
72. Does customer acceptance require OTP?
73. Can Branch Admin record customer acceptance?
74. Can Field Employee record customer acceptance?
75. Is agreement signing electronic?
76. Who verifies the signed agreement?
77. What happens if signature verification fails?
78. Is agreement generation part of Module 8 or the next module?
79. Which configuration version is authoritative at approval time?
80. What happens if the loan scheme becomes inactive while an application is under review?
81. Should approval continue using the captured scheme terms?
82. Should approval be blocked after scheme deactivation?
83. Does changing interest configuration invalidate a pending review?
84. Does changing duration configuration invalidate a pending review?
85. Can loan amount be modified during review?
86. Can loan scheme be modified during review?
87. Can loan type be modified during review?
88. Can purpose be modified during review?
89. If amount changes, must credit assessment be rerun?
90. If rate changes, must sanction be regenerated?
91. If duration changes, must customer re-accept?
92. Does Modify Terms create a new application version?
93. Does Modify Terms require approval again?
94. What exact EMI recalculation behavior applies after rate/duration changes?
95. What happens if EMI recalculation fails?
96. Can approval be committed without successful recalculation?
97. What is the final application-to-loan state transition boundary?
98. Which fields become immutable after approval?
99. Which fields become immutable after sanction?
100. What exact state machine is authoritative for the Approval Workflow?

## Source Traceability

- Customer Journey defines Credit Assessment — CIBIL & Income Check followed by Loan Approved?, with rejection and approval branches. fileciteturn7file1
- Loan Lifecycle defines Admin Review — Verification & Assessment, More Info, Modify Terms, rejection, approval and sanction. fileciteturn7file5turn7file16
- More Info follows Request More Info → Additional Docs Needed → Document Upload → Admin Review. fileciteturn7file5
- Modify Terms is Adjust Rate / Duration and returns to Admin Review. fileciteturn7file7
- Application Rejected and Loan Rejected are unified as `REJECTED` with a rejection reason. fileciteturn7file12
- Approval does not directly cause disbursement; customer agreement and signed Loan Agreement are required first. fileciteturn7file7
- Loan Approved and Loan Rejected notifications target Customer + Branch Admin through SMS + App Push. fileciteturn7file12
- Notification delivery is logged, retried up to three attempts, and final failure alerts Admin. fileciteturn7file12
- Branch Admin is the branch-level operational role, but the final loan approval authority is not fully resolved by the source. fileciteturn7file18
- Offline behavior in the Field Employee source is collection-focused and does not establish offline loan approval authority. fileciteturn7file13

# End of Module 8
