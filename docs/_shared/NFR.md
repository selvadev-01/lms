# LMS — Non-Functional Requirements (NFR)

**Product:** Loan Management System (LMS)  
**Domain:** NBFC / Microfinance Loan Management  
**Architecture:** pnpm monorepo, Next.js App Router, NestJS Modular Monolith, Prisma, PostgreSQL, pg-boss, shadcn/ui, Tailwind CSS v4, TanStack Query  
**Timezone:** Asia/Kolkata  
**Money:** Integer paise  
**EMI Due Dates:** PostgreSQL `DATE`

---

## 1. Purpose

This document defines the non-functional requirements for the Loan Management System.

The NFRs cover:

- System scale and capacity
- Performance
- Offline field collection
- Security
- Availability and disaster recovery
- Backup and restore
- End-of-day processing
- Compliance and data retention
- Auditability and financial-data integrity

The requirements are based on the uploaded LMS flow documentation. Where the diagrams do not define an exact capacity, latency, retention, recovery, or compliance value, the requirement is explicitly marked **TBD** rather than inventing a business requirement.

The uploaded system flow identifies Super Admin, Branch Admin, Field Employee / Collection Agent, Customer, loan lifecycle, EMI collection, overdue recovery, reports, notifications, backup/restore, audit logs, and day-closing capabilities.

---

# 2. NFR Classification

| Category          | Requirement                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Scale             | System must support the organization's confirmed branch, loan, field-agent and transaction volumes                 |
| Performance       | APIs, UI pages, collection operations and reports must meet defined latency targets                                |
| Offline           | Field employees must be able to continue collection operations without network connectivity                        |
| Consistency       | Financial transactions must be idempotent, auditable and protected against duplicate posting                       |
| Security          | Authentication, authorization, re-authentication and encryption must protect sensitive operations/data             |
| Availability      | LMS must remain available for operational users except during explicitly defined maintenance/EOD windows           |
| Disaster Recovery | Backups and restore procedures must support agreed RPO/RTO targets                                                 |
| Auditability      | Financial and security-sensitive operations must generate immutable audit records                                  |
| Compliance        | Customer/loan/financial/audit data must follow the organization's applicable regulatory and retention requirements |

---

# 3. Scale and Capacity Requirements

## 3.1 Capacity Baseline

The uploaded diagrams define the functional scope but **do not specify numeric production capacity**.

Therefore, the following values must be confirmed before infrastructure sizing is finalized.

| Capacity Metric                                | Required Target | Status                              |
| ---------------------------------------------- | --------------: | ----------------------------------- |
| Organizations / tenants                        |             TBD | Requires business confirmation      |
| Branches                                       |             TBD | Requires business confirmation      |
| Employees per branch                           |             TBD | Requires business confirmation      |
| Concurrent Field Employees / Collection Agents |             TBD | Requires business confirmation      |
| Customers                                      |             TBD | Requires business confirmation      |
| Active loans                                   |             TBD | Requires business confirmation      |
| Historical loans                               |             TBD | Requires business confirmation      |
| EMI records                                    |             TBD | Derived from loan volume and tenure |
| Collections/day                                |             TBD | Requires business confirmation      |
| Payment transactions/day                       |             TBD | Requires business confirmation      |
| Offline transactions/day                       |             TBD | Requires business confirmation      |
| Notifications/day                              |             TBD | Derived from business events        |
| Reports/day                                    |             TBD | Requires business confirmation      |
| Concurrent web users                           |             TBD | Requires business confirmation      |

The architecture must not be declared production-sized until these values are confirmed.

---

## 3.2 Capacity Model

The system must be designed so that capacity can grow without requiring a change to the business domain model.

The primary scaling dimensions are:

```text
Branches
   ↓
Employees / Field Agents
   ↓
Customers
   ↓
Loans
   ↓
EMIs
   ↓
Collections
   ↓
Ledger Transactions
   ↓
Reports / Notifications / Audit Records
```

The Field Employee flow explicitly supports assigned customer lists, daily collections, collection history and offline collection/synchronization.

The Reports flow includes branch, daily collection, weekly, monthly, loan, outstanding, employee-performance and cash reports.

---

## 3.3 Transaction Capacity

The system must support concurrent financial operations without double-posting.

Financial transaction candidates include:

- EMI payments
- Partial payments
- Penalty-only payments
- Penalty adjustments
- Penalty waivers
- Penalty cancellations
- Loan disbursements
- Loan closure payments
- Settlement transactions
- Ledger postings

The LMS baseline explicitly requires payments, penalties, adjustments, waivers, cancellations and settlements to remain auditable and prohibits silently overwriting financial history.

### Requirement

Every money-posting operation MUST:

1. Be transactionally consistent.
2. Be protected against duplicate submission.
3. Have a unique transaction identifier.
4. Produce an audit record.
5. Preserve the original financial history.
6. Be safe to retry where applicable.

---

# 4. Performance Requirements

## 4.1 API Performance

Exact performance targets are not defined in the uploaded LMS diagrams. The following values therefore require confirmation before being treated as contractual NFRs.

| API Category                     | Target |
| -------------------------------- | -----: |
| Authentication API p95           |    TBD |
| Standard CRUD API p95            |    TBD |
| Customer search p95              |    TBD |
| Loan lookup p95                  |    TBD |
| EMI due-amount lookup p95        |    TBD |
| Collection submission p95        |    TBD |
| Dashboard API p95                |    TBD |
| Notification API p95             |    TBD |
| Report request API p95           |    TBD |
| Financial transaction commit p95 |    TBD |

### Mandatory Performance Rule

Financial posting APIs must prioritize **correctness and transactional integrity over raw latency**.

A payment must never be considered successful merely because the API responded quickly.

The successful collection flow requires payment verification, receipt generation, ledger update, dashboard/report synchronization and customer notification.

---

## 4.2 API Timeout Requirements

The API layer must distinguish:

- Client timeout
- Database timeout
- External provider timeout
- Background-job timeout
- Transaction rollback
- Successful transaction with delayed notification

A timeout must not automatically mean that the financial transaction failed.

Clients must use idempotency keys/client transaction IDs when retrying money-posting operations.

---

# 5. Frontend Performance

## 5.1 Page Load

Exact page-load targets are not defined by the source diagrams.

The following targets require confirmation:

| Metric                       | Target |
| ---------------------------- | -----: |
| Initial application load     |    TBD |
| Authenticated dashboard load |    TBD |
| Customer search screen       |    TBD |
| Customer details             |    TBD |
| Loan details                 |    TBD |
| Collection screen            |    TBD |
| Reports screen               |    TBD |
| Offline dashboard            |    TBD |

### Field Collection Priority

The collection screen is operationally more critical than administrative screens.

The Field Employee flow requires access to:

- Today's Summary
- Assigned Customers
- Customer Details
- Loan Information
- Due Amount
- Today's Collections
- Collection History
- Missed Customers

The offline path must load cached customer data without requiring a live server request.

---

# 6. Report Performance

The Reports flow supports:

- Branch Report
- Daily Collection Report
- Weekly Report
- Monthly Report
- Loan Report
- Outstanding Report
- Employee Performance
- Cash Report

Reports are generated, previewed, and then exported to PDF/Excel or emailed.

## 6.1 Report Generation Model

The finalized report design already distinguishes small and large reports:

```text
Generate Report
      |
      v
   Report Job
      |
 ┌────┴─────┐
Small      Large
  |           |
Immediate   Background
  |           |
  └─────┬─────┘
        v
   Compute Data
        |
        v
   Preview Report
        |
   ┌────┼────┐
  PDF Excel Email
```

Small reports may be generated synchronously. Large reports must run as background jobs rather than blocking the browser indefinitely.

## 6.2 Report Performance Targets

| Report Type               | Generation Target |
| ------------------------- | ----------------: |
| Small operational report  |               TBD |
| Medium report             |               TBD |
| Large report              |    Background job |
| PDF export                |               TBD |
| Excel export              |               TBD |
| Email delivery initiation |               TBD |

Large reports must expose job status:

```text
QUEUED
  ↓
PROCESSING
  ↓
COMPLETED
```

or:

```text
QUEUED
  ↓
PROCESSING
  ↓
FAILED
```

Failed reports must record the failure reason and provide a retry mechanism.

---

# 7. Offline Capability — Field Employees

Offline capability is a **mandatory functional NFR** because the Field Employee flow explicitly provides an offline mode.

The source flow is:

```text
Field Employee Login
        |
Network Available?
   ┌────┴─────┐
 Online      Offline
   |            |
GPS Check-in  Offline Mode
   |            |
Dashboard    Cached Data
                |
         Local Collection
                |
           Queue for Sync
                |
        Network Restored?
          ┌────┴────┐
         No         Yes
          |           |
        Queue       Sync
                      |
               Update Dashboard
                      |
             Payment Confirmation
```

The source explicitly defines cached customer data, local collection, queueing, automatic synchronization and synchronization after network restoration.

---

## 7.1 Local Queue

The field client MUST maintain a persistent local synchronization queue.

The queue must survive:

- Application restart
- Browser/app restart
- Device restart
- Temporary network failure
- API timeout
- Background synchronization failure

Each queued operation must contain at minimum:

| Field                   | Requirement                                      |
| ----------------------- | ------------------------------------------------ |
| `client_transaction_id` | Client-generated UUID                            |
| `operation_type`        | Collection / note / other supported operation    |
| `created_at`            | Device timestamp                                 |
| `payload`               | Immutable operation payload                      |
| `attempt_count`         | Synchronization attempts                         |
| `status`                | QUEUED / SYNCING / SYNCED / FAILED / CONFLICT    |
| `last_error`            | Last synchronization failure                     |
| `server_reference`      | Server-generated reference after successful sync |

---

# 8. Client-Generated UUIDs

Every offline financial operation MUST receive a UUID generated on the client before synchronization.

Example:

```text
client_transaction_id
    =
UUID generated on field device
```

The server MUST treat this identifier as an idempotency key.

If the same operation reaches the server multiple times:

```text
Request 1 → POST → transaction created
Request 2 → same client_transaction_id
         → existing transaction returned
         → NO second ledger posting
```

This requirement is consistent with the LMS baseline, which explicitly requires a unique client transaction/idempotency identifier for offline payments to prevent duplicate posting.

---

# 9. Offline Data Scope

The source explicitly supports cached customer lists and offline collection.

The minimum offline dataset must therefore include the data required to execute the source-defined field collection flow:

- Assigned customer
- Customer identification information required by the collection screen
- Loan reference
- EMI due information
- Applicable overdue amount
- Applicable penalty information
- Collection assignment
- Route information where available
- Local transaction state
- Receipt information
- Visit notes/observations where supported

The system must not assume that every server-side dataset is available offline.

Only explicitly approved offline data should be cached.

---

# 10. Offline Conflict Resolution

The diagrams **do not define the conflict-resolution strategy**.

This is explicitly identified as an open question in the Field Employee flow: the source does not define what happens when customer, loan or payment data changes on the server while the field employee is offline.

Therefore, the final conflict-resolution policy is **TBD**.

However, financial transactions MUST NOT use silent last-write-wins semantics.

### Required safety principle

For money-related conflicts:

```text
Offline Payment
      |
      v
Server Validation
      |
 ┌────┴───────────┐
Valid            Conflict
 |                 |
Post             Hold
 |                 |
Ledger           Admin Review /
Update           Reconciliation
```

The system must never silently overwrite an existing payment, EMI balance or ledger transaction.

---

# 11. Stale-Schedule Detection

The source requires field employees to work from assigned customers and collection schedules, including cached data while offline.

The exact stale-schedule policy is **not defined in the diagrams**.

The implementation therefore requires a confirmed rule for:

- Maximum schedule age
- Schedule version
- Assignment version
- Loan version
- EMI version
- What happens when a schedule has changed while offline

A recommended technical mechanism is to associate cached records with server versions:

```text
schedule_version
loan_version
emi_version
assignment_version
```

During synchronization:

```text
Client Version
      |
      v
Server Version Check
      |
 ┌────┴───────┐
Same        Changed
 |             |
Process      Conflict /
             Refresh
```

This mechanism is proposed as an implementation approach, not as a source-defined business rule.

---

# 12. Offline Synchronization Requirements

Synchronization MUST be:

- Idempotent
- Retryable
- Ordered where financial dependencies require ordering
- Observable
- Auditable
- Safe against duplicate posting

The queue must support:

```text
QUEUED
  ↓
SYNCING
  ↓
SYNCED
```

Failure:

```text
SYNCING
   ↓
FAILED
   ↓
Retry
```

Unresolvable financial conflict:

```text
SYNCING
   ↓
CONFLICT
   ↓
Administrative reconciliation
```

The Field Employee diagram explicitly provides automatic synchronization after network restoration and a local queue for offline collection.

---

# 13. Security Requirements

## 13.1 Authentication

The application MUST use:

- Short-lived JWT access tokens
- Refresh-token based session renewal
- Secure refresh-token storage
- Token rotation
- Refresh-token revocation
- Session invalidation on logout
- Role/permission checks on protected operations

The diagrams define authentication flows and role separation but do not specify JWT or refresh-token mechanics. Therefore, JWT + refresh is an architectural security requirement requested for this NFR and not a source-derived flow.

---

# 14. Authorization

Authorization MUST be permission-based.

The Super Admin flow explicitly provides Role & Permission Management:

```text
Create Role
   ↓
Assign Module Permissions
   ↓
Save & Activate
```

Reports are also explicitly permission-based rather than being hard-coded solely by role.

Authorization must therefore be evaluated server-side for:

- Customer data
- Loans
- Collections
- Payments
- Penalties
- Reports
- Branch data
- Employee data
- Backup/restore
- Settlement
- Administrative configuration

Client-side permission checks are only UI controls and must never be treated as the security boundary.

---

# 15. Re-authentication for Sensitive Operations

Sensitive operations MUST require recent authentication/re-authentication.

Examples include:

- Password/security changes
- User/role permission changes
- Backup restore
- Financial adjustments
- Penalty waiver
- Penalty cancellation
- Settlement approval
- Loan closure
- Other high-impact administrative operations

The exact list of sensitive operations and the re-authentication timeout are **TBD**.

---

# 16. PII Protection

Customer and KYC data must be treated as sensitive information.

The system should protect:

- Identity information
- Address information
- Mobile numbers
- KYC documents
- Customer documents
- Guarantor information
- Financial information
- Loan information

Sensitive PII MUST be encrypted at rest.

Sensitive data MUST use:

- Encryption at rest
- TLS for data in transit
- Access control
- Least-privilege access
- Audit logging
- Secure document storage
- No sensitive information in application logs

The exact encryption algorithm, key-management architecture and key-rotation period are **TBD**.

---

# 17. Financial Data Integrity

Financial history MUST be immutable.

The LMS baseline explicitly states:

> Payments, penalties, adjustments, waivers, cancellations and settlements must remain auditable.

and:

> Do not silently overwrite financial history.

Therefore:

- Ledger records MUST be append-only.
- Payment history MUST NOT be overwritten.
- Penalty adjustments MUST create adjustment transactions.
- Penalty waivers MUST create waiver transactions.
- Cancellations MUST create cancellation records.
- Reversals MUST preserve the original transaction.
- Corrections MUST reference the original transaction.
- Audit records MUST be immutable.

---

# 18. Audit Immutability

Audit logs are explicitly part of the Super Admin system and are described as user activity tracking.

The audit system MUST capture, where applicable:

| Attribute              | Requirement                        |
| ---------------------- | ---------------------------------- |
| Actor                  | Required                           |
| Role                   | Required                           |
| Organization           | Required                           |
| Branch                 | Required where applicable          |
| Action                 | Required                           |
| Entity type            | Required                           |
| Entity ID              | Required                           |
| Timestamp              | Required                           |
| Request/correlation ID | Required                           |
| Before state           | Required for applicable changes    |
| After state            | Required for applicable changes    |
| Client transaction ID  | Required for financial operations  |
| IP/device information  | Subject to security/privacy policy |

Audit records MUST be append-only.

Application users MUST NOT have ordinary update/delete permissions on audit records.

---

# 19. Availability

The exact availability SLA is not defined in the source material.

Therefore:

| Metric                       | Target |
| ---------------------------- | -----: |
| Monthly availability         |    TBD |
| Planned maintenance window   |    TBD |
| Unplanned downtime target    |    TBD |
| Maximum maintenance duration |    TBD |

The system should be designed so that normal administrative operations and field collection operations are not unnecessarily coupled.

Offline field collection provides operational continuity when the network is unavailable.

---

# 20. Database Availability

PostgreSQL is the system of record.

The database architecture must provide:

- Transactional consistency
- Connection management
- Backup capability
- Restore capability
- Monitoring
- Failure detection
- Recovery procedures
- Protection against accidental data deletion

Financial transactions must use database transactions so that partial posting cannot leave the loan ledger in an inconsistent state.

---

# 21. Backup Requirements

The Super Admin flow explicitly exposes:

```text
Backup & Restore
       |
Schedule & Download
```

The system must support:

- Scheduled backups
- Backup verification
- Backup retention
- Secure backup storage
- Restore procedures
- Restore authorization
- Restore audit logging

The exact backup frequency and retention are **TBD**.

---

# 22. Backup Strategy

At minimum, the production database backup strategy should distinguish:

### Full Backup

Complete database backup at a defined frequency.

### Incremental / WAL Recovery

Where infrastructure supports it, transaction/WAL recovery should be used to reduce data loss between full backups.

### Backup Verification

A backup must not be considered valid merely because the backup command completed.

Restore verification must periodically confirm that backups can actually produce a usable database.

---

# 23. Recovery Point Objective

The RPO defines the maximum acceptable amount of data loss after a disaster.

| System/Data            | RPO |
| ---------------------- | --: |
| Financial transactions | TBD |
| Customer/KYC data      | TBD |
| Loan data              | TBD |
| Audit data             | TBD |
| Reports                | TBD |
| Notifications          | TBD |

Financial data should have the strictest recovery requirement.

---

# 24. Recovery Time Objective

| System Component | RTO |
| ---------------- | --: |
| Core API         | TBD |
| PostgreSQL       | TBD |
| Web application  | TBD |
| Background jobs  | TBD |
| Reports          | TBD |
| Notifications    | TBD |

RTO must be confirmed based on the organization's operational requirements.

---

# 25. Restore Security

Database restore MUST be restricted to explicitly authorized administrators.

Restore operations MUST:

1. Require authorization.
2. Require re-authentication.
3. Record the operator.
4. Record the backup used.
5. Record the restore timestamp.
6. Record the restore environment.
7. Produce an immutable audit event.

The restore process must not silently overwrite production data without an explicit operational procedure.

---

# 26. End-of-Day / Day Closing

The Branch Admin dashboard explicitly exposes:

- Day Closing
- Cash Book

The detailed Day Closing workflow is **not defined in the uploaded diagrams**.

Therefore, the following must be confirmed:

- EOD start time
- EOD end time
- Branch timezone
- Whether collections are blocked during EOD
- Whether payments can be posted after branch closing
- Cash reconciliation rules
- Outstanding transaction handling
- Offline transaction handling
- Report finalization
- EOD approval authority
- Reopening rules

---

# 27. EOD Batch Window

The system should support a configurable EOD processing window.

```text
Branch Operations
      |
      v
EOD Start
      |
      v
Validate Pending Operations
      |
      v
Cash / Collection Reconciliation
      |
      v
EOD Processing
      |
      v
Reports / Balances Finalization
      |
      v
EOD Complete
```

This diagram is an architectural proposal only. The actual EOD business workflow must be confirmed because the source only exposes **Day Closing** without defining its internal behavior.

---

# 28. Offline Transactions During EOD

A critical unresolved requirement is what happens when an offline field collection is synchronized after the branch has entered or completed EOD.

The system must explicitly define whether:

- The transaction is accepted for the original business date.
- The transaction receives the synchronization date.
- The transaction is held for next-day reconciliation.
- Branch Admin approval is required.
- Cash-book reconciliation is automatically updated.

This is especially important because the Field Employee flow allows collections to remain queued until network restoration.

---

# 29. Notification Reliability

Notifications are event-driven.

The source defines notifications for:

- Loan Closed
- Loan Approved
- Loan Rejected
- EMI Due Tomorrow
- EMI Due Today
- EMI Missed
- Penalty Added
- Receipt Generated

The notification system MUST NOT compromise financial transaction integrity.

A successful payment/ledger transaction must remain successful even if SMS, Push or Email delivery fails.

The finalized notification design explicitly states that notification failure must not roll back a successfully committed payment or ledger transaction.

---

# 30. Notification Retry

Notification delivery must:

- Track delivery status per channel.
- Retry failed channels independently.
- Support a maximum of three attempts.
- Record every attempt.
- Mark the notification as failed after the retry limit.
- Alert an administrator after final failure.

The source explicitly defines a maximum of three attempts and administrative escalation after failure.

---

# 31. Data Consistency Requirements

The LMS must maintain strong consistency for financial operations.

Examples:

```text
Payment
  ↓
Payment Verification
  ↓
Ledger Posting
  ↓
Receipt
```

The source collection flow requires payment verification before receipt generation and ledger update.

For loan closure:

```text
Verify EMIs
    ↓
Calculate Closure Amount
    ↓
Collect Final Payment
    ↓
Generate Receipt
    ↓
Update Ledger
    ↓
Mark Loan Closed
    ↓
Generate NOC
```

The system must not mark a loan closed if the required financial posting has not successfully completed.

---

# 32. Compliance Requirements

The uploaded LMS diagrams do not identify a specific regulatory framework or retention period.

Therefore, compliance requirements must be finalized against the organization's applicable:

- RBI requirements
- NBFC regulatory obligations
- KYC/AML requirements
- Accounting requirements
- Tax requirements
- Data-protection/privacy requirements
- Legal/document-retention requirements
- Internal audit requirements

No specific retention duration should be hard-coded until the organization's legal/compliance requirements are confirmed.

---

# 33. Data Retention

Retention must be defined separately by data category.

| Data                 | Retention Period |
| -------------------- | ---------------: |
| Customer master data |              TBD |
| KYC records          |              TBD |
| Guarantor data       |              TBD |
| Loan applications    |              TBD |
| Active loans         |              TBD |
| Closed loans         |              TBD |
| EMI schedules        |              TBD |
| Payment transactions |              TBD |
| Ledger transactions  |              TBD |
| Penalty records      |              TBD |
| Settlement records   |              TBD |
| Audit logs           |              TBD |
| Notification logs    |              TBD |
| Generated reports    |              TBD |
| Receipt documents    |              TBD |
| NOC documents        |              TBD |
| Backup data          |              TBD |

Retention must not be implemented as arbitrary application-level deletion.

---

# 34. Data Deletion

Financial and audit data must not be physically deleted merely because the associated customer or loan is no longer active.

Where legal deletion is required, the system must distinguish:

```text
Business Deactivation
        ≠
Physical Data Deletion
```

Historical financial records must remain available for audit and reconciliation according to the organization's retention policy.

The system must also account for dependencies when attempting branch/customer/loan deletion. The Super Admin and Branch Admin flows expose branch/customer/loan management but do not define historical-data deletion behavior.
---

# 35. Observability

The production system must provide observability for:

- API latency
- API errors
- Database latency
- Database connection usage
- Background job failures
- Report generation
- Notification delivery
- Offline synchronization
- Financial transaction failures
- Authentication failures
- Authorization failures
- Backup failures
- Restore operations
- EOD processing
- Queue backlog

Correlation IDs should connect:

```text
User Request
   ↓
API
   ↓
Domain Operation
   ↓
Database Transaction
   ↓
Background Job
   ↓
Notification
```

This is particularly important for offline synchronization and financial reconciliation.

---

# 36. Logging Requirements

Application logs MUST NOT contain sensitive information unnecessarily.

Do not log:

- Passwords
- Access tokens
- Refresh tokens
- Full KYC documents
- Sensitive PII
- Payment secrets
- Private encryption keys

Logs should contain identifiers that allow authorized operators to correlate operations without exposing unnecessary customer information.

---

# 37. Security Failure Handling

Security-sensitive failures must be auditable.

Examples:

- Invalid login
- Account lock
- Permission denial
- Re-authentication failure
- Unauthorized financial operation
- Backup restore attempt
- Audit access
- Role/permission change

The Branch Admin flow explicitly includes failed-attempt tracking and temporary account locking as part of the finalized baseline.

The exact failed-attempt threshold and lock duration remain open requirements.

---

# 38. Resilience Requirements

The system must tolerate temporary failure of:

- Network connectivity
- Database connections
- Background jobs
- Notification providers
- Report generation
- File/document storage
- Field-device synchronization

Financial transactions must fail safely.

For example:

```text
Payment Request
      |
      v
Database Transaction
   ┌──┴───────┐
Success      Failure
   |            |
Commit       Rollback
   |            |
Receipt       Retry
```

A failed financial transaction must not partially update the loan ledger.

---

# 39. Idempotency Requirements

Idempotency is mandatory for money-posting operations.

The minimum idempotency boundary includes:

- EMI payment
- Partial payment
- Penalty payment
- Loan closure payment
- Disbursement
- Settlement
- Offline synchronization

The server must enforce uniqueness of the client transaction/idempotency identifier.

The Field Employee baseline specifically requires this for offline payments.

---

# 40. Security and NFR Priority

When NFRs conflict, the following priority applies:

```text
1. Financial correctness
2. Data integrity
3. Security
4. Auditability
5. Availability
6. Performance
7. Convenience
```

For example, the system must not bypass payment verification merely to achieve a lower API latency.

---

# 41. NFR Acceptance Criteria

The LMS will be considered NFR-ready only after the following have been explicitly approved:

- [ ] Production branch capacity
- [ ] Customer capacity
- [ ] Loan capacity
- [ ] Concurrent field-agent capacity
- [ ] Daily transaction capacity
- [ ] API p95 targets
- [ ] Page-load targets
- [ ] Report-generation targets
- [ ] Offline data scope
- [ ] Offline queue behavior
- [ ] Conflict-resolution strategy
- [ ] Stale-schedule policy
- [ ] JWT/session configuration
- [ ] Sensitive-operation re-authentication policy
- [ ] PII encryption specification
- [ ] Audit immutability implementation
- [ ] Availability SLA
- [ ] RPO
- [ ] RTO
- [ ] Backup frequency
- [ ] Backup retention
- [ ] Restore procedure
- [ ] EOD window
- [ ] Offline transaction/EOD behavior
- [ ] Compliance framework
- [ ] Data-retention periods

---

# 42. Source-Derived Requirements vs TBD Requirements

| Requirement                                    | Source Status                                |
| ---------------------------------------------- | -------------------------------------------- |
| Field employee offline mode                    | Defined                                      |
| Cached customer data                           | Defined                                      |
| Local collection                               | Defined                                      |
| Offline queue                                  | Defined                                      |
| Automatic synchronization                      | Defined                                      |
| Network-restored synchronization               | Defined                                      |
| Client idempotency for offline payments        | Finalized project rule                       |
| Offline conflict resolution                    | **Not defined**                              |
| Stale schedule handling                        | **Not defined**                              |
| Report background processing for large reports | Finalized project rule                       |
| Report failure/retry                           | Finalized project rule                       |
| Notification maximum 3 retries                 | Defined/finalized                            |
| Immutable financial history                    | Finalized project rule                       |
| Audit logging                                  | Defined                                      |
| JWT + refresh                                  | Architecture requirement; not source-defined |
| Re-authentication                              | Architecture requirement; exact policy TBD   |
| PII encryption                                 | Security requirement; implementation TBD     |
| Availability SLA                               | **Not defined**                              |
| RPO                                            | **Not defined**                              |
| RTO                                            | **Not defined**                              |
| Backup scheduling                              | Defined as module capability                 |
| Backup retention                               | **Not defined**                              |
| Restore procedure                              | **Not defined**                              |
| EOD / Day Closing                              | Module exists; detailed workflow not defined |
| EOD batch window                               | **Not defined**                              |
| Compliance framework                           | **Not defined**                              |
| Data retention                                 | **Not defined**                              |

---

# 43. Recommended Technical Enforcement

The NFRs should be enforced at the appropriate architectural layer.

| Requirement           | Enforcement Layer                          |
| --------------------- | ------------------------------------------ |
| Authentication        | NestJS Auth Module                         |
| Authorization         | NestJS Guards / Permission layer           |
| Idempotency           | API + PostgreSQL unique constraint         |
| Financial consistency | PostgreSQL transaction                     |
| Ledger immutability   | Database permissions + append-only service |
| Audit immutability    | Audit module + database controls           |
| Offline queue         | Field client persistent storage            |
| Synchronization       | API sync endpoint + pg-boss                |
| Report jobs           | pg-boss                                    |
| Notification retries  | pg-boss + notification delivery records    |
| Backup                | PostgreSQL/infrastructure layer            |
| PII encryption        | Application/database/storage layer         |
| Report access         | Permission layer                           |
| EOD processing        | Branch/day-closing domain + pg-boss        |
| Monitoring            | Application/infrastructure observability   |

The architecture remains aligned with the documented pnpm workspace structure, with Next.js under `apps/web`, NestJS modules under `apps/api`, and PostgreSQL/Prisma as the database layer.

---

# 44. Final NFR Principle

The LMS must be designed as a **financially consistent, auditable and offline-capable loan platform**, not merely a CRUD application.

The most critical non-functional guarantees are:

```text
             ┌─────────────────────┐
             │   Financial Data    │
             │      Integrity      │
             └──────────┬──────────┘
                        │
        ┌───────────────┼────────────────┐
        ↓               ↓                ↓
   Idempotency       Auditability    Consistency
        │               │                │
        └───────────────┼────────────────┘
                        ↓
                Offline Reliability
                        ↓
                 Availability
                        ↓
                  Performance
```

Performance must never be achieved by weakening financial integrity, auditability, security, or synchronization correctness.
