# User Story — Change Password

## Epic

Authentication & Session Management

## Feature

Change Password — Authenticated User Credential Change

## User Story

As an **authenticated LMS user**  
I want to change my password from within my active session  
So that I can maintain control over my account credentials without using Forgot Password.

As an **LMS security administrator**  
I want password changes to require the current password, enforce the configured password policy, and be fully auditable  
So that authenticated users cannot silently weaken account security.

**Source boundary:** The uploaded LMS diagrams establish Login → credential validation for Super Admin and Branch Admin, Field Employee Login with Online/Offline handling, and Logout. They do not define an explicit Change Password screen. This document therefore defines Change Password as a separate authenticated screen required by the approved Module 1 split, while keeping unsupported policy values as Open Questions. fileciteturn0file1 fileciteturn0file2 fileciteturn0file5

## Rules & Business Constraints

1. Change Password is available only to an authenticated LMS user.
2. The user must provide the current password before a new password is accepted.
3. The current password must be verified server-side.
4. The current password must never be returned, stored in plaintext, or written to logs.
5. The new password must satisfy the configured LMS password policy.
6. Confirm New Password must match New Password.
7. The new password must not be the same as the current password.
8. Password history must be enforced when configured.
9. Passwords must be stored only as secure hashes.
10. Password values must never appear in application logs, audit logs, analytics, URLs, error messages or API responses.
11. A failed password change must leave the existing password unchanged.
12. A successful password change must atomically replace the stored password hash and record the password-change event.
13. The user account's organization, branch, role and permissions must not change as a consequence of changing the password.
14. Change Password must not activate an inactive account.
15. Change Password must not remove a lock state unless the finalized security policy explicitly permits it.
16. User-account administration belongs to Module 3 and is not part of this screen.
17. Forgot Password and Reset Password are separate recovery flows and are not duplicated here.
18. Change Password does not use OTP as the normal authentication mechanism. LMS authentication is Mobile + Password.
19. Customer mobile-number verification is a Customer/KYC flow and is not part of Change Password. fileciteturn0file4
20. Change Password must preserve organization and branch scoping.
21. A password change must not grant permissions that the user did not already have.
22. Password changes must be audit logged.
23. Password-change failures must be audit logged without recording password values.
24. If the finalized security policy requires all other sessions to be revoked after a password change, those sessions must be invalidated after successful commit.
25. The current session's post-change behavior must follow the finalized session-security policy.
26. The exact password-policy thresholds are not defined by the source and must remain configurable until finalized.
27. Money is always integer paise in the LMS; Change Password has no monetary fields.
28. EMI due dates are DATE-only and Asia/Kolkata; Change Password has no EMI-date fields.
29. Every money movement posts double-entry lines summing to zero; Change Password creates no money movement.
30. Payment posting is idempotent on an `Idempotency-Key`; this financial rule does not apply to Change Password.
31. The ledger is append-only; Change Password never edits or deletes financial ledger entries.
32. Every record remains scoped by organization and branch where applicable.
33. Deletion is blocked where downstream references exist; user-account deletion belongs to Module 3.
34. All actions are audit logged.

## Background

Given the user is logged into the system  
And the user's session is active  
And the user has permission to access account-security settings  
And the user belongs to a valid organization  
And the user has an applicable branch scope  
And the user wants to replace the existing password

The LMS source establishes authenticated sessions through Login and terminates them through Logout. The Super Admin flow exposes Login → Credentials Valid? → Dashboard and Logout, while the Field Employee flow establishes Login → Network Available? → Online GPS Check-in or Offline Mode and later provides Logout. fileciteturn0file2turn0file5

Change Password is therefore an authenticated credential-management screen. It does not replace Sign In, Forgot Password or Reset Password.

## Feature: Change Password Management

### Menu

Profile / Account Security → Change Password

Actions: Enter Current Password, Enter New Password, Confirm New Password, Show/Hide Password, Change Password, Cancel

# Change Password — Fields

## Current Credentials

| Field Name         | Mandatory |
| ------------------ | --------: |
| Current Password * |         * |

## New Credentials

| Field Name             | Mandatory |
| ---------------------- | --------: |
| New Password *         |         * |
| Confirm New Password * |         * |

## Screen Actions

| Action          | Purpose                                        |
| --------------- | ---------------------------------------------- |
| Change Password | Validate and replace the user's password       |
| Show Password   | Temporarily reveal a password field            |
| Hide Password   | Mask a password field                          |
| Cancel          | Leave the screen without changing the password |

# Password Policy

The Change Password screen must enforce the same centrally configured password policy used by Reset Password.

Policy categories may include:

- Minimum password length
- Maximum password length
- Character complexity
- Password history
- Prohibited/common passwords
- Account-identifier restrictions
- Password expiry

These are policy categories only. The uploaded LMS diagrams do not define final values.

## Password Validation Rules

1. Current Password is mandatory.
2. New Password is mandatory.
3. Confirm New Password is mandatory.
4. Current Password must be correct.
5. New Password must satisfy the configured policy.
6. New Password must differ from Current Password.
7. Confirm New Password must match New Password.
8. Password history must be enforced where configured.
9. Validation must be performed server-side.
10. The new password must be securely hashed before persistence.
11. The plaintext password must never be persisted.

# Table Only (Not for UI)

| Internal Field                | Allowed Values / Storage                                |
| ----------------------------- | ------------------------------------------------------- |
| `user_id`                     | Authenticated LMS user reference                        |
| `organization_id`             | Existing organization reference                         |
| `branch_id`                   | Existing branch reference where applicable              |
| `current_password`            | Transient request value only; never persisted           |
| `new_password`                | Transient request value only; never persisted           |
| `password_hash`               | Secure one-way password hash                            |
| `password_history`            | Secure hashes of previous passwords according to policy |
| `password_changed_at`         | Timestamp of successful change                          |
| `session_invalidation_status` | `NOT_REQUIRED`, `PENDING`, `COMPLETED`, `FAILED`        |
| `audit_event_id`              | Immutable audit reference                               |
| `created_at`                  | Record timestamp                                        |
| `updated_at`                  | Record timestamp                                        |

# Password Change State

## Current Password Verification

The submitted current password is checked against the stored password hash.

If verification fails, the existing password remains unchanged.

## Policy Validation

After current-password verification succeeds, the new password is checked against the configured policy.

## Confirmation Validation

The confirmation value must match the new password.

## Commit

The new password hash is stored only after all validations succeed.

## Session Security

The system applies the finalized session policy after a successful password change.

# Gherkin Scenarios

## Screen Access

### Scenario 1: Authenticated user opens Change Password

Given the user has an active authenticated session  
And the user has permission to manage their password  
When the user opens Change Password  
Then the system displays Current Password  
And the system displays New Password  
And the system displays Confirm New Password  
And no password value is pre-populated  
And the screen access is audit logged.

### Scenario 2: Unauthenticated user cannot access Change Password

Given the user does not have an active authenticated session  
When the user attempts to open Change Password directly  
Then the system denies access  
And the password is not changed  
And the access-denial event is audit logged.

### Scenario 3: User cancels password change

Given the user is on Change Password  
And no password change has been committed  
When the user selects Cancel  
Then the system leaves the Change Password screen  
And the existing password remains unchanged  
And no password value is persisted.

## Mandatory Validation

### Scenario 4: User submits without Current Password

Given the user is on Change Password  
When the user submits without Current Password  
Then the system shows "Current Password is required"  
And no password verification is completed  
And the existing password remains unchanged.

### Scenario 5: User submits without New Password

Given the user is on Change Password  
When the user submits without New Password  
Then the system shows "New Password is required"  
And the existing password remains unchanged  
And no password change is committed.

### Scenario 6: User submits without Confirm New Password

Given the user is on Change Password  
When the user submits without Confirm New Password  
Then the system shows "Confirm New Password is required"  
And the existing password remains unchanged  
And no password change is committed.

### Scenario Outline: Change Password mandatory-field validation

Given the user has an active authenticated session  
When the user submits without `<field>`  
Then the system shows "<message>"  
And the existing password remains unchanged  
And no password change is committed.

Examples:

| field                | message                          |
| -------------------- | -------------------------------- |
| Current Password     | Current Password is required     |
| New Password         | New Password is required         |
| Confirm New Password | Confirm New Password is required |

## Current Password Verification

### Scenario 7: User enters the correct current password

Given the user is authenticated  
And the Current Password matches the stored password hash  
When the user submits the password change  
Then current-password verification succeeds  
And the system continues to new-password validation  
And the existing password remains unchanged until the complete operation commits.

### Scenario 8: User enters an incorrect current password

Given the user is authenticated  
And the Current Password does not match the stored password hash  
When the user submits the password change  
Then the system rejects the password change  
And the existing password remains unchanged  
And the new password is not persisted  
And the failure is audit logged.

### Scenario 9: User repeatedly enters an incorrect current password

Given the user has repeatedly submitted an incorrect Current Password  
When another incorrect password-change request is submitted  
Then the system applies the configured security/rate-limiting policy  
And the existing password remains unchanged  
And the security event is audit logged.

**Open Question:** The source does not define a separate failed-current-password threshold for Change Password.

## Password Matching

### Scenario 10: New Password and confirmation match

Given the Current Password is correct  
And the New Password satisfies the configured password policy  
And Confirm New Password matches New Password  
When the user selects Change Password  
Then the system is allowed to commit the new password  
And the password-change operation is audit logged.

### Scenario 11: New Password and confirmation do not match

Given the Current Password is correct  
And New Password is entered  
And Confirm New Password differs from New Password  
When the user selects Change Password  
Then the system shows "Passwords do not match"  
And the existing password remains unchanged  
And the new password is not persisted  
And the failure is audit logged.

## Password Policy

### Scenario 12: New Password fails minimum-length policy

Given the Current Password is correct  
And the configured policy requires a minimum password length  
And the New Password is shorter than the configured minimum  
When the user submits Change Password  
Then the system rejects the new password  
And displays the applicable policy validation message  
And the existing password remains unchanged  
And the failure is audit logged.

### Scenario 13: New Password fails complexity policy

Given the Current Password is correct  
And the configured password policy requires character complexity  
And the New Password does not satisfy the required complexity  
When the user submits Change Password  
Then the system rejects the new password  
And the existing password remains unchanged  
And the failure is audit logged.

### Scenario 14: New Password violates password history

Given the Current Password is correct  
And password history is configured  
And the New Password matches a prohibited previous password  
When the user submits Change Password  
Then the system rejects the new password  
And the existing password remains unchanged  
And the password-reuse failure is audit logged.

### Scenario 15: New Password is identical to Current Password

Given the Current Password is correct  
When the user submits the same value as New Password  
Then the system rejects the password change  
And displays the applicable password-reuse message  
And the existing password remains unchanged  
And the failure is audit logged.

### Scenario 16: New Password violates account-identifier policy

Given the password policy prohibits use of the user's mobile number or another account identifier  
And the New Password violates that policy  
When the user submits Change Password  
Then the system rejects the password  
And the existing password remains unchanged  
And the policy failure is audit logged.

## Successful Change

### Scenario 17: User successfully changes password

Given the user has an active authenticated session  
And the Current Password is correct  
And the New Password satisfies the configured password policy  
And the New Password differs from the Current Password  
And Confirm New Password matches New Password  
When the user selects Change Password  
Then the system securely hashes the New Password  
And replaces the stored password hash  
And records the password-changed timestamp  
And the old password can no longer authenticate the user  
And the new password can authenticate the user through Sign In  
And the successful change is audit logged.

### Scenario 18: Password change does not change organization or branch

Given the user belongs to Organization A  
And the user is assigned to Branch A  
When the user successfully changes the password  
Then the organization remains Organization A  
And the branch remains Branch A  
And no organizational assignment is changed  
And the password change is audit logged.

### Scenario 19: Password change does not change role or permissions

Given the user has an existing role and permissions  
When the user successfully changes the password  
Then the role remains unchanged  
And the permissions remain unchanged  
And the password change does not grant additional privileges  
And the result is audit logged.

## Active / Inactive / Locked Behaviour

### Scenario 20: Active account changes its password

Given the account status is `ACTIVE`  
And the user has an active authenticated session  
When the user successfully changes the password  
Then the password is replaced  
And the account remains `ACTIVE`  
And the user's existing organization, branch and role remain unchanged.

### Scenario 21: Existing authenticated session belongs to an account later deactivated

Given the user is currently authenticated  
And the account is subsequently deactivated by an authorized administrator  
When the user attempts to change the password  
Then the system must validate the current account status before committing  
And must not allow the deactivated account to bypass account controls  
And the result is audit logged.

### Scenario 22: Locked account cannot bypass lock controls through Change Password

Given the account status is `LOCKED`  
And the user's existing session is no longer considered valid under the lock policy  
When the user attempts to change the password  
Then the system denies the operation  
And the lock state remains governed by the account-security policy  
And the denial is audit logged.

## Session Security

### Scenario 23: Successful password change applies session invalidation policy

Given the user has multiple authenticated sessions  
And the password change succeeds  
When the password-change transaction commits  
Then the system applies the configured session-invalidation policy  
And any sessions required to be revoked are marked revoked  
And the session-security action is audit logged.

### Scenario 24: Revoked session cannot access protected resources

Given a password change has caused a session to be revoked  
When the revoked session attempts to access a protected LMS resource  
Then the system denies the request  
And the session cannot continue operating as authenticated  
And the denial is audit logged.

### Scenario 25: Current session behavior follows finalized policy

Given the user changes the password from an authenticated session  
When the password change succeeds  
Then the current session is either retained or terminated according to the configured password-change session policy  
And the resulting session state is audit logged.

## Password Security

### Scenario 26: Password values are not logged

Given the user submits Current Password, New Password and Confirm New Password  
When the server processes the request  
Then none of the plaintext password values appear in application logs  
And none of the plaintext password values appear in audit logs  
And none of the plaintext password values appear in API responses.

### Scenario 27: Password is stored only as a secure hash

Given the password change succeeds  
When the system persists the new credential  
Then only the secure password hash is stored  
And the plaintext password is discarded from the request-processing context according to secure handling practices  
And the hash is never returned to the client.

### Scenario 28: Password change is processed transactionally

Given all password validations succeed  
And the system starts the password-change transaction  
When persistence fails before commit  
Then the old password remains valid  
And the new password is not partially stored  
And session state is not incorrectly changed  
And the failure is audit logged.

## Permission and Branch Scoping

### Scenario 29: User can change only their own password

Given the authenticated user has permission to change their own password  
When the user submits a Change Password request  
Then the request is associated with the authenticated user's own account  
And the user cannot substitute another user's ID through client-controlled input  
And the security event is audit logged.

### Scenario 30: Branch scope is preserved after password change

Given the user is assigned to Branch A  
And Branch B contains separate records  
When the user changes the password and later signs in again  
Then the resulting session remains scoped to Branch A  
And Branch B records remain inaccessible  
And unauthorized cross-branch access remains denied.

### Scenario 31: Password change cannot escalate role

Given a Field Employee has Field Employee permissions  
When the Field Employee changes the password  
Then the account remains a Field Employee account  
And no administrative permissions are added  
And the role remains unchanged.

## Failure Paths

### Scenario 32: Password hashing fails

Given all validations succeed  
When secure password hashing fails  
Then the existing password remains unchanged  
And no incomplete password hash is stored  
And the password-change operation fails safely  
And the failure is audit logged.

### Scenario 33: Database transaction fails

Given the Current Password and New Password are valid  
When the database transaction fails before commit  
Then the old password remains valid  
And the new password is not partially persisted  
And the user receives a controlled failure response  
And the failure is audit logged.

### Scenario 34: Session invalidation fails after successful password commit

Given the password change has committed successfully  
And the configured policy requires existing sessions to be revoked  
When session invalidation encounters a failure  
Then the password change is not silently rolled back unless the finalized transaction policy explicitly requires atomic rollback  
And the failed session-invalidation state is recorded  
And the security event is escalated according to the session-security policy  
And the event is audit logged.

### Scenario 35: Audit logging failure does not expose the password

Given the password change succeeds  
When audit-event persistence encounters a failure  
Then the password values are still not exposed  
And the security system retains or retries the audit event according to the audit reliability policy  
And the credential itself remains secure.

## Offline Behaviour

### Scenario 36: Field Employee attempts Change Password while offline

Given the Field Employee device is operating in Offline Mode  
When the Field Employee attempts to change the password  
Then the system must not treat a local password change as server-authoritative  
And the server-side password remains unchanged  
And no plaintext password is queued for later synchronization  
And the user is instructed to perform the password change through the supported connected flow.

The Field Employee source defines Offline Mode and cached operational data but does not define offline credential changes. fileciteturn0file5

### Scenario 37: Offline mode does not queue a plaintext password

Given the Field Employee is offline  
When the user submits a new password  
Then the system must not place the plaintext password into the offline transaction queue  
And no offline password-change transaction is created  
And the server-side credential remains unchanged.

## Navigation After Change

### Scenario 38: Successful change returns according to the session policy

Given the user successfully changes the password  
When the password-change operation commits  
Then the system displays the configured success state  
And the user is directed either to the authenticated area or Sign In according to the finalized session policy  
And the password-change event is audit logged.

## Audit Logging

### Scenario 39: Successful password change is audit logged

Given the user successfully changes the password  
When the password transaction commits  
Then an immutable audit event is recorded  
And the event identifies the user and result  
And no plaintext password is recorded.

### Scenario 40: Failed password change is audit logged

Given the user submits an invalid password-change request  
When the system rejects the request  
Then the failure is audit logged  
And the audit record contains the failure category  
And the password values are not recorded.

### Scenario 41: Unauthorized Change Password attempt is audit logged

Given the user does not have a valid authenticated session  
When the user attempts to access Change Password  
Then the request is denied  
And the security event is audit logged.

# Acceptance Criteria

- Change Password is available only to an authenticated user with the required account-security permission.
- The current password is mandatory.
- The new password is mandatory.
- Confirm New Password is mandatory.
- Current Password is verified server-side.
- Incorrect Current Password leaves the existing password unchanged.
- New Password must satisfy the configured password policy.
- Confirm New Password must match New Password.
- New Password cannot equal Current Password.
- Password history is enforced when configured.
- Passwords are securely hashed.
- Plaintext passwords are never persisted.
- Plaintext passwords are never written to logs or audit records.
- Successful password change replaces the password hash atomically.
- Failed password changes do not modify the existing password.
- Password changes do not modify organization, branch, role or permissions.
- Password changes cannot be used for privilege escalation.
- User-account administration remains under Module 3.
- Forgot Password and Reset Password remain separate flows.
- Branch scope remains enforced after password change and subsequent authentication.
- Existing sessions are handled according to the finalized password-change session policy.
- Revoked sessions cannot access protected resources.
- Offline Field Employee mode cannot perform a server-authoritative password change.
- Plaintext passwords are never placed into an offline queue.
- Password-change failures are safely handled without partially updating credentials.
- Password changes do not create financial transactions.
- Password changes do not modify the loan ledger.
- All authentication/security events are audit logged.
- All actions are audit logged.
