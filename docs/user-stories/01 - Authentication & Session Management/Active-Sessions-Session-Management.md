# User Story — Active Sessions / Session Management

## Epic

Authentication & Session Management

## Feature

Active Sessions / Session Management — Session Lifecycle, Logout and Revocation

## User Story

As an **authenticated LMS user**  
I want my authenticated session to remain valid only while it satisfies the LMS session-security rules  
So that protected LMS operations cannot be accessed after logout, expiry or session revocation.

As a **Field Employee / Collection Agent**  
I want Logout to terminate my authenticated field session  
So that another person using the device cannot continue accessing protected customer and collection operations.

As an **LMS security administrator**  
I want authentication sessions to be invalidated when security policy requires it  
So that revoked or expired credentials cannot continue accessing protected LMS resources.

The uploaded Super Admin flow explicitly represents **Logout** as a separate dashboard action and states that its destination is not defined. fileciteturn2file0

The Field Employee flow also explicitly contains **Logout** as a terminal/session action. Its flow begins with Field Employee Login, evaluates Network Available?, follows either Online → GPS Check-in → Location Verified or Offline Mode → Cached Customer List, and later exposes Logout from the Profile area. fileciteturn2file18

The source does **not** define an Active Sessions screen, session list UI, concurrent-session limit, exact timeout, device-management UI, or remote-session revocation workflow. Those items are therefore treated as product/security Open Questions rather than silently invented.

## Rules & Business Constraints

1. A protected LMS operation requires a valid authenticated session.
2. A session is created only after successful authentication.
3. Invalid credentials must not create an authenticated session.
4. An inactive or locked account must not establish a new valid session.
5. Logout must terminate the authenticated session according to the finalized session policy.
6. After logout, the terminated session must not access protected LMS resources.
7. A session that has expired must not access protected LMS resources.
8. A session that has been revoked must not access protected LMS resources.
9. Session validity must be enforced server-side.
10. Client-side navigation must never be treated as proof that a session remains valid.
11. Every protected request must use the authenticated session context to establish user, organization, role and branch scope.
12. Every record accessed through a session is scoped by organization and branch.
13. A Branch Admin session must remain restricted to the assigned branch.
14. A Field Employee session must remain restricted to the assigned organization and branch scope.
15. A session cannot be used to escalate a user's role or permissions.
16. Logout must not change the user's organization, branch, role or account status.
17. Session termination must not delete the user account.
18. User-account creation, editing, activation, deactivation and deletion belong to Module 3.
19. Password changes belong to Change Password and password recovery belongs to Forgot Password / Reset Password.
20. If a password-change or password-reset policy requires existing sessions to be revoked, session revocation must be supported by the session subsystem.
21. The exact post-password-change session policy is not defined by the source.
22. The exact concurrent-session limit is not defined by the source.
23. The exact idle timeout is not defined by the source.
24. The exact absolute session lifetime is not defined by the source.
25. The exact behavior when a user signs in from another device is not defined by the source.
26. The exact Active Sessions UI is not defined by the source.
27. The exact remote-session revoke action is not defined by the source.
28. A session must not expose authentication secrets such as plaintext passwords.
29. Session identifiers/tokens must be handled as sensitive security material.
30. Session identifiers must not be written to audit logs in reusable/plaintext form.
31. Session events must be auditable.
32. Money is always integer paise throughout the LMS; session management has no monetary fields.
33. EMI due dates are DATE-only and Asia/Kolkata; session management has no EMI-date fields.
34. Every money movement posts double-entry lines that sum to zero; session management creates no money movement.
35. Payment posting is idempotent on `Idempotency-Key`; this financial rule does not replace session-security controls.
36. The ledger is append-only; session management never edits or deletes ledger entries.
37. Deletion is blocked where records are referenced downstream; session history must not be destructively deleted where retained for security/audit purposes.
38. Deactivation is used instead of destructive deletion for applicable business records.
39. Offline Field Employee operation is distinct from an active server session. The Field Employee flow explicitly supports Offline Mode and cached data. fileciteturn2file18
40. Offline operational access must not falsely represent unsynchronized local data as server-authoritative.
41. A server-side session must not be considered valid merely because cached Field Employee data exists.
42. Logout remains a session-termination action for Super Admin and Field Employee flows. fileciteturn2file0turn2file18
43. All actions are audit logged.

## Background

Given the user has successfully authenticated  
And the system has created an authenticated session  
And the session contains the user's applicable organization, branch, role and permission context

The Super Admin flow shows successful credential validation leading to Dashboard and exposes Logout as a separate dashboard action. The diagram does not specify where the user is redirected after logout. fileciteturn2file0

The Field Employee flow begins with Field Employee Login and then checks Network Available?. The Online path reaches GPS Check-in → Location Verified → Dashboard, while the Offline path reaches Offline Mode → Cached Data Loaded → Cached Customer List. Logout is shown as a terminal session action. fileciteturn2file18

This screen-level document therefore covers the session lifecycle after authentication, including logout, expiry, revocation, scope enforcement and failure handling.

## Feature: Active Sessions / Session Management

### Menu

Profile / Account Security → Active Sessions / Session Management

Actions: View Current Session, View Active Sessions if enabled, Logout Current Session, Revoke Session if enabled, Refresh Session State

**Source limitation:** The diagrams confirm Logout but do not explicitly confirm an Active Sessions list or remote-session management screen.

# Active Sessions / Session Management — Fields

## Current Session

| Field Name                  | Mandatory |
| --------------------------- | --------: |
| Session Status *            |         * |
| User *                      |         * |
| Organization *              |         * |
| Branch                      |           |
| Role *                      |         * |
| Login Time *                |         * |
| Last Activity Time          |           |
| Session Expiry Time         |           |
| Device / Client Information |           |
| Network Information         |           |
| Authentication Method *     |         * |

## Session Actions

| Action               | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| View Current Session | Show the authenticated session context                                    |
| Logout               | Terminate the current authenticated session                               |
| Revoke Session       | Terminate another active session if remote session management is approved |
| Refresh              | Revalidate current session state                                          |

**Note:** Device, network, last-activity and expiry information are implementation-level session metadata. The uploaded flows do not specify the exact UI fields.

# Table Only (Not for UI)

| Internal Field          | Allowed Values / Storage                     |
| ----------------------- | -------------------------------------------- |
| `session_id`            | Unique non-guessable session reference       |
| `user_id`               | Authenticated LMS user reference             |
| `organization_id`       | Organization scope                           |
| `branch_id`             | Branch scope where applicable                |
| `role_id`               | Current role reference                       |
| `status`                | `ACTIVE`, `EXPIRED`, `REVOKED`, `LOGGED_OUT` |
| `authentication_method` | `MOBILE_PASSWORD`                            |
| `created_at`            | Session creation timestamp                   |
| `last_activity_at`      | Last accepted activity timestamp             |
| `expires_at`            | Session expiry timestamp                     |
| `logged_out_at`         | Nullable logout timestamp                    |
| `revoked_at`            | Nullable revocation timestamp                |
| `revocation_reason`     | Controlled security/session reason           |
| `device_reference`      | Device/client metadata where policy permits  |
| `ip_reference`          | Network metadata where policy permits        |
| `audit_event_id`        | Immutable audit reference                    |

# Session State

## Active

The session is valid and may access protected resources subject to role and scope.

## Expired

The session lifetime or idle timeout has been exceeded according to the finalized policy.

The session cannot access protected resources.

## Revoked

The session has been explicitly invalidated by a security or account event.

The session cannot access protected resources.

## Logged Out

The user explicitly selected Logout and the session was terminated.

The session cannot access protected resources.

# Gherkin Scenarios

## Current Session Access

### Scenario 1: Authenticated user opens Session Management

Given the user has a valid authenticated session  
And the user has permission to view their session information  
When the user opens Active Sessions / Session Management  
Then the system displays the current session state  
And the displayed organization and branch context match the authenticated session  
And the user's role is represented correctly  
And the access is audit logged.

### Scenario 2: Unauthenticated user cannot access Session Management

Given the user has no valid authenticated session  
When the user attempts to open Active Sessions / Session Management  
Then the system denies access  
And no protected session information is returned  
And the access denial is audit logged.

### Scenario 3: Session information cannot be used to change authorization scope

Given the authenticated user is assigned to Branch A  
When the user views the current session information  
Then the user cannot modify the organization or branch scope through the session screen  
And the existing authorization scope remains enforced.

## Logout

### Scenario 4: Super Admin logs out

Given the Super Admin has an active authenticated session  
And the Super Admin is on an authenticated dashboard  
When the Super Admin selects Logout  
Then the current session is terminated  
And subsequent protected requests using that session are rejected  
And the logout event is audit logged.

The Super Admin flow explicitly represents Logout as a dashboard action. fileciteturn2file0

### Scenario 5: Field Employee logs out

Given the Field Employee has an active authenticated session  
And the Field Employee has completed or abandoned field operations  
When the Field Employee selects Logout  
Then the current session is terminated  
And subsequent protected field operations require valid authentication  
And the logout is audit logged.

The Field Employee flow explicitly shows Logout as a terminal/session action. fileciteturn2file18

### Scenario 6: Logout does not change the account

Given the user has an active session  
When the user logs out  
Then the user account remains in its existing state  
And the organization remains unchanged  
And the branch remains unchanged  
And the role remains unchanged  
And the logout only terminates the session.

### Scenario 7: Logout is idempotent for an already terminated session

Given a session has already been logged out or revoked  
When another logout request is received for that session  
Then the system does not reactivate the session  
And the protected session remains invalid  
And the repeated logout is handled safely  
And the event is audit logged where applicable.

### Scenario 8: Logout failure does not leave a falsely valid session

Given the user requests Logout  
And the session-termination operation encounters a server-side failure  
When the logout operation is processed  
Then the system must fail safely  
And the user must not be falsely shown as securely logged out if the server still considers the session active  
And the failure is audit logged.

**Open Question:** The source does not define whether logout failure should retry automatically, invalidate locally first, or display a retry state.

## Session Expiry

### Scenario 9: Idle session expires

Given the session has an idle-timeout policy  
And the user remains inactive beyond the configured timeout  
When the user makes another protected request  
Then the system rejects the expired session  
And the user must authenticate again  
And the session state is recorded as `EXPIRED`  
And the expiry event is audit logged.

### Scenario 10: Absolute session lifetime expires

Given the session has an absolute lifetime policy  
And the maximum session lifetime has elapsed  
When the user attempts to access a protected resource  
Then the session is rejected  
And the user must authenticate again  
And the session is recorded as `EXPIRED`  
And the expiry is audit logged.

**Open Question:** The exact absolute lifetime is not defined by the source.

### Scenario 11: Expired session cannot access customer data

Given a Field Employee session has expired  
When the Field Employee requests Customer Details  
Then the request is rejected  
And customer information is not returned  
And the user must authenticate again  
And the denied request is audit logged.

### Scenario 12: Expired session cannot submit a protected operation

Given a session has expired  
When the user submits a protected LMS operation  
Then the system rejects the request  
And the operation is not committed  
And no downstream business transaction is created  
And the expiry/security event is audit logged.

## Session Revocation

### Scenario 13: Explicitly revoked session cannot access protected resources

Given an active session exists  
And the session has been revoked by an authorized security operation  
When the session attempts to access a protected LMS resource  
Then the system rejects the request  
And the session cannot continue operating as authenticated  
And the revocation is audit logged.

### Scenario 14: Password security event revokes a session

Given the finalized security policy requires session revocation after a password change or reset  
And the user's session is subject to that security event  
When the password-security operation completes  
Then the affected session is revoked according to policy  
And the revoked session cannot access protected resources  
And the revocation is audit logged.

### Scenario 15: Revocation does not alter user role

Given a session is revoked  
When the revocation is processed  
Then the user's role remains unchanged  
And the user's organization remains unchanged  
And the user's branch remains unchanged  
And only the session state is changed.

## Active / Inactive Account Behaviour

### Scenario 16: Active account maintains a valid active session

Given the user account is `ACTIVE`  
And the authenticated session has not expired or been revoked  
When the user accesses a protected resource  
Then the session is accepted  
And organization and branch scope are enforced  
And the access is allowed if the user has the required permission.

### Scenario 17: Deactivated account cannot continue protected activity after revalidation

Given the user previously authenticated  
And the account is subsequently changed to `INACTIVE` by an authorized account-management action  
When the user makes a protected request  
Then the system revalidates the account/session security state according to the finalized policy  
And the system must not allow an inactive account to bypass the deactivation control  
And the security event is audit logged.

### Scenario 18: Inactive account cannot create a new session

Given the account status is `INACTIVE`  
When the user attempts to authenticate  
Then the system does not establish a valid new session  
And protected resources remain inaccessible  
And the authentication/security event is audit logged.

### Scenario 19: Locked account cannot establish a new session

Given the account is `LOCKED`  
When the user attempts to authenticate  
Then the system does not establish a valid session while the lock is active  
And the attempt is audit logged.

## Branch and Organization Scoping

### Scenario 20: Branch Admin session remains scoped to its assigned branch

Given the Branch Admin belongs to Branch A  
And the Branch Admin has an active session  
When the Branch Admin accesses branch-scoped resources  
Then the system limits the results to Branch A  
And Branch B records are not returned  
And the branch-scope enforcement is audit logged when access is denied.

### Scenario 21: Branch Admin cannot change branch scope through session data

Given the Branch Admin session is scoped to Branch A  
When the client attempts to submit Branch B as the session scope  
Then the server ignores or rejects the unauthorized scope change  
And the session remains scoped to Branch A  
And the security event is audit logged.

### Scenario 22: Organization scope cannot be changed through session manipulation

Given the user belongs to Organization A  
When the client attempts to submit Organization B as the authenticated organization  
Then the server does not accept the manipulated organization scope  
And the session remains associated with Organization A  
And the unauthorized attempt is audit logged.

## Permission Denial

### Scenario 23: Wrong role attempts remote session management

Given remote session management is enabled  
And the authenticated user does not have permission to revoke another user's session  
When the user attempts to revoke another session  
Then the system denies the operation  
And the target session remains unchanged  
And the permission denial is audit logged.

### Scenario 24: User cannot access another user's session details

Given the user has permission to view their own session  
And another user's session exists  
When the user attempts to access the other user's session details without permission  
Then the system denies access  
And no sensitive session metadata is returned  
And the denial is audit logged.

## Mandatory Validation

### Scenario Outline: Session action rejects missing mandatory context

Given the user is attempting a session-management action  
When the action is submitted without `<field>`  
Then the system shows "<message>"  
And the session-management action is not committed  
And the failure is audit logged.

Examples:

| field          | message                    |
| -------------- | -------------------------- |
| Session ID     | Session ID is required     |
| Session Status | Session Status is required |
| User           | User is required           |

**Note:** Session ID and other internal fields are not necessarily UI fields. The exact UI validation model is an Open Question because the source does not define an Active Sessions screen.

## Concurrent Session Behaviour

### Scenario 25: Multiple sessions are allowed when permitted by policy

Given the finalized policy permits multiple concurrent sessions  
And the user has authenticated successfully from more than one client  
When the user accesses the LMS  
Then each permitted session is evaluated independently  
And each session retains the same organization, branch, role and permission scope  
And session activity is auditable.

### Scenario 26: Concurrent session exceeds the configured limit

Given a concurrent-session limit has been configured  
And the user already has the maximum permitted number of sessions  
When another authentication creates a new session  
Then the system applies the configured session-limit policy  
And the resulting session state is deterministic  
And any session revoked as a result is recorded  
And the security event is audit logged.

**Open Question:** The source does not define a concurrent-session limit or which session should be revoked.

## Device / Client Security

### Scenario 27: Session cannot be transferred by changing client scope fields

Given the user has a valid session  
When the client modifies organization, branch, role or user identifiers in a protected request  
Then the server continues to derive authorization from the authenticated session  
And the manipulated values cannot grant additional access  
And the security event is audit logged.

### Scenario 28: Invalid session identifier is rejected

Given the client submits an invalid or unknown session identifier  
When the server receives a protected request  
Then the request is rejected  
And no protected data is returned  
And the invalid-session event is audit logged.

### Scenario 29: Revoked session identifier cannot be reused

Given a session has been revoked  
When the same session credential is presented again  
Then the system rejects it  
And no new authenticated session is created from the revoked credential  
And the replay/revocation event is audit logged.

## Field Employee Offline Behaviour

### Scenario 30: Field Employee enters Offline Mode

Given the Field Employee has reached the network decision  
And network connectivity is unavailable  
When the Field Employee enters the offline path  
Then the application enters Offline Mode  
And cached data is loaded  
And the system does not represent the offline state as an active server-synchronized session  
And the offline transition is audit logged where connectivity permits.

The source explicitly defines `Network Available? → Offline Mode → Cached Customer List`. fileciteturn2file18

### Scenario 31: Cached data does not imply server session validity

Given the Field Employee has cached customer data  
And the server-side session has expired or been revoked  
When the Field Employee is offline  
Then cached operational data must not be treated as proof that the server session remains valid  
And no server-authoritative protected operation is claimed as completed  
And the state is handled according to the finalized offline policy.

### Scenario 32: Offline Logout clears local authenticated access state according to policy

Given the Field Employee is operating with cached data  
When the Field Employee selects Logout  
Then the local authenticated state is terminated according to the finalized offline-session policy  
And subsequent protected offline operations require whatever reauthentication/offline-access rule is approved  
And the logout is recorded locally for synchronization if the product requires it.

**Open Question:** The source does not define offline Logout semantics.

## Session and Financial Isolation

### Scenario 33: Session creation does not create a financial transaction

Given a user successfully authenticates  
When the session is created  
Then no payment is recorded  
And no receipt is generated  
And no debit or credit ledger lines are posted  
And no loan balance is changed.

### Scenario 34: Session termination does not reverse financial transactions

Given a user has previously completed an authorized payment  
And the user logs out  
When the session terminates  
Then the previous financial transaction remains unchanged  
And no reversal entry is created merely because of Logout  
And the logout is audit logged.

### Scenario 35: Expired session cannot partially commit a financial transaction

Given a protected payment operation requires an active valid session  
And the session expires before authorization/commit  
When the user attempts to complete the payment  
Then the payment is not committed as an authorized operation  
And no partial financial entry is created  
And the security failure is audit logged.

## Failure Paths

### Scenario 36: Session store is unavailable

Given the user has a session  
And the server cannot access the session store  
When the user makes a protected request  
Then the system fails closed rather than granting unauthenticated access  
And the protected operation is not executed  
And the session-service failure is audit logged.

### Scenario 37: Session revocation persistence fails

Given an authorized session-revocation operation is requested  
When the system cannot persist the revocation state  
Then the system does not falsely report a durable revocation  
And the failure is surfaced to the appropriate security flow  
And the failure is audit logged.

### Scenario 38: Logout request is interrupted

Given the user selects Logout  
And the network connection is interrupted during the logout request  
When the client cannot confirm server-side termination  
Then the application must not falsely claim server-side logout success  
And the local client state is handled according to the finalized logout policy  
And the event is recorded for retry or reconciliation if required.

### Scenario 39: Session validation fails unexpectedly

Given the user has presented a session credential  
When session validation encounters an unexpected internal error  
Then the system denies access rather than bypassing session validation  
And no protected operation is executed  
And the error is audit logged without exposing security secrets.

## Audit Logging

### Scenario 40: Session creation is audit logged

Given authentication succeeds  
When a session is created  
Then an immutable audit event records the successful session creation  
And the event identifies the user and applicable organization/branch scope  
And the reusable session secret is not recorded.

### Scenario 41: Logout is audit logged

Given the user has an active session  
When the user logs out  
Then an immutable logout audit event is recorded  
And the event identifies the user and session outcome  
And the reusable session secret is not recorded.

### Scenario 42: Session expiry is audit logged

Given a session reaches its configured expiry condition  
When the server rejects the expired session  
Then the expiry event is audit logged  
And the event does not contain reusable session credentials.

### Scenario 43: Session revocation is audit logged

Given an authorized security action revokes a session  
When the revocation succeeds  
Then the revocation event is audit logged  
And the event identifies the affected user/session context without exposing the reusable session secret.

### Scenario 44: Permission denial is audit logged

Given a user attempts a session-management operation without sufficient permission  
When the system rejects the action  
Then a permission-denial audit event is recorded  
And the session state is not changed.

# Acceptance Criteria

- A protected LMS resource requires a valid authenticated session.
- Sessions are created only after successful authentication.
- Logout terminates the current authenticated session according to the finalized policy.
- A logged-out session cannot access protected LMS resources.
- Expired sessions cannot access protected LMS resources.
- Revoked sessions cannot access protected LMS resources.
- Session authorization is enforced server-side.
- Client-controlled user, organization, branch and role fields cannot override authenticated session scope.
- Branch Admin sessions remain restricted to the assigned branch.
- Organization scope remains enforced for every authenticated session.
- Field Employee sessions remain restricted to the assigned organization and branch.
- Inactive accounts cannot establish new sessions.
- Locked accounts cannot establish new sessions while locked.
- Password-change/reset session invalidation can be supported once the security policy is finalized.
- Session identifiers and reusable authentication secrets are never written to audit logs in plaintext.
- Session state transitions are auditable.
- Active Sessions / remote-session management is implemented only if explicitly approved because the source confirms Logout but does not define an Active Sessions UI.
- Field Employee Offline Mode remains distinct from server-authoritative session validity.
- Cached Field Employee data does not prove that a server session is still valid.
- Session management does not create financial transactions.
- Session management does not modify loan balances or ledger records.
- Expired/revoked sessions cannot partially commit protected financial operations.
- Session-store failures fail closed.
- Session-revocation failures do not falsely report successful durable revocation.
- Logout interruption is handled according to the finalized security policy.
- All actions are audit logged.
