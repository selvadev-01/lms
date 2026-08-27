# LMS — Consolidated Open Questions

**Purpose:** Single register of every unresolved product, security and technical
question extracted from all specification documents. Each story file keeps its
own `# Open Questions` section as the authoritative source; this file is the
cross-cutting working register used for decision sessions.

**Status legend:** `OPEN` = undecided · `DECIDED` = answer recorded · `DEFERRED` = out of current scope
· `DEFAULT-APPLIED` = still undecided, but a documented default is implemented so
the build could proceed. These need a product decision; the code is configurable
so a change does not require a rewrite.

## Defaults applied by the Sign-In implementation

Recorded per [PROMPT-DEVELOPMENT.md](PROMPT-DEVELOPMENT.md) — "apply a documented
default, never a silent guess". All values are environment-driven; see
`apps/api/src/config/auth.config.ts`.

| Question                             | Applied default                                                                                                                                                    | Where                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Q-AUTH-2 (mobile uniqueness scope)   | Mobile stays unique **per organization**; sign-in takes an **Organization Code** as a third field to resolve the tenant. `Organization.code` is globally unique.   | `packages/validation` `signInSchema`                               |
| Q-AUTH-1 (mobile format)             | Normalized 10-digit Indian mobile, `/^[6-9]\d{9}$/`, trimmed server-side.                                                                                          | `phoneSchema`                                                      |
| Q-AUTH-4 / Q-AUTH-5 (lockout)        | 5 failed attempts, then a 15-minute temporary lock that self-heals on expiry.                                                                                      | `AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCK_DURATION_MINUTES`           |
| Q-AUTH-6 (counter reset)             | A successful sign-in resets the counter immediately.                                                                                                               | `AuthService.signIn`                                               |
| Q-RBAC-16 (delegation)               | Subset rule on role create/edit; **self-assignment only** for user role assignment — see §9.1.                                                                     | `RoleService.assertDelegable`, `UserService.assertRolesAssignable` |
| Q-RBAC-17 (Super Admin restrictable) | No. `Role.isSystem` refuses rename, deactivate, delete and permission removal.                                                                                     | `Role.isSystem`, `RoleService.assertNotSystemProtected`            |
| Q-ACT-13 (`PENDING` status)          | Added. A provisioned account with no password is PENDING, distinct from a deliberate INACTIVE.                                                                     | `UserStatus.PENDING`                                               |
| Q-SESS-18 / 19 (role change effect)  | Authorization is re-resolved from the database on **every** request, so a role, permission or status change applies on the user's next call — not at next sign-in. | `AuthorizationService.resolve`, `JwtAuthGuard`                     |
| Q-AUTH-7 / Q-AUTH-8 (who is locked)  | The same lockout applies to every role, Super Admin included.                                                                                                      | `AuthService.signIn`                                               |
| Q-AUTH-9 (error granularity)         | One generic `Invalid credentials` for invalid / unknown-org / inactive / locked. Chosen as the secure default; it does trade user clarity for non-disclosure.      | `AuthService.signIn`                                               |
| Q-AUTH-10 (rate limiting)            | 20 sign-in requests per minute per IP, above the account lockout so a legitimate user meets the lock first.                                                        | `@Throttle` on `POST /auth/sign-in`                                |
| Q-PWD-1 (min length)                 | 12 characters — **enforced only when a password is set**, never at sign-in, where it would leak policy.                                                            | `passwordPolicySchema`, `AUTH_PASSWORD_MIN_LENGTH`                 |
| Q-PWD-2 (max length)                 | 200 characters, bounding argon2 work an unauthenticated caller can force.                                                                                          | `passwordPolicySchema`, `AUTH_PASSWORD_MAX_LENGTH`                 |
| Q-PWD-3 (complexity)                 | At least **3 of 4** classes (upper, lower, digit, symbol). Chosen over all-4 to keep field-employee passwords memorable at a 12-character minimum.                 | `passwordPolicySchema`, `AUTH_PASSWORD_REQUIRED_CLASSES`           |
| Q-PWD-4 (history depth)              | Last **5** passwords rejected, plus the current one. Each check costs one argon2 verification, so the depth is configurable.                                       | `PasswordHistory`, `AUTH_PASSWORD_HISTORY_DEPTH`                   |
| Q-PWD-7 (common passwords)           | A small embedded blocklist. Deliberately not a HIBP lookup: a network call would make password validation fail when a third party is down.                         | `COMMON_PASSWORDS` in `packages/validation`                        |
| Q-PWD-8 (account identifiers)        | The password may not contain the user's name tokens, mobile number or org code (fragments of 4+ characters, case-insensitive).                                     | `buildPasswordPolicySchema`                                        |
| Q-PWD-9 (hashing)                    | argon2id, 19 MiB / t=2 / p=1 (OWASP).                                                                                                                              | `PasswordService`                                                  |
| Q-SESS-21 (session storage)          | Server-side `user_sessions` rows + httpOnly cookies; access JWT 15m, refresh token 7d stored as SHA-256.                                                           | `UserSession`, `SessionService`                                    |
| Q-SESS-2 (concurrent sessions)       | Unlimited (`0`), confirmed in the Active-Sessions story. A cap revokes oldest-first when a deployment sets one.                                                    | `AUTH_MAX_CONCURRENT_SESSIONS`                                     |
| Q-SESS-20 (post-logout destination)  | `/signin`.                                                                                                                                                         | `signOutAction`                                                    |

## Defaults applied by the Active Sessions implementation

The source confirms Logout but defines no Active Sessions screen, timeout or
revocation workflow. Remote session management was **explicitly approved** for
this slice; everything below is an applied default, changeable without a code
edit.

| Question                             | Applied default                                                                                                                                                 | Where                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Q-SESS-1 (Active Sessions list)      | **Built.** `/active-sessions` lists the caller's own active sessions with device, IP, sign-in and last-activity times.                                          | `ActiveSessionsList`, `GET /auth/sessions`          |
| Q-SESS-4 (idle timeout)              | **30 minutes.** A session with no accepted activity for that long is expired on its next request and persisted as `IDLE_TIMEOUT`.                               | `AUTH_IDLE_TIMEOUT_MINUTES`                         |
| Q-SESS-5 (absolute lifetime)         | 7 days, unchanged from Sign-In. A session dies at whichever of idle or absolute comes first.                                                                    | `AUTH_REFRESH_TTL_DAYS`                             |
| Q-SESS-6 (sliding expiry)            | Idle expiry slides on activity; the absolute lifetime does not. `last_seen_at` is written at most once a minute so tracking is not a write per request.         | `AUTH_SESSION_ACTIVITY_WRITE_SECONDS`               |
| Q-SESS-8 (device info)               | Shown, coarsely — browser and platform only, not the raw user agent.                                                                                            | `describeDevice`                                    |
| Q-SESS-9 (revoke own device)         | **Yes**, plus "sign out everywhere else", which spares the acting session.                                                                                      | `DELETE /auth/sessions/:id`, `.../revoke-all`       |
| Q-SESS-10 / Q-SESS-11 (admin revoke) | **Yes**, behind the new `sessions.revoke` permission. A Branch Admin is confined to their own branch; a Super Admin is organization-wide. Never across tenants. | `SessionManagementService.revokeUserSession`        |
| Q-SESS-16 (inactive account)         | Enforced at the session layer: any event that revokes a session takes effect on that session's very next request.                                               | `JwtAuthGuard`, `SessionService.validateForRequest` |
| Session state storage                | Derived from `revoked_at` / `revoked_reason` / `expires_at` rather than stored in a `status` column, so state cannot drift from the timestamps that decide it.  | `deriveSessionState`                                |
| Offline logout (Scenarios 30–32)     | **Not implemented.** Offline semantics are undefined by the source and belong with the Field-Employee-GPS-Check-in story.                                       | —                                                   |
| Q-AUDIT-1 (audit retention)          | **Configurable, and audit logs are protected.** Module 17 adds `RetentionPolicy` with a per-category policy. `AUDIT_LOG` is immutable evidence (Rule 76): its retention and archival can be described, but it can never carry a purge schedule, in the DTO, the service and a CHECK constraint. No purge runs anywhere yet — `retention.purge.run` is granted to no seeded role. | `RetentionPolicyService`                            |

## Defaults applied by the Password Recovery implementation

The LMS diagrams contain **no Forgot Password flow at all**, so every value
below is an applied default rather than a source-derived requirement. All are
environment-driven; see `apps/api/src/config/auth.config.ts`.

| Question                          | Applied default                                                                                                                                 | Where                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Q-REC-1 / Q-REC-2 (mechanism)     | SMS OTP, used only for recovery. Delivered via **Twilio**, chosen per organization in `sms_provider_configs`; credentials stay in env.          | `apps/api/src/sms/`                                        |
| Q-REC-3 / Q-REC-4 / Q-REC-5 (OTP) | 6 digits, 10-minute lifetime, 5 verification attempts.                                                                                          | `AUTH_RECOVERY_OTP_*`                                      |
| Q-REC-6 (resend)                  | 60-second cooldown, at most 3 resends per request.                                                                                              | `AUTH_RECOVERY_RESEND_COOLDOWN_SECONDS`                    |
| Q-REC-8 / Q-REC-9 (concurrency)   | A new request cancels all prior unconsumed ones, so one authorization is live per user.                                                         | `RecoveryService.requestRecovery`                          |
| Q-REC-10 (token)                  | OTP hashed argon2id (low entropy needs a work factor); reset token 32 random bytes stored SHA-256 (256 bits needs none).                        | `PasswordRecoveryRequest`                                  |
| Q-REC-11 (inactive)               | `INACTIVE`/`SUSPENDED` are a silent no-op — no code sent, generic response, no account change.                                                  | `RecoveryService.requestRecovery`                          |
| Q-REC-12 / Q-REC-13 (locked)      | A `LOCKED` account may recover; the reset leaves `status`, `lockedUntil` and `failedLoginAttempts` untouched. Reset is not a lock bypass.       | `RecoveryService.resetPassword`                            |
| Q-REC-14 / Q-REC-16 / Q-REC-18    | The authorization is consumed, every session revoked, and no session issued — the user signs in again.                                          | `SessionService.revokeAllForUser`                          |
| Q-REC-15 (post-reset navigation)  | Success screen at `/reset-password/done` with a link to Sign In.                                                                                | `(auth)/reset-password/done`                               |
| Q-REC-17 (rate limiting)          | 5 requests/min and 10 verifies/min per IP, plus the per-account cooldown above. Both configurable.                                              | `ThrottlerModule.forRootAsync`, `AUTH_RECOVERY_RATE_LIMIT` |
| Q-AUTH-11 (enumeration parity)    | Every Forgot Password outcome returns an identical 202 body; ineligible branches still spend an argon2 verification so timing does not diverge. | `RecoveryService`, `AuthController`                        |

**SMS delivery:** Twilio, selected **per organization** in
`sms_provider_configs`. An organization with no row, or a disabled one, falls
back to the `SMS_PROVIDER` environment value and then to `console`, so one
deployment can serve organizations on different gateways and an unconfigured
organization behaves exactly as it did before the table existed.

Credentials are deliberately **environment-only**. The database records _which_
gateway an organization uses and _how to address it_ (Messaging Service SID,
from-number, country code); `TWILIO_AUTH_TOKEN` never enters the schema. This
matches the existing rule that `AUTH_JWT_SECRET` is env-only and that refresh
tokens, reset tokens and OTPs are stored only as hashes — a plaintext Twilio
token would otherwise be the one live, replayable credential in the database,
and read access to that table would become the ability to spend money.

Open items for production, none of which block the current implementation:

- **Trial account** — every recipient must first be added under Twilio Console →
  Phone Numbers → Verified Caller IDs, or sends fail with code `21608`.
- **India DLT** — OTP traffic is generally exempt from DLT template
  registration, but a registered sender ID is still recommended for
  deliverability. Prefer a Messaging Service SID over a bare from-number.
- **Credential scope** — one Twilio account serves every organization. If
  tenants ever need their own accounts, that requires encrypted per-org
  credentials and a key-rotation story; the table is shaped so such a column can
  be added without touching callers.

Q-REC-7, 19, 20 and 21 remain OPEN: they concern link-based recovery, offline
behaviour and the Change-Password story, none of which this implementation
covers.

**Known deviation:** when the submitted Organization Code matches no
organization, no `orgId` exists and `audit_logs` cannot accept a row (`org_id`
is part of its primary key _and_ a foreign key). Those attempts are written to
the application log as `AUTH_LOGIN_UNKNOWN_ORG` instead. This is a deliberate
gap in "every attempt is audit logged" and needs a product decision — the
alternative is a nullable-organization security-event table.

## Defaults applied by the GPS Check-in implementation

The Field Employee diagram shows only the success path —
`Field Employee Login → Network Available? → Online → GPS Check-in → Location
Verified` — and never defines the failure branch, the accuracy threshold, the
geofence, the retry count or the storage model. Every value below is therefore
an applied default; all are environment-driven, see
`apps/api/src/config/field.config.ts`.

One thing is **not** treated as tunable: the direction of failure. No setting
can make a missing or unusable location verify. The story states that outright
(Rules 8, 9), so it lives in `gps-verification.ts` as a fixed rule.

| Question                              | Applied default                                                                                                                                                 | Where                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Q-GPS-1 (accuracy threshold)          | **100 metres.** Rejects a coarse cell-tower fix without failing an employee standing inside a customer's house. `0` disables the rule.                          | `FIELD_GPS_MAX_ACCURACY_METERS`      |
| Q-GPS-2 / Q-GPS-3 (geofence)          | **No geofence.** Any position passing the accuracy rule verifies. Branch coordinates are not modelled, so a radius rule has nothing to measure from.            | —                                    |
| Q-GPS-4 (permission prompt)           | Requested on an explicit button press, never auto-prompted on mount.                                                                                            | `GpsCheckInPanel`                    |
| Q-GPS-5 / Q-GPS-6 (retries)           | **Unlimited**, from the same screen. No server-side attempt cap; the endpoint throttle (20/min) is the only bound.                                              | `GpsCheckInPanel`, `@Throttle`       |
| Q-GPS-7 (timeout)                     | **30 seconds**, enforced by the browser. The server only records the failure the device reports.                                                                | `FIELD_GPS_TIMEOUT_SECONDS`          |
| Q-GPS-8 / Q-GPS-9 (after failure)     | **Blocked.** No verified check-in means no field operations, and a GPS failure while online does not unlock Offline Mode.                                       | `requireVerifiedCheckIn`             |
| Q-GPS-10 (stale location)             | Not accepted. `maximumAge: 0` client-side, and the server rejects a device timestamp older than **120 seconds**.                                                | `FIELD_GPS_MAX_LOCATION_AGE_SECONDS` |
| Q-GPS-11 / Q-GPS-12 (clock authority) | **Server clock is authoritative** for `verified_at`. The device timestamp is stored as reported and judged for freshness; forward skew beyond 60s is rejected.  | `FIELD_GPS_MAX_CLOCK_SKEW_SECONDS`   |
| Q-GPS-13 (coordinate storage)         | Stored permanently, `Decimal(10,7)`, matching `FieldVisit`. Coordinates are **not** copied into `audit_logs`.                                                   | `gps_check_ins`                      |
| Q-GPS-14 (who may view history)       | Own history always; another user's needs `field.checkin.view`. A Branch Admin is confined to their branch, a Super Admin is organization-wide, never cross-org. | `GpsCheckInService.listHistory`      |
| Q-GPS-15 (continuous tracking)        | **Check-in only.** No background or periodic location capture.                                                                                                  | —                                    |
| Q-GPS-16 (mid-flow network loss)      | Recorded `FAILED` with reason `NETWORK_LOST`. Never `VERIFIED`, and never silently retried.                                                                     | `evaluateLocation`                   |
| Q-GPS-17 (GPS while offline)          | **Not captured.** Offline Mode makes no location attempt.                                                                                                       | `OfflineModeNotice`                  |
| Q-GPS-18 (customer-location validity) | Out of scope — this story covers employee check-in only.                                                                                                        | —                                    |
| Q-GPS-19 (session-bound or durable)   | **Durable record** in `gps_check_ins`, carrying `session_id`. Every attempt persists, successes and failures alike.                                             | `GpsCheckIn`                         |
| Q-GPS-20 (session during failure)     | The session stays authenticated; only field operations are gated. A GPS failure is not a sign-out.                                                              | `requireVerifiedCheckIn`             |
| Check-in validity                     | **12 hours**, or until the session ends — whichever comes first. Verification is scoped to the session, so a new device needs a new check-in.                   | `FIELD_CHECKIN_VALIDITY_HOURS`       |
| Authorization                         | New `field.checkin` permission, seeded to `FIELD_EMPLOYEE` only. Admins hold `field.checkin.view` but **not** `field.checkin`.                                  | `seed.ts`, `PermissionsGuard`        |

**Idempotency (Q-OFF-7, partial):** a client-minted `client_attempt_id`, unique
per organization, makes a repeated submit return the original outcome rather
than creating a second authoritative check-in. A _retry_ uses a fresh id, so it
becomes its own record — which is what keeps an earlier failure from being
rewritten as a success (Scenarios 13-15). This answers the idempotency question
for check-in events specifically; the broader sync-conflict questions stay open.

## Defaults applied by the Customers & KYC implementation

The source defines the customer journey and names Branch Admin as the KYC
approval authority, but leaves 50 questions open — the status dictionaries, the
duplicate rules, the conversion authority and the deactivation lifecycle among
them. Every value below is an applied default recorded in §15; the decisions that
shaped the code, rather than the full list, are explained here.

Two rules are **not** treated as tunable, because the story states them outright:

- A KYC customer cannot become ACTIVE without an approval (Rules 6, 9). No
  configuration makes an unapproved customer active.
- A LOCAL customer skips KYC but not the loan lifecycle (Rules 13, 14). Customer
  type is therefore never consulted outside this module.

| Question                                | Applied default                                                                                                                                                                                      | Where                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Q-CUST-1 / Q-CUST-2 (status dictionary) | The enums already in the schema. Revision lives **only** in `KycStatus`; a LOCAL customer has no `CustomerKyc` row rather than a `NOT_REQUIRED` one, so "has KYC" is a row test, not a value test.   | `schema.prisma`                        |
| Q-CUST-3 (required documents)           | `ID`, `ADDRESS`, `PHOTO`, checked at **approval**, not upload. Uploading one document at a time must not be an error.                                                                                | `KycService.approve`                   |
| Q-CUST-4 / Q-CUST-5 (duplicates)        | A soft flag on `(orgId, mobile)`. Create refuses once with `duplicateOf`, then proceeds if the caller passes `force`. Shared household numbers are real; silent duplicates are not acceptable.       | `CustomerService.create`               |
| Q-CUST-8 / Q-CUST-9 (maker-checker)     | **Not enforced.** A one-admin branch must still be able to onboard. The approving actor is audited, so a separation policy can be added later without a data migration.                              | `KycService.approve`                   |
| Q-CUST-13 (deletion)                    | Physical delete only at zero dependencies, else 409 + `blockedBy`. Identical in shape to the Module 03 user delete guard; in practice a customer with any loan is undeletable.                       | `customer-dependencies.ts`             |
| Q-CUST-16 (file validation)             | 5 MB, and the type is decided by **magic bytes**. A client-supplied `Content-Type` is an assertion by the uploader, not evidence.                                                                    | `LocalFileStorage`                     |
| Q-CUST-21 (masking)                     | Mobile masked in list responses, full on detail. A search screen is the wide surface; it should not be a bulk PII export.                                                                            | `toSummary` / `toDetail`               |
| Q-CUST-22 (concurrency)                 | Optimistic via `expectedVersion` (`updatedAt`). A mismatch is a 409 — the losing edit is refused rather than silently overwriting a committed change (Scenarios 40, 41).                             | `CustomerService.update`, `KycService` |
| Q-CUST-28 (mobile change)               | For a LOCAL customer, changing the number clears `mobileVerifiedAt` and returns an ACTIVE customer to PENDING. The verification attaches to the number, not to the customer.                         | `CustomerService.update`               |
| Q-CUST-29 (re-KYC on edit)              | No edit triggers re-KYC in this pass. Before/after snapshots are audited so a reviewer can see exactly what changed.                                                                                 | `AuditService`                         |
| Document access                         | No file is ever reachable by URL. Every read goes through an endpoint that re-checks org + branch scope and audits the access (Scenarios 12, 32). **No static file serving is added.**               | `DocumentController.download`          |
| LOCAL mobile verification               | A real OTP through the existing `SmsService`, reusing the hashing and expiry shape of password recovery. A LOCAL customer cannot reach ACTIVE with `mobileVerifiedAt` null (Scenario 14).            | `CustomerMobileService`                |
| Authorization                           | 14 new `customers.*` codes. Branch Admin gets read, create, update, activate, KYC and documents — but **not** `customers.delete` or `customers.convert`, so Scenarios 23 and 29 have a real refusal. | `permission-catalog.ts`, `seed.ts`     |

**Scope enforcement (Scenarios 19, 21, 30, 31):** no DTO in this module accepts
`orgId` or `branchId`. Both come from the JWT, and the global validation pipe's
`forbidNonWhitelisted` turns a client attempt to supply either into a 400 — which
is Scenario 31 enforced by configuration rather than by a hand-written check.
Out-of-scope, cross-tenant and absent customers all return one opaque
`Customer not found`, so a 404 never confirms that an id exists.

**Known deviation — Offline Mode is detection only.** The source flow continues
`Offline Mode → Load Cached Data → Customer List`, but offline caching and
synchronization are not implemented: `Q-OFF-1..15` are all still `OPEN`, and
building them would mean inventing answers to fifteen unresolved questions.

The consequence is that Scenario 19 (load cached data) and Scenarios 36-37
(synchronization conflict) are **not** satisfied. What is satisfied is the part
that matters for correctness: the system detects the offline state, says plainly
that cached data is unavailable, and refuses to fabricate records or to present
anything as server-confirmed (Rules 18, 19, Scenario 20). An empty customer list
would have been the dishonest option — "you have no customers" is a different
claim from "we cannot reach your customers".

`Q-GPS-16` is likewise only half-answered: a network loss detected _before_ the
request is recorded as `NETWORK_LOST`, but a loss mid-request leaves no row at
all, because the request never arrives. The `PENDING` state exists in the schema
for that case and nothing writes it yet.

**Unused audit action:** `FIELD_CHECKIN_DENIED_PERMISSION` is declared but never
emitted — `PermissionsGuard` rejects a caller lacking `field.checkin` before the
service runs, so there is no point at which the service could record it. It is
retained because a future in-service authorization check would need it, and
because its absence from the log is itself meaningful: a permission denial today
appears as a 403 with no `GPS_CHECK_IN` audit row.

## Defaults applied by the Guarantors implementation

The source establishes **Guarantor Added → Guarantor KYC & Consent → Loan
Application** in the customer journey and marks Guarantor Name, Mobile, Address,
Relationship, Consent and KYC Documents on the wireframe — then leaves 76
questions open, including the duplicate key, the consent mechanism, the required
document set and whether one guarantor may stand for several customers. Every
value below is an applied default recorded in §16.

A CRUD-and-consent core already existed, built as part of Module 04. Module 05
added the lifecycle, KYC, delete safeguards, concurrency, duplicate detection,
the standalone directory and the readiness gate around it.

Three rules are **not** treated as tunable, because the story states them
outright:

- Guarantor KYC is separate from borrower KYC (Rule 18, Scenario 22). No
  configuration lets one approve the other.
- Consent is never inferred from a guarantor record existing (Rule 22,
  Scenario 18).
- Deactivation never detaches a historical loan relationship (Rules 35, 38).

| Question                                      | Applied default                                                                                                                                                                                                    | Where                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Q-GUAR-1..3 (shared guarantor)                | A guarantor is a child of exactly **one** customer. The same person standing for two customers is two rows, each with its own consent, KYC and authorization context (Rule 46). No merge, no shared-person entity. | `schema.prisma`                            |
| Q-GUAR-4 / Q-GUAR-5 (duplicates)              | A soft flag on `(orgId, customerId, mobile)` with a `force` override, the same shape as Q-CUST-4. No unique constraint: the source leaves the duplicate key undefined, and a hard rule cannot be overridden.       | `GuarantorService.create`                  |
| Q-GUAR-6 (address mandatory)                  | **Always required**, unlike the customer's. Rule 13 and the Scenario 9 outline both name it; a conditional rule would need the loan product that decides when a guarantor is required at all.                      | `create-guarantor.dto.ts`                  |
| Q-GUAR-7 / Q-GUAR-8 (relationship)            | Free text, optional. The source names the field and refuses to enumerate values; inventing an enum is a migration to undo later.                                                                                   | `schema.prisma`                            |
| Q-GUAR-9 / Q-GUAR-10 (required documents)     | `ID` + `ADDRESS`. **`PHOTO` is accepted but never demanded** — the source never says a guarantor photo is required, and requiring one would block every approval on a document nobody agreed to collect.           | `REQUIRED_GUARANTOR_KYC_DOCUMENTS`         |
| Q-GUAR-11 (is KYC required)                   | Product-dependent, so `kycStatus` defaults to `NOT_REQUIRED` and the readiness evaluator returns `required: null`. Defaulting to `PENDING` would put every guarantor ever created into a review queue.             | `GuarantorKycService`, `evaluateReadiness` |
| Q-GUAR-12..14 (who reviews, maker-checker)    | A dedicated `customers.guarantors.kyc.review`, seeded to Branch Admin and kept separate from `customers.kyc.approve` so a different authority is a seed change. No maker-checker, per Q-CUST-9.                    | `permission-catalog.ts`, `seed.ts`         |
| Q-GUAR-15..17 (consent mechanism, revocation) | Staff-recorded status plus a **server** timestamp and actor (Rule 23). No OTP or e-sign. Revocation is expressible as `REJECTED` after `GIVEN`; no fourth enum value is added for a rule nobody has stated.        | `GuarantorService.recordConsent`           |
| Q-GUAR-39..44 (edits, re-consent, re-KYC)     | Changing the mobile resets consent to `PENDING` — the person who agreed may not be the person now recorded. **No** edit forces re-KYC (Q-GUAR-42 is unanswered); before/after is audited instead, as in Q-CUST-29. | `GuarantorService.update`                  |
| Q-GUAR-45..48 (cross-branch / branch move)    | Prohibited. `Guarantor` has **no `branchId` column**: scope reads through `customer.branchId`, so a customer changing branch carries their guarantors and Rule 10 holds by construction rather than by a check.    | `GuarantorDirectoryService.branchScope`    |
| Q-GUAR-51..53 (deletion)                      | Physical delete only at zero `LoanGuarantor` references, else 200 with `deleted: false` + `blockedBy` and a "deactivate instead" hint. Same shape as the customer delete guard.                                    | `guarantor-dependencies.ts`                |
| Q-GUAR-61 / Q-GUAR-62 (standalone screens)    | GUA-001 and GUA-002 are **built, read-only**, org-scoped, on the previously-unused `customers.guarantors.view`. Every mutation stays nested under the customer so the relationship is never client-supplied.       | `(admin)/guarantors/`                      |
| Q-GUAR-63 / Q-GUAR-65 (search, masking)       | One box over guarantor name (contains), mobile (prefix) and customer name/code. Mobile masked on the list, full on detail: a directory is a browsing surface, not a bulk PII export.                               | `GuarantorDirectoryService.list`           |
| Q-GUAR-67 (concurrency)                       | Optimistic via `expectedVersion` = `updatedAt.toISOString()`, identical to Q-CUST-22. **No `Int version` column** — a second concurrency idiom in one module is how the two drift apart.                           | `GuarantorService.assertVersion`           |
| Authorization                                 | 6 new codes on top of the existing two. Branch Admin gets the whole surface **except `customers.guarantors.delete`**, so Scenario 40 has an account that reaches the screen and is refused.                        | `permission-catalog.ts`, `seed.ts`         |

**The withheld delete grant is load-bearing.** Branch Admin holds
`customers.guarantors.deactivate` and every document and KYC code, but not
`.delete`. That omission is what gives Scenario 40 a real refusal, exactly as
`customers.delete` does for Scenario 23 — granting it would silently make the
scenario unprovable. The e2e suite asserts the 403 directly.

**Known deviation — offline guarantor sync is not implemented.** Scenarios 48-50
describe cached guarantor data, offline scope enforcement and stale-update
conflict handling. None is built: offline remains detection-only across this
codebase (`Q-OFF-1..15` are still `OPEN`), and Module 05's own source says
offline guarantor editing is undefined. Nothing presents guarantor data as
server-confirmed when it is not, which is the part that matters for correctness.

**The loan gate answers half a question by design.** `GET
/customers/:id/guarantors/readiness` reports whether the guarantors that exist
are usable — active, consented, KYC approved or not required. It never reports
whether one was _needed_: that is a loan-product rule (Rule 3), and Module 07
will supply it. A customer with no guarantors is therefore `satisfied: true`,
which is Scenarios 7 and 43 — the absence of a guarantor is only a problem if
something required one.

**How to use:**

1. Work through one theme at a time (themes are grouped below, not per-file).
2. When a question is answered, record the decision in the **Decision** column,
   set Status to `DECIDED`, and update the owning story file's rules section.
3. Anything still `OPEN` when a story reaches development is handled per
   [PROMPT-DEVELOPMENT.md](PROMPT-DEVELOPMENT.md) — apply a documented default,
   never a silent guess.

**Sources scanned:**

| Source file                                                                                                                                    | Questions |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| [Sign-In.md](user-stories/01%20-%20Authentication%20&%20Session%20Management/Sign-In.md)                                                       |        25 |
| [Signup.md](user-stories/01%20-%20Authentication%20&%20Session%20Management/Signup.md)                                                         |        32 |
| [Forgot-Password.md](user-stories/01%20-%20Authentication%20&%20Session%20Management/Forgot-Password.md)                                       |        26 |
| [Reset-Password.md](user-stories/01%20-%20Authentication%20&%20Session%20Management/Reset-Password.md)                                         |        25 |
| [Change-Password.md](user-stories/01%20-%20Authentication%20&%20Session%20Management/Change-Password.md)                                       |        22 |
| [Active-Sessions-Session-Management.md](user-stories/01%20-%20Authentication%20&%20Session%20Management/Active-Sessions-Session-Management.md) |        32 |
| [Field-Employee-GPS-Check-in.md](user-stories/01%20-%20Authentication%20&%20Session%20Management/Field-Employee-GPS-Check-in.md)               |        26 |
| [Organizations-and-Branches.md](user-stories/02%20-%20Organizations%20&%20Branches/Organizations-and-Branches.md)                              |        28 |
| [Users-Employees-Roles-Permissions.md](user-stories/03%20-%20Users,%20Roles%20&%20Permissions/Users-Employees-Roles-Permissions.md)            |        45 |
| [LMS-Module-4-Customer-Management-KYC.md](user-stories/04%20-%20Customers%20&%20KYC/LMS-Module-4-Customer-Management-KYC.md)                   |        50 |
| [LMS-Module-5-Guarantors.md](user-stories/05%20-%20Guarantors/LMS-Module-5-Guarantors.md)                                                      |        76 |
| [LMS-Module-7-Loan-Applications.md](user-stories/07%20-%20Loan%20Applications/LMS-Module-7-Loan-Applications.md)                               |       200 |
| [NFR.md](_shared/NFR.md)                                                                                                                       |        44 |
| [State-Machines.md](_shared/State-Machines.md)                                                                                                 |        38 |
| **Total**                                                                                                                                      |   **669** |

**ID convention:** `Q-<THEME>-<n>`. Themes: `PWD` password policy · `SESS` session
& token · `AUTH` identity & sign-in · `ACT` account activation · `REC` password
recovery · `GPS` location · `OFF` offline & sync · `ORG` organization & branch ·
`RBAC` users/roles/permissions · `NOTIF` notification · `AUDIT` audit & retention ·
`NFR` non-functional · `DOM` domain state machines · `SRC` source gaps ·
`CUST` customers & KYC · `GUAR` guarantors · `LOAN` loan products & schemes ·
`APP` loan applications · `EMI` repayment calculation.

---

## Defaults applied by the Loan Products & Applications implementation

The source defines the six-step application screen, the review flow and the
unified `REJECTED` outcome — then leaves 200 questions open, including every EMI
formula, the rounding rule, the required document set per product, the approval
authority and the whole concurrency policy. Every value below is an applied
default recorded in §17 and §18.

Module 06 was built as a **minimal slice** to unblock this: products, schemes and
duration options only. Interest configuration, penalty rules and charges are
untouched, because `LoanApplication` needs a scheme to point at and nothing more.

Four rules are **not** treated as tunable, because the story states them
outright:

- Approval is not disbursement (Rules 42, 47, 48; Scenario 30). Nothing in the
  approve path writes a loan, a disbursement or a ledger line.
- A submitted application is never destructible (Rules 56, 57; Scenario 34).
- Rejection carries a reason, always (Rules 39, 40; Scenario 27).
- A scheme's terms are copied onto an application at creation, so repricing a
  scheme never moves an existing application (Rules 69, 70; Scenario 39).

| Question                                     | Applied default                                                                                                                                                                                                                                                                    | Where                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Q-APP-1..5 (canonical statuses)              | Six reachable: `DRAFT`, `SUBMITTED`, `UNDER_REVIEW`, `MORE_INFO_REQUIRED`, `APPROVED`, `REJECTED`. The enum's remaining seven (`SANCTIONED` onward) are never written — sanction belongs to a later module.                                                                        | `ApplicationStatus`, `LoanApplicationReviewService` |
| Q-APP-2 (is DRAFT persisted)                 | **Yes**, but only once steps 1-3 are complete. `LoanApplication` has nine non-null columns; making them nullable for a half-empty draft would force every later reader to null-check what is always populated (D-APP-1).                                                           | `ApplicationWizard`, `createLoanApplicationSchema`  |
| Q-APP-6..12 (approval authority)             | `loans.approve`, the code Module 01 already seeded, reused rather than duplicated. Withheld from Branch Admin so Scenario 28's denial is provable. **No maker-checker**, per Q-CUST-9 and Q-GUAR-14.                                                                               | `permission-catalog.ts`, `seed.ts`                  |
| Q-APP-25..27 (reopen a decided application)  | Not possible. `APPROVED` and `REJECTED` have no outgoing transition, so Rules 85 and 86 are structural rather than a status check that could be forgotten.                                                                                                                         | `LoanApplicationReviewService.transition`           |
| Q-APP-52..54 (EMI formula, rounding)         | FLAT = simple interest on the original principal; REDUCING = standard amortization; **`CUSTOM_RATE` is not a third formula** — it amortizes as REDUCING and differs only in provenance (D-EMI-1). Floor at every division; all residue to the final instalment (D-EMI-2, D-EMI-3). | `packages/emi`                                      |
| Q-APP-59..60 (due dates)                     | DATE-only `YYYY-MM-DD` in Asia/Kolkata, computed from `{year, month, day}` integers so no timezone conversion ever runs. Month-end clamped; first due is one full period after the anchor (D-EMI-5).                                                                               | `packages/emi/src/dates.ts`                         |
| Q-APP-61..63 (required documents)            | `ID` + `INCOME` always; `COLLATERAL` additionally for `GOLD` and `VEHICLE`. The source names the three categories but never says which apply to which product (D-APP-3).                                                                                                           | `requiredDocumentTypes`                             |
| Q-APP-95..96 (is a guarantor required)       | **Not required by default.** `GuarantorService` answers "are the guarantors that exist usable"; this module supplies the other half and the source never says one is needed, so absence never blocks (D-APP-2).                                                                    | `LoanApplicationCompletenessService`                |
| Q-APP-107..110 (ID format, idempotency)      | Server-allocated `APP-000001` upward, numeric maximum per organization — never a lexical sort, which is the bug that already bit customer codes once. No `Idempotency-Key`: the source does not require one for non-money endpoints.                                               | `nextApplicationNumber`                             |
| Q-APP-119..123 (concurrency)                 | Optimistic, on `updatedAt`. Lifecycle transitions additionally put both `status` and `updatedAt` in an `updateMany` WHERE clause, because a read-then-write check cannot stop a concurrent approve/reject (Scenario 52).                                                           | `LoanApplicationReviewService.transition`           |
| Q-APP-157 (verified or merely uploaded)      | **Uploaded** is enough to submit — a branch cannot review its own submission before making it. Verification is a reviewer's separate act, and whether approval should demand it is left to their judgement.                                                                        | `missingDocuments`                                  |
| Q-APP-165..168 (approved ≠ requested amount) | Not supported. `Modify Terms` adjusts rate, frequency and duration only; changing the amount is a different application, and the source never defines how a reduced sanction is recorded.                                                                                          | `modifyTermsSchema`                                 |
| Q-LOAN-1 (who owns configuration)            | Super Admin alone. Branch Admin holds `loans.products.view` and `loans.schemes.view` and no write — not the usual withheld-grant trick, but because the source is explicit that Branch Admin is not a configuration owner.                                                         | `seed.ts`                                           |
| Q-LOAN-2 (when is a scheme selectable)       | Three conditions, all required: the scheme is ACTIVE, its product is ACTIVE, and it carries at least one ACTIVE duration option. Activation is refused without the third, so a scheme that fails every application cannot go live.                                                 | `LoanSchemeService.assertSelectable`                |

---

## 1. Password Policy (`Q-PWD-*`)

Appears in Sign-In, Signup, Reset-Password, Change-Password, Forgot-Password —
**answer once, apply everywhere.**

| ID       | Question                                                                                                     | Raised in                                          | Status          | Decision |
| -------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | --------------- | -------- |
| Q-PWD-1  | Exact minimum password length?                                                                               | Sign-In 8, Signup 15, Reset 8, Change 1, Forgot 16 | DEFAULT-APPLIED |          |
| Q-PWD-2  | Maximum permitted password length?                                                                           | Reset 10, Change 3                                 | DEFAULT-APPLIED |          |
| Q-PWD-3  | Which character classes are mandatory (upper/lower/numeric/special)?                                         | Sign-In 9, Signup 16, Reset 9, Change 2            | DEFAULT-APPLIED |          |
| Q-PWD-4  | How many previous passwords must be rejected (history depth)?                                                | Sign-In 10, Reset 11, Change 4, Forgot 14          | DEFAULT-APPLIED |          |
| Q-PWD-5  | Does the LMS require periodic password expiration?                                                           | Sign-In 11, Reset 12, Change 5, Forgot 15          | OPEN            |          |
| Q-PWD-6  | If expiry exists, how many days before expiry is the user warned?                                            | Sign-In 12                                         | OPEN            |          |
| Q-PWD-7  | Should commonly compromised passwords be rejected?                                                           | Reset 13, Change 6                                 | DEFAULT-APPLIED |          |
| Q-PWD-8  | Must the password be prohibited from containing the registered mobile number?                                | Signup 18, Reset 14, Change 7                      | DEFAULT-APPLIED |          |
| Q-PWD-9  | Which approved password-hashing algorithm and parameters are standardized?                                   | Sign-In 21, Signup 17                              | DEFAULT-APPLIED |          |
| Q-PWD-10 | Where do exact password create/reset/change rules live — auth module referenced, not duplicated in Module 3? | RBAC 39                                            | OPEN            |          |

## 2. Identity & Sign-In (`Q-AUTH-*`)

| ID        | Question                                                                                | Raised in                       | Status          | Decision |
| --------- | --------------------------------------------------------------------------------------- | ------------------------------- | --------------- | -------- |
| Q-AUTH-1  | Store/authenticate mobile with explicit `+91`, or normalized 10-digit?                  | Sign-In 1, Signup 29, Forgot 17 | DEFAULT-APPLIED |          |
| Q-AUTH-2  | Mobile uniqueness scope: global / per organization / per branch?                        | Sign-In 2, Signup 28            | DEFAULT-APPLIED |          |
| Q-AUTH-3  | Is mobile the only login identifier, or are email/username also allowed?                | RBAC 2                          | OPEN            |          |
| Q-AUTH-4  | Exact maximum failed-login attempts for Branch Admin?                                   | Sign-In 3                       | DEFAULT-APPLIED |          |
| Q-AUTH-5  | How long does a Branch Admin account stay temporarily locked?                           | Sign-In 4                       | DEFAULT-APPLIED |          |
| Q-AUTH-6  | Does a successful login reset the failed-attempt counter immediately?                   | Sign-In 5                       | DEFAULT-APPLIED |          |
| Q-AUTH-7  | Does Super Admin use the same failed-attempt/lock mechanism?                            | Sign-In 6                       | DEFAULT-APPLIED |          |
| Q-AUTH-8  | Does Field Employee use the same lock policy?                                           | Sign-In 7                       | DEFAULT-APPLIED |          |
| Q-AUTH-9  | One generic auth error for all failures, or distinct messages for inactive/locked?      | Sign-In 17                      | DEFAULT-APPLIED |          |
| Q-AUTH-10 | Request-rate limit for repeated auth attempts per device/IP/mobile?                     | Sign-In 25                      | DEFAULT-APPLIED |          |
| Q-AUTH-11 | Should Forgot Password use the same account-enumeration protection as Sign In?          | Sign-In 24                      | OPEN            |          |
| Q-AUTH-12 | How many incorrect Current Password attempts are allowed on Change Password?            | Change 8                        | OPEN            |          |
| Q-AUTH-13 | Per-user/device/IP rate limits for Change Password?                                     | Change 9                        | OPEN            |          |
| Q-AUTH-14 | Should repeated failed password changes trigger account lock?                           | Change 21                       | OPEN            |          |
| Q-AUTH-15 | Can a locked account change its password via an already active session?                 | Change 13                       | OPEN            |          |
| Q-AUTH-16 | Can an inactive account with an existing session change its password?                   | Change 14                       | OPEN            |          |
| Q-AUTH-17 | Must a user who does not know the current password always be routed to Forgot Password? | Change 18                       | OPEN            |          |
| Q-AUTH-18 | Who can unlock a locked account?                                                        | RBAC 41                         | OPEN            |          |
| Q-AUTH-19 | Who can initiate account recovery for admins/employees?                                 | RBAC 40                         | OPEN            |          |

## 3. Account Activation / Signup (`Q-ACT-*`)

| ID       | Question                                                                              | Raised in          | Status | Decision |
| -------- | ------------------------------------------------------------------------------------- | ------------------ | ------ | -------- |
| Q-ACT-1  | How is the first Super Admin of a new organization provisioned?                       | Signup 1           | OPEN   |          |
| Q-ACT-2  | Who is authorized to create a new organization and its first Super Admin?             | Signup 2           | OPEN   |          |
| Q-ACT-3  | Activation token delivery channel — SMS, email, or both?                              | Signup 3           | OPEN   |          |
| Q-ACT-4  | Email is optional in Module 3 — can activation rely on it, or must it be mobile-only? | Signup 4           | OPEN   |          |
| Q-ACT-5  | Exact activation-token expiry period?                                                 | Signup 5           | OPEN   |          |
| Q-ACT-6  | Token format: URL-embedded opaque token, short numeric code, or both?                 | Signup 6           | OPEN   |          |
| Q-ACT-7  | Is a separate mobile verification code required in addition to the activation link?   | Signup 7           | OPEN   |          |
| Q-ACT-8  | Exact verification-code expiry window?                                                | Signup 8           | OPEN   |          |
| Q-ACT-9  | Maximum incorrect verification-code attempts before lockout?                          | Signup 9           | OPEN   |          |
| Q-ACT-10 | How many verification-code resends are permitted, over what window?                   | Signup 10          | OPEN   |          |
| Q-ACT-11 | Request-rate limit for activation attempts per device/IP/account?                     | Signup 11          | OPEN   |          |
| Q-ACT-12 | Should repeated failed activations lock the `PENDING` account, and for how long?      | Signup 12          | OPEN   |          |
| Q-ACT-13 | Is `PENDING` a confirmed required status in the final status dictionary?              | Signup 13, RBAC 3  | OPEN   |          |
| Q-ACT-14 | Should an unactivated `PENDING` account expire/auto-deactivate after a period?        | Signup 14          | OPEN   |          |
| Q-ACT-15 | Must the user accept terms of use / AUP during activation?                            | Signup 19          | OPEN   |          |
| Q-ACT-16 | Should activation collect additional profile fields, or strictly credential setup?    | Signup 20          | OPEN   |          |
| Q-ACT-17 | Should Field Employee activation bind the account to a specific device?               | Signup 21          | OPEN   |          |
| Q-ACT-18 | Can a Field Employee activate offline, or is online activation mandatory?             | Signup 22          | OPEN   |          |
| Q-ACT-19 | Does Field Employee activation require GPS check-in?                                  | Signup 23          | OPEN   |          |
| Q-ACT-20 | After activation: redirect to Sign In or auto sign-in?                                | Signup 24          | OPEN   |          |
| Q-ACT-21 | May administrators set a temporary password instead of using the activation flow?     | Signup 25          | OPEN   |          |
| Q-ACT-22 | Are bulk user imports with bulk activation-token issuance required?                   | Signup 26          | OPEN   |          |
| Q-ACT-23 | Is Signup the confirmed implementation of Module 3's invitation workflow?             | Signup 27, RBAC 38 | OPEN   |          |
| Q-ACT-24 | Should the creating administrator be notified when the user completes activation?     | Signup 30          | OPEN   |          |
| Q-ACT-25 | Should consumed activation tokens be retained for audit or purged?                    | Signup 32          | OPEN   |          |

## 4. Password Recovery — Forgot & Reset (`Q-REC-*`)

| ID       | Question                                                                                    | Raised in                      | Status          | Decision                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Q-REC-1  | Recovery mechanism: SMS OTP, SMS link, other token, or admin-assisted?                      | Forgot 1, Reset 1              | DEFAULT-APPLIED | SMS OTP delivered via **Twilio**, selected per organization in `sms_provider_configs`; `console` retained for dev/test. |
| Q-REC-2  | Should OTP be used _only_ for recovery (since normal auth is Mobile + Password)?            | Forgot 2                       | DEFAULT-APPLIED | Yes — OTP is used only for recovery. Normal auth stays Mobile + Password.                                               |
| Q-REC-3  | OTP length?                                                                                 | Forgot 3                       | DEFAULT-APPLIED | 6 digits (`AUTH_RECOVERY_OTP_LENGTH`).                                                                                  |
| Q-REC-4  | OTP validity duration?                                                                      | Forgot 4                       | DEFAULT-APPLIED | 10 minutes (`AUTH_RECOVERY_OTP_TTL_MINUTES`).                                                                           |
| Q-REC-5  | Maximum incorrect OTP attempts?                                                             | Forgot 5                       | DEFAULT-APPLIED | 5 attempts, then the request is retired (`AUTH_RECOVERY_MAX_OTP_ATTEMPTS`).                                             |
| Q-REC-6  | Resend count and cooldown?                                                                  | Forgot 6                       | DEFAULT-APPLIED | 60s cooldown, max 3 resends per request.                                                                                |
| Q-REC-7  | Recovery-link expiry duration?                                                              | Forgot 7, Reset 3              | OPEN            |                                                                                                                         |
| Q-REC-8  | Does issuing a new recovery authorization invalidate all previous ones?                     | Forgot 8, Reset 4              | DEFAULT-APPLIED | Yes — a new request CANCELs all prior unconsumed ones.                                                                  |
| Q-REC-9  | Should only one active recovery request exist per user?                                     | Forgot 9                       | DEFAULT-APPLIED | Yes — at most one live request per user, enforced by Q-REC-8.                                                           |
| Q-REC-10 | If token-based, what token format and entropy standard?                                     | Reset 2                        | DEFAULT-APPLIED | 32 random bytes base64url, stored SHA-256. OTP stored argon2id.                                                         |
| Q-REC-11 | Can an `INACTIVE` account reset its password, or is recovery rejected?                      | Forgot 10, Reset 5             | DEFAULT-APPLIED | No. INACTIVE/SUSPENDED are a silent no-op: no OTP, generic response.                                                    |
| Q-REC-12 | Can a `LOCKED` account reset its password while remaining locked?                           | Forgot 11, Reset 6             | DEFAULT-APPLIED | Yes — a LOCKED account may reset and remains LOCKED.                                                                    |
| Q-REC-13 | Does a successful reset clear a temporary lock, or leave it untouched?                      | Forgot 12, Reset 7             | DEFAULT-APPLIED | Untouched. Reset never clears `status`, `lockedUntil` or `failedLoginAttempts`.                                         |
| Q-REC-14 | Should the recovery session itself be invalidated immediately after reset?                  | Reset 16                       | DEFAULT-APPLIED | Yes — the authorization is consumed and every session revoked.                                                          |
| Q-REC-15 | Post-reset navigation: straight to Sign In, or success screen first?                        | Reset 17                       | DEFAULT-APPLIED | Success screen at `/reset-password/done`, then a link to Sign In.                                                       |
| Q-REC-16 | Should a successful reset auto-authenticate the user?                                       | Reset 18                       | DEFAULT-APPLIED | No. The user must sign in again with the new password.                                                                  |
| Q-REC-17 | Exact per-mobile, per-IP/device and org-level recovery-request rate limits?                 | Forgot 22                      | DEFAULT-APPLIED | Per-IP 5/min request, 10/min verify+reset; per-account cooldown in `RecoveryService`.                                   |
| Q-REC-18 | Should a successful reset trigger forced reauthentication on all devices?                   | Forgot 25                      | DEFAULT-APPLIED | Yes — `revokeAllForUser(..., 'PASSWORD_RESET')` after a successful reset.                                               |
| Q-REC-19 | Should Field Employees be blocked from — or shown a hidden — Forgot Password while offline? | Forgot 23, Reset 22, Change 19 | OPEN            |                                                                                                                         |
| Q-REC-20 | Post-change navigation: stay logged in, redirect to Sign In, or success screen?             | Change 12                      | OPEN            |                                                                                                                         |
| Q-REC-21 | Is changing the mobile number a separate Module 3 account-management feature?               | Change 17                      | OPEN            |                                                                                                                         |

## 5. Session, Token & Logout (`Q-SESS-*`)

| ID        | Question                                                                                  | Raised in                          | Status          | Decision |
| --------- | ----------------------------------------------------------------------------------------- | ---------------------------------- | --------------- | -------- |
| Q-SESS-1  | Does the LMS need a visible Active Sessions list, or only current session + Logout?       | Sessions 1                         | RESOLVED        |          |
| Q-SESS-2  | How many simultaneous sessions may one user have?                                         | Sessions 2, Sign-In 13             | DEFAULT-APPLIED |          |
| Q-SESS-3  | On limit reached, revoke oldest / newest / user-selected session?                         | Sessions 3                         | OPEN            |          |
| Q-SESS-4  | Exact idle/inactivity timeout?                                                            | Sessions 4, Sign-In 14             | DEFAULT-APPLIED |          |
| Q-SESS-5  | Maximum absolute session lifetime regardless of activity?                                 | Sessions 5, Sign-In 15             | DEFAULT-APPLIED |          |
| Q-SESS-6  | Does active use extend the session expiry (sliding expiry)?                               | Sessions 6                         | DEFAULT-APPLIED |          |
| Q-SESS-7  | Support persistent sessions across browser restarts ("remember device")?                  | Sessions 7, Sign-In 16             | OPEN            |          |
| Q-SESS-8  | Should users see device/browser info for active sessions?                                 | Sessions 8                         | RESOLVED        |          |
| Q-SESS-9  | Can a user revoke another device/session remotely?                                        | Sessions 9                         | RESOLVED        |          |
| Q-SESS-10 | Can Super Admin revoke any user's session?                                                | Sessions 10                        | RESOLVED        |          |
| Q-SESS-11 | Can Branch Admin revoke Field Employee sessions within its branch?                        | Sessions 11                        | RESOLVED        |          |
| Q-SESS-12 | Revoke all other sessions after Change Password?                                          | Sessions 12, Change 10, Sign-In 22 | OPEN            |          |
| Q-SESS-13 | Should the current session survive its own password change?                               | Change 11                          | OPEN            |          |
| Q-SESS-14 | Revoke all sessions after Reset Password?                                                 | Sessions 13, Reset 15, Forgot 13   | OPEN            |          |
| Q-SESS-15 | On reset, revoke _all_ sessions or only those created before the reset?                   | Reset 24                           | OPEN            |          |
| Q-SESS-16 | Revoke all sessions immediately when an account becomes inactive?                         | Sessions 14, RBAC 22               | DEFAULT-APPLIED |          |
| Q-SESS-17 | Revoke all sessions when an account becomes locked?                                       | Sessions 15                        | OPEN            |          |
| Q-SESS-18 | Does a role change immediately invalidate existing sessions?                              | Sessions 16, RBAC 23               | OPEN            |          |
| Q-SESS-19 | Do permission changes require invalidation, or apply at next authorization check?         | Sessions 17, RBAC 24               | OPEN            |          |
| Q-SESS-20 | Post-Logout destination — Sign In, public landing page, or other?                         | Sessions 18, Sign-In 20            | DEFAULT-APPLIED |          |
| Q-SESS-21 | Session storage: server-side sessions, opaque identifiers, or another mechanism?          | Sessions 23                        | DEFAULT-APPLIED |          |
| Q-SESS-22 | If token-based, when should credentials rotate?                                           | Sessions 24                        | OPEN            |          |
| Q-SESS-23 | What mechanism prevents reuse of revoked/rotated session credentials?                     | Sessions 25                        | OPEN            |          |
| Q-SESS-24 | CSRF protection model for browser-authenticated state-changing requests?                  | Sessions 26                        | OPEN            |          |
| Q-SESS-25 | Should a session be bound to a device/client?                                             | Sessions 27                        | OPEN            |          |
| Q-SESS-26 | Should a session survive a client IP change?                                              | Sessions 28                        | OPEN            |          |
| Q-SESS-27 | Access-token lifetime?                                                                    | NFR 4                              | OPEN            |          |
| Q-SESS-28 | Refresh-token lifetime?                                                                   | NFR 4                              | OPEN            |          |
| Q-SESS-29 | Which operations require re-authentication, and how long is the recent-auth window valid? | NFR 4                              | OPEN            |          |
| Q-SESS-30 | What device/session revocation policy is required?                                        | NFR 4                              | OPEN            |          |

## 6. GPS & Location (`Q-GPS-*`)

| ID       | Question                                                                                 | Raised in         | Status          | Decision                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------- | ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Q-GPS-1  | Minimum accuracy threshold for `Location Verified`?                                      | GPS 1             | DEFAULT-APPLIED | 100 m; `0` disables. Rejects a cell-tower fix without failing an employee indoors.                                                 |
| Q-GPS-2  | Is a geofence required (branch/customer/collection area), or is any location sufficient? | GPS 2             | DEFAULT-APPLIED | No geofence — branch coordinates are not modelled, so a radius has nothing to measure from.                                        |
| Q-GPS-3  | If geofencing is required, what radius applies?                                          | GPS 3             | DEFAULT-APPLIED | Not applicable while Q-GPS-2 is "no geofence".                                                                                     |
| Q-GPS-4  | Request location permission automatically, or instruct the user to enable it?            | GPS 4             | DEFAULT-APPLIED | Prompted on an explicit button press, never on mount.                                                                              |
| Q-GPS-5  | After permission denial, can the user retry from the same screen?                        | GPS 5             | DEFAULT-APPLIED | Yes — the same button, relabelled.                                                                                                 |
| Q-GPS-6  | How many GPS retries are permitted?                                                      | GPS 6             | DEFAULT-APPLIED | Unlimited; only the 20/min endpoint throttle bounds it.                                                                            |
| Q-GPS-7  | Maximum location-acquisition duration (GPS timeout)?                                     | GPS 7             | DEFAULT-APPLIED | 30 s, enforced by the browser.                                                                                                     |
| Q-GPS-8  | After repeated GPS failure: continue, enter Offline Mode, or block?                      | GPS 8, Sign-In 18 | DEFAULT-APPLIED | Blocked — no verified check-in, no field operations.                                                                               |
| Q-GPS-9  | If network exists but GPS fails, may the user enter Offline Mode?                        | GPS 9             | DEFAULT-APPLIED | No. Offline Mode is for no network, not for a failed fix.                                                                          |
| Q-GPS-10 | Is a recently cached location ever acceptable, and what maximum age?                     | GPS 10, GPS 11    | DEFAULT-APPLIED | No cached position; device timestamps older than 120 s are rejected.                                                               |
| Q-GPS-11 | Authoritative timestamp source: device, server, or both?                                 | GPS 12            | DECIDED         | Server clock for `verified_at`; the device timestamp is stored as evidence only.                                                   |
| Q-GPS-12 | How is an inaccurate device clock handled?                                               | GPS 13            | DEFAULT-APPLIED | Forward skew tolerated to 60 s, then the reading is rejected as stale.                                                             |
| Q-GPS-13 | Store latitude/longitude permanently, or only verification result + timestamp?           | GPS 14            | DEFAULT-APPLIED | Stored permanently on `gps_check_ins`; never copied into `audit_logs`.                                                             |
| Q-GPS-14 | Who may view historical Field Employee GPS locations?                                    | GPS 15            | DEFAULT-APPLIED | Own always; others need `field.checkin.view`, branch-confined, never cross-org.                                                    |
| Q-GPS-15 | Is location collected only at Check-in, or continuously during field operations?         | GPS 17            | DEFAULT-APPLIED | Check-in only. No background tracking.                                                                                             |
| Q-GPS-16 | State when network drops after the Online path starts but before verification commits?   | GPS 18            | DEFAULT-APPLIED | Recorded `FAILED`/`NETWORK_LOST` when detected client-side. A true mid-request loss writes no row — see the known deviation above. |
| Q-GPS-17 | Is GPS captured locally during Offline Mode for later sync, or skipped entirely?         | GPS 19            | DEFAULT-APPLIED | Skipped — no capture, no queue.                                                                                                    |
| Q-GPS-18 | Should customer-specific location validation be separate from employee GPS check-in?     | GPS 24            | DEFERRED        | Out of scope: this story covers employee check-in only.                                                                            |
| Q-GPS-19 | Does GPS verification stay bound to the session, or is it a separate durable record?     | Sessions 30       | DECIDED         | Both — a durable `gps_check_ins` row that carries `session_id` and is scoped to it.                                                |
| Q-GPS-20 | On GPS failure, does the session stay authenticated during retry, or is access blocked?  | Sessions 31       | DECIDED         | Session stays authenticated; only field operations are gated.                                                                      |

## 7. Offline & Synchronization (`Q-OFF-*`)

| ID       | Question                                                                                                                    | Raised in               | Status          | Decision                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Q-OFF-1  | Does offline access require a previously authenticated device session, local credential verification, or another mechanism? | Sign-In 19, Sessions 20 | OPEN            |                                                                                                                             |
| Q-OFF-2  | Exact local-session behavior for Logout while offline?                                                                      | Sessions 19             | OPEN            |                                                                                                                             |
| Q-OFF-3  | Does offline mode have its own local expiry?                                                                                | Sessions 21             | OPEN            |                                                                                                                             |
| Q-OFF-4  | Should an offline Logout event be queued for server synchronization?                                                        | Sessions 22             | OPEN            |                                                                                                                             |
| Q-OFF-5  | What exact data must be synchronized after connectivity returns?                                                            | GPS 20                  | OPEN            |                                                                                                                             |
| Q-OFF-6  | Authoritative rule when offline and server-side check-in events conflict?                                                   | GPS 21                  | OPEN            |                                                                                                                             |
| Q-OFF-7  | What field combination makes a GPS event idempotent?                                                                        | GPS 22                  | DEFAULT-APPLIED | `(org_id, client_attempt_id)`, client-minted per attempt. Answered for check-in events; the wider sync questions stay open. |
| Q-OFF-8  | Branch-state conflict resolution when the branch changes while offline?                                                     | Org 23                  | OPEN            |                                                                                                                             |
| Q-OFF-9  | Behavior of queued offline operations if the employee is deactivated or moved before sync?                                  | RBAC 34                 | OPEN            |                                                                                                                             |
| Q-OFF-10 | What exact datasets should be cached offline?                                                                               | NFR 3                   | OPEN            |                                                                                                                             |
| Q-OFF-11 | Maximum acceptable cache age?                                                                                               | NFR 3                   | OPEN            |                                                                                                                             |
| Q-OFF-12 | Conflict-resolution strategy when loan/EMI/payment data changes while offline?                                              | NFR 3                   | OPEN            |                                                                                                                             |
| Q-OFF-13 | Stale-schedule threshold?                                                                                                   | NFR 3                   | OPEN            |                                                                                                                             |
| Q-OFF-14 | What happens when an offline transaction synchronizes after EOD?                                                            | NFR 3, NFR 7            | OPEN            |                                                                                                                             |
| Q-OFF-15 | Does a conflicting offline financial transaction require Branch Admin reconciliation?                                       | NFR 3                   | OPEN            |                                                                                                                             |

## 8. Organizations & Branches (`Q-ORG-*`)

**Status: implemented.** The source names Company Settings (Org Info, Logo,
Config) and Branch Management (Add / Edit / Delete Branches) but expands
neither, so every value below is an applied default. The two that shaped the
build most are recorded first.

**Who may manage an organization (Q-ORG-1, Q-ORG-6).** **Self-organization
only.** Every principal is bound to one `orgId` by its JWT, and no cross-tenant
actor exists. A Super Admin reads and edits their own organization through
`GET`/`PATCH /organizations/me`; there is no create, no list and no delete. An
organization-create would have no `orgId` to scope its own audit row against,
and an organization-delete cascades the entire tenant — including the audit log
meant to record the deletion. Scenarios 4, 5, 31 and 32 are therefore **not
satisfied**, deliberately, rather than served by endpoints nothing could
legitimately reach. Introducing a platform-admin role would answer them, and is
a larger design question than this story.

**Deletion policy (Q-ORG-11, Q-ORG-12).** **Physical delete, guarded by a
pre-count.** `DELETE /branches/:branchId` counts all thirteen branch-scoped
models inside the deleting transaction; any non-zero count refuses with 409,
names the blockers in the body, and records `BRANCH_DELETE_BLOCKED`. Counting
inside the transaction is what makes the guard non-racy. In practice a branch
that has traded can never be deleted — `DayClosing` and `CashBookEntry` see to
that — so deactivation is the real path for anything in use, which is what the
story intends (Scenarios 30, 33).

| Question                            | Applied default                                                                                                                                                      | Where                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Q-ORG-2 (org fields)                | Name, code, legal name, timezone, status. Logo reference exists on the row but no upload is built (see Q-ORG-8).                                                     | `UpdateOrganizationDto`                 |
| Q-ORG-3 (org code uniqueness)       | **Globally unique**, and immutable after creation. It resolves the tenant at sign-in, so it is quoted by users and referenced by history.                            | `Organization.code`                     |
| Q-ORG-4 (org states)                | `ACTIVE` \| `INACTIVE` only. No third state: "deleted" is either a physical delete or a refusal, never a status every query must remember to exclude.                | `OrganizationStatus`                    |
| Q-ORG-5 (deactivation cascade)      | **Blocks new transactions; does not cascade.** Branch rows are untouched, but `assertBranchOperational` refuses any branch under an inactive organization (Rule 49). | `BranchService.assertBranchOperational` |
| Q-ORG-9 (branch fields)             | Code, name, address line 1, city, state, pincode mandatory; address line 2, phone, contact email optional.                                                           | `CreateBranchDto`                       |
| Q-ORG-10 (branch code uniqueness)   | **Unique within the organization** (`@@unique([orgId, code])`), and immutable after creation — it scopes the gapless receipt sequence.                               | `Branch`, `UpdateBranchDto`             |
| Q-ORG-13 (Branch Admin powers)      | **View own branch only.** `branches.view` is seeded to BRANCH_ADMIN; every mutation stays Super Admin. A caller with a non-null `branchId` is confined to it.        | `seed.ts`, `BranchService`              |
| Q-ORG-26 (branch contact required?) | **Optional.** Phone and contact email are nullable; address, city, state and pincode are not.                                                                        | `CreateBranchDto`                       |
| Lifecycle audit trail               | `deactivatedAt` + `deactivationReason` on both models, set together on deactivation and cleared on reactivation, so "why is this off?" needs no audit query.         | `add_org_branch_lifecycle` migration    |
| Authorization                       | Seven new permissions: `organizations.view/update`, `branches.view/create/update/delete/activate`. Split so a Branch Admin can hold the read without any write.      | `seed.ts`, `PermissionsGuard`           |

**Deferred — not needed for this story, and unanswerable from the source:**

| ID                            | Why deferred                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-ORG-7 (Config settings)     | The source names "Config" without enumerating one setting. A schema-less JSON column would be inventing requirements; `organization.configuration` is deliberately **not** built. |
| Q-ORG-8 (logo storage)        | `logoFileRef` exists on the row; no upload, format rule or storage backend is built. Needs a file-storage decision this story does not force.                                     |
| Q-ORG-14 (sub-branches)       | One level only. Nothing in the schema or the source suggests a hierarchy.                                                                                                         |
| Q-ORG-15 (branch migration)   | Branches cannot move between organizations. `orgId` is absent from every DTO, so the operation has no entry point rather than a blocked one.                                      |
| Q-ORG-16 to Q-ORG-22          | Receipt-sequence resumption, agent moves, post-deactivation operations, loan/customer migration and cross-branch accounting all belong to modules that do not exist yet.          |
| Q-ORG-23 (report scope)       | Reporting is Module 09.                                                                                                                                                           |
| Q-ORG-24, Q-ORG-25 (timezone) | `Organization.timezone` is editable and defaults to Asia/Kolkata; per-branch timezone is not modelled.                                                                            |

**Known deviation — downstream blocking is guard-level only.** Rules 47 and 50
require an inactive branch to refuse new customers, loans and collections
(Scenarios 24, 25, 26, 44). Those modules are not built, so
`BranchService.assertBranchOperational` exists and is unit-tested as the seam
they will call, but nothing calls it yet. The rule is written and enforceable;
it is not yet enforced end-to-end, and those four scenarios are **not**
satisfied.

## 9. Users, Roles & Permissions (`Q-RBAC-*`)

| ID        | Question                                                                                                   | Raised in      | Status          | Decision                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- | -------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-RBAC-1  | Exact fields for Admin Management → Create & Manage Admins?                                                | RBAC 1         | OPEN            |                                                                                                                                                                             |
| Q-RBAC-2  | Exact required account statuses?                                                                           | RBAC 3         | DEFAULT-APPLIED | ACTIVE / INACTIVE / LOCKED / SUSPENDED / PENDING. `PENDING` added for a provisioned account with no password yet — distinct from a deliberate deactivation.                 |
| Q-RBAC-3  | Exact required fields for Employee Add?                                                                    | RBAC 4         | OPEN            |                                                                                                                                                                             |
| Q-RBAC-4  | What does Employee Management → Assign actually assign?                                                    | RBAC 5         | DEFAULT-APPLIED | Branch. The only assignment target the source proves is a scope concept; field-collection assignment stays a Branch Admin flow.                                             |
| Q-RBAC-5  | Is employee type separate from role, or the same concept?                                                  | RBAC 6         | DEFAULT-APPLIED | Same concept. Employee type **is** the assigned role; no `employeeType` column, per Rule 20.                                                                                |
| Q-RBAC-6  | Must every employee belong to exactly one branch?                                                          | RBAC 7, GPS 23 | DEFAULT-APPLIED | Exactly one branch. Required for an employee; nullable only for an organization-wide administrator.                                                                         |
| Q-RBAC-7  | Can an employee operate across multiple branches?                                                          | RBAC 8, GPS 23 | DEFAULT-APPLIED | No. One branch per employee.                                                                                                                                                |
| Q-RBAC-8  | Is field-collection assignment owned by Employee Management or Branch Admin → Field Collection Assignment? | RBAC 9         | OPEN            |                                                                                                                                                                             |
| Q-RBAC-9  | One unified user/employee account model, or separate admin and employee stores?                            | RBAC 10        | DEFAULT-APPLIED | Unified. An employee is a `User` with `employeeCode != null`; two permission families over one table.                                                                       |
| Q-RBAC-10 | Are roles global, organization-specific, or branch-specific?                                               | RBAC 11        | DEFAULT-APPLIED | Organization-specific. `Role` is keyed `[orgId, roleId]`; roles carry no branch scope.                                                                                      |
| Q-RBAC-11 | Can roles inherit from other roles?                                                                        | RBAC 12        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-12 | Can one user hold multiple roles simultaneously?                                                           | RBAC 13        | DEFAULT-APPLIED | Yes. `UserRole` is many-to-many.                                                                                                                                            |
| Q-RBAC-13 | Exact permission IDs for every LMS module?                                                                 | RBAC 14        | DEFAULT-APPLIED | 33 codes in `apps/api/src/users/permission-catalog.ts`, the single source the seed and `syncCatalogForOrg` both read.                                                       |
| Q-RBAC-14 | Permission granularity: module / action / field / action + scope?                                          | RBAC 15        | DEFAULT-APPLIED | `MODULE + ACTION`. Scope is enforced by the service from `AuthContext`, not encoded in the permission.                                                                      |
| Q-RBAC-15 | Exact supported scopes: own, branch, organization, all branches, global?                                   | RBAC 16        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-16 | Can an administrator grant only permissions they themselves hold?                                          | RBAC 17        | DEFAULT-APPLIED | Yes for role creation and permission editing (subset rule). For _user role assignment_ it applies to self-assignment only — see the note below.                             |
| Q-RBAC-17 | Can Super Admin permissions be restricted, or is Super Admin always unrestricted?                          | RBAC 18        | DEFAULT-APPLIED | Not restrictable. `Role.isSystem` refuses rename, deactivate, delete and permission removal.                                                                                |
| Q-RBAC-18 | Can inactive roles remain assigned but temporarily ineffective?                                            | RBAC 19        | DEFAULT-APPLIED | Yes. The assignment persists; an INACTIVE role simply contributes no permissions.                                                                                           |
| Q-RBAC-19 | Should roles ever be physically deleted, or always deactivated?                                            | RBAC 20        | DEFAULT-APPLIED | Deletion allowed but blocked while any user holds the role; system roles never.                                                                                             |
| Q-RBAC-20 | Is physical user deletion allowed at all, or is deactivation the only lifecycle?                           | RBAC 21        | DEFAULT-APPLIED | Delete allowed only when nothing references the user. In practice `AuditLog.actorUserId` makes anyone who has signed in undeletable, so deactivation is the real lifecycle. |
| Q-RBAC-21 | Can Branch Admin add/assign/deactivate employees, or a restricted action set?                              | RBAC 25        | DEFAULT-APPLIED | Restricted set: `employees.view` and `employees.activate` only. No create or assign.                                                                                        |
| Q-RBAC-22 | Which roles, if any, can view or operate across branches?                                                  | RBAC 26        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-23 | Does any operational role support multiple organizations?                                                  | RBAC 27        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-24 | Can a role grant itself approval permissions, or are those restricted to higher administration?            | RBAC 28        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-25 | When an employee moves branches, what happens to existing collection assignments?                          | RBAC 32        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-26 | On role/branch change, do historical screens show the old snapshot or current master data?                 | RBAC 33        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-27 | What happens when two administrators edit the same user/employee/role simultaneously?                      | RBAC 35        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-28 | Are bulk activation/deactivation/assignment operations required?                                           | RBAC 36        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-29 | Is employee/user import from CSV/Excel required?                                                           | RBAC 37        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-30 | Which fields can users edit themselves versus administrators?                                              | RBAC 42        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-31 | Can Field Employees edit their own profile/contact information?                                            | RBAC 43        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-32 | Should users see their effective permissions, or only their role?                                          | RBAC 44        | OPEN            |                                                                                                                                                                             |
| Q-RBAC-33 | With multiple roles, is the effective permission set a union, intersection or priority model?              | RBAC 45        | DEFAULT-APPLIED | Union of the ACTIVE roles' permissions.                                                                                                                                     |

### 9.1 Note on Q-RBAC-16 — why delegation is scoped to self on assignment

The subset rule ("you cannot grant a permission you do not hold") is applied in
full when a role is **created** or its **permission set edited**: that is where a
role more privileged than its author would be minted, which is the escalation
Rule 27 exists to stop.

It is **not** applied to assigning an existing role to another user, and the
reason is concrete rather than a relaxation. `FIELD_EMPLOYEE` grants
`field.checkin`, which administrators deliberately never hold — only field staff
check in, and the GPS module's scenarios depend on an authenticated admin being
refused. Applied to every assignment, the subset rule therefore made it
impossible for anyone to create a Field Employee at all. Operational roles are
routinely more capable than their administrators in specific ways; that is
separation of duties, not a privilege leak.

Self-assignment keeps the full check, so nobody can hand themselves a permission
they were not given (Scenario 37). What bounds handing a privileged role to
someone _else_ is the `users.assign_role` permission plus the fact that the role
had to be created in the first place — where the subset rule does apply.

Implemented in `UserService.assertRolesAssignable` and `RoleService.assertDelegable`.

## 10. Notifications (`Q-NOTIF-*`)

| ID        | Question                                                                                 | Raised in           | Status | Decision |
| --------- | ---------------------------------------------------------------------------------------- | ------------------- | ------ | -------- |
| Q-NOTIF-1 | Recovery instructions channel: SMS, Push, Email, or a combination?                       | Forgot 18           | OPEN   |          |
| Q-NOTIF-2 | Does the Notification Engine own password-recovery delivery, or does authentication?     | Forgot 19, Reset 20 | OPEN   |          |
| Q-NOTIF-3 | Does the three-retry business-notification policy apply to recovery/reset notifications? | Forgot 20, Reset 21 | OPEN   |          |
| Q-NOTIF-4 | Should the user be notified after a successful password reset?                           | Forgot 24, Reset 19 | OPEN   |          |
| Q-NOTIF-5 | Should a confirmation be sent after a successful password change?                        | Change 15           | OPEN   |          |
| Q-NOTIF-6 | Must notification failure remain independent of the committed password change?           | Change 16, Reset 20 | OPEN   |          |

## 11. Audit & Retention (`Q-AUDIT-*`)

| ID         | Question                                                                                          | Raised in      | Status | Decision |
| ---------- | ------------------------------------------------------------------------------------------------- | -------------- | ------ | -------- |
| Q-AUDIT-1  | Retention for authentication and failed-login audit records?                                      | Sign-In 23     | OPEN   |          |
| Q-AUDIT-2  | Retention for password-change security events?                                                    | Change 20      | OPEN   |          |
| Q-AUDIT-3  | Retention for password-recovery request/verification records?                                     | Forgot 21      | OPEN   |          |
| Q-AUDIT-4  | Retention for password-reset audit records?                                                       | Reset 23       | OPEN   |          |
| Q-AUDIT-5  | Retention for activation and failed-activation audit records?                                     | Signup 31      | OPEN   |          |
| Q-AUDIT-6  | Retention for session creation/logout/expiry/revocation events?                                   | Sessions 29    | OPEN   |          |
| Q-AUDIT-7  | Retention for GPS check-in audit records and location data?                                       | GPS 16, GPS 25 | OPEN   |          |
| Q-AUDIT-8  | Retention for organization and branch audit records?                                              | Org 25         | OPEN   |          |
| Q-AUDIT-9  | Retention for user/role/permission audit records?                                                 | RBAC 31        | OPEN   |          |
| Q-AUDIT-10 | Exact before/after fields retained for role, permission, user and employee changes?               | RBAC 30        | OPEN   |          |
| Q-AUDIT-11 | Statutory retention: customer records, loan/payment records, audit logs, receipts/NOCs/documents? | NFR 8          | OPEN   |          |
| Q-AUDIT-12 | Legal process for data deletion/anonymization after retention expiry?                             | NFR 8          | OPEN   |          |

## 12. Non-Functional Requirements (`Q-NFR-*`)

| ID       | Question                                                                          | Raised in | Status | Decision |
| -------- | --------------------------------------------------------------------------------- | --------- | ------ | -------- |
| Q-NFR-1  | Expected branches at launch, and after 3 years?                                   | NFR 1     | OPEN   |          |
| Q-NFR-2  | Expected number of customers and active loans?                                    | NFR 1     | OPEN   |          |
| Q-NFR-3  | Maximum concurrent Field Employees / Collection Agents?                           | NFR 1     | OPEN   |          |
| Q-NFR-4  | Expected peak transactions per day and per hour?                                  | NFR 1     | OPEN   |          |
| Q-NFR-5  | Contractual API p95 latency target?                                               | NFR 2     | OPEN   |          |
| Q-NFR-6  | Contractual page-load target?                                                     | NFR 2     | OPEN   |          |
| Q-NFR-7  | Acceptable collection-screen response target for field operations?                | NFR 2     | OPEN   |          |
| Q-NFR-8  | Acceptable report-generation time for small/medium reports?                       | NFR 2     | OPEN   |          |
| Q-NFR-9  | Maximum acceptable duration for large background reports?                         | NFR 2     | OPEN   |          |
| Q-NFR-10 | Encryption/key-management standard for PII?                                       | NFR 4     | OPEN   |          |
| Q-NFR-11 | Required monthly availability SLA?                                                | NFR 5     | OPEN   |          |
| Q-NFR-12 | Permitted maintenance window and acceptable planned downtime?                     | NFR 5     | OPEN   |          |
| Q-NFR-13 | Required RPO for financial transactions?                                          | NFR 6     | OPEN   |          |
| Q-NFR-14 | Required RTO for the LMS?                                                         | NFR 6     | OPEN   |          |
| Q-NFR-15 | Full-backup frequency, PITR requirement, and backup retention?                    | NFR 6     | OPEN   |          |
| Q-NFR-16 | Who is authorized to perform a restore, and must restores be tested periodically? | NFR 6     | OPEN   |          |
| Q-NFR-17 | Branch EOD time, and is it configurable per branch?                               | NFR 7     | OPEN   |          |
| Q-NFR-18 | Are collections blocked during EOD?                                               | NFR 7     | OPEN   |          |
| Q-NFR-19 | Required reconciliation before Day Closing?                                       | NFR 7     | OPEN   |          |
| Q-NFR-20 | Can a completed day be reopened?                                                  | NFR 7     | OPEN   |          |
| Q-NFR-21 | Which exact RBI/NBFC regulatory requirements must be implemented?                 | NFR 8     | OPEN   |          |
| Q-NFR-22 | Mandatory KYC/AML retention periods?                                              | NFR 8     | OPEN   |          |

## 13. Domain State Machines (`Q-DOM-*`)

### 13.1 Loan Application

| ID      | Question                                                                                         | Status   | Decision                                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-DOM-1 | Is `DRAFT` a persisted status or only a UI concept?                                              | OPEN     |                                                                                                                                                                                                                                                                       |
| Q-DOM-2 | Who is the loan approval authority — Branch Admin, Super Admin, other role, or permission-based? | OPEN     |                                                                                                                                                                                                                                                                       |
| Q-DOM-3 | Is `SANCTIONED` a persisted application status?                                                  | OPEN     |                                                                                                                                                                                                                                                                       |
| Q-DOM-4 | Is `AGREEMENT_PENDING` required as a persisted state?                                            | OPEN     |                                                                                                                                                                                                                                                                       |
| Q-DOM-5 | Who can issue the sanction letter?                                                               | OPEN     |                                                                                                                                                                                                                                                                       |
| Q-DOM-6 | Who can initiate disbursement?                                                                   | RESOLVED | Module 09. Split five ways: `loans.disbursements.{view,schedule,record_transfer,confirm,cancel}`. Branch Admin holds four; `confirm` is withheld and stays with the approval authority, because it is the irreversible money-movement act (Rule 28, Scenarios 29/30). |

### 13.2 Loan

| ID       | Question                                                     | Status | Decision |
| -------- | ------------------------------------------------------------ | ------ | -------- |
| Q-DOM-7  | Exact definition and trigger for `NPA`?                      | OPEN   |          |
| Q-DOM-8  | What DPD threshold causes NPA classification?                | OPEN   |          |
| Q-DOM-9  | Who can mark a loan NPA?                                     | OPEN   |          |
| Q-DOM-10 | What is the `FORECLOSED` workflow?                           | OPEN   |          |
| Q-DOM-11 | What is the `WRITTEN_OFF` workflow?                          | OPEN   |          |
| Q-DOM-12 | Accounting entries for foreclosure and write-off?            | OPEN   |          |
| Q-DOM-13 | Can an NPA loan return to `ACTIVE`?                          | OPEN   |          |
| Q-DOM-14 | Can a written-off loan receive subsequent recovery payments? | OPEN   |          |
| Q-DOM-15 | Is `RESTRUCTURED` a loan status or a recovery-case outcome?  | OPEN   |          |

### 13.3 EMI

| ID       | Question                                                                              | Status | Decision |
| -------- | ------------------------------------------------------------------------------------- | ------ | -------- |
| Q-DOM-16 | Is `PARTIALLY_PAID` persisted, or derived from allocated payment transactions?        | OPEN   |          |
| Q-DOM-17 | When does `DUE` become `OVERDUE` — immediately after due date, or after grace expiry? | OPEN   |          |
| Q-DOM-18 | Is `GRACE` a status or only a recovery phase?                                         | OPEN   |          |
| Q-DOM-19 | Can an EMI itself be waived, or only the penalty?                                     | OPEN   |          |
| Q-DOM-20 | How are partial payments allocated across principal, interest, overdue and penalty?   | OPEN   |          |

### 13.4 Collection / Receipt

| ID       | Question                                                                                                                                                                                                                                              | Status | Decision |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| Q-DOM-21 | Is `CREATED → SYNCED → POSTED` canonical, or do online collections bypass `SYNCED`?                                                                                                                                                                   | OPEN   |          |
| Q-DOM-22 | What exactly constitutes `CREATED`?                                                                                                                                                                                                                   | OPEN   |          |
| Q-DOM-23 | **Source conflict:** receipt generation before or after ledger posting? EMI Collection flow says Generate Receipt → Update Ledger; System Overview Payment Verification says Update Ledger → Generate Receipt. Must be decided before implementation. | OPEN   |          |
| Q-DOM-24 | Formal payment reversal workflow?                                                                                                                                                                                                                     | OPEN   |          |
| Q-DOM-25 | Who can reverse a posted collection?                                                                                                                                                                                                                  | OPEN   |          |
| Q-DOM-26 | Does reversal require maker-checker approval?                                                                                                                                                                                                         | OPEN   |          |
| Q-DOM-27 | Required ledger reversal journal entries?                                                                                                                                                                                                             | OPEN   |          |

### 13.5 Approval

| ID       | Question                                                                | Status | Decision |
| -------- | ----------------------------------------------------------------------- | ------ | -------- |
| Q-DOM-28 | Is `Approval Request` a separate persisted domain entity?               | OPEN   |          |
| Q-DOM-29 | Can a loan have multiple approval requests?                             | OPEN   |          |
| Q-DOM-30 | Is maker-checker required?                                              | OPEN   |          |
| Q-DOM-31 | Is approval escalation required, what triggers it, and who receives it? | OPEN   |          |
| Q-DOM-32 | What approval limits apply by role / amount / loan product?             | OPEN   |          |

### 13.6 Accounting

| ID       | Question                                                                | Status   | Decision                                                                                                                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-DOM-33 | Exact double-entry journal mappings for disbursement?                   | RESOLVED | Module 09, narrowest reading of the source. `Dr 1100 Loan Receivable / Cr 1200 Bank` (or `1210 Cash` for a cash disbursal), one entry, two lines, net zero. Branch and loan ride on the `AccountDimension`, not on per-branch accounts. Module 14 owns the full chart. |
| Q-DOM-34 | Exact journal mappings for EMI collection?                              | OPEN     |                                                                                                                                                                                                                                                                        |
| Q-DOM-35 | Exact penalty recognition, adjustment, waiver and cancellation entries? | OPEN     |                                                                                                                                                                                                                                                                        |
| Q-DOM-36 | Exact settlement/restructuring entries?                                 | OPEN     |                                                                                                                                                                                                                                                                        |
| Q-DOM-37 | Exact closure entries?                                                  | OPEN     |                                                                                                                                                                                                                                                                        |

## 14. Source Coverage Gaps (`Q-SRC-*`)

These are not policy questions but statements that the uploaded LMS diagrams do
not cover a screen or branch at all. Each must be confirmed as an intentional
product addition before the corresponding story is implemented.

| ID       | Gap                                                                                                      | Raised in          | Status |
| -------- | -------------------------------------------------------------------------------------------------------- | ------------------ | ------ |
| Q-SRC-1  | Forgot Password is not represented in the source diagrams.                                               | Forgot 26          | OPEN   |
| Q-SRC-2  | Reset Password is not represented in the source diagrams.                                                | Reset 25           | OPEN   |
| Q-SRC-3  | Change Password is not represented in the source diagrams.                                               | Change 22          | OPEN   |
| Q-SRC-4  | Active Sessions UI, timeout values, remote revocation and session lifecycle are undefined.               | Sessions 32        | OPEN   |
| Q-SRC-5  | The Field Employee diagram shows only the GPS success path; the failure branch is undefined.             | GPS 26, Sign-In 18 | OPEN   |
| Q-SRC-6  | Company Settings child workflow and Branch Management dependency/deletion behavior are not expanded.     | Org traceability   | OPEN   |
| Q-SRC-7  | Branch Admin's internal Branch Management and Employee Management permissions are undefined.             | Org 12, RBAC 25    | OPEN   |
| Q-SRC-8  | Field Employee flow leaves offline conflict handling unresolved.                                         | NFR 9              | OPEN   |
| Q-SRC-9  | Reports flow defines background jobs but no latency targets.                                             | NFR 9              | OPEN   |
| Q-SRC-10 | Branch Admin flow exposes Day Closing and Cash Book without internal workflows.                          | NFR 9              | OPEN   |
| Q-SRC-11 | Super Admin flow exposes Backup & Restore without restore behavior or retention.                         | NFR 9              | OPEN   |
| Q-SRC-12 | Baseline flags backup retention/recovery, report permission scope and offline sync policy as unresolved. | NFR 9              | OPEN   |

## 15. Customers & KYC (`Q-CUST-*`)

| ID        | Question                                                                        | Raised in  | Status          | Decision                                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------- | ---------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-CUST-1  | What exact customer statuses are required?                                      | Cust 8     | DEFAULT-APPLIED | The existing enum: `PENDING / ACTIVE / INACTIVE / BLOCKED`. `DRAFT` and `KYC_REVISION_REQUIRED` are **not** added — revision belongs to `KycStatus`, and duplicating it lets two enums disagree.  |
| Q-CUST-2  | What exact KYC statuses are required?                                           | Cust 9     | DEFAULT-APPLIED | The existing enum: `PENDING / SUBMITTED / REVISION_REQUIRED / APPROVED / REJECTED`. `NOT_REQUIRED` is not added; a LOCAL customer has **no** `CustomerKyc` row at all.                            |
| Q-CUST-3  | What exact KYC document types are mandatory?                                    | Cust 12    | DEFAULT-APPLIED | `ID`, `ADDRESS`, `PHOTO` — the three the source names. Checked as a required set at **approval** time, not at upload time, so a partial upload is savable.                                        |
| Q-CUST-4  | What duplicate-detection rules apply?                                           | Cust 16    | DEFAULT-APPLIED | Same `(orgId, mobile)` is a **soft flag**, not a block: create returns `duplicateOf` and refuses until the caller re-submits with `force`. Satisfies Scenario 5 without inventing a merge policy. |
| Q-CUST-5  | Can the same mobile belong to multiple customers?                               | Cust 17    | DEFAULT-APPLIED | Yes, via the Q-CUST-4 flag. Family members share numbers in this market; a unique constraint would be a data-entry dead end.                                                                      |
| Q-CUST-6  | Who can convert LOCAL to KYC?                                                   | Cust 6     | DEFAULT-APPLIED | A dedicated `customers.convert` permission, seeded to SUPER_ADMIN only. Branch Admin is deliberately excluded so Scenario 29 has an account that is refused.                                      |
| Q-CUST-7  | Should conversion update the existing customer or create another record?        | Cust 7     | DEFAULT-APPLIED | Update the existing row. Loans and financial history stay attached to the same `customerId` (Scenarios 27, 28).                                                                                   |
| Q-CUST-8  | Can Branch Admin approve a customer they created?                               | Cust 30    | DEFAULT-APPLIED | Yes. Maker-checker is not source-required, and a single-admin branch would otherwise be unable to onboard anyone. See Q-CUST-9.                                                                   |
| Q-CUST-9  | Is maker-checker separation required for KYC?                                   | Cust 31    | DEFAULT-APPLIED | No, per Q-CUST-8. The approving actor is audited on every approval, so separation can be added later as a policy check without a data migration.                                                  |
| Q-CUST-10 | Can Super Admin approve KYC?                                                    | Cust 32    | DEFAULT-APPLIED | Yes — Super Admin holds every permission including `customers.kyc.approve`. Branch Admin remains the source-named authority; this does not displace it.                                           |
| Q-CUST-11 | Can customers be deactivated?                                                   | Cust 21    | DEFAULT-APPLIED | Yes, via `customers.activate`, in both directions. Deactivation never touches loans, payments or receipts (Rule 22).                                                                              |
| Q-CUST-12 | Can customers with active loans be deactivated?                                 | Cust 22    | DEFAULT-APPLIED | Yes. Deactivation stops new onboarding actions, not the servicing of existing debt — blocking it would strand a defaulting customer in ACTIVE.                                                    |
| Q-CUST-13 | Is destructive customer deletion ever allowed?                                  | Cust 23    | DEFAULT-APPLIED | Only when a dependency count is zero across loans, applications, collections, field visits and assignments. Otherwise 409 + `blockedBy` (Rule 23, Scenario 37).                                   |
| Q-CUST-14 | Can a customer move between branches?                                           | Cust 19    | DEFERRED        | Not in this pass. `branchId` is set at creation and is not editable.                                                                                                                              |
| Q-CUST-15 | Who can change customer branch ownership?                                       | Cust 20    | DEFERRED        | Follows Q-CUST-14 — nobody, while branch moves are unimplemented.                                                                                                                                 |
| Q-CUST-16 | What file size/type validation is required?                                     | Cust 14    | DEFAULT-APPLIED | 5 MB max; `image/jpeg`, `image/png`, `application/pdf` only, decided by **magic bytes**, never the client-supplied MIME type.                                                                     |
| Q-CUST-17 | Are document numbers mandatory?                                                 | Cust 13    | DEFAULT-APPLIED | Optional. A photo has no number, and an ID whose number is unreadable should still be uploadable for review.                                                                                      |
| Q-CUST-18 | What document retention period applies?                                         | Cust 15    | OPEN            | Blocked on Q-AUDIT-11 / Q-NFR-22 (statutory KYC/AML retention). Nothing is deleted meanwhile.                                                                                                     |
| Q-CUST-19 | Should search support partial matching?                                         | Cust 43    | DEFAULT-APPLIED | Case-insensitive `contains` on name, exact prefix on mobile, exact on `customerCode`.                                                                                                             |
| Q-CUST-20 | What search fields are indexed?                                                 | Cust 42    | DEFAULT-APPLIED | `(orgId, fullName)`, `(orgId, mobile)`, `(orgId, branchId)` already exist; `(orgId, customerType)` and `(orgId, status)` added for the list filters.                                              |
| Q-CUST-21 | Should mobile/KYC data be masked in search results?                             | Cust 44    | DEFAULT-APPLIED | Mobile masked in list responses, full value only on the detail view. Reuses `maskMobile()` from `audit.service.ts`.                                                                               |
| Q-CUST-22 | What concurrency strategy applies to profile/KYC updates?                       | Cust 45    | DEFAULT-APPLIED | Optimistic. The client returns `updatedAt` as `expectedVersion`; a mismatch is a 409 (Scenarios 40, 41). Also answers Q-RBAC-27 for this module.                                                  |
| Q-CUST-23 | Can Field Employees create/edit customers?                                      | Cust 33    | DEFAULT-APPLIED | No. `FIELD_EMPLOYEE` receives `customers.view` only in this pass.                                                                                                                                 |
| Q-CUST-24 | Is DOB mandatory? Is gender mandatory?                                          | Cust 28-29 | DEFAULT-APPLIED | Both optional. Neither is source-required, and a LOCAL customer is defined by Name + Mobile + Address alone.                                                                                      |
| Q-CUST-25 | Is customer email verification required?                                        | Cust 27    | DEFAULT-APPLIED | No. Email is an optional contact field with no verification loop; mobile is the verified identity channel.                                                                                        |
| Q-CUST-26 | What exact address fields are required?                                         | Cust 11    | DEFAULT-APPLIED | `addressLine1` required; line 2, city, state, pincode optional. Matches the columns already on `customers`.                                                                                       |
| Q-CUST-27 | What minimum identity verification beyond mobile is required for LOCAL?         | Cust 2     | DEFAULT-APPLIED | None. Mobile OTP is the whole identity check for LOCAL — that is what distinguishes it from KYC.                                                                                                  |
| Q-CUST-28 | Does changing mobile require re-verification?                                   | Cust 25    | DEFAULT-APPLIED | Yes for LOCAL: changing the number clears `mobileVerifiedAt`, and an ACTIVE LOCAL customer returns to PENDING until re-verified.                                                                  |
| Q-CUST-29 | Which profile edits require re-KYC? Does changing address require re-KYC?       | Cust 24/26 | DEFAULT-APPLIED | None do, in this pass. An approved KYC record stays approved; the edit is audited with before/after values so a reviewer can see what moved.                                                      |
| Q-CUST-30 | Is a guarantor mandatory for LOCAL or scheme-dependent?                         | Cust 3     | DEFERRED        | Scheme-dependent, decided by the loan product — which does not exist yet. Customer Management stores guarantors; it does not require them.                                                        |
| Q-CUST-31 | Is LOCAL allowed for every organization/branch?                                 | Cust 1     | DEFAULT-APPLIED | Yes. No per-org toggle; adding one later is a config row, not a schema change.                                                                                                                    |
| Q-CUST-32 | Can LOCAL customers use every loan scheme? Which products need supporting docs? | Cust 4-5   | DEFERRED        | Belongs to Loan Management. Rule 14 (LOCAL does not bypass loan controls) is honoured by not special-casing customer type anywhere outside this module.                                           |
| Q-CUST-33 | Can customers self-register?                                                    | Cust 34    | DEFAULT-APPLIED | No. Every customer is created by an authenticated, permissioned staff user.                                                                                                                       |
| Q-CUST-34 | What is the exact Lead → Customer relationship?                                 | Cust 35    | DEFERRED        | The `Customer.leadId` FK exists and is preserved, but no Lead workflow is built in this pass.                                                                                                     |
| Q-CUST-35 | What permission is required for Verify & Create Customer from Loan Management?  | Cust 36    | DEFERRED        | Answered when Loan Management is built; it will reuse `customers.create` rather than mint a second code (see Q-CUST-36).                                                                          |
| Q-CUST-36 | Should Loan Management reuse the Customer Management use case/API?              | Cust 37    | DEFAULT-APPLIED | Yes — Rule 27 requires it. `CustomerService` is exported from `CustomersModule` for exactly this.                                                                                                 |
| Q-CUST-37 | Is bulk customer import required? Is customer export required?                  | Cust 46-47 | DEFERRED        | Neither in this pass, matching the Module 03 position on bulk operations (Q-RBAC-28, Q-RBAC-29).                                                                                                  |
| Q-CUST-38 | Who can export KYC information?                                                 | Cust 48    | DEFERRED        | Follows Q-CUST-37 — no export surface exists to permission.                                                                                                                                       |
| Q-CUST-39 | What exact audit fields are required for customer/KYC changes?                  | Cust 49    | DEFAULT-APPLIED | The standard `AuditLog` shape: actor, action, entity, org, request id, IP, user agent, plus before/after snapshots on every change (Scenarios 33-35).                                             |
| Q-CUST-40 | What are the exact retention and archival rules?                                | Cust 50    | OPEN            | Same blocker as Q-CUST-18.                                                                                                                                                                        |
| Q-CUST-41 | How are offline customer edits reconciled? How is stale state detected?         | Cust 38-41 | DEFERRED        | Out of scope, per the story's own note that offline conflict behavior is unresolved. Tracked under `Q-OFF-*`.                                                                                     |

---

## 16. Guarantors (`Q-GUAR-*`)

Numbered to match the 76 entries in the Module 05 story's own `# Open Questions`
section, so `Q-GUAR-n` is that file's question _n_.

| ID            | Question                                                                | Status          | Decision                                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-GUAR-1      | Can one guarantor guarantee multiple customers?                         | DEFERRED        | Not as one record. The same person on two customers is two rows; each relationship carries its own consent, KYC and authorization context (Rule 46).                   |
| Q-GUAR-2      | Can one guarantor guarantee multiple active loans?                      | DEFERRED        | Belongs to Module 07 — `LoanGuarantor` imposes no count limit, so the rule can be added there without a schema change.                                                 |
| Q-GUAR-3      | Is guarantor uniqueness global, org- or branch-scoped?                  | DEFAULT-APPLIED | Per customer. The only enforced check is a soft duplicate flag within one customer (Q-GUAR-4).                                                                         |
| Q-GUAR-4      | What exact fields identify a duplicate guarantor?                       | DEFAULT-APPLIED | `(orgId, customerId, mobile)`, as a soft flag with a `force` override. No DB constraint — the source leaves the key undefined and a hard rule could not be overridden. |
| Q-GUAR-5      | Is guarantor mobile unique?                                             | DEFAULT-APPLIED | No. Shared household numbers are real, and the same person may guarantee several customers legitimately.                                                               |
| Q-GUAR-6      | Is address mandatory in every flow?                                     | DEFAULT-APPLIED | Yes, always. Rule 13 and the Scenario 9 outline both name it as required.                                                                                              |
| Q-GUAR-7      | What exact relationship values are allowed?                             | DEFAULT-APPLIED | Free text, `VarChar(100)`. The source names the field but enumerates nothing; an invented enum is a migration to undo.                                                 |
| Q-GUAR-8      | Is relationship mandatory?                                              | DEFAULT-APPLIED | No. The wireframe marks Name, Mobile and Address with an asterisk and Relationship without one.                                                                        |
| Q-GUAR-9      | Is a guarantor photo required?                                          | DEFAULT-APPLIED | **No.** `PHOTO` is an accepted document type but never a required one — demanding it would block approval on a document the source never asks for.                     |
| Q-GUAR-10     | What exact KYC documents are required for guarantors?                   | DEFAULT-APPLIED | `ID` + `ADDRESS`, checked at **approval**, not at upload, so a partial pack is savable.                                                                                |
| Q-GUAR-11     | Is guarantor KYC always required, or product-dependent?                 | DEFERRED        | Product-dependent. `kycStatus` defaults `NOT_REQUIRED`; submitting is what asserts KYC applies to a given guarantor.                                                   |
| Q-GUAR-12     | Who verifies guarantor KYC?                                             | DEFAULT-APPLIED | Whoever holds `customers.guarantors.kyc.review`; seeded to Branch Admin, the only authority the source names anywhere.                                                 |
| Q-GUAR-13     | Is Branch Admin the authority, or a different role?                     | DEFAULT-APPLIED | Branch Admin for now, but the code is deliberately separate from `customers.kyc.approve` so another answer is a seed change, not a code change.                        |
| Q-GUAR-14     | Is maker-checker required for guarantor KYC?                            | DEFAULT-APPLIED | No, per Q-CUST-9. The reviewer is audited, so a separation policy can be added later without a data migration.                                                         |
| Q-GUAR-15     | What exact consent mechanism is required?                               | DEFAULT-APPLIED | Staff-recorded decision with a server timestamp and the acting user (Rule 23). The API accepts neither a timestamp nor an actor from the client.                       |
| Q-GUAR-16     | Is consent electronic, OTP-based, signed, or a checkbox?                | DEFERRED        | None of them yet. No consent artifact, channel or text version is stored — only the decision, its time and who recorded it.                                            |
| Q-GUAR-17     | Can consent be revoked?                                                 | DEFAULT-APPLIED | Expressible as `REJECTED` after `GIVEN`, which clears the timestamp and actor. No separate `REVOKED` value is added for a rule nobody has stated.                      |
| Q-GUAR-18     | What happens to a loan if consent is revoked after activation?          | DEFERRED        | Module 07/09. This module records the state; it does not act on a live loan.                                                                                           |
| Q-GUAR-19..23 | Replacement / removal / addition after approval or disbursement         | DEFERRED        | All Module 07/09. Deactivation preserves history, and nothing here rewrites a loan (Rule 31).                                                                          |
| Q-GUAR-24..32 | Requirement rules — per loan, amount, type, risk, product               | DEFERRED        | The loan product owns every one of these. `evaluateReadiness` returns `required: null` precisely so Module 07 can answer without this module guessing.                 |
| Q-GUAR-33     | Does guarantor presence affect credit scoring?                          | DEFERRED        | Rule 73 — presence must never be an automatic approval signal, so nothing is emitted toward scoring.                                                                   |
| Q-GUAR-34     | Does guarantor KYC affect credit assessment?                            | DEFERRED        | Same as Q-GUAR-33.                                                                                                                                                     |
| Q-GUAR-35..38 | Legal obligation, liability, exposure, paise storage                    | DEFERRED        | No monetary column is added. If liability is ever stored it is integer paise (Rule 57); guarantor CRUD posts no ledger lines (Rules 54-56).                            |
| Q-GUAR-39     | Can guarantor data be edited after the loan is active?                  | DEFAULT-APPLIED | Yes — profile fields only, and the edit never touches `LoanGuarantor` (Scenario 13).                                                                                   |
| Q-GUAR-40     | Which fields are editable after approval?                               | DEFAULT-APPLIED | Name, mobile, address and relationship. Status, consent and KYC each have their own endpoint and permission.                                                           |
| Q-GUAR-41     | Which edits require re-consent?                                         | DEFAULT-APPLIED | A mobile change, which resets consent to `PENDING` and clears the timestamp and actor.                                                                                 |
| Q-GUAR-42     | Which edits require re-KYC?                                             | OPEN            | None currently forces it. The source does not answer, and forcing a re-review would invent a rule; the before/after is audited so a reviewer can see what moved.       |
| Q-GUAR-43     | Should a mobile change require verification?                            | DEFERRED        | No guarantor OTP exists. The consent reset is the compensating control.                                                                                                |
| Q-GUAR-44     | Should an address change require re-KYC?                                | OPEN            | Same as Q-GUAR-42.                                                                                                                                                     |
| Q-GUAR-45     | Can a guarantor belong to a different branch from the borrower?         | DEFAULT-APPLIED | No. A guarantor has no branch of its own; it inherits the customer's.                                                                                                  |
| Q-GUAR-46     | Can a guarantor belong to a different organization?                     | DEFAULT-APPLIED | No. Cross-organization association is prohibited (Rule 47) and structurally impossible — every query is org-filtered.                                                  |
| Q-GUAR-47     | If cross-branch guarantors were allowed, what rules apply?              | DEFERRED        | Moot while Q-GUAR-45 is No.                                                                                                                                            |
| Q-GUAR-48     | If a customer changes branch, does the guarantor move?                  | DEFAULT-APPLIED | Automatically, because scope is read through `customer.branchId` rather than copied. Rule 10 holds by construction.                                                    |
| Q-GUAR-49     | If the customer is deactivated, what happens to the guarantor?          | DEFAULT-APPLIED | Nothing. Guarantor history survives customer, branch and organization deactivation (Rules 68-70).                                                                      |
| Q-GUAR-50     | Can existing relationships stay active in a deactivated branch?         | DEFAULT-APPLIED | Yes. An inactive branch blocks only the creation of **new** guarantors (Rule 71, Scenario 35).                                                                         |
| Q-GUAR-51     | Is physical guarantor deletion ever permitted?                          | DEFAULT-APPLIED | Only at zero `LoanGuarantor` references. The delete path exists for the row typed in by mistake.                                                                       |
| Q-GUAR-52     | Is deactivation the only supported removal method?                      | DEFAULT-APPLIED | It is the only one that always works, and the one the API points at when a delete is refused (Rule 34).                                                                |
| Q-GUAR-53     | What exact downstream references block deletion?                        | DEFAULT-APPLIED | `LoanGuarantor` today — the only `Restrict` relation. Module 07 appends loan applications to `GUARANTOR_DEPENDENCIES`.                                                 |
| Q-GUAR-54     | How long are historical guarantor relationships retained?               | OPEN            | Same blocker as Q-CUST-18 / Q-AUDIT-11 — no retention policy exists anywhere yet.                                                                                      |
| Q-GUAR-55     | How long are guarantor KYC documents retained?                          | OPEN            | Same as Q-GUAR-54. Files are stored under the customer prefix so a per-customer sweep can reach them when a policy exists.                                             |
| Q-GUAR-56     | Can Field Employees view guarantor information?                         | DEFAULT-APPLIED | No. `FIELD_EMPLOYEE` is granted no guarantor permission at all; the e2e suite asserts the 403.                                                                         |
| Q-GUAR-57     | Can Field Employees add guarantors?                                     | DEFAULT-APPLIED | No, per Q-GUAR-56.                                                                                                                                                     |
| Q-GUAR-58     | Can Field Employees collect guarantor consent?                          | DEFAULT-APPLIED | No, per Q-GUAR-56.                                                                                                                                                     |
| Q-GUAR-59     | Can Field Employees operate guarantor workflows offline?                | DEFERRED        | Offline is detection-only across this codebase; tracked under `Q-OFF-*`.                                                                                               |
| Q-GUAR-60     | How should offline guarantor changes conflict with server changes?      | DEFERRED        | Same as Q-GUAR-59. Scenarios 48-50 are not implemented.                                                                                                                |
| Q-GUAR-61     | Standalone list/detail screens, or only under Customer/Loan?            | DEFAULT-APPLIED | Both. GUA-001/GUA-002 exist as a read-only org-scoped directory; every mutation stays nested under the customer.                                                       |
| Q-GUAR-62     | Are GUA-001 and GUA-002 mandatory or derived?                           | DEFAULT-APPLIED | Built as real screens, on the previously-unused `customers.guarantors.view` — the surface that permission was always describing.                                       |
| Q-GUAR-63     | Should search support Name, Mobile, ID or Customer?                     | DEFAULT-APPLIED | Name (contains), mobile (prefix), and customer name or code. One box, as on the customer list.                                                                         |
| Q-GUAR-64     | Who can export guarantor data?                                          | DEFERRED        | No export surface exists to permission, per Q-CUST-38.                                                                                                                 |
| Q-GUAR-65     | What masking rules apply to mobile and address?                         | DEFAULT-APPLIED | Mobile masked on the directory list, full on detail. Address is not masked — it is a required field the branch typed in, not an identifier.                            |
| Q-GUAR-66     | What audit fields are required for guarantor changes?                   | DEFAULT-APPLIED | The standard `AuditLog` shape plus before/after snapshots. 23 guarantor-specific actions, including the denials and the blocked delete (Rules 49-53).                  |
| Q-GUAR-67     | What concurrency strategy applies to guarantor edits?                   | DEFAULT-APPLIED | Optimistic via `expectedVersion` = `updatedAt` ISO string, identical to Q-CUST-22. A stale write is a 409 and is audited.                                              |
| Q-GUAR-68..70 | Notifications for revision, pending consent, consent confirmation       | DEFERRED        | Module 16. Nothing notifies a guarantor today.                                                                                                                         |
| Q-GUAR-71     | Is consent required before application creation or final review?        | DEFERRED        | Module 07 decides _when_ to call the readiness endpoint; this module only answers.                                                                                     |
| Q-GUAR-72     | Is guarantor KYC required before application or before review?          | DEFERRED        | Same as Q-GUAR-71.                                                                                                                                                     |
| Q-GUAR-73     | Does a guarantor need a customer master record of their own?            | DEFAULT-APPLIED | No. A guarantor is its own entity and is never given the borrower's identity or account status (Rule 30).                                                              |
| Q-GUAR-74     | If a guarantor later becomes a borrower, should the identity be reused? | DEFERRED        | No linkage exists. Creating a customer from a guarantor is manual re-entry.                                                                                            |
| Q-GUAR-75     | How should duplicate guarantor identity be merged?                      | DEFERRED        | No merge policy. Duplicates are flagged at creation and otherwise left as distinct rows.                                                                               |
| Q-GUAR-76     | Does the relationship have a lifecycle separate from the person?        | DEFAULT-APPLIED | No — they are the same row. `status` is the relationship's lifecycle, since a guarantor record exists only as a relationship to one customer.                          |

---

## 17. Loan Products & Schemes (`Q-LOAN-*`)

Module 06 was built as a **minimal slice**: products, schemes and duration
options only, because `LoanApplication` carries non-null foreign keys to a
product and a scheme and could not exist without them. Interest configuration,
penalty rules and charges are untouched and remain Module 06's own scope.

These IDs are local to this file — the Module 06 story's own `# Open Questions`
section was not the driver here; the questions below are the ones the slice had
to answer to be buildable.

| ID        | Question                                                     | Status          | Decision                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q-LOAN-1  | Who owns loan configuration?                                 | DEFAULT-APPLIED | Super Admin alone. Branch Admin holds the two view permissions and no write. Unlike the withheld-grant pattern elsewhere, this is not to make a denial provable — the source states Branch Admin is not a configuration owner. |
| Q-LOAN-2  | When may an application select a scheme?                     | DEFAULT-APPLIED | Three conditions, all required: scheme ACTIVE, product ACTIVE, and at least one ACTIVE duration option. Each has its own seed fixture and e2e assertion, because a rule checking two of three still passes a happy path.       |
| Q-LOAN-3  | Should deactivating a product cascade to its schemes?        | DEFAULT-APPLIED | **No.** Selectability reads both statuses instead. A cascade would destroy which schemes were active, so a product reinstated later could not come back as it was.                                                             |
| Q-LOAN-4  | Can a product or scheme be deleted?                          | DEFAULT-APPLIED | No delete endpoint exists. Configuration is withdrawn, never erased, because applications reference it — and an application's terms must stay reproducible (Rule 70).                                                          |
| Q-LOAN-5  | Can a scheme move between products?                          | DEFAULT-APPLIED | No. `loanProductId` is absent from the update DTO: an application reads its loan type through the product, so moving a scheme would silently re-type every application already created against it.                             |
| Q-LOAN-6  | Can a duration option be deleted once used?                  | DEFAULT-APPLIED | Refused while any application carries that frequency and count. There is no foreign key — an application stores them as values — so the guard is the only thing between a delete and an orphaned term.                         |
| Q-LOAN-7  | What is a product or scheme's initial status?                | DEFAULT-APPLIED | `DRAFT`, always, however privileged the caller. Activation is a separate decision under a separate permission, and a scheme with no term cannot be activated at all.                                                           |
| Q-LOAN-8  | Are schemes organization-wide or branch-specific?            | DEFERRED        | Organization-wide. Neither model carries a `branchId`, and the source never asks for branch-varying prices. Adding one later is a migration, not a redesign.                                                                   |
| Q-LOAN-9  | Where are per-scheme amount limits configured?               | OPEN            | Nowhere yet. Module 07 Q-APP-33..37 ask for minimum/maximum loan amounts and the schema has no column for them; the completeness gate checks only `> 0`.                                                                       |
| Q-LOAN-10 | How does global Interest Configuration relate to a scheme's? | OPEN            | Unresolved, and deliberately untouched. `InterestConfig` exists in the schema and is unused; the story warns the precedence must not be silently assumed.                                                                      |

---

## 18. Loan Applications (`Q-APP-*`) and EMI (`Q-EMI-*`)

Numbered to match the 200 entries in the Module 07 story's own `# Open Questions`
section, so `Q-APP-n` is that file's question _n_. The `Q-EMI-*` rows are the
calculation decisions, which the story raises as Q-APP-51..60 but which are
grouped separately below because they form one coherent set implemented in one
package.

### 18.1 Lifecycle and authority

| ID           | Question                                             | Status          | Decision                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-APP-1      | What exact application statuses are canonical?       | DEFAULT-APPLIED | Six are reachable. The Prisma enum's other seven (`SANCTIONED` through `CLOSED`) are never written by this module — approval is where it stops.                                                   |
| Q-APP-2      | Is `DRAFT` persisted or only a UI concept?           | DEFAULT-APPLIED | Persisted, but only from wizard step 3 onward. See D-APP-1: the row cannot exist earlier without making nine columns nullable for every later reader's sake.                                      |
| Q-APP-3      | Is `SUBMITTED` distinct from `UNDER_REVIEW`?         | DEFAULT-APPLIED | Yes. `SUBMITTED` is the unclaimed queue; `UNDER_REVIEW` means a reviewer has claimed it. Returning from `MORE_INFO_REQUIRED` goes straight to `UNDER_REVIEW`, since the reviewer already has it.  |
| Q-APP-4      | Is `MORE_INFO` a persisted state or an event?        | DEFAULT-APPLIED | Both. The state is what blocks approval; the review row is what records who asked and for what.                                                                                                   |
| Q-APP-5      | Is `SANCTIONED` an application or a loan state?      | DEFERRED        | Out of scope. The enum value exists and is never written.                                                                                                                                         |
| Q-APP-6..9   | Who is the final approval authority?                 | DEFAULT-APPLIED | Whoever holds `loans.approve` — the code Module 01 seeded, reused rather than duplicated. Seeded to Super Admin only, so Scenario 28 has a role that reaches the screen and is refused.           |
| Q-APP-10..12 | Is maker-checker required? Can the creator approve?  | DEFAULT-APPLIED | No maker-checker, per Q-CUST-9 and Q-GUAR-14. Nothing stops a creator approving their own; the actor is audited, so a separation policy is a later rule rather than a migration.                  |
| Q-APP-13..21 | What exact application permissions exist?            | DEFAULT-APPLIED | Thirteen, split finely (create / submit / review / modify_terms / reject / override_rate / delete_draft plus four document codes) because the source's own review flow separates these decisions. |
| Q-APP-22..24 | Is deletion or deactivation permitted?               | DEFAULT-APPLIED | Deletion only of an unreferenced `DRAFT`. **No `INACTIVE` state is invented** (Rules 59-61, Scenario 37) — a submitted application is history and stays.                                          |
| Q-APP-25..27 | Can a rejected application be reopened?              | DEFAULT-APPLIED | No. `REJECTED` and `APPROVED` have no outgoing transitions at all, which makes Rules 85 and 86 structural rather than a check somebody could omit.                                                |
| Q-APP-28..30 | Can a More-Info application expire? Any cycle limit? | OPEN            | No expiry, no limit. Nothing sweeps stale applications and the source defines no SLA.                                                                                                             |
| Q-APP-31..32 | What rejection-reason values are allowed?            | DEFAULT-APPLIED | Free text, mandatory, up to 1000 characters. The source requires a reason and enumerates none; an invented code list is a migration to undo.                                                      |

### 18.2 Terms, amounts and documents

| ID           | Question                                           | Status          | Decision                                                                                                                                                                                    |
| ------------ | -------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-APP-33..37 | What amount minimum/maximum applies, and where?    | OPEN            | Only `> 0` is enforced. The schema carries no limit columns; see Q-LOAN-9.                                                                                                                  |
| Q-APP-38..40 | What purpose validation applies?                   | DEFAULT-APPLIED | Free text, required, 500 characters. Note the column is nullable while the rule is not — enforcement lives in the completeness gate, so a direct SQL writer could bypass it.                |
| Q-APP-41..46 | What may change after submission?                  | DEFAULT-APPLIED | Rate, interest type, frequency and duration, through Modify Terms under its own permission. Customer, amount, purpose and scheme are fixed — changing any makes it a different application. |
| Q-APP-47..50 | Does Modify Terms need re-approval or consent?     | DEFERRED        | Neither. It stays `UNDER_REVIEW` and still needs an approve or reject, so the decision is always made against the final terms.                                                              |
| Q-APP-61..63 | What documents are required, by product?           | DEFAULT-APPLIED | `ID` + `INCOME`; plus `COLLATERAL` for `GOLD` and `VEHICLE` (D-APP-3). The source names the categories and never maps them to products.                                                     |
| Q-APP-65..67 | Can documents be replaced? Does that version them? | DEFAULT-APPLIED | Yes and yes — supersede-by-insert at `version + 1`, the idiom Modules 04 and 05 use. A replacement always arrives `PENDING`, so a rejected pack cannot be re-approved by swapping the file. |
| Q-APP-157    | Must documents be verified, or merely uploaded?    | DEFAULT-APPLIED | Uploaded, to submit — a branch cannot review its own submission before making it. A `REJECTED` document does **not** satisfy its requirement: it was reviewed and found wanting.            |
| Q-APP-95..99 | Are guarantors required? What if one lapses?       | DEFAULT-APPLIED | Not required by default (D-APP-2). An existing guarantor that is unusable blocks; an absent one never does. A guarantor lapsing mid-review is caught at submit, not continuously.           |

### 18.3 Concurrency, identity and scope

| ID             | Question                                           | Status          | Decision                                                                                                                                                                                               |
| -------------- | -------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q-APP-100..106 | Can an application move between branches?          | DEFAULT-APPLIED | No. `branchId` comes from the customer's own record and no parameter names one, so Scenarios 41-43 are impossible to express rather than merely refused.                                               |
| Q-APP-107      | Is the application ID generated server-side?       | DEFAULT-APPLIED | Yes — `APP-000001` upward, numeric maximum per organization. **Never a lexical sort**: that is the bug that already produced a misleading 503 on customer codes.                                       |
| Q-APP-108..110 | Is `Idempotency-Key` required for submission?      | DEFAULT-APPLIED | No. The project rule scopes idempotency to money-posting endpoints, and an application create is not one. A duplicate submit is refused by the transition guard instead.                               |
| Q-APP-111..118 | Offline creation and conflict resolution           | DEFERRED        | Not implemented. The server-side revalidation Rules 72-75 demand is in place — submit re-runs every check inside its own transaction — but nothing queues an application offline.                      |
| Q-APP-119..120 | Is optimistic locking required? On what field?     | DEFAULT-APPLIED | Yes, on `updatedAt` exposed as `version`. No separate column: a second concurrency idiom in one codebase is how the two drift apart.                                                                   |
| Q-APP-121..123 | What happens when approve and reject race?         | DECIDED         | Exactly one commits. Both `status` and `updatedAt` go in an `updateMany` WHERE clause and a zero count is a 409 — a read-then-write check passes for both callers before either writes. Proved by e2e. |
| Q-APP-138      | What PII masking is required on application lists? | OPEN            | None applied. The list shows the customer's name and code to anyone holding `loans.applications.view` within scope, as the screen inventory specifies.                                                 |

### 18.4 EMI calculation (`Q-EMI-*`, from Q-APP-51..60)

Implemented in `packages/emi` — a zero-dependency package rather than API code,
because the wizard needs a live preview and a second browser-side implementation
of a money formula is the kind of thing that drifts quietly until a borrower is
billed the wrong amount.

| ID       | Question                                       | Status          | Decision                                                                                                                                                                                                         |
| -------- | ---------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q-EMI-1  | What formula applies to each interest type?    | DEFAULT-APPLIED | FLAT = simple interest on the original principal. REDUCING = standard amortization. **`CUSTOM_RATE` is not a third formula** — the source names Flat/Reducing/Custom as _selections_ and defines no third maths. |
| Q-EMI-2  | How is rounding handled?                       | DEFAULT-APPLIED | Floor at every division, in `bigint` throughout. Paise never touch `number`: a rupee amount above ~90,000 crore exceeds `Number.MAX_SAFE_INTEGER` once expressed in paise.                                       |
| Q-EMI-3  | Where does the rounding residue go?            | DEFAULT-APPLIED | Entirely to the final instalment, so the schedule sums exactly to the total payable. The borrower budgets against the early instalments; the last is where a payoff quote is recomputed anyway.                  |
| Q-EMI-4  | How many periods are there in a year?          | DEFAULT-APPLIED | 365 daily, 52 weekly, 12 monthly, 4 quarterly, 1 yearly. All integers — a fractional count would make the periodic rate's denominator fractional and lose the exactness the package rests on.                    |
| Q-EMI-5  | Are due dates DATE-only, and in which zone?    | DEFAULT-APPLIED | `YYYY-MM-DD` in Asia/Kolkata, built from `{year, month, day}` integers so no conversion ever runs. Month-end clamped (31 Jan + 1 month is 28/29 Feb). First due is one full period after the anchor.             |
| Q-EMI-6  | What fields does the preview show?             | DEFAULT-APPLIED | Instalment, final instalment, totals for principal / interest / payable, count, first and last due date, and the full schedule.                                                                                  |
| Q-EMI-7  | Is a zero interest rate legal?                 | DEFAULT-APPLIED | Yes, and it short-circuits to `principal / n` — the amortization formula divides by zero there.                                                                                                                  |
| Q-EMI-8  | What rate precision is allowed?                | DEFAULT-APPLIED | Integer basis points only. No sub-basis-point rates.                                                                                                                                                             |
| Q-EMI-9  | What duration precision is allowed?            | DEFAULT-APPLIED | A positive integer number of periods, for every frequency. Capped at 10,000.                                                                                                                                     |
| Q-EMI-10 | May an application override the scheme's rate? | DEFAULT-APPLIED | Only under `CUSTOM_RATE`, and only with `loans.applications.override_rate` — withheld from Branch Admin, because pricing off the scheme is a configuration decision.                                             |
| Q-EMI-11 | How is `(1+r)^n` computed?                     | DEFAULT-APPLIED | Binary exponentiation in scaled integer arithmetic at scale 10^12. `Math.pow` is float and would put a rounding error under every instalment in the schedule.                                                    |
| Q-EMI-12 | When must the EMI be recalculated?             | DEFAULT-APPLIED | Server-side at submit and again at approve, and on every read of the detail screen. The client's preview is never trusted, and no schedule is persisted that could disagree with its own terms.                  |

---

## 19. Settings, Audit & Maintenance (`Q-SET-*`)

Module 17. The settings registry, configuration governance, business calendar,
EOD, maintenance jobs and mode, and the audit trail are built. Two areas of the
source scenarios are recorded here.

| ID       | Question                                      | Status          | Answer                                                                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q-SET-1  | Are retention policies configurable?           | DEFAULT-APPLIED | Yes — `RetentionPolicy`, one ACTIVE policy per record category per organization (partial unique index, so deactivate-then-replace stays open). Scenarios 55-58.                                                                                                                                                       |
| Q-SET-2  | Which categories are protected from purge?     | DEFAULT-APPLIED | `AUDIT_LOG`, `LEDGER_ENTRY`, `JOURNAL_ENTRY`. `immutableEvidence` is derived from the category server-side and stored — never client-supplied, or a caller could mark ledger evidence purgeable (Rule 76). Enforced in the DTO, the service and a CHECK constraint.                                                    |
| Q-SET-3  | Is retention branch-scoped?                    | DEFAULT-APPLIED | No. `RetentionPolicy` has **no `branchId` column** (the `Guarantor` precedent): retention is an organization-wide compliance question, so a per-branch policy is not expressible rather than expressible-and-ignored.                                                                                                  |
| Q-SET-4  | Can a retention policy be deleted?             | DEFAULT-APPLIED | Only while `referencedAt` is null. Once it has governed processing, deletion is a 409 naming deactivation as the alternative (Scenario 56) — deleting one whose decisions are reflected in purged data would leave audit history pointing at a policy that no longer exists.                                          |
| Q-SET-5  | Who may run a purge?                           | DEFAULT-APPLIED | Nobody by default. `retention.purge.run` is withheld from **every** seeded role including Super Admin, alongside `field.checkin` and `recovery.writeoff.post`. Scenario 58 needs an account that reaches retention administration and is still refused the purge.                                                      |
| Q-SET-6  | Does a purge run automatically?                | DEFERRED        | No purge executor exists. `assertPurgeAllowed` is the guard a future one must call — it throws rather than returning a boolean, so a caller cannot proceed by ignoring a return value, and it audits every refusal as `RETENTION_PURGE_BLOCKED`.                                                                       |
| Q-SET-7  | Is configuration import/export supported?      | DEFAULT-APPLIED | Yes. `GET /settings/export` and `POST /settings/import`. The source's "where enabled" is read as a PERMISSION rather than a feature flag: `settings.export` and `settings.import` are separate codes, both withheld from Branch Admin, so "not enabled" is expressed by not granting them. Scenarios 59-62.             |
| Q-SET-8  | How does an import avoid a partial apply?      | DEFAULT-APPLIED | Two passes. Every entry is validated into a plan, and only a wholly valid plan is written, inside one transaction (Rule 83, Scenario 60). Validating while writing would leave the entries before the failure already active. A refusal names every bad entry, so one round trip tells the operator all of it.          |
| Q-SET-9  | What stops an import overwriting newer config? | DEFAULT-APPLIED | Each entry may carry the `version` it was exported at; an entry older than the stored row is a conflict, not an overwrite (Scenario 61). An entry with no version cannot prove it knew the current value, so it is create-only. The write is a conditional `updateMany`, so a row that moves mid-import fails too.      |
| Q-SET-10 | Can an import write protected settings?        | DEFAULT-APPLIED | Only with `settings.protected.manage` as well (Rule 84) — import must not become a way around a permission the single-setting path enforces. An entry exported WITHOUT its value (masked) is refused by name rather than written as null over a real value.                                                             |

---

## Resolution Priority

Answer in this order — earlier groups unblock later stories.

| Priority                           | Themes                                    | Unblocks                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1 — blocks Module 01 build**    | `Q-PWD-*`, `Q-AUTH-1..11`, `Q-SESS-1..30` | Sign-In, and every other auth story                                                                                                                                                                                                                                                                                                   |
| **P2 — blocks Module 03 build**    | `Q-RBAC-*`                                | Users/Roles/Permissions — **resolved**; the 17 that gated the build are DEFAULT-APPLIED (see §9). The rest concern bulk operations, CSV import and self-service editing, none of which Module 03 implements.                                                                                                                          |
| **P3 — blocks Signup & recovery**  | `Q-ACT-*`, `Q-REC-*`, `Q-NOTIF-*`         | Signup, Forgot/Reset/Change Password                                                                                                                                                                                                                                                                                                  |
| **P4 — blocks field operations**   | `Q-GPS-*`, `Q-OFF-*`                      | GPS Check-in, offline collections                                                                                                                                                                                                                                                                                                     |
| **P4b — blocks Module 04 build**   | `Q-CUST-*`                                | Customers & KYC — **resolved**; the questions that gated the build are DEFAULT-APPLIED (see §15). The rest concern retention (blocked on `Q-AUDIT-11`), bulk import/export, branch moves and offline sync.                                                                                                                            |
| **P4c — blocks Module 05 build**   | `Q-GUAR-*`                                | Guarantors — **resolved**; the questions that gated the build are DEFAULT-APPLIED (see §16). The rest wait on the loan product (requirement rules, replacement after disbursement) or on retention and offline sync.                                                                                                                  |
| **P4d — blocks Modules 06/07**     | `Q-LOAN-*`, `Q-APP-*`, `Q-EMI-*`          | Loan Products & Applications — **partly resolved**; the questions that gated the build are DEFAULT-APPLIED (see §17, §18). Still genuinely open: amount limits (`Q-LOAN-9`, `Q-APP-33..37`), the global-vs-scheme interest precedence (`Q-LOAN-10`), application expiry and SLA (`Q-APP-28..30`), and list PII masking (`Q-APP-138`). |
| **P5 — blocks lending domain**     | `Q-DOM-*`                                 | Loans, EMI, Collections, Accounting modules. `Q-GUAR-11` and `Q-GUAR-24..32` must be answered here — they are what lets the guarantor readiness gate report `required` as something other than null. Sanction onward (`Q-APP-5`, `Q-APP-164..175`) also lands here, since Module 07 stops at approval.                                |
| **P6 — contractual / operational** | `Q-NFR-*`, `Q-AUDIT-*`                    | SLAs, DR plan, compliance sign-off                                                                                                                                                                                                                                                                                                    |
| **P7 — confirmations**             | `Q-SRC-*`                                 | Product sign-off that added screens are intended                                                                                                                                                                                                                                                                                      |

## Maintenance

- When a new user story is written, append its `# Open Questions` entries here
  under the matching theme and give them the next free ID in that theme.
- Never delete a resolved row — set Status to `DECIDED` and record the answer so
  the rationale stays traceable.
- Keep the per-story `# Open Questions` sections as the source of truth for
  wording; this file is the index and decision log.
