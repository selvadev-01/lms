# Module 15 — Reports & Analytics

## User Story — Reports & Analytics

### Epic

Business Intelligence & Operational Reporting

### Feature

Operational, Portfolio, Collection, Overdue, Recovery and Financial Reporting

### User Story

As an authorized management, branch or operational user  
I want to view, filter, generate and export reports based on authoritative LMS data  
So that I can monitor loan operations, portfolio performance, collections, delinquency, recovery and financial activity.

As the system  
I want reports to respect organization, branch, role and data-access scope and to distinguish generated reporting from authoritative transactional records  
So that users receive accurate information without exposing unauthorized data or modifying source transactions.

---

## Rules & Business Constraints

1. Every report and analytics query is scoped by `organization_id`.
2. Branch-level report access is scoped by `branch_id` unless the user has explicitly granted cross-branch or organization-wide reporting permission.
3. A Branch Admin cannot view another branch's report data unless explicitly authorized.
4. Server-side scope enforcement is mandatory. Client-supplied organization or branch filters cannot override authenticated scope.
5. Reports are read-only views of authoritative source data unless a separately defined report snapshot or export record is created.
6. Generating, viewing or exporting a report must never modify loan, customer, collection, recovery, accounting or other source records.
7. Report totals involving money must use integer paise internally. Floating-point money is prohibited.
8. Display formatting may convert integer paise to a human-readable currency representation, but calculations must remain based on integer paise.
9. EMI due dates are DATE-only and reporting filters that evaluate due dates use Asia/Kolkata business-date rules.
10. Time-based reports must clearly define their date basis, such as application date, disbursal date, due date, collection business date, posting date or accounting business date.
11. A report must not silently mix different date bases.
12. Report definitions must use authoritative source states and canonical module terminology.
13. Loan status, EMI status, overdue status, NPA status, collection status and recovery status must be derived from the authoritative modules.
14. A report must not independently recalculate or override authoritative state transitions using inconsistent logic.
15. Financial reports must reconcile to authoritative accounting and ledger data where the report is defined as a financial report.
16. Every money movement represented in financial reporting must correspond to balanced double-entry accounting data where applicable.
17. Report generation must not create new ledger entries.
18. Posted ledger entries remain append-only; reports must reflect reversals and adjustments rather than editing historical financial data.
19. A reversed transaction must be represented according to the report's defined treatment and must not disappear by deleting historical source data.
20. If a report supports cash collection totals, reversals must be excluded, netted or separately shown according to the approved report definition.
21. Part-payment reporting must use the authoritative allocation order: **penalty → interest → principal → fees**.
22. A report that displays component collections must use the authoritative allocation amounts.
23. Reports may be generated synchronously for small result sets and asynchronously for large result sets, subject to performance limits.
24. An asynchronous report job must have a defined lifecycle and must not expose a partially generated file as complete.
25. Generated report files must be accessible only to users with continuing authorization to access the underlying scope.
26. A report export must not bypass organization, branch or role restrictions.
27. If authorization changes after report generation, download access must be revalidated according to the configured security policy.
28. Report exports containing PII must follow the same or stricter access controls as the underlying data.
29. Sensitive fields must be masked or excluded where the user's report permission does not allow access.
30. Filters must be validated server-side.
31. Invalid date ranges, unsupported filters and invalid scope combinations must be rejected.
32. A report date range must follow configured limits to prevent unbounded expensive queries.
33. The maximum synchronous result size and export size must be configurable or documented.
34. Report pagination must use the platform's standard cursor-pagination conventions where applicable.
35. Summary totals must be computed from the same authorized dataset represented by the report filters.
36. Cached or materialized analytics must not be presented as real-time without an explicit freshness indicator.
37. Report freshness and last-updated time must be available where asynchronous, cached or aggregated data is used.
38. A failed report generation must not create a misleading successful export.
39. Retrying a report generation must not duplicate authoritative business transactions because reporting is read-only.
40. If a report request is idempotently retried, the system may return the same generated artifact or create a new report job according to the configured job semantics, but must not affect source data.
41. Offline clients may cache previously authorized report data for viewing only where explicitly supported.
42. Offline report data is not authoritative for live operational decisions until refreshed.
43. A stale analytics response must not overwrite a newer report result in the user interface.
44. Saved report definitions, if supported, are scoped to the authorized organization and owner/visibility rules.
45. Deletion of a saved report is blocked where referenced by scheduled delivery, dashboard configuration, audit requirements or another downstream dependency; deactivation is used where applicable.
46. An inactive saved report or dashboard cannot generate new scheduled output but historical audit records remain preserved.
47. Reports must not expose deactivated users, branches, products or other records as active unless the report definition explicitly includes historical/inactive data.
48. Historical reports must preserve the correct interpretation of inactive or deleted-by-policy source entities through retained references.
49. A report must clearly distinguish zero values, unavailable data and unauthorized/masked data.
50. Report definitions, exports, failed generation attempts, permission denials and configuration changes are audit logged where required.
51. Downloading or exporting sensitive reports must be audit logged.
52. All actions are audit logged.

---

## Background

Given the user is logged into the system  
And the user has permission to view the requested report  
And the requested organization and branch scope is within the user's authorization  
And report data is derived from authoritative LMS modules  
And monetary calculations use integer paise  
And business-date calculations use Asia/Kolkata where applicable

Report data sources may include:

- Organizations & Branches
- Customers & KYC
- Guarantors
- Loan Products
- Loan Applications
- Approval Workflow
- Disbursal
- Repayment Schedule
- EMI Collection
- Field Collection & Cash Reconciliation
- Overdue & Recovery
- Accounting & Ledger
- Notifications
- Audit records where separately authorized

The report lifecycle is:

`Requested`
→ `Validating`
→ `Queued / Generating`
→ `Completed`

or:

`Requested`
→ `Validating`
→ `Failed`

A completed report remains a read-only representation or generated artifact. It does not become a source transaction.

---

# Feature: Reports & Analytics Management

## Menu

Reports  
→ Dashboard

Reports  
→ Loan Portfolio

Reports  
→ Applications

Reports  
→ Disbursal

Reports  
→ Repayment & Collections

Reports  
→ Field Collection & Reconciliation

Reports  
→ Overdue & Recovery

Reports  
→ Financial Reports

Reports  
→ Saved Reports

Reports  
→ Report Exports

Suggested routes:

`/reports/dashboard`  
`/reports/portfolio`  
`/reports/applications`  
`/reports/disbursals`  
`/reports/collections`  
`/reports/field-collections`  
`/reports/overdue-recovery`  
`/reports/financial`  
`/reports/saved`  
`/reports/exports`

Actions: List, View, Filter, Apply Date Range, Drill Down, Generate, Export, Download, Save Report Definition, Edit Saved Report, Deactivate Saved Report, Delete Where Permitted, Retry Failed Generation

---

# Report Dashboard — Fields

## Global Scope

```text
Organization *
Branch
Date Basis *
From Date
To Date
```

## Portfolio KPIs

```text
Total Active Loans
Total Outstanding Principal
Total Portfolio Outstanding
Loans Disbursed
Disbursed Amount
```

## Collection KPIs

```text
Collection Due
Collection Received
Collection Rate
Cash Pending Reconciliation
Reconciled Amount
```

## Delinquency KPIs

```text
Overdue Accounts
Overdue Amount
Oldest Due Date
Delinquency Bucket
NPA Count
NPA Outstanding
```

## Recovery KPIs

```text
Open Recovery Cases
Assigned Cases
Promise-to-Pay Amount
Recovered Amount
Escalated Cases
```

---

# Loan Portfolio Report — Fields

```text
Loan Number
Customer
Branch
Loan Product
Loan Status
Disbursal Date
Principal Disbursed
Outstanding Principal
Outstanding Interest
Outstanding Penalty
Outstanding Fees
Total Outstanding
Oldest Unpaid Due Date
Days Past Due
NPA Status
```

---

# Application Report — Fields

```text
Application Number
Customer
Branch
Loan Product
Application Date
Requested Amount
Approved Amount
Application Status
Current Approval Stage
Rejected Reason
```

---

# Collection Report — Fields

```text
Receipt Number
Loan Number
Customer
Branch
Collection Date
Payment Mode
Collected Amount
Penalty Allocation
Interest Allocation
Principal Allocation
Fee Allocation
Collection Status
Reversal Reference
Field Agent
```

---

# Field Collection & Reconciliation Report — Fields

```text
Field Agent
Branch
Collection Count
Cash Collected
Cash Handed Over
Cash Pending
Shortage
Excess
Reconciliation Status
Business Date
```

---

# Overdue & Recovery Report — Fields

```text
Loan Number
Customer
Branch
Oldest Unpaid Due Date
Days Past Due
Overdue Principal
Overdue Interest
Overdue Penalty
Overdue Fees
Total Overdue
Delinquency Bucket
NPA Status
Recovery Officer
Recovery Status
Promise-to-Pay Date
Promise-to-Pay Amount
```

---

# Financial Report — Fields

```text
Business Date
Journal Reference
Account Code
Account Name
Debit Amount
Credit Amount
Running Balance
Source Module
Source Transaction ID
Reversal Reference
Branch
```

---

# Saved Report — Fields

## Definition

```text
Report Name *
Report Type *
Organization *
Branch Scope
Visibility *
Status *
```

## Filters

```text
Date Basis
From Date
To Date
Loan Product
Loan Status
Collection Status
Recovery Status
Field Agent
Recovery Officer
```

## Delivery / Ownership

```text
Owner
Created By
Last Run At
```

---

# Table Only (Not for UI)

```text
organization_id
branch_id
report_id
report_type
report_definition_version
filter_json
date_basis
from_date
to_date
scope_hash
owner_user_id
visibility
report_status
is_active
last_generated_at
last_data_fresh_at
created_at
updated_at
version

report_job_id
requested_by
organization_id
branch_scope
report_type
filter_json
job_status
requested_at
started_at
completed_at
failed_at
failure_code
failure_message
artifact_id
artifact_expires_at
data_fresh_at

report_row_cursor
result_snapshot_id
source_watermark
```

---

# Report Data and Date Constraints

```text
Money values:
stored and aggregated in integer paise

EMI due date:
DATE only

Business date:
Asia/Kolkata

Every report must declare its date basis.

Examples:

Application Report:
application_date

Disbursal Report:
disbursal_date

Collection Report:
collection business/posting date

Overdue Report:
authoritative business date
+ oldest unpaid EMI due date

Financial Report:
accounting business_date
```

---

# Report Categories

## 1. Dashboard

Provides authorized high-level operational and financial KPIs.

## 2. Application Reports

Tracks application volume and state progression.

## 3. Loan Portfolio Reports

Tracks active loans, disbursed amounts and outstanding balances.

## 4. Disbursal Reports

Tracks approved and disbursed loans by date, branch and product.

## 5. Repayment & Collection Reports

Tracks due amounts, collected amounts, payment modes, allocation components and reversals.

## 6. Field Collection & Reconciliation Reports

Tracks agent collections, handovers, pending cash, shortages, excesses and reconciliation status.

## 7. Overdue & Recovery Reports

Tracks delinquency, aging, recovery assignments, promises and outcomes.

## 8. Financial Reports

Provides ledger-oriented views that reconcile to Module 14 Accounting & Ledger.

The exact final list of statutory, management and regulatory reports remains dependent on the unresolved report requirements.

---

# Gherkin Scenarios

## Dashboard — List / View

### Scenario 1: View authorized organization dashboard

Given dashboard data exists for Organization A and Organization B  
And the user is authorized only for Organization A  
When the user opens the dashboard  
Then only Organization A metrics are calculated and displayed  
And Organization B data is not exposed.

### Scenario 2: Branch Admin views branch dashboard

Given Branch A and Branch B contain portfolio and collection data  
And the Branch Admin belongs only to Branch A  
When the Branch Admin opens the dashboard  
Then the dashboard contains only Branch A-authorized data  
And Branch B metrics are excluded.

### Scenario 3: View dashboard KPI details

Given a dashboard KPI is visible to the user  
When the user drills into the KPI  
Then the system applies the same organization, branch and permission scope  
And the detailed result reconciles to the KPI definition.

### Scenario 4: Cached dashboard displays freshness

Given a dashboard uses cached or aggregated data  
When the user views the dashboard  
Then the system displays the applicable data freshness indicator  
And does not present stale aggregated data as guaranteed real-time data.

---

## Application and Portfolio Reports

### Scenario 5: List loan applications by authorized date range

Given applications exist within and outside the selected date range  
When an authorized user runs the Application Report  
Then only applications matching the selected authoritative date basis and authorized scope are returned  
And the report does not include unauthorized branches.

### Scenario 6: View application status breakdown

Given applications exist in multiple authoritative workflow states  
When the user requests an application status report  
Then counts and amounts are grouped by canonical application status  
And rejected applications remain distinguishable from approved and disbursed applications.

### Scenario 7: Generate loan portfolio report

Given active and historical loans exist in the authorized scope  
When the user generates a Loan Portfolio Report  
Then the report displays loan status and authoritative outstanding balances  
And monetary totals are calculated in integer paise.

### Scenario 8: Portfolio report shows inactive historical references correctly

Given a loan references a branch, product or user that is now inactive  
When an authorized historical portfolio report is generated  
Then the historical loan remains reportable  
And the inactive entity is not incorrectly represented as an active current configuration.

---

## Mandatory Field Validation

### Scenario Outline: Mandatory report request validation

Given the user is generating a report that requires <field>  
When the user submits without <field>  
Then the system shows "<message>"  
And the report is not generated

Examples:

| field        | message                  |
| ------------ | ------------------------ |
| Report Type  | Report Type is required  |
| Organization | Organization is required |
| Date Basis   | Date Basis is required   |
| From Date    | From Date is required    |
| To Date      | To Date is required      |

---

## Filter Validation

### Scenario 9: Reject invalid date range

Given the user selects a report date range  
When the From Date is later than the To Date  
Then the system rejects the request  
And shows an appropriate validation message.

### Scenario 10: Reject unsupported filter combination

Given a report type supports only defined filters  
When the user submits an unsupported or invalid filter combination  
Then the system rejects the invalid request  
And does not execute an unbounded or ambiguous query.

### Scenario 11: Client-supplied branch cannot override authorization

Given the authenticated user is authorized only for Branch A  
When the user submits Branch B as a report filter  
Then the server validates the request independently  
And rejects or ignores the unauthorized Branch B scope according to the access policy  
And Branch B data is not exposed.

### Scenario 12: Report uses declared date basis

Given a user selects a report date range  
When the report is generated  
Then the report applies the selected canonical date basis consistently  
And does not silently mix due date, posting date and disbursal date.

---

## Collections

### Scenario 13: Generate collection report

Given authoritative collection records exist  
When an authorized user runs the Collection Report  
Then the report displays collection amount, payment mode, branch and status  
And the totals use authoritative posted or otherwise defined collection states.

### Scenario 14: Report part-payment allocation

Given a collection is a part-payment  
When the Collection Report displays allocation components  
Then penalty allocation is shown before interest, principal and fees according to the authoritative allocation  
And component totals reconcile to the collected amount.

### Scenario 15: Report reversed collection

Given a collection has been reversed  
When the report includes the transaction  
Then the report applies the configured reversal treatment  
And preserves traceability to the original and reversal reference  
And does not delete historical evidence.

### Scenario 16: Collection total reconciles to source records

Given the report filters are applied  
When the collection total is calculated  
Then the total is derived from the same authorized dataset represented in the report  
And the displayed component totals reconcile according to the report definition.

---

## Field Collection & Reconciliation

### Scenario 17: Generate field collection report

Given Field Employees have recorded authoritative collections  
When an authorized Branch User runs the Field Collection Report  
Then the report shows permitted agents, collection counts and collected amounts  
And unauthorized branch data is excluded.

### Scenario 18: Report pending cash handover

Given a Field Employee has collected cash that has not completed reconciliation  
When the report is generated  
Then the pending cash amount is displayed according to the authoritative reconciliation state  
And the report does not treat pending cash as fully reconciled.

### Scenario 19: Report shortage or excess

Given a cash reconciliation produced an authoritative shortage or excess  
When the Field Collection & Reconciliation Report is generated  
Then the discrepancy is displayed using the authoritative reconciliation result  
And no report action modifies the accounting or reconciliation record.

---

## Overdue & Recovery

### Scenario 20: Generate overdue aging report

Given overdue obligations exist in the authorized scope  
When an authorized user generates the Overdue Report  
Then the report displays oldest unpaid due date, days past due and overdue components  
And the calculation uses the authoritative overdue state and business date rules.

### Scenario 21: Report NPA status from authoritative loan state

Given loans have authoritative NPA classifications  
When the user generates the delinquency report  
Then the report displays the canonical NPA status  
And does not independently classify a loan using inconsistent report-only logic.

### Scenario 22: Report recovery assignments and outcomes

Given recovery cases and actions exist  
When an authorized user generates the Recovery Report  
Then the report displays current authorized assignment, status and recorded outcomes  
And historical recovery activity remains traceable through drill-down where permission allows.

### Scenario 23: Report missed promise to pay

Given a promise-to-pay date has passed without the required authoritative payment  
When the recovery report is generated  
Then the report identifies the promise according to the canonical recovery rules  
And does not reduce the outstanding balance merely because a promise existed.

---

## Financial Reports

### Scenario 24: Generate general ledger report

Given posted ledger entries exist for the authorized organization and branch scope  
When the Finance User generates the General Ledger Report  
Then the report displays journal reference, account, debit, credit and business date  
And source references remain traceable.

### Scenario 25: Financial report uses integer paise

Given multiple ledger amounts are aggregated  
When the financial total is calculated  
Then the calculation uses integer paise  
And no floating-point rounding discrepancy is introduced.

### Scenario 26: Financial report reflects reversals

Given an original journal and its reversal exist  
When the applicable financial report is generated  
Then the report reflects both according to the defined gross, net or separate reversal presentation  
And the original journal remains historically traceable.

### Scenario 27: Financial report reconciles to ledger

Given a financial report is generated for a defined date range and scope  
When the report totals are calculated  
Then the totals reconcile to the authoritative ledger entries included by the report definition  
And no report-only adjustment changes the ledger.

### Scenario 28: Branch Admin cannot access another branch's financial report

Given financial data exists for Branch A and Branch B  
And the Branch Admin belongs only to Branch A  
When the Branch Admin generates a financial report  
Then only authorized Branch A data is returned  
And Branch B ledger data is not exposed.

---

## Report Generation

### Scenario 29: Generate small report synchronously

Given the requested report result is within the synchronous generation threshold  
When the user submits the report request  
Then the system generates the report within the configured synchronous processing path  
And returns the completed result or artifact.

### Scenario 30: Queue large report asynchronously

Given the requested report exceeds the configured synchronous threshold  
When the user submits the report request  
Then the system creates a report generation job  
And the job status begins in a valid requested, queued or generating state  
And the user is not shown a partially generated artifact as complete.

### Scenario 31: View completed report job

Given a report generation job completed successfully  
When an authorized user opens the report job  
Then the system shows the completed status  
And provides access only if current authorization permits the underlying scope.

### Scenario 32: Failed report generation

Given a report job encounters a query, validation or generation failure  
When the job fails  
Then the system records the failed status and failure context  
And does not mark the report as completed  
And does not expose a misleading incomplete artifact.

### Scenario 33: Retry failed report generation

Given a report generation job failed  
And the user still has permission to run the report  
When the user retries generation  
Then a new valid execution attempt is created or the configured retry mechanism is used  
And no source business transaction is modified.

---

## Export / Download

### Scenario 34: Export authorized report

Given a user has generated or viewed an authorized report  
When the user exports the report  
Then the exported file contains only the data permitted by the user's organization, branch and role scope  
And the export action is audit logged.

### Scenario 35: Export containing PII applies access restrictions

Given a report includes customer information or other sensitive data  
When a user without sensitive-data export permission requests the export  
Then the system denies or masks restricted data according to the permission model  
And unauthorized PII is not included in the exported artifact.

### Scenario 36: Authorization changes before report download

Given a report artifact was generated while the user had access  
And the user's relevant access is later revoked or reduced  
When the user attempts to download the artifact  
Then the system revalidates access according to the configured security policy  
And denies access if the underlying scope is no longer authorized.

### Scenario 37: Export failure

Given a report result is valid  
When file generation or artifact storage fails  
Then the system marks the export attempt as failed  
And does not present a broken or incomplete file as a successful export  
And the failure is audit logged.

---

## Saved Reports

### Scenario 38: Save report definition

Given an authorized user has configured valid report filters  
When the user saves the report  
Then the system stores the report type, filters, scope and visibility  
And the saved definition does not store unauthorized expanded scope.

### Scenario 39: View saved reports by visibility and scope

Given private and shared saved reports exist  
When a user opens Saved Reports  
Then the system returns only reports visible to that user  
And organization and branch scope restrictions continue to apply when the report is run.

### Scenario 40: Edit saved report

Given a saved report is active and the user has edit permission  
When the user changes an allowed filter or configuration  
Then the system validates the updated definition  
And audit logs the change.

### Scenario 41: Deactivate saved report

Given a saved report is no longer intended for new use  
When an authorized user deactivates it  
Then the report cannot be used for new scheduled or standard generation where deactivation blocks it  
And historical execution records remain preserved.

### Scenario 42: Delete saved report referenced downstream is blocked

Given a saved report is referenced by a dashboard, schedule, audit record or downstream configuration  
When a user attempts to delete it  
Then deletion is blocked  
And deactivation or dependency removal is required.

---

## Active / Inactive Behaviour

### Scenario 43: Active saved report can be generated

Given a saved report is active  
And the user has permission to run it  
When the user generates the report  
Then the report runs using its validated current definition  
And current source authorization rules are applied.

### Scenario 44: Inactive saved report cannot generate new output

Given a saved report is inactive  
When a user attempts to generate new output from it  
Then the system blocks the generation  
And historical completed reports remain traceable where authorized.

### Scenario 45: Inactive source entity in historical report

Given a branch, product, user or other source entity is inactive  
And historical transactions reference that entity  
When an authorized historical report is generated  
Then the historical transactions remain available according to retention rules  
And the entity is clearly represented as inactive where relevant rather than silently removed.

---

## Edit / Delete Report Artifacts

### Scenario 46: Generated report content is read-only

Given a report result or completed artifact has been generated  
When a user attempts to directly edit reported values  
Then the system blocks the edit  
And instructs that source data changes must occur through the owning module's authorized workflow.

### Scenario 47: Delete generated report artifact where no downstream dependency exists

Given a generated artifact is eligible for deletion under retention policy  
And the user has permission  
When the user deletes the artifact  
Then only the artifact is removed or expired according to policy  
And source business records remain unchanged.

### Scenario 48: Delete referenced report artifact is blocked

Given a report artifact is referenced by audit, delivery, approval or another retained dependency  
When a user attempts to delete it  
Then deletion is blocked  
And retention or expiration rules continue to apply.

---

## Permission Denial

### Scenario 49: Wrong role attempts financial report access

Given the user lacks financial reporting permission  
When the user requests the financial report  
Then the system denies access  
And financial report data is not exposed  
And the denial is audit logged.

### Scenario 50: Wrong role attempts cross-branch reporting

Given the user is authorized only for Branch A  
When the user requests a report for Branch B  
Then the system denies or constrains the request according to server-side scope rules  
And Branch B data is not exposed  
And the denial is audit logged.

### Scenario 51: Wrong role attempts report export

Given the user can view a limited report but lacks export permission  
When the user attempts to export the report  
Then the system denies the export  
And no unauthorized artifact is created  
And the denial is audit logged.

### Scenario 52: Wrong role attempts saved report administration

Given the user lacks permission to manage saved reports  
When the user attempts to edit, deactivate or delete another user's shared report  
Then the system denies the action  
And the report definition remains unchanged.

---

## Branch / Organization Scoping

### Scenario 53: Branch Admin cannot see another branch's portfolio

Given Branch A and Branch B each have active loans  
And the Branch Admin belongs only to Branch A  
When the Branch Admin generates the Loan Portfolio Report  
Then only Branch A-authorized loans are included  
And Branch B loans are excluded from both rows and totals.

### Scenario 54: Cross-organization report access is denied

Given Organization A and Organization B each contain reportable data  
And the authenticated user belongs only to Organization A  
When the user requests Organization B data  
Then the system denies access  
And Organization B report rows, totals and metadata are not exposed.

### Scenario 55: Drill-down preserves report scope

Given a user opens a drill-down from an authorized summary report  
When the user views underlying records  
Then the same organization, branch and permission scope is enforced  
And drill-down cannot reveal records outside the original authorized dataset.

---

## Offline / Stale Data / Conflict

### Scenario 56: Offline cached report is marked stale

Given offline report viewing is supported  
And the client has previously cached an authorized report  
When the user views it while offline  
Then the system identifies it as cached or stale  
And does not represent it as a live authoritative result.

### Scenario 57: Offline client cannot create authoritative report changes

Given a user is offline  
When the user changes local report filters or view state  
Then no source transaction or authoritative report definition is modified until a permitted synchronization occurs.

### Scenario 58: Stale report response does not overwrite newer result

Given a user submits two report requests  
And the newer request completes before an older delayed request  
When the older response arrives  
Then the client does not overwrite the newer visible result with stale data.

### Scenario 59: Saved report sync conflict

Given the same saved report is modified by two authorized users or devices  
When a stale update conflicts with a newer authoritative version  
Then the system rejects or resolves the conflict according to versioning rules  
And does not silently overwrite the newer definition.

---

## Failure Paths

### Scenario 60: Source data inconsistency is reported safely

Given a report encounters inconsistent authoritative source references  
When the report is generated  
Then the system does not silently invent corrected values  
And the generation fails or identifies the inconsistency according to the configured report policy.

### Scenario 61: Financial report reconciliation mismatch

Given a financial report total does not reconcile to the authoritative ledger dataset defined for the report  
When reconciliation detects the mismatch  
Then the system flags the discrepancy  
And does not modify ledger records automatically.

### Scenario 62: Report query exceeds configured limits

Given a report request exceeds configured date-range, row-count or processing limits  
When the user submits the request  
Then the system rejects, constrains or queues the request according to the configured report policy  
And does not execute an uncontrolled query.

### Scenario 63: Unauthorized report job artifact access

Given a report job belongs to another unauthorized user or scope  
When a user attempts to access the job or artifact directly  
Then the system denies access  
And the artifact metadata and data are not exposed.

---

## Audit

### Scenario 64: Report generation is audit logged

Given a user requests a report  
When the request is accepted or completed  
Then the audit history records the user, report type, authorized scope and generation outcome.

### Scenario 65: Sensitive report download is audit logged

Given a user downloads or exports a report containing sensitive or restricted data  
When the download completes  
Then the audit history records the actor, report/artifact reference and timestamp.

### Scenario 66: Saved report changes are audit logged

Given an authorized user creates, edits, deactivates or deletes a saved report  
When the action completes  
Then the audit history records the action and affected definition.

### Scenario 67: Failed or denied report operation is audit logged

Given a report generation, export, download or administration action fails or is denied  
When the system handles the outcome  
Then the audit history records the actor/process and relevant failure or denial context.

---

# Acceptance Criteria

- Every report query is scoped by organization and applicable branch authorization.
- Server-side enforcement prevents client-supplied filters from bypassing scope.
- A Branch Admin cannot access another branch's report data without explicit authorization.
- Reports are read-only representations of authoritative source data.
- Generating or exporting a report never modifies source business records.
- All monetary calculations use integer paise.
- Floating-point money is prohibited in report calculations.
- EMI due-date reporting uses DATE-only semantics and Asia/Kolkata business-date rules.
- Every report declares and consistently applies its date basis.
- Report logic uses canonical source states rather than independent conflicting state calculations.
- Financial reports reconcile to authoritative accounting and ledger data according to the approved report definition.
- Reversals remain historically traceable in financial and collection reporting.
- Part-payment component reporting follows penalty → interest → principal → fees.
- Summary totals are calculated from the same authorized dataset represented by the report filters.
- Cached or aggregated analytics expose a data freshness indicator.
- Large reports have a defined asynchronous job lifecycle.
- A partially generated or failed artifact is never presented as a successful completed report.
- Report downloads reapply required authorization controls.
- PII and sensitive data are masked or denied according to permissions.
- Invalid date ranges and unsupported filters are rejected.
- Report queries are subject to configured range and processing limits.
- Saved report definitions are scope-controlled and versioned or concurrency-protected.
- Inactive saved reports cannot generate new output where deactivation blocks execution.
- Deletion is blocked where report definitions or artifacts are referenced downstream.
- Historical reporting preserves referenced inactive entities without presenting them as active.
- Generated report values cannot be directly edited.
- Drill-down preserves the same organization, branch and permission scope.
- Offline cached reports are clearly identified as stale where supported.
- Stale report responses do not overwrite newer results.
- Saved report conflicts do not silently overwrite authoritative definitions.
- Report generation failures do not modify source transactions.
- Financial reconciliation mismatches are detectable and do not trigger silent ledger modification.
- Unauthorized report, export and artifact access is denied.
- Report generation, exports, sensitive downloads, definition changes, failures and permission denials are audit logged.
- All actions are audit logged.

# Open Questions

1. What exact reports are mandatory for the LMS MVP?
2. Which reports are operational, management, financial, compliance or regulatory reports?
3. What statutory or regulator-specific reports must be supported?
4. What is the exact dashboard KPI list and formula for each KPI?
5. What is the canonical definition of:
   - Total Portfolio Outstanding
   - Collection Due
   - Collection Received
   - Collection Rate
   - Overdue Amount
   - Recovery Rate
6. What date basis should each mandatory report use?
7. Are users allowed to select different date bases, or is each report fixed?
8. What is the exact overdue aging bucket configuration?
9. What is the exact NPA reporting definition and source state?
10. Should reversed payments be shown gross, netted or as separate rows by default?
11. Should waived amounts appear as separate financial report components?
12. How should foreclosure settlements appear in collection and financial reports?
13. How should post-write-off recoveries be reported?
14. Which report totals must reconcile exactly to Module 14 Accounting & Ledger?
15. Is a trial balance required in this module?
16. Is a balance sheet required?
17. Is a profit and loss report required?
18. Is a cash flow report required?
19. Are accrual-based income and receivable reports required?
20. Is branch-wise profitability required?
21. Is product-wise profitability required?
22. Is agent productivity reporting required?
23. What exact metrics define Field Employee performance?
24. What exact metrics define Recovery Officer performance?
25. Are customer, loan or KYC compliance reports required?
26. Which PII fields must be masked for which roles?
27. Which report types require explicit export permission separate from view permission?
28. What export formats are required: CSV, XLSX, PDF or others?
29. What maximum export size is allowed?
30. What maximum date range is allowed per report?
31. Which reports may run synchronously and which must always run asynchronously?
32. What are the report generation performance targets?
33. What report job retention period is required?
34. How long should generated artifacts remain downloadable?
35. Can users regenerate an expired artifact?
36. Are scheduled reports required?
37. If scheduled reports are required, does delivery belong in Module 15 or Module 16 Notifications?
38. Are report snapshots required for month-end or compliance reporting?
39. If source data changes after report generation, should an existing artifact remain immutable?
40. Are report definitions versioned?
41. Can shared reports be edited by users other than the owner?
42. What visibility values are required for saved reports?
43. Is a maker-checker workflow required for financial or regulatory report generation?
44. Is drill-down supported for all dashboard and report metrics?
45. What pagination and maximum row limits apply to interactive reports?
46. Are materialized views or analytics aggregates planned?
47. What maximum staleness is acceptable for cached dashboards?
48. Is offline report viewing actually required, and which report types may be cached?
49. Are external BI tools or APIs required?
50. Is audit-log reporting included here or exclusively in Module 17?
51. Which reports must support branch comparison for organization-level users?
52. Are custom ad hoc reports required, or only predefined and saved filter reports?
53. What retention policy applies to generated exports containing PII?
54. What happens when a user's authorization changes after a scheduled or asynchronous report job has started?
55. What exact error information may be exposed to users when report generation fails?

# End of Module 15
