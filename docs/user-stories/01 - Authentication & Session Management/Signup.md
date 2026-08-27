# User Story — Signup (Account Activation & First-Time Credential Setup)

## Epic

Authentication & Session Management

## Feature

Signup — Invitation-Based Account Activation and First-Time Password Creation

## User Story

As a **newly created Super Admin**
I want to activate my account and set my first password using a secure activation link
So that I can sign in and access the LMS system-wide administration functions.

As a **newly created Branch Admin**
I want to activate my account and set my first password
So that I can sign in and operate my assigned branch.

As a **newly created Field Employee / Collection Agent**
I want to activate my account and set my first password on my mobile number
So that I can sign in and access my assigned collection activities.

As a **Super Admin performing tenant bootstrap**
I want the very first administrator account of a new organization to be established through a controlled provisioning path
So that a new tenant can be brought online without an unauthenticated public registration surface.

**Scope boundary:** The LMS is an internal multi-tenant NBFC staff system. There is **no public self-registration**. Every LMS user account originates from **Module 3 — Users, Roles & Permissions** (Admin Management → Create & Manage Admins, Employee Management → Add). This story covers only the authentication-side completion of that account: converting a `PENDING` account into an `ACTIVE`, credentialed account that Sign In can consume. Customer/borrower onboarding is a separate Customer/KYC workflow and is not LMS user signup.

---

## Rules & Business Constraints

1. Signup is **not** public self-registration. An LMS user account must already exist before Signup can be attempted.
2. Account records are created exclusively by an authorized administrator through Module 3.
3. A newly created account starts in `PENDING` status and holds no usable password.
4. A `PENDING` account must not establish an authenticated session through Sign In.
5. Signup transitions the account from `PENDING` to `ACTIVE` only after a valid activation token is presented and a compliant password is set.
6. Account activation requires a system-issued **activation token**; the user cannot self-select which account to activate.
7. The activation token must be bound to exactly one user account.
8. The activation token must be single-use and must be consumed atomically on successful activation.
9. The activation token must expire after a configurable validity period.
10. An expired activation token must not activate the account.
11. An already-consumed activation token must not activate the account a second time.
12. Activation tokens must be stored as a secure one-way hash and never in retrievable plaintext.
13. The activation token must be delivered to the account's registered mobile number through the approved delivery channel.
14. Signup must verify possession of the registered mobile number before the account becomes `ACTIVE`.
15. The mobile number is set by the administrator during account creation and must not be changeable by the user during Signup.
16. The user must not be able to change organization, branch, role or account status during Signup.
17. Role, organization and branch scope are assigned in Module 3 and are read-only inputs to Signup.
18. The first password must satisfy the configured LMS password policy before it is accepted.
19. The exact password-policy parameters are not defined by the uploaded diagrams and must remain configurable rather than hard-coded.
20. The password policy must be enforced server-side, not only by the UI.
21. Passwords must never be stored as plaintext.
22. The first password must be stored using the approved secure password-hashing mechanism.
23. Password values must not be written to application logs, audit logs, error messages, analytics events, or client-side persistent storage.
24. Password and Confirm Password must match before the password is accepted.
25. Signup must not reveal whether a given mobile number or token corresponds to an existing account beyond the approved generic error behavior.
26. Signup must not create an authenticated session implicitly; the user proceeds to Sign In after successful activation.
27. Repeated Signup attempts must be rate limited to prevent activation-token brute force.
28. A failed activation attempt must not change account status.
29. A failed activation attempt must not consume the activation token unless the token itself is invalid or expired.
30. Activation must be transactional: password persistence and status transition either both commit or neither commits.
31. Activation must not create or modify financial transactions.
32. Activation must not post ledger entries.
33. Money displayed by downstream modules is always integer paise and must never be converted to floating-point values; Signup creates no money movement.
34. Ledger records remain append-only; account activation cannot modify or delete financial history.
35. Activation must not grant permissions beyond those assigned to the account's Module 3 role.
36. An administrator must be able to re-issue an activation token when the original expires.
37. Re-issuing an activation token must invalidate any previously outstanding token for that account.
38. An account deactivated before activation completes must not be activatable.
39. Tenant bootstrap — creation of the first Super Admin for a new organization — must occur through a controlled provisioning path and must not be exposed as an unauthenticated public endpoint.
40. Forgot Password and Reset Password are separate Module 1 screens and must not be used as a substitute for first-time activation.
41. Change Password is a separate Module 1 screen applying only to already-active credentialed accounts.
42. OTP-based authentication is not the LMS sign-in mechanism; any OTP used here serves only as mobile-possession verification during activation.
43. All actions are audit logged.

---

## Background

Given an authorized administrator has created the user account in Module 3
And the account has a registered mobile number
And the account belongs to a valid organization
And the account has an assigned role
And the account has an applicable branch scope
And the account status is `PENDING`
And no usable password hash exists for the account

The LMS account lifecycle begins with administrator-driven creation rather than user self-registration. The Super Admin flow exposes Admin Management — Create & Manage Admins and Employee Management — Add, Assign, Deactivate. Neither flow produces a credentialed, sign-in-ready account on its own.

Signup closes that gap. The account holder receives an activation token on the registered mobile number, proves possession of that number, sets a policy-compliant password, and the account transitions to `ACTIVE`. Only then can the Sign In flow authenticate the account and establish a session.

Tenant bootstrap is the one path that has no prior administrator: the first Super Admin of a new organization. That account must be provisioned through a controlled operational path rather than an open registration screen.

---

# Feature: Signup

## Menu

Authentication → Activate Account

Actions: Open Activation Link, Enter Mobile Number, Enter Verification Code, Resend Verification Code, Enter Password, Enter Confirm Password, Show/Hide Password, Activate Account, Navigate to Sign In

---

# Signup — Fields

## Activation Details

| Field Name          | Mandatory |
| ------------------- | --------: |
| Activation Token \* |        \* |
| Mobile Number \*    |        \* |

## Mobile Verification

| Field Name           | Mandatory |
| -------------------- | --------: |
| Verification Code \* |        \* |

## Credential Setup

| Field Name          | Mandatory |
| ------------------- | --------: |
| Password \*         |        \* |
| Confirm Password \* |        \* |

## Read-Only Context (Displayed, Not Editable)

| Field Name   | Editable |
| ------------ | -------- |
| Full Name    | No       |
| Organization | No       |
| Branch       | No       |
| Role         | No       |

## Screen Actions

| Action           | Purpose                                                       |
| ---------------- | ------------------------------------------------------------- |
| Activate Account | Submit credentials to complete activation                     |
| Verify Mobile    | Submit the verification code to prove mobile possession       |
| Resend Code      | Request a new verification code within the configured limit   |
| Show Password    | Temporarily reveal password value in the UI                   |
| Hide Password    | Conceal password value in the UI                              |
| Go to Sign In    | Navigate to the Sign In screen after successful activation    |
| Request New Link | Request a fresh activation token when the current one expired |

---

## Field Rules

### Activation Token

- Mandatory.
- Supplied through the activation link rather than typed by the user where the delivery channel supports it.
- Must resolve to exactly one `PENDING` LMS user account.
- Must be unexpired.
- Must be unconsumed.
- Must be validated server-side against a stored one-way hash.
- Must not be logged in plaintext.
- An invalid, expired or consumed token must produce the approved generic activation error.

### Mobile Number

- Mandatory.
- Must match the mobile number registered on the account the token resolves to.
- Must contain a syntactically valid mobile number according to the LMS-supported mobile-number format.
- Leading/trailing whitespace must not create a separate identity.
- Mobile number comparison must use a canonical normalized representation.
- The user must not be able to substitute a different mobile number during activation.
- The exact country-code policy is not defined by the uploaded LMS diagrams and remains an Open Question.

### Verification Code

- Mandatory where mobile-possession verification is enabled.
- Must be time-limited.
- Must be single-use.
- Must be bound to the same account as the activation token.
- Must be rate limited against repeated guessing.
- Must not be written to application logs or audit logs in plaintext.

### Password

- Mandatory.
- Must satisfy the configured LMS password policy.
- Must be submitted securely.
- Must not be persisted in plaintext.
- Must not appear in logs or audit records.
- Must be stored using the approved secure password-hashing mechanism.
- The exact password length, character-complexity and history rules are not defined by the source and must not be invented.

### Confirm Password

- Mandatory.
- Must exactly match the Password value.
- A mismatch must block activation without disclosing the entered password values.

---

# Table Only (Not for UI)

| Internal Field                | Allowed Values / Storage                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`                     | User account reference created in Module 3                                                                                                                                         |
| `mobile_number`               | Canonical normalized mobile identifier assigned at account creation                                                                                                                |
| `password_hash`               | Null until activation completes; secure one-way hash afterwards                                                                                                                    |
| `account_status`              | `PENDING`, `ACTIVE`, `INACTIVE`, `LOCKED`                                                                                                                                          |
| `activation_token_hash`       | Secure one-way hash of the issued activation token; plaintext token is never stored                                                                                                |
| `activation_token_expires_at` | Activation token expiry timestamp                                                                                                                                                  |
| `activation_token_used_at`    | Nullable single-use consumption timestamp                                                                                                                                          |
| `activation_issued_by`        | Administrator who created or re-issued the activation token                                                                                                                        |
| `activation_issued_at`        | Activation token issue timestamp                                                                                                                                                   |
| `mobile_verified_at`          | Nullable mobile-possession verification timestamp                                                                                                                                  |
| `verification_code_hash`      | Secure one-way hash of the mobile verification code                                                                                                                                |
| `verification_attempts`       | Non-negative integer                                                                                                                                                               |
| `activated_at`                | Nullable account activation timestamp                                                                                                                                              |
| `organization_id`             | Organization foreign-key reference assigned in Module 3                                                                                                                            |
| `branch_id`                   | Nullable branch foreign-key reference assigned in Module 3                                                                                                                         |
| `role_id`                     | Assigned role reference from Module 3                                                                                                                                              |
| `activation_result`           | `SUCCESS`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_CONSUMED`, `MOBILE_MISMATCH`, `VERIFICATION_FAILED`, `PASSWORD_POLICY_VIOLATION`, `ACCOUNT_NOT_ELIGIBLE`, `ACTIVATION_FAILURE` |
| `audit_event_type`            | Account-activation/security event identifier                                                                                                                                       |
| `audit_actor_id`              | Activating user where available, otherwise attempted identity reference per security policy                                                                                        |
| `audit_created_at`            | Immutable audit timestamp                                                                                                                                                          |

---

# Activation State Rules

## Pending Account

`PENDING`

The account exists, holds no usable password, and cannot establish a session. It is the only status eligible for Signup activation.

## Active Account

`ACTIVE`

Activation has completed. The account is now owned by Sign In and must not be re-activated through Signup.

## Inactive Account

`INACTIVE`

The account is not eligible for activation. An account deactivated before activation completed must remain unactivatable until an administrator re-enables it in Module 3.

## Temporarily Locked Account

`LOCKED`

The account is not eligible for activation while the lock is active.

## Expired Activation Token

No status change occurs.

The account remains `PENDING` and an administrator must re-issue an activation token.

## Consumed Activation Token

No status change occurs.

The account is already `ACTIVE` or the token was previously spent. The user must proceed through Sign In or Forgot Password rather than Signup.

---

# Gherkin Scenarios

## Successful Activation

### Scenario 1: Branch Admin activates a pending account successfully

Given a Branch Admin account exists with status `PENDING`
And a valid unexpired activation token has been issued to the registered mobile number
And the supplied mobile number matches the registered account
And the mobile verification code is correct
And the submitted password satisfies the configured password policy
And Confirm Password matches Password
When the user selects Activate Account
Then the system stores the password as a secure hash
And sets the account status to `ACTIVE`
And records the activation timestamp
And marks the activation token as consumed
And does not create an authenticated session
And directs the user to the Sign In screen
And the activation is audit logged.

### Scenario 2: Field Employee activates a pending account successfully

Given a Field Employee account exists with status `PENDING`
And a valid unexpired activation token has been issued
And mobile possession has been verified
And the submitted password satisfies the configured password policy
When the Field Employee selects Activate Account
Then the account becomes `ACTIVE`
And the account inherits the organization and branch scope assigned in Module 3
And the account receives no permissions beyond its assigned role
And the activation is audit logged.

### Scenario 3: Activated account can subsequently sign in

Given a user has successfully completed activation
And the account status is `ACTIVE`
When the user submits the newly created password on the Sign In screen
Then authentication succeeds
And an authenticated session is created
And the session inherits the user's organization and branch scope
And the successful login is audit logged.

### Scenario 4: Read-only scope fields cannot be altered during activation

Given the activation screen displays organization, branch and role as read-only
When the client submits modified organization, branch or role values with the activation request
Then the server ignores the client-supplied scope values
And the account retains the scope assigned in Module 3
And the attempted scope manipulation is audit logged.

---

## Activation Token Validation

### Scenario 5: Expired activation token is rejected

Given an activation token was issued for a `PENDING` account
And the token validity period has elapsed
When the user attempts to activate the account
Then the system rejects the activation
And the account status remains `PENDING`
And no password hash is stored
And the system offers the Request New Link action
And the rejection is audit logged.

### Scenario 6: Already-consumed activation token is rejected

Given an activation token has already been successfully consumed
When the same token is presented a second time
Then the system rejects the activation
And the existing account credentials remain unchanged
And no second activation occurs
And the rejection is audit logged.

### Scenario 7: Unknown activation token is rejected generically

Given the supplied activation token does not resolve to any LMS user account
When the user attempts to activate
Then the system rejects the activation
And the response does not expose whether any account exists
And no account state is modified
And the failed attempt is audit logged.

### Scenario 8: Activation token is bound to a single account

Given an activation token was issued for User A
When the token is presented alongside User B's mobile number
Then the system rejects the activation
And User B's account remains unchanged
And User A's account remains `PENDING`
And the mismatch is audit logged.

### Scenario 9: Re-issued token invalidates the previous token

Given an administrator re-issues an activation token for a `PENDING` account
When the previously issued token is presented
Then the system rejects the superseded token
And only the most recently issued token remains valid
And the re-issue and the rejection are both audit logged.

### Scenario 10: Activation token is never stored in retrievable plaintext

Given an activation token has been issued
When the activation token record is persisted
Then only a secure one-way hash is stored
And the plaintext token is not recoverable from the database
And the plaintext token is not written to application or audit logs.

---

## Mobile Verification

### Scenario 11: Mobile number mismatch blocks activation

Given a valid activation token resolves to an account registered to Mobile A
When the user submits Mobile B
Then the system rejects the activation
And the account status remains `PENDING`
And no password is stored
And the mismatch is audit logged.

### Scenario 12: Incorrect verification code is rejected

Given a verification code has been sent to the registered mobile number
When the user submits an incorrect verification code
Then the system rejects the verification
And the verification attempt count is recorded
And the account status remains `PENDING`
And the failed verification is audit logged.

### Scenario 13: Verification code attempts are rate limited

Given the account has reached the configured maximum verification attempts
When another incorrect verification code is submitted
Then further verification attempts are denied for the configured cooldown period
And the account is not activated
And the rate-limit event is audit logged.

### Scenario 14: Expired verification code is rejected

Given a verification code has passed its validity window
When the user submits that code
Then the system rejects the verification
And the user may request a new code within the configured resend limit
And the rejection is audit logged.

### Scenario 15: Verification code is single-use

Given a verification code has been successfully used
When the same code is submitted again
Then the system rejects the reuse
And no additional verification state is granted
And the reuse attempt is audit logged.

---

## Password Policy

### Scenario 16: Password below policy is rejected

Given the user is on the credential-setup step
When the submitted password does not satisfy the configured password policy
Then the system rejects the password
And the account status remains `PENDING`
And no password hash is stored
And the activation token is not consumed
And the policy-validation failure is audit logged.

### Scenario 17: Confirm Password mismatch blocks activation

Given the user enters a policy-compliant password
And Confirm Password does not match Password
When the user selects Activate Account
Then the system shows the password-mismatch validation message
And no password hash is stored
And the account status remains `PENDING`.

### Scenario 18: Password is stored only as a secure hash

Given the user submits a valid first password
When activation commits
Then the system stores a secure one-way password hash
And the plaintext password is not persisted
And the plaintext password is not returned in an API response.

### Scenario 19: Password is never exposed in activation logs

Given a user submits a password during activation
When the activation request is processed
Then the plaintext password is not written to application logs
And the plaintext password is not written to audit logs
And only non-sensitive activation metadata is retained.

### Scenario 20: Password policy is enforced server-side

Given the client UI has been bypassed
When a non-compliant password is submitted directly to the activation API
Then the server evaluates the configured password policy
And rejects the non-compliant password
And no account activation occurs.

**Note:** The actual password-policy thresholds are not defined in the uploaded LMS flows and are intentionally not hard-coded into this document.

---

## Account Eligibility

### Scenario 21: Already-active account cannot be re-activated

Given the account status is `ACTIVE`
When an activation attempt is made against that account
Then the system rejects the activation
And the existing password hash remains unchanged
And the user is directed to Sign In or Forgot Password
And the rejected attempt is audit logged.

### Scenario 22: Inactive account cannot be activated

Given the account was deactivated by an administrator before activation completed
And the account status is `INACTIVE`
When a valid activation token is presented
Then the system denies the activation
And no password hash is stored
And the account remains `INACTIVE`
And the denial is audit logged.

### Scenario 23: Locked account cannot be activated

Given the account status is `LOCKED`
And the lock is still active
When a valid activation token is presented
Then the system denies the activation
And the lock remains effective
And the attempt is audit logged.

### Scenario 24: Pending account cannot sign in before activation

Given the account status is `PENDING`
And no password hash exists
When the user attempts to sign in
Then the system denies authentication
And no authenticated session is created
And the denied login is audit logged.

### Scenario 25: Account is deactivated mid-activation

Given the user begins a valid activation request
And an administrator deactivates the account before the transaction commits
When the activation transaction reaches account-state validation
Then the system must not activate the account
And the final account state must be respected
And the activation failure is audit logged.

---

## Administrator Interaction

### Scenario 26: Administrator creates an account that requires activation

Given a Super Admin has permission to create users
And the required account information is valid
When the Super Admin submits the new user
Then the account is created with status `PENDING`
And no usable password is set
And an activation token is issued to the registered mobile number
And the creation and token issuance are audit logged.

### Scenario 27: Administrator re-issues an expired activation token

Given a `PENDING` account has an expired activation token
And the administrator has permission to manage the account
When the administrator re-issues the activation token
Then a new token is generated and delivered to the registered mobile number
And the previous token is invalidated
And the re-issue is audit logged.

### Scenario 28: Unauthorized user cannot issue an activation token

Given the acting user lacks user-management permission
When the user attempts to issue or re-issue an activation token
Then the system denies the operation
And no token is issued
And the denial is audit logged.

### Scenario 29: Administrator cannot set another user's password directly

Given an administrator manages a `PENDING` account
When the administrator attempts to set the account's password directly
Then the system denies the operation
And the password remains user-established through activation
And the denial is audit logged.

---

## Tenant Bootstrap

### Scenario 30: First Super Admin of a new organization is provisioned

Given a new organization is being brought online
And no administrator account yet exists for that organization
When the first Super Admin account is provisioned through the controlled provisioning path
Then the account is created with status `PENDING`
And an activation token is issued to the designated mobile number
And the provisioning event is audit logged with the acting operator identity.

### Scenario 31: Tenant bootstrap is not publicly reachable

Given the tenant-bootstrap provisioning path exists
When an unauthenticated request attempts to invoke it
Then the request is denied
And no organization or administrator account is created
And the denied attempt is audit logged.

**Open Question:** The exact tenant-bootstrap mechanism — seeded operator account, platform-operator console, or infrastructure-level provisioning command — is not defined by the uploaded LMS diagrams.

---

## Mandatory Field Validation

### Scenario Outline: Activation cannot be submitted without a mandatory field

Given the user is on the Signup activation screen
When the user submits without `<field>`
Then the system shows "<message>"
And the activation request is not sent
And the account status remains `PENDING`.

Examples:

| field             | message                       |
| ----------------- | ----------------------------- |
| Mobile Number     | Mobile Number is required     |
| Verification Code | Verification Code is required |
| Password          | Password is required          |
| Confirm Password  | Confirm Password is required  |

### Scenario 32: Whitespace-only mobile number is treated as missing

Given the user enters only whitespace into the Mobile Number field
When the user selects Activate Account
Then the system treats the value as missing/invalid
And the activation request is not accepted
And the account status remains `PENDING`.

### Scenario 33: Invalid mobile-number format is rejected before activation

Given the user enters a value that does not satisfy the supported mobile-number format
When the user selects Activate Account
Then the system displays the mobile-number validation message
And activation is not attempted
And the account status remains `PENDING`.

---

## Signup Screen Behaviour

### Scenario 34: User toggles password visibility

Given the user has entered a password
When the user selects Show Password
Then the password value becomes temporarily visible in the UI
And the password is not persisted outside the active form state.

Given the password is visible
When the user selects Hide Password
Then the password is masked again.

### Scenario 35: User requests a new verification code

Given the user has not received the verification code
And the configured resend limit has not been reached
When the user selects Resend Code
Then a new verification code is issued to the registered mobile number
And the previous verification code is invalidated
And the resend is audit logged.

### Scenario 36: Resend limit is enforced

Given the user has reached the configured maximum resend attempts
When the user selects Resend Code again
Then the system denies the resend for the configured cooldown period
And no additional code is issued
And the denial is audit logged.

### Scenario 37: Expired-link screen offers recovery

Given the user opens an activation link whose token has expired
When the activation screen loads
Then the system displays the approved expired-link message
And offers the Request New Link action
And does not disclose account details on the expired-link screen.

---

## Failure Paths

### Scenario 38: Activation service is unavailable

Given the user has entered valid activation details
And the activation service is unavailable
When the user selects Activate Account
Then the account status remains `PENDING`
And no password hash is stored
And the system shows an activation-service failure message
And the user can retry the activation
And the failure is audit logged.

### Scenario 39: Password persistence fails after validation succeeds

Given the activation token, mobile verification and password policy have all passed validation
And password persistence fails
When the system attempts to commit the activation
Then the account status must not become `ACTIVE`
And no partially activated account is created
And the activation token is not consumed
And the failure is audit logged.

### Scenario 40: Status transition fails after password is stored

Given the password hash has been written
And the account status transition fails
When the activation transaction cannot complete
Then the entire activation is rolled back
And the account does not remain in a credentialed-but-pending state
And the failure is audit logged.

### Scenario 41: Database failure occurs during activation

Given the user submits valid activation details
And the activation database cannot be reached
When the system attempts to validate the account
Then activation fails safely
And no account state is modified
And the system does not disclose internal database information
And the failure is audit logged.

### Scenario 42: Verification-code delivery fails

Given the user requests a verification code
And the delivery channel is unavailable
When the system attempts to send the code
Then the system reports a delivery failure to the user
And the account status remains `PENDING`
And the user can retry within the configured resend limit
And the delivery failure is audit logged.

### Scenario 43: Activation request is replayed

Given an activation request has already been successfully processed
When the same request is replayed
Then the system must not activate the account a second time
And the stored password hash remains unchanged
And the replay is rejected through single-use token consumption
And the event must be auditable.

### Scenario 44: Concurrent activation attempts on the same account

Given two activation requests are submitted for the same account simultaneously
When both requests reach token consumption
Then exactly one activation succeeds
And the other request is rejected as a consumed token
And no duplicate or conflicting password hash is written
And both outcomes are audit logged.

---

## Security

### Scenario 45: Activation attempts are rate limited

Given repeated activation attempts originate from the same device, IP or account
When the configured request-rate limit is exceeded
Then further activation attempts are throttled
And no account is activated through the throttled attempts
And the rate-limit event is audit logged.

### Scenario 46: Activation does not enumerate accounts

Given an attacker submits arbitrary activation tokens or mobile numbers
When each attempt fails
Then the system returns the approved generic activation error
And the response does not distinguish unknown token from expired token in a way that enables enumeration
And each failed attempt is audit logged.

### Scenario 47: Activation does not create a session implicitly

Given activation completes successfully
When the account status becomes `ACTIVE`
Then no authenticated session is created by the activation transaction
And the user must authenticate through Sign In to obtain a session
And the activation is audit logged separately from any subsequent login.

### Scenario 48: Activation cannot escalate privilege

Given the account was assigned a Field Employee role in Module 3
When the client submits an elevated role during activation
Then the server ignores the client-supplied role
And the activated account retains the Field Employee role
And the attempted escalation is audit logged.

---

## Audit Logging

### Scenario 49: Successful activation is audit logged

Given a valid activation completes
When the account status becomes `ACTIVE`
Then an immutable activation-success audit record is created
And the audit record identifies the user, organization, role/scope, timestamp and activation result
And the password is not recorded
And the plaintext activation token is not recorded.

### Scenario 50: Failed activation is audit logged

Given an activation attempt fails
When the failure is processed
Then an activation-failure audit record is created
And the password is not recorded
And the failure reason is represented using a non-sensitive security event classification.

### Scenario 51: Token issuance and re-issuance are audit logged

Given an administrator issues or re-issues an activation token
When the token is generated
Then an audit record captures the acting administrator, the target account and the issue timestamp
And the plaintext token is not recorded.

### Scenario 52: Activation does not write financial records

Given an account activation completes
When the activation transaction commits
Then no ledger entry is posted
And no financial transaction is created
And no existing financial history is modified.

---

# Acceptance Criteria

- Signup is invitation/activation based; there is no public self-registration surface.
- User accounts are created exclusively by authorized administrators through Module 3.
- A newly created account starts in `PENDING` status with no usable password.
- A `PENDING` account cannot establish an authenticated session.
- Activation requires a valid, unexpired, unconsumed, single-use activation token.
- Activation tokens are stored as secure one-way hashes and never in retrievable plaintext.
- Activation tokens are bound to exactly one user account.
- Re-issuing an activation token invalidates the previous token.
- Expired activation tokens can be replaced by an administrator re-issue.
- Mobile possession is verified against the registered mobile number before activation completes.
- The user cannot change the registered mobile number during activation.
- Verification codes are time-limited, single-use and rate limited.
- The first password must satisfy the configured password policy.
- Password policy is enforced server-side, not only in the UI.
- Confirm Password must match Password before activation proceeds.
- Passwords are never stored or logged in plaintext.
- The first password is stored using the approved secure password-hashing mechanism.
- Successful activation transitions the account from `PENDING` to `ACTIVE`.
- Activation is transactional; partial activation states are never persisted.
- Activation does not create an authenticated session; the user proceeds to Sign In.
- Already-active accounts cannot be re-activated through Signup.
- Inactive and locked accounts cannot be activated.
- Organization, branch and role are read-only during activation and assigned only in Module 3.
- Client-supplied scope or role values cannot override the assigned authorization context.
- Activation cannot grant permissions beyond the assigned role.
- Tenant bootstrap for the first Super Admin uses a controlled provisioning path, never a public endpoint.
- Activation attempts are rate limited against brute force.
- Activation errors do not enable account enumeration.
- Replayed and concurrent activation requests result in at most one successful activation.
- Activation-service, persistence and delivery failures fail safely without partial state.
- Forgot Password and Reset Password remain separate screens and are not substitutes for activation.
- Change Password remains a separate screen applying only to credentialed accounts.
- Customer/KYC onboarding remains separate and is not treated as LMS user signup.
- Successful activation is audit logged.
- Failed activation is audit logged.
- Token issuance and re-issuance are audit logged.
- Activation never creates financial ledger entries.
- Activation never modifies financial history.
- All actions are audit logged.

---

# Source Traceability

- The Sign In baseline explicitly states that user-account creation, editing, activation, deactivation and deletion belong to **Module 3 — Users, Roles & Permissions** and are not part of the Sign In screen. Signup therefore covers only the authentication-side credential establishment, not account creation.
- The Sign In baseline requires the account status to be `ACTIVE` before a session can be established, which makes a `PENDING` → `ACTIVE` transition a prerequisite that no existing Module 1 story covered.
- Module 3 defines `PENDING` as "Account exists but is not yet active, if onboarding requires this state," establishing the status this story consumes and resolves.
- The Super Admin flow exposes **Admin Management — Create & Manage Admins** and **Employee Management — Add, Assign, Deactivate**, none of which produce a credentialed, sign-in-ready account.
- Module 3 lists "Is an admin/employee invitation workflow required before account activation?" as an unresolved Open Question; this story defines the invitation-based activation model while preserving that question for confirmation.
- The Sign In baseline states that Customer mobile-number verification is a separate Customer/KYC workflow and must not be treated as LMS user authentication, which excludes borrower onboarding from this story.
- The Sign In baseline requires organization and branch scope enforcement and prohibits client-controlled scope manipulation; Signup inherits both constraints.

# End of Signup
