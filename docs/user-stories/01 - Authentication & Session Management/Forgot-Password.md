# User Story — Forgot Password

## Epic

Authentication & Session Management

## Feature

Forgot Password — Mobile-Based Password Recovery

## User Story

As an **LMS user who cannot remember my password**  
I want to initiate password recovery using my registered mobile number  
So that I can regain access to my LMS account without requiring an administrator to manually reset my password.

The selected LMS authentication mechanism is **Mobile + Password**. Therefore, Forgot Password is defined as a recovery entry point based on the registered mobile number.

**Source boundary:** The uploaded LMS diagrams define Login, credential validation, account lock behavior for Branch Admin, Field Employee authentication, Offline Mode, GPS Check-in and Logout, but they do **not** contain a Forgot Password flow.
Accordingly, this document defines the **Forgot Password screen boundary and validation behavior**, while recovery-token/OTP delivery mechanics that are not established by the LMS source are explicitly identified as Open Questions rather than silently invented.

---

# Rules & Business Constraints

1. Forgot Password is a separate authentication screen reached from the Sign In screen.
2. LMS user authentication uses Mobile Number + Password.
3. Forgot Password must use the registered mobile number as the account-recovery identifier.
4. The mobile number must be normalized consistently with the Sign In flow.
5. The Forgot Password screen must not require the existing password because the purpose of the screen is to recover access when the password is unavailable.
6. An account must be eligible for password recovery before a recovery process can be completed.
7. `INACTIVE` accounts must not be silently reactivated through Forgot Password.
8. `LOCKED` accounts must not automatically become `ACTIVE` merely because a password-recovery request is initiated.
9. Password recovery must not bypass organization, account-status, role or security controls.
10. Forgot Password must not expose whether an arbitrary mobile number belongs to an LMS account through an account-enumeration-sensitive response.
11. Password recovery requests must be rate limited to prevent abuse.
12. Repeated recovery requests must not invalidate or interfere with unrelated authenticated sessions unless the finalized security policy explicitly requires it.
13. The recovery mechanism must use a short-lived, single-use recovery authorization before a new password can be established.
14. The exact recovery authorization mechanism is **not defined by the uploaded LMS diagrams**.
15. OTP-based login was not selected for normal authentication; authentication is Mobile + Password.
16. Whether password recovery uses OTP, a recovery link, another verification mechanism, or an administrator-assisted mechanism is **not defined by the source**.
17. Forgot Password must not itself change the user's password. Password creation belongs to Reset Password.
18. A successful Forgot Password request must transition the user into the approved password-recovery process.
19. A recovery request must not reveal the existing password, password hash, account status details, role, organization, branch or internal user identifiers.
20. Passwords must never be stored in plaintext.
21. Passwords must never be included in audit logs.
22. Recovery credentials, tokens or OTP values must never be stored or logged in plaintext where the finalized implementation requires them to be persisted.
23. Recovery requests must be audit logged without recording sensitive authentication secrets.
24. Failed recovery requests must also be audit logged according to the security audit policy.
25. A recovery attempt for a nonexistent mobile number must not create a user account.
26. A recovery attempt must not modify customer records.
27. Customer mobile-number verification is separate from LMS user authentication. The Customer Journey includes mobile verification for the Local Customer onboarding path, but that is a Customer/KYC concern rather than LMS password recovery.
28. User-account creation, editing, activation and deactivation belong to Module 3 — Users, Roles & Permissions.
29. Forgot Password must not change the organization or branch assigned to a user.
30. Forgot Password must not change the user's role or permissions.
31. Forgot Password must not create or modify financial transactions.
32. Forgot Password must not post accounting or ledger entries.
33. Money remains integer paise throughout the LMS; Forgot Password has no monetary fields.
34. EMI due dates remain DATE-only and Asia/Kolkata throughout the LMS; Forgot Password has no EMI-date fields.
35. Every money movement must use double-entry lines summing to zero; Forgot Password creates no money movement.
36. Payment posting idempotency through `Idempotency-Key` applies to payment operations and does not substitute for recovery-request protection.
37. The append-only ledger rule applies to accounting records and is not modified by password recovery.
38. Branch scoping applies to authenticated LMS data access. Forgot Password must not grant access to another organization's or branch's records.
39. A successful password recovery must not automatically grant permissions beyond the user's existing role.
40. All actions are audit logged.

---

# Background

Given the user has an LMS account  
And the user previously authenticates using Mobile Number + Password  
And the user cannot authenticate because the password is unavailable or forgotten  
And the user is on the Sign In screen

The Sign In flow is defined in the LMS authentication baseline as Login → Credentials Valid? → successful Dashboard or retry after invalid credentials. Super Admin invalid credentials return to Login, while Branch Admin failed attempts are tracked and can lead to temporary account locking.

The Forgot Password screen is therefore a separate recovery entry point from Sign In.

**Important source boundary:** The uploaded LMS flows do not specify the actual Forgot Password recovery mechanism. No OTP, SMS recovery code, email recovery link, recovery token, security question, administrator approval, expiry duration, or resend behavior is shown in the diagrams. Those details are intentionally not presented as source-defined requirements.

---

# Feature: Forgot Password Management

## Menu

Authentication → Sign In → Forgot Password

Actions: Enter Mobile Number, Submit Recovery Request, Cancel, Return to Sign In

---

# Forgot Password — Fields

## Account Recovery

| Field Name      | Mandatory |
| --------------- | --------: |
| Mobile Number * |         * |

## Screen Actions

| Action          | Purpose                                    |
| --------------- | ------------------------------------------ |
| Submit          | Start the password-recovery request        |
| Cancel          | Abandon the recovery request               |
| Back to Sign In | Return to the normal authentication screen |

---

# Mobile Number — Field Rules

The Mobile Number is the only source-defined identity input that can be directly established from the selected authentication model.

### Validation

- Mobile Number is mandatory.
- Mobile Number must use the same normalization rules as Sign In.
- Invalid mobile-number format must be rejected before the recovery request is submitted.
- Whitespace must be normalized.
- The system must not treat differently formatted representations of the same mobile number as separate identities.
- The exact accepted Indian mobile-number format is an Open Question.
- The exact country-code storage format is an Open Question.

### Security

The recovery response must not reveal sensitive account information.

The system must not expose:

- Password
- Password hash
- User ID
- Role
- Organization
- Branch
- Account status
- Internal database identifier
- Recovery secret
- Recovery token
- OTP, if OTP is eventually selected

---

# Table Only (Not for UI)

| Internal Field        | Allowed Values / Storage                                                               |
| --------------------- | -------------------------------------------------------------------------------------- |
| `mobile_number`       | Canonically normalized user mobile identifier                                          |
| `recovery_request_id` | Unique recovery-request identifier                                                     |
| `user_id`             | Nullable/associated LMS user reference after secure account resolution                 |
| `organization_id`     | Associated organization reference                                                      |
| `branch_id`           | Associated branch reference where applicable                                           |
| `request_status`      | `REQUESTED`, `VERIFIED`, `COMPLETED`, `EXPIRED`, `FAILED`, `RATE_LIMITED`, `CANCELLED` |
| `verification_status` | `PENDING`, `VERIFIED`, `FAILED`, `EXPIRED`                                             |
| `recovery_token_hash` | Hash of recovery authorization where token-based recovery is selected                  |
| `otp_hash`            | Hash of OTP where OTP-based recovery is selected                                       |
| `expires_at`          | Recovery authorization expiry timestamp                                                |
| `attempt_count`       | Non-negative integer                                                                   |
| `last_attempt_at`     | Recovery attempt timestamp                                                             |
| `consumed_at`         | Nullable timestamp once recovery authorization is consumed                             |
| `created_at`          | Recovery request creation timestamp                                                    |
| `completed_at`        | Nullable completion timestamp                                                          |
| `audit_event_id`      | Audit event reference                                                                  |

**Note:** `recovery_token_hash` and `otp_hash` are alternatives, not simultaneous mandatory fields. The source does not establish which recovery mechanism will be used.

---

# Recovery State Model

## Requested

The user has submitted a recovery request.

The system has not yet established authorization to change the password.

## Verification Pending

The user must complete the approved recovery verification mechanism.

The exact verification mechanism is not source-defined.

## Verified

The recovery request has passed the approved verification mechanism and may transition to Reset Password.

## Completed

The recovery process has successfully resulted in a password reset.

## Expired

The recovery authorization has exceeded its permitted lifetime.

## Failed

The recovery attempt cannot continue because the verification or recovery process failed.

## Rate Limited

The system temporarily prevents additional recovery requests because the configured recovery-request threshold has been exceeded.

---

# Gherkin Scenarios

## Navigation

### Scenario 1: User opens Forgot Password from Sign In

Given the user is on the Sign In screen  
When the user selects Forgot Password  
Then the system navigates to the Forgot Password screen  
And the Mobile Number field is displayed  
And no password value is requested on the Forgot Password screen  
And the navigation action is audit logged.

### Scenario 2: User returns to Sign In

Given the user is on the Forgot Password screen  
When the user selects Back to Sign In  
Then the system returns the user to the Sign In screen  
And the recovery form is not submitted  
And no password is changed  
And the navigation action is audit logged.

### Scenario 3: User cancels password recovery

Given the user is on the Forgot Password screen  
And no recovery request has been submitted  
When the user selects Cancel  
Then the recovery flow is abandoned  
And no password is changed  
And no authenticated session is created.

---

## Mandatory Validation

### Scenario 4: User submits without Mobile Number

Given the user is on the Forgot Password screen  
When the user submits without Mobile Number  
Then the system shows "Mobile Number is required"  
And no recovery request is created  
And no recovery message is sent  
And the validation failure is audit logged.

### Scenario Outline: Forgot Password mandatory-field validation

Given the user is on the Forgot Password screen  
When the user submits without `<field>`  
Then the system shows "<message>"  
And the recovery request is not created.

Examples:

| field         | message                   |
| ------------- | ------------------------- |
| Mobile Number | Mobile Number is required |

### Scenario 5: User submits an invalid mobile-number format

Given the user is on the Forgot Password screen  
And the Mobile Number field contains an invalid mobile-number format  
When the user submits the recovery request  
Then the system rejects the input  
And displays the mobile-number validation message  
And does not initiate account recovery  
And no recovery authorization is generated  
And the validation failure is audit logged.

### Scenario 6: User submits whitespace-only mobile number

Given the user is on the Forgot Password screen  
When the user enters only whitespace in Mobile Number  
And submits the recovery request  
Then the system treats the value as missing or invalid  
And does not initiate recovery  
And no recovery authorization is generated.

---

## Existing Account Handling

### Scenario 7: Recovery request is submitted for an eligible account

Given an LMS user account exists for the submitted mobile number  
And the account is eligible for password recovery  
When the user submits the Mobile Number  
Then the system creates a recovery request  
And the request enters the configured recovery state  
And the user is instructed to continue through the approved recovery mechanism  
And no password is changed at this stage  
And the recovery request is audit logged.

### Scenario 8: Recovery request is submitted for a nonexistent mobile number

Given no LMS user account exists for the submitted mobile number  
When the user submits the recovery request  
Then the system does not create a user account  
And the system does not modify any existing account  
And the response does not reveal whether the mobile number belongs to an LMS account  
And the recovery attempt is audit logged according to the security policy.

### Scenario 9: Recovery request does not disclose account role

Given an LMS account exists for the submitted mobile number  
And the account has a specific role  
When the user submits the Forgot Password request  
Then the recovery response does not reveal the user's role  
And the response does not expose whether the account is Super Admin, Branch Admin, Field Employee or another role  
And the recovery request is audit logged.

### Scenario 10: Recovery request does not disclose branch

Given an LMS account exists for the submitted mobile number  
And the account is assigned to a branch  
When the user submits the recovery request  
Then the recovery response does not disclose the branch  
And no branch-specific LMS data is returned  
And the recovery request is audit logged.

---

## Account State

### Scenario 11: Inactive account does not become active through Forgot Password

Given an LMS account exists for the submitted mobile number  
And the account status is `INACTIVE`  
When the user submits a Forgot Password request  
Then the system must not change the account status to `ACTIVE`  
And the recovery flow must not grant authenticated LMS access  
And the recovery attempt is audit logged.

### Scenario 12: Locked account does not automatically become unlocked

Given an LMS account exists for the submitted mobile number  
And the account status is `LOCKED`  
And the account is within the configured lock period  
When the user submits a Forgot Password request  
Then the recovery request must not automatically remove the lock  
And the account must not be treated as Active solely because recovery was requested  
And the event is audit logged.

### Scenario 13: Password recovery does not change role or permissions

Given an LMS account exists  
And the account has an assigned role and permissions  
When the user completes password recovery  
Then the user's role remains unchanged  
And the user's permissions remain unchanged  
And the user's organization remains unchanged  
And the user's branch scope remains unchanged  
And the change is audit logged.

### Scenario 14: Password recovery does not reactivate a deactivated user

Given a user account is `INACTIVE`  
And the user submits valid recovery information  
When the recovery process reaches password reset  
Then the system must not reactivate the account as part of password reset  
And the account remains `INACTIVE` until an authorized Module 3 action changes its status  
And the status-preservation event is audit logged.

---

## Recovery Authorization

### Scenario 15: Recovery cannot directly reset the password

Given the user has submitted a valid mobile number  
And a recovery request has been created  
When the request is initially submitted  
Then the user's existing password remains unchanged  
And the system does not mark the password as reset  
And the recovery request remains pending the required verification.

### Scenario 16: Unverified recovery request cannot access Reset Password

Given a recovery request exists  
And the recovery authorization has not been verified  
When the user attempts to access Reset Password  
Then the system denies the reset operation  
And the existing password remains unchanged  
And the failed recovery attempt is audit logged.

### Scenario 17: Expired recovery authorization cannot reset password

Given a recovery authorization was issued  
And the authorization has expired  
When the user attempts to continue to Reset Password  
Then the system rejects the recovery authorization  
And the existing password remains unchanged  
And the user must initiate a new recovery request  
And the expired authorization event is audit logged.

### Scenario 18: Recovery authorization cannot be reused

Given a recovery authorization has already been consumed  
When the same authorization is submitted again  
Then the system rejects the request  
And the password is not changed again  
And the replay attempt is audit logged.

### Scenario 19: Invalid recovery authorization is rejected

Given a recovery authorization does not match an active recovery request  
When the authorization is submitted  
Then the system rejects the recovery operation  
And the existing password remains unchanged  
And the failed authorization attempt is audit logged.

---

## Rate Limiting and Abuse Protection

### Scenario 20: Recovery request rate is within the permitted threshold

Given the user has not exceeded the configured password-recovery request limit  
When the user submits a recovery request  
Then the request is accepted for processing  
And the recovery request is audit logged.

### Scenario 21: Recovery request exceeds the configured threshold

Given repeated recovery requests have reached the configured rate limit  
When the user submits another recovery request  
Then the system prevents further recovery processing according to the configured rate-limit policy  
And the request enters a rate-limited state or equivalent controlled response  
And no uncontrolled recovery authorization is created  
And the rate-limit event is audit logged.

### Scenario 22: Repeated recovery requests do not expose account existence

Given a user repeatedly submits mobile numbers to the Forgot Password screen  
When the recovery endpoint processes the requests  
Then the external response must remain appropriately generic  
And the system must not reveal which mobile numbers belong to LMS users  
And abuse-prevention events are audit logged.

### Scenario 23: Recovery request cannot create multiple uncontrolled active authorizations

Given a user has already initiated a recovery request  
When another recovery request is submitted within the configured protection window  
Then the system applies the configured recovery-request policy  
And does not create uncontrolled concurrent recovery authorizations  
And the resulting behavior is audit logged.

**Open Question:** Whether a new request invalidates the previous recovery authorization is not defined by the LMS source.

---

## Security and Sensitive Data

### Scenario 24: Password is never exposed during recovery

Given the user initiates Forgot Password  
When the system processes the recovery request  
Then the existing password is never returned  
And the password hash is never returned  
And the password is never written to logs  
And the password is never written to audit records.

### Scenario 25: Recovery authorization secret is not exposed

Given the recovery process uses a secret authorization mechanism  
When the system records the recovery request  
Then the persisted recovery data must not expose the usable recovery secret where secure hashing is required  
And application logs must not contain the usable recovery secret  
And the event is audit logged without sensitive secret values.

### Scenario 26: Recovery does not disclose internal user identifiers

Given the submitted mobile number corresponds to an LMS user  
When the recovery request is accepted  
Then the API response does not expose the internal User ID  
And the organization ID is not exposed  
And the branch ID is not exposed  
And internal database identifiers are not exposed.

---

## Permission and Scope

### Scenario 27: Unauthenticated user can initiate Forgot Password

Given the user is not authenticated  
And the user is on the Sign In screen  
When the user selects Forgot Password  
Then the system allows access to the Forgot Password screen  
And the user is not required to have an active LMS session merely to initiate recovery.

### Scenario 28: Forgot Password does not grant module permissions

Given the user has initiated password recovery  
When the recovery request is accepted  
Then the system does not grant access to the LMS Dashboard  
And the system does not grant access to customer records  
And the system does not grant access to loan records  
And the system does not grant access to collections  
And the user must complete the full recovery process and authenticate again before protected LMS access is granted.

### Scenario 29: Branch scope remains unchanged after recovery

Given a Field Employee or Branch Admin belongs to a specific branch  
When the user completes password recovery  
Then the account retains its existing branch association  
And the recovery process does not provide access to another branch  
And the resulting authentication session, once created through Sign In, must continue to enforce the original branch scope.

### Scenario 30: Wrong role cannot use Forgot Password to escalate privileges

Given a user belongs to a non-administrative role  
When the user completes password recovery  
Then the system does not elevate the user's role  
And no additional permissions are assigned  
And the account remains subject to the existing role and permission model  
And the recovery completion is audit logged.

---

## Failure Paths

### Scenario 31: Recovery service is unavailable

Given the user has entered a valid-looking mobile number  
And the recovery service is unavailable  
When the user submits the recovery request  
Then the system does not falsely report that recovery has completed  
And no password is changed  
And the user receives a controlled failure response  
And the recovery failure is audit logged.

### Scenario 32: Recovery request persistence fails

Given the user submits a valid-looking recovery request  
And the system cannot persist the recovery request  
When the recovery operation is processed  
Then the system does not report a completed recovery request  
And no reset authorization is treated as valid  
And the failure is audit logged.

### Scenario 33: Notification delivery fails

Given a recovery request has been accepted  
And the finalized recovery mechanism requires an outbound notification  
When notification delivery fails  
Then the system must not mark the password as reset  
And the recovery request remains in an appropriate recoverable state  
And the notification failure is audit logged.

**Open Question:** The LMS Notification Flow defines event-driven notification delivery, retries and maximum three attempts for LMS business notifications, but it does not define password-recovery notifications.

### Scenario 34: Recovery request is replayed

Given a recovery request has already been completed or expired  
When the same recovery request is submitted again  
Then the system rejects the replay  
And the existing password is not changed  
And the replay event is audit logged.

### Scenario 35: Concurrent recovery requests are processed safely

Given multiple recovery requests are initiated for the same account  
When the recovery service processes them concurrently  
Then the system applies the configured recovery-request concurrency policy  
And only an authorized recovery path may proceed to Reset Password  
And recovery state changes are transactionally consistent  
And the concurrency event is audit logged.

---

## Audit Logging

### Scenario 36: Forgot Password request is audit logged

Given a user submits a Forgot Password request  
When the request is processed  
Then an immutable audit record is created  
And the record contains the recovery-request result  
And the password is not recorded  
And recovery secrets are not recorded in usable form.

### Scenario 37: Failed Forgot Password request is audit logged

Given a recovery request fails validation or security checks  
When the system rejects the request  
Then an audit record is created  
And the record identifies the security event type  
And sensitive authentication information is not recorded.

### Scenario 38: Recovery rate limiting is audit logged

Given the recovery rate limit has been exceeded  
When the system blocks another recovery request  
Then the rate-limit event is audit logged  
And the system retains sufficient metadata to investigate abuse  
And the recovery secret is not logged.

### Scenario 39: Recovery completion is audit logged

Given the user successfully completes the recovery process  
When the password reset is completed through the Reset Password screen  
Then the recovery completion is audit logged  
And the audit record identifies the affected user  
And the password itself is not stored in the audit record.

---

## Integration with Reset Password

### Scenario 40: Successful recovery verification transitions to Reset Password

Given a Forgot Password request exists  
And the user successfully completes the finalized recovery verification mechanism  
When the verification succeeds  
Then the recovery request is marked as verified  
And the user is allowed to continue to Reset Password  
And the existing password remains unchanged until Reset Password is completed  
And the verification event is audit logged.

### Scenario 41: Failed recovery verification does not transition to Reset Password

Given a Forgot Password request exists  
And the user fails the required recovery verification  
When verification fails  
Then the system does not allow access to Reset Password  
And the existing password remains unchanged  
And the failed verification is audit logged.

### Scenario 42: Reset Password completion consumes the recovery authorization

Given a recovery authorization has been successfully verified  
And the user completes Reset Password  
When the new password is successfully established  
Then the recovery authorization is marked as consumed  
And the same authorization cannot be reused  
And the recovery completion is audit logged.

---

## Offline Behaviour

### Scenario 43: Forgot Password is attempted while the Field Employee device is offline

Given a Field Employee device has no network connectivity  
And the Field Employee cannot establish a server connection  
When the user selects Forgot Password  
Then the system must not falsely report that a password-recovery request was submitted to the server  
And the system must clearly indicate that server connectivity is required for the recovery operation  
And no local offline password reset is performed  
And the failure/attempt is audit logged when connectivity permits.

The Field Employee diagram explicitly provides an Offline Mode for cached operational data and local collection, but it does not define an offline Forgot Password mechanism.

### Scenario 44: Offline mode does not permit local password reset

Given the Field Employee is operating in Offline Mode  
When the user attempts to reset a forgotten password locally  
Then the system does not change the server-side password  
And the system does not create a locally authoritative replacement credential  
And the user must use the supported online recovery process.

---

## Mandatory Field Validation

### Scenario Outline: Forgot Password rejects missing mandatory input

Given the user is on the Forgot Password screen  
When the user submits without `<field>`  
Then the system shows "<message>"  
And no recovery request is created  
And no recovery notification is initiated.

Examples:

| field         | message                   |
| ------------- | ------------------------- |
| Mobile Number | Mobile Number is required |

---

# Acceptance Criteria

- Forgot Password is a separate screen from Sign In.
- The Forgot Password screen accepts Mobile Number as the recovery identifier.
- Mobile Number is mandatory.
- Invalid mobile-number formats are rejected before recovery processing.
- Forgot Password does not require the existing password.
- Forgot Password does not directly change the user's password.
- A recovery request must pass the finalized verification mechanism before Reset Password can be accessed.
- Unverified recovery requests cannot reach Reset Password.
- Expired recovery authorizations cannot be used.
- Consumed recovery authorizations cannot be reused.
- Recovery does not reactivate inactive accounts.
- Recovery does not automatically remove account locks.
- Recovery does not change organization, branch, role or permissions.
- Recovery does not grant access to protected LMS modules.
- Recovery does not create user accounts.
- Recovery does not modify customer records.
- Recovery does not create or modify financial transactions.
- Recovery does not create accounting or ledger entries.
- Recovery responses do not disclose unnecessary account-existence information.
- Recovery responses do not disclose user role, organization, branch or internal identifiers.
- Passwords are never stored or logged in plaintext.
- Recovery secrets are not exposed through application logs.
- Recovery requests are rate limited.
- Recovery abuse-prevention events are audit logged.
- Recovery failures do not result in a false successful-recovery state.
- Notification failure does not falsely mark the password as reset.
- Offline Field Employee mode does not permit a local authoritative password reset.
- Successful recovery verification transitions to Reset Password.
- Successful Reset Password consumes the recovery authorization.
- User-account administration remains in Module 3.
- Customer mobile verification remains a Customer/KYC concern and is not duplicated as LMS authentication.
- All actions are audit logged.
