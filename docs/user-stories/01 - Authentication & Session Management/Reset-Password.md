# User Story — Reset Password

## Epic

Authentication & Session Management

## Feature

Reset Password — Recovery-Authorized Password Replacement

## User Story

As an **LMS user who has successfully passed the password-recovery verification process**  
I want to set a new password  
So that I can regain access to my LMS account without knowing my previous password.

As an **LMS security administrator**  
I want password reset authorization to be short-lived, single-use, policy-controlled and auditable  
So that password recovery cannot be abused to take over user accounts.

**Source boundary:** The uploaded LMS diagrams define Login, credential validation, Branch Admin failed-attempt handling, Field Employee online/offline behavior and Logout, but do not define the Forgot Password or Reset Password flows. Therefore, this document treats Reset Password as the screen following the approved recovery-verification step and explicitly marks recovery-mechanism details as Open Questions rather than inventing them. fileciteturn0file1 fileciteturn0file2 fileciteturn0file5

## Rules & Business Constraints

1. Reset Password is accessible only after a valid password-recovery authorization has been established.
2. The recovery authorization must be short-lived and single-use.
3. An expired, revoked, consumed or invalid recovery authorization cannot be used to reset a password.
4. The existing password must not be required on this screen because the user has entered the recovery flow.
5. The new password must satisfy the configured LMS password policy.
6. The new password and confirmation password must match exactly after normalization rules are applied.
7. Passwords must never be stored in plaintext.
8. Passwords must never be written to application logs, audit logs, analytics events or API responses.
9. The system must store only a secure password hash.
10. Password reuse must be prevented according to the configured password-history policy.
11. The exact password length, complexity, history and expiry rules are not defined by the uploaded diagrams and remain Open Questions.
12. A successful reset must not change the user's organization, branch, role or permissions.
13. A successful reset must not automatically reactivate an `INACTIVE` account.
14. A successful reset must not automatically remove a `LOCKED` state unless that behavior is explicitly finalized.
15. A password reset must not create a new user account.
16. Password reset must not modify customer, loan, collection, accounting or ledger records.
17. A password reset must not post any financial entry.
18. Money is always integer paise in downstream LMS modules; Reset Password has no monetary fields.
19. EMI due dates remain DATE-only and Asia/Kolkata; Reset Password has no EMI-date fields.
20. Every money movement must post double-entry lines summing to zero; Reset Password creates no money movement.
21. Payment posting idempotency using `Idempotency-Key` is a payment-domain rule and does not replace recovery-token single-use enforcement.
22. The ledger is append-only; Reset Password never edits or deletes ledger entries.
23. Every record remains scoped by organization and branch where applicable; Reset Password must preserve the existing user's scope.
24. User-account creation, editing, activation, deactivation and deletion belong to Module 3.
25. Reset Password must not grant permissions beyond the user's existing role.
26. Successful password reset must consume the recovery authorization so it cannot be replayed.
27. A failed reset must leave the currently valid password unchanged.
28. Concurrent reset requests must be handled transactionally so that two requests cannot both establish different passwords from the same single-use authorization.
29. Password reset completion must be audit logged.
30. Failed reset attempts must be audit logged without recording password values.
31. If the security policy requires existing sessions to be revoked after password reset, that revocation must occur as part of the reset transaction or immediately after successful commit.
32. The exact post-reset session policy is not defined by the source and remains an Open Question.
33. All actions are audit logged.

## Background

Given the user has initiated Forgot Password  
And the recovery verification mechanism has been successfully completed  
And the system has issued a valid recovery authorization  
And the recovery authorization has not expired  
And the recovery authorization has not been consumed  
And the associated LMS account is eligible for password reset

The normal LMS authentication mechanism is Mobile + Password. The uploaded diagrams establish Login → credential validation for administrative users and the Field Employee login path, but they do not define password reset. fileciteturn0file1turn0file2turn0file5

Reset Password therefore operates between successful recovery verification and the next normal Sign In. It changes only the credential secret and associated security metadata; it does not alter the user's business permissions or organizational scope.

## Feature: Reset Password Management

### Menu

Authentication → Forgot Password → Recovery Verification → Reset Password

Actions: Enter New Password, Confirm New Password, Show/Hide Password, Reset Password, Cancel

# Reset Password — Fields

## Password

| Field Name             | Mandatory |
| ---------------------- | --------: |
| New Password *         |         * |
| Confirm New Password * |         * |

## Recovery Context

| Field Name                    | Mandatory |
| ----------------------------- | --------: |
| Recovery Authorization        |         * |
| Recovery Authorization Status |         * |

The recovery authorization is a system-controlled value and should not be exposed as a raw secret in the UI.

## Screen Actions

| Action              | Purpose                                 |
| ------------------- | --------------------------------------- |
| Reset Password      | Validate and establish the new password |
| Show Password       | Temporarily reveal the password value   |
| Hide Password       | Mask the password value                 |
| Cancel              | Abandon the reset operation             |
| Continue to Sign In | Available only after successful reset   |

# Password Policy

The Reset Password screen must enforce the centrally configured password policy.

The exact policy is not defined by the uploaded LMS diagrams. The implementation must therefore expose the policy as configurable rather than hard-coding unsupported thresholds.

The policy may include:

- Minimum password length
- Maximum password length
- Character complexity
- Password history
- Password expiry
- Prohibited/common passwords
- Account-identifier reuse restrictions

These are **policy categories**, not source-defined final values.

## Password Validation Rules

1. New Password is mandatory.
2. Confirm New Password is mandatory.
3. New Password must satisfy the active password policy.
4. Confirm New Password must exactly match New Password.
5. The new password must not violate the configured password-history rule.
6. The new password must not contain prohibited values defined by the configured policy.
7. The password must be securely hashed before persistence.
8. The plaintext password must not be persisted.
9. The password must not appear in audit logs.
10. Validation must occur server-side even if the UI performs client-side validation.

# Table Only (Not for UI)

| Internal Field                | Allowed Values / Storage                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| `recovery_request_id`         | Reference to the password-recovery request                        |
| `user_id`                     | LMS user reference                                                |
| `recovery_status`             | `VERIFIED`, `EXPIRED`, `CONSUMED`, `REVOKED`, `INVALID`           |
| `password_hash`               | Secure one-way password hash                                      |
| `password_changed_at`         | Timestamp of successful password change                           |
| `password_history`            | Secure hashes of previous passwords according to retention policy |
| `recovery_consumed_at`        | Timestamp when recovery authorization is consumed                 |
| `recovery_expires_at`         | Recovery authorization expiry timestamp                           |
| `session_invalidation_status` | `NOT_REQUIRED`, `PENDING`, `COMPLETED`, `FAILED`                  |
| `organization_id`             | Existing organization reference; unchanged                        |
| `branch_id`                   | Existing branch reference where applicable; unchanged             |
| `role_id`                     | Existing role reference; unchanged                                |
| `created_at`                  | Record creation timestamp                                         |
| `updated_at`                  | Record update timestamp                                           |
| `audit_event_id`              | Audit reference                                                   |

# Reset Authorization State

## Verified

The recovery mechanism has successfully authorized password reset.

The user may submit a new password.

## Expired

The recovery authorization is no longer valid.

The user must restart Forgot Password.

## Consumed

The authorization has already been used successfully.

It cannot be reused.

## Revoked

The authorization has been invalidated by a security or recovery policy.

It cannot be used.

## Invalid

The supplied recovery authorization cannot be resolved to a valid recovery request.

The reset must be rejected.

# Gherkin Scenarios

## Navigation and Access

### Scenario 1: User reaches Reset Password after successful recovery verification

Given the user has completed the approved recovery verification  
And the recovery authorization is valid  
And the recovery authorization is not expired  
And the recovery authorization has not been consumed  
When the system opens Reset Password  
Then the New Password field is displayed  
And the Confirm New Password field is displayed  
And the user is allowed to attempt password reset  
And the transition is audit logged.

### Scenario 2: User cannot open Reset Password without recovery authorization

Given the user has not completed password-recovery verification  
When the user attempts to access Reset Password directly  
Then the system rejects access to the reset operation  
And the existing password remains unchanged  
And the unauthorized reset attempt is audit logged.

### Scenario 3: User attempts to use an expired recovery authorization

Given a recovery authorization exists  
And the authorization has expired  
When the user opens Reset Password  
Then the system rejects the authorization  
And the New Password cannot be submitted successfully  
And the user is instructed to restart password recovery  
And the expired-authorization event is audit logged.

### Scenario 4: User attempts to reuse a consumed recovery authorization

Given a recovery authorization has already been successfully consumed  
When the user attempts to use the same authorization again  
Then the system rejects the reset  
And the password is not changed  
And the replay attempt is audit logged.

### Scenario 5: User attempts to use an invalid recovery authorization

Given the submitted recovery authorization does not correspond to a valid recovery request  
When the user attempts to reset the password  
Then the system rejects the reset  
And the existing password remains unchanged  
And the invalid-authorization event is audit logged.

## Mandatory Validation

### Scenario 6: User submits without New Password

Given the user has a valid recovery authorization  
When the user submits without New Password  
Then the system shows "New Password is required"  
And the password is not changed  
And the recovery authorization is not consumed.

### Scenario 7: User submits without Confirm New Password

Given the user has a valid recovery authorization  
When the user submits without Confirm New Password  
Then the system shows "Confirm New Password is required"  
And the password is not changed  
And the recovery authorization is not consumed.

### Scenario Outline: Reset Password mandatory-field validation

Given the user has a valid recovery authorization  
When the user submits without `<field>`  
Then the system shows "<message>"  
And the password is not changed  
And the recovery authorization remains available.

Examples:

| field                | message                          |
| -------------------- | -------------------------------- |
| New Password         | New Password is required         |
| Confirm New Password | Confirm New Password is required |

## Password Matching

### Scenario 8: New Password and confirmation match

Given the recovery authorization is valid  
And the New Password satisfies the configured password policy  
And Confirm New Password exactly matches New Password  
When the user submits Reset Password  
Then the system proceeds with server-side validation  
And the password is eligible for replacement  
And the reset operation is audit logged.

### Scenario 9: Password confirmation does not match

Given the recovery authorization is valid  
And New Password is entered  
And Confirm New Password differs from New Password  
When the user submits Reset Password  
Then the system shows "Passwords do not match"  
And the password is not changed  
And the recovery authorization is not consumed  
And the validation failure is audit logged.

## Password Policy

### Scenario 10: Password fails minimum-length policy

Given the recovery authorization is valid  
And the configured password policy requires a minimum length  
And the New Password does not meet the minimum length  
When the user submits Reset Password  
Then the system rejects the password  
And displays the applicable password-policy validation message  
And the existing password remains unchanged  
And the recovery authorization is not consumed  
And the failure is audit logged.

### Scenario 11: Password fails complexity policy

Given the recovery authorization is valid  
And the configured password policy requires character complexity  
And the New Password does not satisfy the configured complexity  
When the user submits Reset Password  
Then the system rejects the password  
And displays the applicable password-policy message  
And the existing password remains unchanged  
And the recovery authorization is not consumed  
And the failure is audit logged.

### Scenario 12: Password violates password-history policy

Given the recovery authorization is valid  
And password history is configured  
And the submitted New Password matches a prohibited previous password hash  
When the user submits Reset Password  
Then the system rejects the password  
And displays the applicable password-reuse message  
And the existing password remains unchanged  
And the recovery authorization is not consumed  
And the failure is audit logged.

### Scenario 13: Password contains prohibited account identifier

Given the password policy prohibits use of the user's mobile number or other account identifier  
And the submitted New Password violates that policy  
When the user submits Reset Password  
Then the system rejects the password  
And the existing password remains unchanged  
And the recovery authorization remains available  
And the policy failure is audit logged.

## Successful Reset

### Scenario 14: User successfully resets the password

Given the recovery authorization is valid  
And the recovery authorization is not expired  
And the recovery authorization has not been consumed  
And New Password satisfies the configured password policy  
And Confirm New Password matches New Password  
When the user selects Reset Password  
Then the system securely hashes the new password  
And stores the new password hash  
And updates the password-changed timestamp  
And consumes the recovery authorization  
And the old password can no longer authenticate the user  
And the new password can be used on the Sign In screen  
And the successful reset is audit logged.

### Scenario 15: Reset does not change organization or branch

Given the user belongs to Organization A  
And the user is assigned to Branch A  
And the user has a valid recovery authorization  
When the user successfully resets the password  
Then the user remains associated with Organization A  
And the user remains associated with Branch A  
And no organization or branch assignment is changed  
And the reset is audit logged.

### Scenario 16: Reset does not change role or permissions

Given the user has an existing role and permission set  
When the user successfully resets the password  
Then the role remains unchanged  
And permissions remain unchanged  
And the reset does not grant administrative access  
And the reset is audit logged.

## Account State

### Scenario 17: Reset does not automatically activate an inactive account

Given the associated user account is `INACTIVE`  
And the recovery process permits the user to reach Reset Password  
When the user successfully submits a compliant new password  
Then the password is changed only if the finalized account-recovery policy permits reset for inactive accounts  
And the account status is not silently changed to `ACTIVE`  
And no LMS business access is granted solely by the reset  
And the outcome is audit logged.

### Scenario 18: Reset does not automatically unlock an account

Given the associated account is `LOCKED`  
And the account is currently subject to a lock policy  
When the user successfully resets the password  
Then the system must not silently convert the account to `ACTIVE` unless the finalized lock policy explicitly requires it  
And the account state remains governed by the lock policy  
And the result is audit logged.

## Session Security

### Scenario 19: Existing sessions are handled according to password-reset policy

Given the user has one or more existing authenticated sessions  
And the user completes a successful password reset  
When the password reset transaction commits  
Then the system applies the configured session-invalidation policy  
And any sessions that must be revoked are marked revoked  
And the session-security action is audit logged.

### Scenario 20: Revoked session cannot continue after reset

Given the password-reset policy requires existing sessions to be revoked  
And the user had an existing session before the reset  
When the password reset completes  
Then the revoked session cannot access protected LMS resources  
And the user must authenticate again  
And the session revocation is audit logged.

## Security

### Scenario 21: Password is not logged

Given the user submits a new password  
When Reset Password is processed  
Then the plaintext New Password is not written to application logs  
And the plaintext Confirm New Password is not written to application logs  
And neither value is written to audit records.

### Scenario 22: Password is stored only as a secure hash

Given the user successfully resets the password  
When the password is persisted  
Then the system stores a secure password hash  
And the plaintext password is not stored  
And the password hash is not returned to the client.

### Scenario 23: Recovery authorization is consumed atomically

Given the recovery authorization is valid  
And two reset requests attempt to use the same authorization concurrently  
When both requests reach the server  
Then at most one request can consume the authorization successfully  
And the other request is rejected as consumed or otherwise invalid  
And the final password state is deterministic  
And the concurrency result is audit logged.

## Permission and Scope

### Scenario 24: Reset cannot be used to escalate privileges

Given the user belongs to a Field Employee role  
And the user has a valid recovery authorization  
When the user successfully resets the password  
Then the user remains a Field Employee  
And no Branch Admin or Super Admin permissions are added  
And the role remains unchanged  
And the action is audit logged.

### Scenario 25: Branch scope remains enforced after reset

Given the user belongs to Branch A  
And Branch B contains separate records  
When the user resets the password and later authenticates successfully  
Then the resulting session remains scoped to Branch A  
And Branch B records remain inaccessible  
And any unauthorized access attempt is denied and audit logged.

## Failure Paths

### Scenario 26: Password persistence fails

Given the submitted password satisfies all validations  
And the recovery authorization is valid  
When the system cannot persist the new password hash  
Then the existing password remains unchanged  
And the recovery authorization must not be marked consumed unless the transaction has safely committed the password change  
And the reset is reported as failed  
And the failure is audit logged.

### Scenario 27: Password hash generation fails

Given the user submits a compliant password  
When the secure hashing operation fails  
Then the password is not persisted  
And the existing password remains unchanged  
And the recovery authorization remains recoverable according to the transaction policy  
And the failure is audit logged.

### Scenario 28: Database transaction fails during reset

Given the recovery authorization is valid  
And the password is ready to be persisted  
When the reset transaction fails before commit  
Then the system rolls back the password change  
And the recovery authorization is not incorrectly marked as consumed  
And the user can retry according to the recovery policy  
And the failure is audit logged.

### Scenario 29: Notification after reset fails

Given the password reset has successfully committed  
And the finalized product requires a password-reset confirmation notification  
When notification delivery fails  
Then the committed password reset is not rolled back  
And the notification failure is recorded separately  
And the system may retry notification according to the configured notification policy  
And the failure is audit logged.

The Notification Flow establishes that notification failure must not roll back a successfully committed payment or ledger transaction; whether the same principle is explicitly applied to password-reset confirmation is an Open Question. fileciteturn0file8

## Offline Behaviour

### Scenario 30: Field Employee attempts Reset Password while offline

Given the Field Employee device has no network connectivity  
And the Field Employee is operating in Offline Mode  
When the user attempts to reset a forgotten password  
Then the system must not treat a local password change as a server-authoritative reset  
And no server-side password is changed while offline  
And the user must use the supported online recovery process.

The Field Employee source defines Offline Mode with cached operational data and local queueing, but does not define offline password reset. fileciteturn0file5

### Scenario 31: Offline reset request is not silently queued as a password change

Given the Field Employee is offline  
When the user attempts to submit a new password  
Then the system must not queue the plaintext password for later synchronization  
And no local queued password-reset transaction is created  
And the user receives a controlled connectivity/recovery message.

## Audit Logging

### Scenario 32: Successful reset is audit logged

Given the user successfully resets the password  
When the reset transaction commits  
Then an immutable audit event is created  
And the event records the user and result  
And the event does not record the plaintext password.

### Scenario 33: Failed reset is audit logged

Given the user submits a reset request that fails validation or processing  
When the system rejects the reset  
Then an audit event is created  
And the event records the failure category  
And the password value is not recorded.

### Scenario 34: Recovery authorization replay is audit logged

Given a recovery authorization has already been consumed  
When it is submitted again  
Then the replay attempt is rejected  
And the security event is audit logged.

# Acceptance Criteria

- Reset Password is accessible only through a valid password-recovery authorization.
- Expired, invalid, revoked and consumed recovery authorizations cannot reset passwords.
- New Password is mandatory.
- Confirm New Password is mandatory.
- Password confirmation must match the new password.
- Server-side password validation is mandatory even when client-side validation exists.
- Password policy is enforced before persistence.
- Password history is enforced when configured.
- Passwords are securely hashed.
- Plaintext passwords are never stored.
- Plaintext passwords are never written to application or audit logs.
- A successful reset consumes the recovery authorization.
- A consumed recovery authorization cannot be reused.
- Failed resets leave the existing password unchanged.
- Concurrent use of one recovery authorization is handled atomically.
- Reset does not modify organization, branch, role or permissions.
- Reset does not automatically grant LMS access.
- Reset does not automatically activate an inactive account.
- Reset does not automatically unlock a locked account unless the finalized security policy explicitly says so.
- Existing sessions are handled according to the finalized password-reset session policy.
- Revoked sessions cannot access protected LMS resources.
- Password reset does not create or modify customer, loan, collection or accounting records.
- Password reset does not create financial ledger entries.
- Offline Field Employee mode cannot perform a server-authoritative password reset.
- Password-reset notification failure does not automatically imply rollback of the committed password change unless the finalized product rule explicitly requires it.
- All validation, security, success and failure events are audit logged.
- All actions are audit logged.
