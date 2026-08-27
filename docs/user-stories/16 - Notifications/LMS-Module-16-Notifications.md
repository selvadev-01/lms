# Module 16 — Notifications

## User Story — Notifications

### Epic

Communication & Operational Alerts

### Feature

In-App, Email, SMS and Operational Notification Management

### User Story

As an authorized LMS user  
I want to receive timely, relevant and scoped notifications about events that require my attention  
So that I can take action on applications, approvals, disbursals, collections, overdue accounts, recovery work and other operational events.

As a system administrator  
I want to configure notification templates, channels, event rules and delivery controls  
So that communications are consistent, auditable and sent only to eligible recipients.

---

## Rules & Business Constraints

1. Every notification is scoped by `organization_id`.
2. Branch-specific notifications are additionally scoped by `branch_id` where the source event belongs to a branch.
3. Notification recipients must be resolved from the authoritative user, role, assignment and branch scope at the time required by the notification policy.
4. A user must never receive notification content for an organization or branch outside the user's authorized scope.
5. Client-side filtering is not sufficient; recipient authorization and notification visibility must be enforced server-side.
6. A notification is an event-driven communication record and must not independently change the state of a loan, application, EMI, receipt, collection, recovery case or ledger entry.
7. Sending, retrying, reading, dismissing or failing a notification must never modify the underlying business transaction.
8. Notification events must reference authoritative source records where applicable.
9. If a source transaction is later reversed, corrected or cancelled, the notification history remains auditable and any corrective notification follows the authoritative source workflow.
10. Notifications may be delivered through supported channels such as in-app, email and SMS, subject to final channel requirements.
11. A single business event may create one or more notification deliveries for different recipients or channels.
12. Duplicate delivery must be prevented according to an event-level idempotency rule.
13. Retrying a notification delivery must not create uncontrolled duplicate sends.
14. Each notification event must have a stable deduplication key or equivalent uniqueness mechanism where retries are possible.
15. Delivery attempts must be recorded separately from the logical notification where multiple attempts occur.
16. Notification status must distinguish at minimum logical creation and delivery outcomes where applicable.
17. A notification must not be marked as delivered merely because the system successfully handed it to an external provider unless the provider semantics explicitly define that status.
18. Provider-specific statuses must be mapped to canonical internal statuses without losing the relevant provider response reference.
19. Failed delivery must be retryable only according to configured retry rules.
20. Permanent failures must not retry indefinitely.
21. Retry attempts must use deterministic backoff and maximum-attempt rules.
22. A duplicate source event must not result in duplicate logical notifications when the same idempotency or deduplication key applies.
23. If the notification infrastructure receives the same source event more than once, processing must remain idempotent.
24. Notifications generated from money-related events must report authoritative amounts stored and processed as integer paise.
25. Floating-point money values are prohibited in notification generation and template rendering.
26. EMI due dates communicated in notifications are DATE-only values using Asia/Kolkata business-date rules.
27. Notification templates must not independently recalculate EMI, overdue, penalty, interest, principal or other financial values.
28. Part-payment notifications must use authoritative allocation information based on the order: **penalty → interest → principal → fees**.
29. A collection or receipt notification must reference the authoritative collection state and must not treat an unposted or reversed receipt as final unless the notification event definition explicitly requires it.
30. Payment posting remains idempotent on its `Idempotency-Key`; notification processing must not cause a second payment posting.
31. Every money movement remains governed by double-entry accounting in the owning transaction module; sending a notification creates no ledger line.
32. Notification delivery records are not accounting records and must not be used as financial source-of-truth data.
33. Templates must be organization-scoped unless explicitly defined as protected system templates.
34. Branch-level administrators may manage only templates, rules or recipient configurations within their authorized branch scope if branch-level configuration is enabled.
35. Template names must be unique within the applicable organization and template category/versioning scope.
36. Deletion of a notification template is blocked when it is referenced by an active event rule, scheduled notification, immutable notification history or other downstream dependency.
37. Referenced templates must be deactivated rather than deleted.
38. An inactive template cannot be selected for new notification generation.
39. Historical notification records retain the template version or rendered content reference required for auditability.
40. Editing a template must not retroactively rewrite already-created notification content.
41. Notification event rules must be explicitly mapped to supported source events.
42. A notification rule must define eligible recipient resolution, channel policy and template selection.
43. Invalid or inactive recipient records must not receive new notifications.
44. A deactivated user must not receive new notifications after deactivation, except where a legal or explicitly configured historical delivery requirement exists.
45. Historical notifications for deactivated users remain preserved according to retention policy.
46. Users may manage personal notification preferences only for channels and event types that the organization permits them to control.
47. Mandatory operational or compliance notifications cannot be disabled by a user where organization policy marks them mandatory.
48. A user preference must never override an explicit mandatory notification rule.
49. Notification preferences are scoped to the authenticated user and organization.
50. A user cannot edit another user's personal notification preferences unless an explicitly authorized administrative capability exists.
51. Marking a notification as read affects only the recipient's read state and does not alter the source event.
52. Read/unread state must be maintained per recipient when one logical event notifies multiple users.
53. A user may view only notifications addressed to that user or otherwise explicitly shared through authorized scope.
54. A notification list must be filterable by defined criteria such as read status, type, date and source module.
55. Notification content containing PII or sensitive financial information must be minimized and controlled by channel and permission policy.
56. SMS and email content must not expose unnecessary sensitive data.
57. Links inside notifications must require normal authentication and authorization when opened.
58. A notification link must not bypass organization, branch or role checks.
59. Notification actions that invoke an LMS operation must perform normal permission and state validation.
60. An external provider outage must not cause loss of the authoritative source transaction.
61. Provider failures must be recorded independently from source transaction success.
62. A notification may be delayed, failed or retried without rolling back a successfully committed business transaction unless the source workflow explicitly defines synchronous notification as a hard business requirement.
63. If outbox or queued event processing is used, source event persistence and notification processing must support reliable replay without uncontrolled duplicate sends.
64. Offline clients may queue only supported local notification preference or read-state actions; they must not invent authoritative source events.
65. Offline changes must include client-generated identifiers or concurrency/version information where synchronization requires conflict detection.
66. A stale offline preference update must not silently overwrite a newer server-side preference change.
67. Notification timestamps must preserve the authoritative event time and delivery attempt times separately.
68. Business-date fields such as EMI due date remain DATE-only and must not be converted into arbitrary timestamp semantics.
69. Notification retention and purge behavior must follow the configured retention policy.
70. Deletion of immutable delivery or audit history must be blocked where retention requires preservation.
71. Soft deletion or archival may be used for user-visible notifications where permitted, without deleting required audit evidence.
72. All notification configuration changes are audit logged.
73. Notification generation, delivery attempts, failures, retries, read-state changes where required, permission denials and administrative actions are audit logged.
74. All actions are audit logged.

---

## Background

Given the user is logged into the system  
And the user has permission to access Notifications or manage Notification configuration as applicable  
And the user's organization and branch scope are resolved from the authenticated session  
And notification events originate from authoritative LMS modules  
And money values are represented as integer paise  
And EMI due dates use DATE-only semantics in Asia/Kolkata

Authoritative source modules may trigger notification events for:

- Loan Application submitted
- Application returned or rejected
- Approval requested
- Approval approved
- Approval rejected
- Approval escalated
- Disbursal completed or failed
- EMI due
- EMI overdue
- EMI partially paid
- EMI paid
- Receipt posted
- Receipt reversed
- Field collection sync or reconciliation exception
- Cash shortage or excess
- Recovery assignment
- Promise-to-pay reminder
- Promise-to-pay missed
- Loan foreclosed
- Loan closed
- Loan written off
- NPA state change
- Security or account events where Module 1 authentication policies require notification

The notification lifecycle is:

`Created`
→ `Queued`
→ `Processing`
→ `Sent`

or:

`Created`
→ `Queued`
→ `Processing`
→ `Failed`
→ `Retrying`
→ `Sent`

or:

`Created`
→ `Suppressed`

A recipient read lifecycle is independent:

`Unread`
→ `Read`

A notification can also become:

`Archived`

according to retention and user-visible lifecycle rules.

---

# Feature: Notification Center

## Menu

Notifications  
→ All Notifications

Notifications  
→ Unread

Notifications  
→ Notification Preferences

Administration  
→ Notifications  
→ Event Rules

Administration  
→ Notifications  
→ Templates

Administration  
→ Notifications  
→ Delivery Monitoring

Suggested routes:

`/notifications`  
`/notifications/preferences`  
`/admin/notifications/rules`  
`/admin/notifications/templates`  
`/admin/notifications/deliveries`

Actions: List, View Details, Mark Read, Mark Unread where permitted, Archive, Filter, Update Preferences, Add, Edit, Deactivate, Delete Where Permitted, Retry Failed Delivery, View Delivery History

---

# Notification — Fields

## Notification Details

```text
Title *
Message *
Notification Type *
Source Module
Source Record Reference
Event Type *
Priority
Created At
Event Time
```

## Recipient

```text
Recipient User *
Organization *
Branch
Recipient Role Snapshot
```

## Delivery

```text
Channel *
Delivery Status *
Provider Reference
Attempt Count
Last Attempt At
Delivered At
Failure Code
Failure Message
```

## User State

```text
Read Status *
Read At
Archived At
```

---

# Notification Template — Fields

## Template Identity

```text
Template Name *
Template Code *
Organization *
Category *
Status *
```

## Channel

```text
Channel *
Subject
Title Template
Message Template *
```

## Source / Event Mapping

```text
Supported Event Type *
Source Module *
```

## Content Controls

```text
Locale
Contains PII
Sensitive Data Classification
Version
```

---

# Notification Event Rule — Fields

## Rule Identity

```text
Rule Name *
Event Type *
Organization *
Status *
```

## Source

```text
Source Module *
Source State / Trigger *
```

## Recipient Resolution

```text
Recipient Strategy *
Role
Assigned User
Record Owner
Branch User Group
Explicit Recipient
```

## Delivery Policy

```text
Channel *
Template *
Priority
Retry Policy
Mandatory *
```

## Timing

```text
Send Immediately
Scheduled Offset
Business Date Trigger
```

---

# Notification Preference — Fields

## User Scope

```text
User *
Organization *
```

## Channel Preferences

```text
In-App Enabled
Email Enabled
SMS Enabled
```

## Event Preferences

```text
Application Alerts
Approval Alerts
Disbursal Alerts
EMI Alerts
Collection Alerts
Field Collection Alerts
Overdue Alerts
Recovery Alerts
Security Alerts
```

## Table Only (Not for UI)

```text
notification_id
organization_id
branch_id
event_id
event_type
source_module
source_record_id
source_version
deduplication_key
recipient_id
recipient_scope_hash
template_id
template_version
rendered_payload_hash
notification_status
read_status
created_at
queued_at
processed_at
sent_at
archived_at

delivery_attempt_id
notification_id
attempt_number
channel
provider
provider_message_id
provider_status
canonical_status
attempted_at
completed_at
failure_code
failure_message
next_retry_at

notification_rule_id
organization_id
branch_id
event_type
recipient_strategy
template_id
channel_policy
retry_policy_id
is_mandatory
is_active
version

preference_id
user_id
organization_id
channel_preferences
event_preferences
version
updated_at

outbox_event_id
organization_id
event_type
aggregate_type
aggregate_id
event_version
deduplication_key
created_at
processed_at
```

---

# Notification Status Constraints

```text
Logical notification status:
Created
Queued
Processing
Sent
Failed
Retrying
Suppressed
Archived

Recipient read status:
Unread
Read

Template status:
Active
Inactive

Event rule status:
Active
Inactive

Delivery attempt canonical status:
Pending
AcceptedByProvider
Delivered
Failed
RetryScheduled
PermanentFailure
```

Provider-specific values must be mapped to canonical statuses without falsely claiming delivery.

---

# Gherkin Scenarios

## Notification Center — List / View

### Scenario 1: List notifications for the authenticated user

Given notifications exist for User A and User B  
And the logged-in user is User A  
When User A opens Notifications  
Then only notifications addressed to User A are returned  
And User B notifications are not exposed.

### Scenario 2: View notification details

Given an authorized notification exists for the logged-in user  
When the user opens the notification  
Then the system displays the authorized title, message, source reference and status  
And opening the notification does not modify the source business transaction.

### Scenario 3: Mark notification as read

Given the user has an unread notification  
When the user marks the notification as read  
Then only that recipient's read state changes to Read  
And the underlying source record remains unchanged.

### Scenario 4: Mark one recipient read without affecting another recipient

Given the same source event created notifications for User A and User B  
And both notifications are unread  
When User A marks the notification as read  
Then User A's notification state becomes Read  
And User B's notification remains Unread.

### Scenario 5: Filter notifications

Given the user has notifications with different types, dates and read states  
When the user applies a supported filter  
Then only matching authorized notifications are returned  
And unauthorized notifications are never included in the result.

---

## Mandatory Field Validation

### Scenario Outline: Mandatory notification configuration validation

Given the user has permission to manage the applicable notification configuration  
When the user submits without <field>  
Then the system shows "<message>"  
And the configuration is not saved

Examples:

| field              | message                        |
| ------------------ | ------------------------------ |
| Template Name      | Template Name is required      |
| Template Code      | Template Code is required      |
| Organization       | Organization is required       |
| Category           | Category is required           |
| Channel            | Channel is required            |
| Message Template   | Message Template is required   |
| Event Type         | Event Type is required         |
| Rule Name          | Rule Name is required          |
| Recipient Strategy | Recipient Strategy is required |

---

## Templates — Add / Edit / View

### Scenario 6: Add notification template

Given the user has permission to manage notification templates  
When the user creates a valid template  
Then the system stores the template under the authorized organization scope  
And the template receives the configured initial status.

### Scenario 7: Prevent duplicate template code

Given an active or retained template with the same code exists in the applicable uniqueness scope  
When the user creates another template with the same code  
Then the system rejects the duplicate  
And the existing template remains unchanged.

### Scenario 8: Edit notification template without changing history

Given a template has been used to create historical notifications  
When an authorized user edits the template  
Then future notifications use the permitted updated template version  
And already-created notification content is not retroactively rewritten.

### Scenario 9: View template only within authorized scope

Given Organization A and Organization B each have notification templates  
And the administrator belongs only to Organization A  
When the administrator lists templates  
Then only Organization A templates are returned  
And Organization B templates are not exposed.

---

## Templates — Delete / Deactivate / Active Behaviour

### Scenario 10: Deactivate referenced notification template

Given a template is referenced by an active event rule  
When an authorized administrator deactivates the template according to configuration rules  
Then the template becomes inactive for new notification generation  
And historical notification records remain preserved.

### Scenario 11: Delete template referenced downstream is blocked

Given a template is referenced by an active rule, notification history or retention dependency  
When the user attempts to delete the template  
Then deletion is blocked  
And the system requires deactivation or dependency removal where permitted.

### Scenario 12: Inactive template cannot generate new notification

Given a notification template is inactive  
When a source event attempts to use the template for a new notification  
Then the system does not generate a notification using the inactive template  
And the event is handled according to the configured failure or suppression policy.

### Scenario 13: Active template generates notification

Given an active template is mapped to an active event rule  
When the corresponding authoritative source event occurs  
Then the system creates the notification using the applicable template version  
And the creation is associated with the authoritative event reference.

---

## Event Rules

### Scenario 14: Add notification event rule

Given the user has permission to manage notification rules  
And the selected event type is supported  
When the user creates a valid event rule  
Then the rule stores the source event, recipient strategy, channel policy and template reference  
And the rule is scoped to the authorized organization.

### Scenario 15: Reject unsupported source event mapping

Given the user is configuring an event rule  
When the user selects an unsupported source module and event combination  
Then the system rejects the configuration  
And no invalid event rule is activated.

### Scenario 16: Resolve recipient from authoritative assignment

Given a recovery assignment event occurs  
And the event rule targets the assigned Recovery Officer  
When the notification is generated  
Then the recipient is resolved from the authoritative recovery assignment  
And an unauthorized or inactive user is not selected as a recipient.

### Scenario 17: Mandatory rule overrides personal preference

Given a notification rule is marked mandatory  
And the recipient has disabled the corresponding optional channel or event preference  
When the authoritative event occurs  
Then the mandatory notification is processed according to the rule  
And the user preference does not suppress the mandatory communication.

---

## Notification Preferences

### Scenario 18: Update personal notification preferences

Given the user has permission to manage personal notification preferences  
When the user enables or disables an allowed channel or event preference  
Then the system stores the preference under that user's authorized organization scope  
And the change is audit logged.

### Scenario 19: User cannot modify another user's preferences

Given User A lacks administrative preference-management permission  
When User A attempts to update User B's preferences  
Then the system denies the request  
And User B's preferences remain unchanged.

### Scenario 20: Disabled optional preference suppresses notification

Given an event notification is optional  
And the recipient has disabled that allowed event or channel preference  
When the source event occurs  
Then the system suppresses the applicable optional delivery  
And records the suppression outcome where required.

### Scenario 21: Stale preference update conflict

Given the same preference record was changed on another device  
When a stale client submits an outdated update  
Then the system detects the version or concurrency conflict  
And does not silently overwrite the newer authoritative preference.

---

## Event Processing and Idempotency

### Scenario 22: Create notification from authoritative event

Given an authoritative loan application event is committed  
And an active notification rule matches the event  
When notification processing handles the event  
Then the system creates the logical notification with the authoritative source reference  
And source transaction data remains unchanged.

### Scenario 23: Duplicate source event does not duplicate notification

Given a notification event with a deduplication key has already been processed successfully  
When the same event is received again  
Then the system does not create an uncontrolled duplicate logical notification  
And the duplicate processing attempt is traceable.

### Scenario 24: Retry does not create duplicate logical notification

Given a notification delivery failed after the logical notification was created  
When the system retries delivery  
Then the retry creates a new delivery attempt under the same logical notification where applicable  
And does not create a second unrelated notification.

### Scenario 25: Payment idempotency remains independent from notification processing

Given a receipt payment has already been posted using an Idempotency-Key  
And the payment event is replayed to notification processing  
When the notification service handles the event  
Then notification processing does not repost the payment  
And no duplicate money movement or ledger entry is created.

---

## Delivery

### Scenario 26: Deliver notification through configured channel

Given an active event rule resolves an eligible recipient  
And the configured channel is available  
When the notification is processed  
Then the system creates a delivery attempt  
And records the provider response reference and canonical delivery status where available.

### Scenario 27: Provider accepts but does not confirm final delivery

Given an external provider accepts a notification request  
When the provider does not provide final delivery confirmation  
Then the system records the appropriate provider/canonical status  
And does not falsely mark the notification as Delivered.

### Scenario 28: Temporary provider failure schedules retry

Given a notification delivery fails with a retryable provider error  
When the failure is processed  
Then the system records the failure attempt  
And schedules the next retry according to deterministic backoff and maximum-attempt rules.

### Scenario 29: Permanent delivery failure stops retrying

Given a delivery failure is classified as permanent  
When the failure is recorded  
Then the notification enters the configured failed or permanent-failure outcome  
And the system does not retry indefinitely.

### Scenario 30: Maximum retry attempts reached

Given a retryable notification has reached the configured maximum attempts  
When the final attempt fails  
Then the system marks the delivery according to the terminal failure state  
And no additional automatic retry is scheduled.

### Scenario 31: External provider outage does not roll back source transaction

Given a valid collection, approval or other source transaction has already committed  
And the external notification provider is unavailable  
When notification delivery fails  
Then the source transaction remains committed according to its own workflow  
And the notification failure is recorded independently.

---

## Financial and Collection Notifications

### Scenario 32: Collection notification uses authoritative integer paise amount

Given an authoritative collection has been posted  
When a collection notification is generated  
Then the amount is sourced as integer paise from the authoritative transaction  
And no floating-point calculation is used.

### Scenario 33: Part-payment notification uses authoritative allocation

Given a posted collection is a part-payment  
When the notification includes allocation details  
Then the values follow the authoritative allocation order of penalty, interest, principal and fees  
And the notification does not independently recompute the allocation.

### Scenario 34: Reversed receipt notification preserves historical reference

Given a previously notified receipt is later reversed  
When the authoritative reversal event occurs  
Then the system creates the configured corrective or reversal notification  
And the original notification history remains traceable  
And no historical notification is silently edited to erase the original event.

### Scenario 35: Notification creates no ledger entry

Given a notification is sent about a money movement  
When the notification delivery completes  
Then no debit or credit ledger line is created by the notification action  
And all double-entry posting remains owned by the authoritative transaction module.

---

## EMI, Overdue and Recovery Notifications

### Scenario 36: EMI due notification uses DATE-only due date

Given an EMI becomes eligible for a due notification  
When the notification is generated  
Then the due date is rendered as a DATE-only value using Asia/Kolkata business-date semantics  
And the system does not introduce an arbitrary time component.

### Scenario 37: Overdue notification uses authoritative overdue state

Given an EMI or loan is overdue according to the authoritative overdue process  
When an overdue notification is generated  
Then the notification uses the authoritative overdue amount and status  
And it does not independently classify the account using conflicting logic.

### Scenario 38: Recovery assignment notification

Given a recovery case is assigned to an authorized Recovery Officer  
When the authoritative assignment event occurs  
Then the assigned officer receives the configured notification  
And the notification links to the recovery case subject to normal authorization.

### Scenario 39: Missed promise-to-pay notification

Given a promise-to-pay has passed according to the authoritative recovery rules  
And the required payment condition has not been satisfied  
When the missed-promise event is raised  
Then the configured recipient receives a missed-promise notification  
And the notification does not itself change the loan balance or recovery status.

---

## Branch Scoping

### Scenario 40: Branch Admin receives only own branch notification data

Given Branch A and Branch B have operational events  
And the Branch Admin belongs only to Branch A  
When the Branch Admin lists administrative branch notifications or event history  
Then only Branch A-authorized data is returned  
And Branch B notifications are not exposed.

### Scenario 41: Branch Admin cannot configure another branch rule

Given branch-level notification configuration is enabled  
And the Branch Admin is authorized only for Branch A  
When the Branch Admin attempts to create or edit a rule for Branch B  
Then the system denies the action  
And Branch B configuration remains unchanged.

### Scenario 42: Cross-organization notification access is denied

Given Organization A and Organization B have notification records  
And the user belongs only to Organization A  
When the user requests Organization B notification data directly or through filters  
Then the system denies access  
And Organization B notification metadata and content are not exposed.

---

## Permission Denial

### Scenario 43: Wrong role attempts template administration

Given the user lacks permission to manage notification templates  
When the user attempts to add, edit, deactivate or delete a template  
Then the system denies the action  
And the template remains unchanged.

### Scenario 44: Wrong role attempts event rule administration

Given the user lacks permission to manage notification rules  
When the user attempts to create or modify an event rule  
Then the system denies the request  
And no configuration change is persisted.

### Scenario 45: Wrong role attempts delivery retry

Given the user lacks permission to retry notification deliveries  
When the user attempts to retry a failed delivery  
Then the system denies the action  
And no new delivery attempt is created.

---

## Delete / Archive

### Scenario 46: Archive user-visible notification

Given a user has an authorized notification eligible for archival  
When the user archives it  
Then the notification is removed from the normal active list according to UI policy  
And required audit or delivery history remains preserved.

### Scenario 47: Delete immutable notification history is blocked

Given a notification or delivery record is retained for audit or compliance  
When a user attempts to delete the immutable historical record  
Then the system blocks deletion  
And preserves the required historical evidence.

### Scenario 48: Delete unreferenced configuration where permitted

Given a notification configuration record has no protected downstream reference  
And retention policy permits deletion  
When an authorized administrator deletes it  
Then the configuration is removed according to policy  
And historical notification records remain unaffected.

---

## Offline / Sync Conflict

### Scenario 49: Offline read-state sync

Given offline notification viewing is supported  
And the user marks a previously downloaded notification as read while offline  
When the device reconnects  
Then the read-state update is synchronized against the authorized recipient record  
And the source business transaction remains unchanged.

### Scenario 50: Offline stale notification content

Given the user has cached notifications while offline  
When the underlying source event changes or is reversed before reconnection  
Then the offline client does not treat the cached notification as a replacement for the authoritative current record  
And refreshed data reflects the authoritative state.

### Scenario 51: Offline preference conflict

Given the user changes notification preferences offline  
And the same preferences are changed on another device before synchronization  
When the offline update is submitted  
Then the system detects the conflict using the configured versioning strategy  
And does not silently overwrite the newer server state.

---

## Failure Paths

### Scenario 52: Template rendering failure

Given a notification event matches an active rule  
When required authoritative template data is missing or cannot be rendered  
Then the system records the notification generation failure  
And does not send malformed content as a successful notification.

### Scenario 53: Recipient resolution failure

Given a notification rule requires an assigned or role-based recipient  
When no eligible authorized recipient can be resolved  
Then the system records the failure or suppression according to policy  
And does not send the notification to an arbitrary user.

### Scenario 54: Inactive recipient

Given a recipient was deactivated before notification processing  
When the system resolves recipients for a new event  
Then the inactive user is excluded  
And the outcome is handled according to the configured recipient fallback policy.

### Scenario 55: Notification link access denied

Given a user receives a notification containing a source-record link  
And the user's access to that source record is later revoked  
When the user opens the link  
Then the system performs normal authentication and authorization checks  
And access is denied if the user is no longer authorized.

---

## Audit

### Scenario 56: Notification configuration changes are audit logged

Given an authorized administrator creates, edits, activates, deactivates or deletes permitted notification configuration  
When the action completes  
Then the audit history records the actor, action and affected configuration.

### Scenario 57: Notification delivery attempts are audit logged

Given a notification is processed  
When a delivery attempt succeeds, fails or is retried  
Then the system records the attempt outcome and relevant provider reference according to audit policy.

### Scenario 58: Permission denial is audit logged

Given a user attempts an unauthorized notification action  
When access is denied  
Then the denial is audit logged  
And no unauthorized data or configuration is changed.

### Scenario 59: Read-state action is audit logged where required

Given the organization requires auditability of notification acknowledgement  
When a user marks a notification as read  
Then the read-state transition and actor are recorded according to the configured audit policy.

---

# Acceptance Criteria

- Every notification and notification configuration record is scoped by organization and applicable branch.
- A Branch Admin cannot view or manage another branch's notification data or configuration without explicit authorization.
- Recipient resolution is based on authoritative user, role, assignment and scope data.
- Unauthorized users never receive notification content for another organization or branch.
- Notifications do not modify source business transactions.
- Notification sending does not create debit or credit ledger entries.
- Payment notification processing cannot repost a payment or create duplicate money movement.
- Money values used in notifications are sourced and processed as integer paise.
- Floating-point money calculations are prohibited.
- EMI due dates in notifications remain DATE-only and follow Asia/Kolkata business-date semantics.
- Part-payment details use authoritative penalty → interest → principal → fees allocation.
- Duplicate source-event processing is idempotent and does not create uncontrolled duplicate notifications.
- Delivery retries are recorded as separate attempts and follow configured deterministic retry limits.
- Provider acceptance is not falsely represented as confirmed delivery unless supported by provider semantics.
- Provider outages do not roll back already-committed authoritative business transactions.
- Templates are uniquely identified within their applicable scope.
- Historical notifications retain sufficient template version or rendered-content evidence for auditability.
- Editing a template does not rewrite historical notification content.
- Referenced templates and configurations cannot be deleted where downstream dependencies or retention rules require preservation.
- Inactive templates cannot be used for new notification generation.
- Inactive users do not receive new notifications unless an explicit policy requires otherwise.
- Personal preferences apply only to allowed optional notifications.
- Mandatory notification rules override personal opt-out where configured.
- Read state is maintained per recipient.
- Users can view only notifications addressed to them or explicitly authorized for them.
- Notification links enforce normal authentication and authorization.
- Notification configuration and delivery monitoring enforce RBAC.
- Offline notification state is treated as cached and non-authoritative until synchronized.
- Stale offline preference updates do not silently overwrite newer server state.
- Template rendering, recipient resolution and provider failures are handled explicitly.
- Unauthorized actions are denied without exposing restricted data.
- Notification generation, delivery attempts, retries, failures, configuration changes and required read-state events are audit logged.
- All actions are audit logged.

# Open Questions

1. Which notification channels are mandatory for the LMS MVP: in-app, email, SMS, push, WhatsApp or others?
2. Is mobile push notification required?
3. Is WhatsApp a notification channel or only a separate future integration?
4. Which events require immediate notification and which can be queued?
5. Which notifications are mandatory and cannot be disabled by users?
6. Which user roles receive each application, approval, disbursal, collection, overdue and recovery event?
7. Are customer/borrower notifications included in this LMS, or only internal staff notifications?
8. If borrower notifications are required, which verified contact method is authoritative?
9. Should customers receive payment receipts, due reminders, overdue reminders and foreclosure confirmations?
10. Are SMS and email templates managed by the same screen or separate screens?
11. Is multi-language template support required?
12. Is locale selection based on organization, customer or user preference?
13. Which PII and financial fields may appear in each channel?
14. Are message templates allowed to contain raw loan number, customer name or collection amount?
15. Are notification templates versioned explicitly?
16. Can an administrator roll back to a previous template version?
17. What exact uniqueness scope applies to Template Code?
18. Are system templates globally managed or organization-specific?
19. Can branch-level administrators manage templates and rules, or only organization-level administrators?
20. What exact recipient strategies are required?
21. Are notifications sent to roles, individual users, record owners, assigned officers or escalation groups?
22. What happens when no eligible recipient is resolved?
23. Is escalation required if a notification remains unread?
24. Is acknowledgement separate from simple read state?
25. Are read receipts required for email or SMS, where technically supported?
26. What external email provider will be used?
27. What SMS provider will be used?
28. Is provider delivery callback/webhook integration required?
29. What are the retry intervals and maximum retry attempts?
30. Which provider errors are retryable versus permanent?
31. What is the notification queue/outbox architecture?
32. Is guaranteed at-least-once event processing acceptable with deduplication?
33. What exact deduplication key format is required?
34. Should notification generation happen inside the source transaction, through an outbox, or another asynchronous mechanism?
35. What notification generation and delivery SLA is required?
36. What is the maximum acceptable delay for critical operational notifications?
37. Are scheduled reminders required?
38. If scheduled reminders are required, how are holidays and non-working days handled?
39. Should EMI due reminders use the due date itself, days before, or both?
40. What overdue reminder cadence is required?
41. What recovery and promise-to-pay reminder schedule is required?
42. Should notification delivery be visible to branch users, only administrators, or both?
43. What retention period applies to notification content and delivery history?
44. Can users archive notifications, and after how long should archived notifications be purged?
45. Is hard deletion ever permitted for user-visible notification records?
46. Which notification actions require immutable audit retention?
47. Is offline notification viewing required?
48. If offline viewing is supported, what maximum cache age is allowed?
49. Should stale cached notifications display an explicit freshness timestamp?
50. Are report exports or scheduled reports allowed to trigger notifications?
51. Should Module 15 report completion notifications be configured here?
52. Are authentication/security notifications owned jointly with Module 1 or exclusively configured here?
53. Which security events must trigger mandatory alerts?
54. Is notification preference management one screen or separate channel/event screens?
55. Are administrative delivery monitoring and retry actions part of the MVP?
56. Is a dead-letter queue or equivalent failure review workflow required?
57. What information should be exposed in provider failure messages to administrators?
58. Are rate limits required per recipient, event type or channel?
59. Should repeated source events be coalesced into a digest?
60. Are daily or periodic notification digests required?
61. Is notification analytics required, such as sent, delivered, failed and unread counts?
62. If yes, does notification analytics belong in Module 15 Reports or this module?
63. What exact audit fields are required for notification delivery and acknowledgement?
64. Are organization-wide quiet hours required?
65. If quiet hours are required, which notifications may bypass them?
66. Should branch holidays or business calendars affect scheduled notifications?

# End of Module 16
