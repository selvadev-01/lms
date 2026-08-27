# User Story — Sign In

## Epic

Authentication & Session Management

## Feature

Sign In — Mobile + Password Authentication

## User Story

As a **Super Admin**  
I want to sign in using my registered mobile number and password  
So that I can securely access the LMS system-wide administration functions.

As a **Branch Admin**  
I want to sign in using my registered mobile number and password  
So that I can securely access my branch operations.

As a **Field Employee / Collection Agent**  
I want to sign in using my registered mobile number and password  
So that I can access my assigned collection activities and customer information.

The source flow explicitly defines login and credential validation for Super Admin and Branch Admin, while the Field Employee flow begins with Field Employee Login and then evaluates network availability.
---

## Rules & Business Constraints

1. Authentication uses **Mobile Number + Password**.
2. The mobile number used for authentication must identify an existing LMS user account.
3. The user account must be `ACTIVE` to establish a new authenticated session.
4. Invalid credentials must not create an authenticated session.
5. Super Admin invalid credentials return the user to the login screen and allow another attempt.
6. Branch Admin invalid credentials must record the failed attempt. The consolidated LMS baseline defines a configurable maximum failed-attempt threshold followed by a temporary account lock.
7. A successful Super Admin login proceeds to the system-wide Dashboard.
8. A successful Branch Admin login proceeds to the Branch Dashboard.
9. Field Employee authentication must subsequently evaluate network availability. The online path performs GPS Check-in and location verification; the offline path loads cached data.
10. Authentication must enforce the user's organization and branch scope before granting access to protected business data.
11. A Branch Admin must not receive another branch's records after successful authentication.
12. Authentication success does not grant permissions that are not assigned to the authenticated user's role.
13. A user with an `INACTIVE` account must not establish a new session even when the supplied password is correct.
14. A temporarily `LOCKED` account must not establish a new session while the lock is active.
15. Failed authentication attempts must not reveal whether a mobile number belongs to another user account beyond the approved login error behavior.
16. Passwords must never be stored as plaintext.
17. Password verification must use a secure password-hashing mechanism.
18. Password values must not be written to application logs, audit logs, error messages, analytics events, or client-side persistent storage.
19. The password must satisfy the configured LMS password policy before a new password is accepted through the password-management flows.
20. The exact password-policy parameters are not defined by the uploaded diagrams and therefore must be configurable rather than hard-coded until finalized.
21. The password policy must be consistently enforced by Sign In-related password-management operations rather than only by the UI.
22. A successful login creates an authenticated session associated with the correct user, organization, role and branch scope.
23. A failed login must not create an authenticated session.
24. Authentication attempts must be audit logged, including successful and failed outcomes.
25. Logout is a separate session action defined in the Super Admin and Field Employee flows; Sign In must create the session that Logout later terminates.
26. Sign In does not create or modify financial transactions.
27. Sign In does not post ledger entries.
28. All downstream financial operations accessed after authentication must continue to enforce the LMS financial controls.
29. Money displayed by downstream modules is always integer paise and must never be converted to floating-point values.
30. EMI due dates remain DATE-only in Asia/Kolkata; authentication does not change that domain rule.
31. Every money movement must post double-entry accounting lines that sum to zero; Sign In itself creates no money movement.
32. Payment idempotency using `Idempotency-Key` applies to payment posting and is not a substitute for authentication/session idempotency.
33. Ledger records remain append-only; authentication cannot modify or delete financial history.
34. User-account creation, editing, activation, deactivation and deletion belong to **Module 3 — Users, Roles & Permissions** and are not part of this Sign In screen.
35. Forgot Password and Reset Password are separate Module 1 screens and are not handled by the Sign In screen.
36. OTP-based authentication is not part of this LMS authentication flow because the selected authentication method is Mobile + Password.
37. Customer mobile-number verification is a separate Customer/KYC workflow and must not be treated as LMS user authentication. The Customer Journey defines mobile verification specifically within the Local Customer onboarding path.
38. All actions are audit logged.

---

## Background

Given the user is logged into the system  
And the user has permission to access the LMS  
And the user has a registered mobile number  
And the user account belongs to a valid organization  
And the user has an assigned role  
And the user has an applicable branch scope  
And the account status is `ACTIVE`

The LMS authentication flow starts at Login and validates credentials before entering the appropriate dashboard. Super Admin login has an invalid-credential loop back to login and a successful path to the system-wide Dashboard.

Branch Admin follows the same credential-validation pattern and enters the branch Dashboard after successful authentication. The consolidated baseline additionally records failed attempts and supports a configurable temporary lock after the maximum failed-attempt threshold.

For Field Employee authentication, the source introduces a second decision after login: Network Available?. The Online path performs GPS Check-in and Location Verified, while the Offline path enters Offline Mode and loads cached data.

---

# Feature: Sign In

## Menu

Authentication → Sign In

Actions: Enter Mobile Number, Enter Password, Show/Hide Password, Sign In, Navigate to Forgot Password

---

# Sign In — Fields

## Authentication Details

| Field Name      | Mandatory |
| --------------- | --------: |
| Mobile Number * |         * |
| Password *      |         * |

## Screen Actions

| Action          | Purpose                                              |
| --------------- | ---------------------------------------------------- |
| Sign In         | Submit mobile number and password for authentication |
| Show Password   | Temporarily reveal password value in the UI          |
| Hide Password   | Conceal password value in the UI                     |
| Forgot Password | Navigate to the Forgot Password screen               |
| Retry Sign In   | Retry authentication after a failed attempt          |

---

## Field Rules

### Mobile Number

- Mandatory.
- Must contain a syntactically valid mobile number according to the LMS-supported mobile-number format.
- Must resolve to an LMS user account.
- Leading/trailing whitespace must not create a separate identity.
- Mobile number comparison must use a canonical normalized representation.
- The exact country-code policy is not defined by the uploaded LMS diagrams and remains an Open Question.
- The system must not expose whether a particular mobile number belongs to an account through overly specific error messages.

### Password

- Mandatory.
- Must be submitted securely.
- Must not be persisted in plaintext.
- Must not appear in logs or audit records.
- Must be verified against the stored password hash.
- The password must satisfy the configured password policy when created or changed.
- The exact password length, character-complexity, history and expiry rules are not defined by the source and must not be invented.

---

# Table Only (Not for UI)

| Internal Field          | Allowed Values / Storage                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `mobile_number`         | Canonical normalized mobile identifier                                                                  |
| `password_hash`         | Secure one-way password hash; plaintext password is never stored                                        |
| `account_status`        | `ACTIVE`, `INACTIVE`, `LOCKED`                                                                          |
| `failed_login_attempts` | Non-negative integer                                                                                    |
| `account_locked_until`  | Nullable timestamp                                                                                      |
| `last_login_at`         | Nullable authentication timestamp                                                                       |
| `last_failed_login_at`  | Nullable authentication timestamp                                                                       |
| `organization_id`       | Organization foreign-key reference                                                                      |
| `branch_id`             | Nullable branch foreign-key reference where applicable                                                  |
| `role_id`               | Assigned role reference                                                                                 |
| `session_id`            | Created only after successful authentication                                                            |
| `authentication_result` | `SUCCESS`, `INVALID_CREDENTIALS`, `ACCOUNT_INACTIVE`, `ACCOUNT_LOCKED`, `AUTHENTICATION_FAILURE`        |
| `audit_event_type`      | Authentication/security event identifier                                                                |
| `audit_actor_id`        | Authenticated user where available, otherwise attempted identity reference according to security policy |
| `audit_created_at`      | Immutable audit timestamp                                                                               |

---

# Authentication State Rules

## Active Account

`ACTIVE`

The account may authenticate if the mobile number and password are valid.

## Inactive Account

`INACTIVE`

The account must not establish a new authenticated session.

The user account remains a Module 3 concern. Sign In only consumes the account's current status.

## Temporarily Locked Account

`LOCKED`

The account must not establish a new authenticated session while the lock is active.

The exact lock duration and maximum failed-attempt configuration are currently unresolved in the LMS baseline.

## Invalid Credentials

No session is created.

For Super Admin, the source explicitly returns the user to the Login screen.

For Branch Admin, the failed attempt is recorded and the user can retry unless the configured lock threshold has been reached.

---

# Gherkin Scenarios

## Super Admin Sign In

### Scenario 1: Super Admin signs in with valid mobile number and password

Given a Super Admin account exists  
And the account status is `ACTIVE`  
And the supplied mobile number matches the registered account  
And the supplied password is correct  
When the Super Admin selects Sign In  
Then the system authenticates the credentials  
And creates an authenticated session  
And associates the session with the Super Admin's organization and system-wide access scope  
And redirects the Super Admin to the Dashboard  
And the successful login is audit logged.

### Scenario 2: Super Admin enters an incorrect password

Given a Super Admin account exists  
And the supplied mobile number matches the account  
And the supplied password is incorrect  
When the Super Admin selects Sign In  
Then the system rejects authentication  
And no authenticated session is created  
And the system shows a login error  
And the user remains on the login screen  
And the failed attempt is audit logged.

### Scenario 3: Super Admin enters an unregistered mobile number

Given no eligible LMS user account matches the supplied mobile number  
When the user submits the mobile number and password  
Then the system rejects authentication  
And no authenticated session is created  
And the response does not expose unnecessary account-existence information  
And the failed authentication is audit logged.

### Scenario 4: Super Admin submits empty credentials

Given the Super Admin is on the Sign In screen  
When the Super Admin submits the form without the required credentials  
Then the system does not call credential authentication  
And the system displays the applicable mandatory-field validation messages  
And no authenticated session is created  
And the validation failure is audit logged where security-event logging applies.

---

## Branch Admin Sign In

### Scenario 5: Branch Admin signs in with valid credentials

Given a Branch Admin account exists  
And the account status is `ACTIVE`  
And the supplied mobile number matches the registered account  
And the supplied password is correct  
When the Branch Admin selects Sign In  
Then the system authenticates the credentials  
And creates an authenticated session  
And associates the session with the Branch Admin's organization  
And associates the session with the Branch Admin's assigned branch  
And redirects the Branch Admin to the branch Dashboard  
And the successful login is audit logged.

### Scenario 6: Branch Admin enters an incorrect password

Given a Branch Admin account exists  
And the supplied mobile number matches the account  
And the supplied password is incorrect  
When the Branch Admin selects Sign In  
Then the authentication attempt is rejected  
And the failed attempt count is recorded  
And no authenticated session is created  
And the Branch Admin remains able to retry unless the configured failed-attempt threshold has been reached  
And the failed authentication is audit logged.

### Scenario 7: Branch Admin reaches the configured failed-login threshold

Given the Branch Admin account has reached the configured maximum failed-login attempts  
When another invalid authentication attempt is processed  
Then the account is temporarily locked  
And no authenticated session is created  
And further authentication attempts are denied while the lock remains active  
And the account-lock event is audit logged.

### Scenario 8: Branch Admin attempts login while temporarily locked

Given the Branch Admin account status is `LOCKED`  
And the lock period has not expired  
And the supplied password is correct  
When the Branch Admin selects Sign In  
Then authentication is denied  
And no authenticated session is created  
And the lock state is preserved  
And the authentication attempt is audit logged.

### Scenario 9: Branch Admin login does not expose another branch

Given the Branch Admin belongs to Branch A  
And the user account is valid  
When the Branch Admin successfully signs in  
Then the session contains the Branch A scope  
And Branch B records are not made accessible through the authenticated session  
And branch scoping is enforced server-side  
And the successful authentication is audit logged.

---

## Field Employee Sign In

### Scenario 10: Field Employee signs in while online

Given a Field Employee account exists  
And the account status is `ACTIVE`  
And the mobile number and password are valid  
And network connectivity is available  
When the Field Employee selects Sign In  
Then authentication succeeds  
And the system evaluates the Online path  
And GPS Check-in is initiated  
And the system proceeds to location verification  
And the authentication event is audit logged.

### Scenario 11: Field Employee enters the Offline path

Given the Field Employee has valid previously available offline data  
And the device has no network connectivity  
When the Field Employee enters the application  
Then the system enters Offline Mode  
And cached data is loaded  
And the cached customer list is made available  
And the system does not falsely represent the device as server-synchronized  
And the offline access event is audit logged.

### Scenario 12: Field Employee authentication fails

Given the Field Employee account is not eligible for authentication  
When the Field Employee submits invalid authentication credentials  
Then the system does not create an authenticated session  
And the user does not receive access to protected customer or collection data  
And the authentication failure is audit logged.

---

## Account State

### Scenario 13: Active account authenticates successfully

Given the user's account status is `ACTIVE`  
And the mobile number is valid  
And the password is correct  
When the user selects Sign In  
Then the authentication succeeds  
And an authenticated session is created  
And the session inherits the user's organization and branch scope  
And the login is audit logged.

### Scenario 14: Inactive account is denied authentication

Given the user's account status is `INACTIVE`  
And the mobile number and password are correct  
When the user selects Sign In  
Then the system denies authentication  
And no authenticated session is created  
And protected LMS resources remain inaccessible  
And the denied login is audit logged.

### Scenario 15: Locked account is denied authentication

Given the user's account status is `LOCKED`  
And the lock is still active  
And the mobile number and password are correct  
When the user selects Sign In  
Then the system denies authentication  
And no authenticated session is created  
And the lock remains effective  
And the attempt is audit logged.

### Scenario 16: Account becomes inactive before authentication completes

Given the user begins a valid Sign In request  
And the account becomes `INACTIVE` before session creation completes  
When the authentication transaction reaches account-state validation  
Then the system must not create an authenticated session  
And the final account state must be respected  
And the authentication failure is audit logged.

---

## Permission and Scope

### Scenario 17: Valid credentials do not bypass role permissions

Given a user has valid mobile credentials  
And the account is `ACTIVE`  
And the user has successfully authenticated  
When the user accesses a module not permitted by the assigned role  
Then authentication does not grant the missing permission  
And the protected operation is denied  
And the permission denial is audit logged.

### Scenario 18: Branch Admin cannot authenticate into another branch scope

Given a Branch Admin is assigned to Branch A  
And the user account belongs to Branch A  
When the Branch Admin signs in successfully  
Then the authenticated session is scoped to Branch A  
And the Branch Admin cannot use the session to access Branch B records  
And any unauthorized cross-branch access attempt is denied and audit logged.

### Scenario 19: Organization scope is preserved after authentication

Given a user belongs to Organization A  
And the user has valid credentials  
When the user successfully signs in  
Then the authenticated session is associated with Organization A  
And protected resources belonging to another organization are not accessible  
And the organization-scope enforcement is audit logged when access is denied.

---

## Password Security

### Scenario 20: Password is never exposed in authentication logs

Given a user submits a password during Sign In  
When the authentication request is processed  
Then the plaintext password is not written to application logs  
And the plaintext password is not written to audit logs  
And the plaintext password is not returned in an API response  
And only non-sensitive authentication metadata is retained.

### Scenario 21: Password is verified against a stored hash

Given the user account has a stored password hash  
When the user submits the correct password  
Then the authentication service verifies the supplied password against the stored hash  
And the plaintext password is not persisted  
And successful authentication proceeds only after verification succeeds.

### Scenario 22: Incorrect password does not reveal password policy details unnecessarily

Given the user submits an incorrect password  
When authentication fails  
Then the system returns the approved authentication error  
And the response does not reveal the stored password characteristics  
And the failure is audit logged.

### Scenario 23: Password policy is enforced for newly established credentials

Given a user is creating or changing a password through the applicable password-management screen  
When the submitted password does not satisfy the configured password policy  
Then the password must be rejected  
And the previous valid password remains unchanged  
And the policy-validation failure is audit logged.

**Note:** The actual password-policy thresholds are not defined in the uploaded LMS flows and therefore are intentionally not hard-coded into this document.

---

## Sign In Screen Behaviour

### Scenario 24: User toggles password visibility

Given the user has entered a password  
When the user selects Show Password  
Then the password value becomes temporarily visible in the UI  
And the password is not persisted outside the active form state.

Given the password is visible  
When the user selects Hide Password  
Then the password is masked again.

### Scenario 25: User submits with mobile number missing

Given the user is on the Sign In screen  
When the user submits without Mobile Number  
Then the system shows "Mobile Number is required"  
And authentication is not attempted  
And no session is created.

### Scenario 26: User submits with password missing

Given the user is on the Sign In screen  
When the user submits without Password  
Then the system shows "Password is required"  
And authentication is not attempted  
And no session is created.

### Scenario 27: User submits whitespace-only mobile number

Given the user enters only whitespace into the Mobile Number field  
When the user selects Sign In  
Then the system treats the value as missing/invalid  
And the authentication request is not accepted  
And no session is created.

### Scenario 28: User submits an invalid mobile-number format

Given the user enters a value that does not satisfy the supported mobile-number format  
When the user selects Sign In  
Then the system displays the mobile-number validation message  
And authentication is not attempted  
And no session is created.

---

## Mandatory Field Validation

### Scenario Outline: Sign In cannot be submitted without a mandatory field

Given the user is on the Sign In screen  
When the user submits without `<field>`  
Then the system shows "<message>"  
And the authentication request is not sent  
And no authenticated session is created.

Examples:

| field         | message                   |
| ------------- | ------------------------- |
| Mobile Number | Mobile Number is required |
| Password      | Password is required      |

---

## Failure Paths

### Scenario 29: Authentication service is unavailable

Given the user has entered valid-looking authentication details  
And the authentication service is unavailable  
When the user selects Sign In  
Then the system does not create an authenticated session  
And the system shows an authentication-service failure message  
And the user can retry the Sign In operation  
And the failure is audit logged.

### Scenario 30: Session creation fails after successful credential validation

Given the mobile number and password have been successfully validated  
And session creation fails  
When the system attempts to establish the authenticated session  
Then the user is not treated as authenticated  
And no partially active session is created  
And the failure is audit logged.

### Scenario 31: Database failure occurs during authentication

Given the user submits valid authentication credentials  
And the authentication database cannot be reached  
When the system attempts to validate the account  
Then authentication fails safely  
And no session is created  
And the system does not disclose internal database information  
And the failure is audit logged.

### Scenario 32: Authentication request is replayed

Given a Sign In request has already been successfully processed  
When the same request is replayed  
Then the system must not create uncontrolled duplicate authentication state  
And any resulting session behavior must comply with the configured concurrent-session policy  
And the event must be auditable.

**Open Question:** The allowed number of concurrent sessions per user is not defined by the source.

---

## Audit Logging

### Scenario 33: Successful authentication is audit logged

Given valid credentials are submitted  
When authentication succeeds  
Then an immutable authentication-success audit record is created  
And the audit record identifies the user, organization, role/scope, timestamp and authentication result  
And the password itself is not recorded.

### Scenario 34: Failed authentication is audit logged

Given invalid credentials are submitted  
When authentication fails  
Then an authentication-failure audit record is created  
And the password is not recorded  
And the failure reason is represented using a non-sensitive security event classification.

### Scenario 35: Account lock is audit logged

Given the configured failed-login threshold has been reached  
When the account becomes temporarily locked  
Then an account-lock audit event is created  
And the lock timestamp and applicable security metadata are retained  
And the password is not recorded.

---

## Logout Relationship

### Scenario 36: Successful Sign In creates a session that can later be logged out

Given a user successfully authenticates  
When the system creates the authenticated session  
Then the session is associated with the authenticated user  
And the session can subsequently be terminated through Logout  
And the successful authentication is audit logged.

The source diagrams explicitly expose Logout as a session action for Super Admin and Field Employee flows.

---

# Acceptance Criteria

- Sign In authenticates users using **Mobile Number + Password**.
- A valid Active user can successfully authenticate.
- Invalid credentials never create an authenticated session.
- Super Admin successful authentication reaches the system-wide Dashboard.
- Branch Admin successful authentication reaches the Branch Dashboard.
- Super Admin invalid credentials return the user to the login screen.
- Branch Admin failed authentication attempts are recorded.
- Branch Admin temporary account locking is supported after the configured maximum failed-attempt threshold.
- Locked accounts cannot establish new sessions.
- Inactive accounts cannot establish new sessions.
- Field Employee authentication evaluates network availability after login.
- Online Field Employee authentication enters GPS Check-in and location verification.
- Offline Field Employee access uses the defined Offline Mode and cached-data path.
- Authentication preserves organization and branch scope.
- Branch Admin sessions cannot access another branch's records.
- Authentication cannot bypass downstream role permissions.
- Mobile Number is mandatory.
- Password is mandatory.
- Invalid mobile-number format is rejected before authentication.
- Passwords are never stored or logged in plaintext.
- Password verification uses the stored password hash.
- Password policy validation is enforced by password-management operations.
- Exact password-policy thresholds remain configurable until finalized.
- Forgot Password is accessed as a separate screen and is not duplicated here.
- Reset Password is handled as a separate screen and is not duplicated here.
- User Account Administration remains exclusively under Module 3.
- Customer mobile verification remains under Customer/KYC and is not treated as LMS-user authentication.
- Authentication service failures fail safely without creating sessions.
- Session-creation failures fail safely without creating partially authenticated sessions.
- Successful authentication creates a session that can later be terminated through Logout.
- Every successful login is audit logged.
- Every failed login is audit logged.
- Account locking is audit logged.
- Authentication never creates financial ledger entries.
- Authentication never modifies financial history.
- All actions are audit logged.
