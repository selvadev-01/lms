# User Story — Field Employee GPS Check-in

## Epic

Authentication & Session Management

## Feature

Field Employee GPS Check-in — Location Verification Before Online Field Operations

## User Story

As a **Field Employee / Collection Agent**  
I want the LMS to verify my current location when I start an online field session  
So that field operations are associated with the Field Employee's verified working location.

As an **LMS administrator**  
I want Field Employee location verification to fail safely when GPS or location services are unavailable or invalid  
So that the system does not falsely record an unverified location as a valid field check-in.

The uploaded Field Employee flow explicitly shows:

`Field Employee Login → Network Available? → Online → GPS Check-in → Location Verified`

and separately:

`Network Available? → Offline Mode → Load Cached Data`

The source therefore establishes GPS Check-in and Location Verified for the online path, and Offline Mode for the no-network path. It does **not** define the exact GPS failure branch, accuracy threshold, geofence, retry count, or check-in storage model. Those items are explicitly left as Open Questions rather than invented. fileciteturn0file5

## Rules & Business Constraints

1. GPS Check-in applies to the Field Employee / Collection Agent online field-operation flow.
2. The Field Employee must authenticate before entering the protected field-operations area.
3. The Field Employee flow evaluates network availability after login.
4. When network connectivity is available, the online path proceeds to GPS Check-in.
5. GPS Check-in must obtain a location result from the device's supported location services.
6. The system must distinguish between a valid location result and a location failure.
7. The source diagram explicitly shows `GPS Check-in → Location Verified`, but does not define the failure path.
8. The system must never mark a GPS check-in as verified when no valid location result has been obtained.
9. The system must not fabricate, infer or reuse a stale location as the current verified location unless an explicit product rule permits it.
10. The exact GPS accuracy threshold is not defined by the source.
11. The exact geofence/radius rule is not defined by the source.
12. The exact location-permission behavior is not defined by the source.
13. The exact number of GPS retries is not defined by the source.
14. The exact behavior after repeated GPS failure is not defined by the source.
15. The Field Employee must be informed when location verification cannot be completed.
16. A failed GPS check-in must not falsely transition the user into a verified online field-operation state.
17. If the device has no network, the source flow enters Offline Mode and loads cached data instead of following the online GPS path. fileciteturn0file5
18. Offline Mode must not be treated as a successful GPS verification.
19. Offline operational data must not be presented as server-synchronized unless synchronization has actually occurred.
20. A GPS check-in must be associated with the authenticated Field Employee.
21. A GPS check-in must preserve the Field Employee's organization and branch scope.
22. A Field Employee must not use GPS check-in to obtain access to another branch's records.
23. Location data must not alter the Field Employee's role or permissions.
24. GPS Check-in must not create, edit or delete user accounts.
25. User-account administration belongs to Module 3.
26. GPS Check-in must not create a loan, modify a loan, approve a loan or disburse a loan.
27. GPS Check-in must not create or modify customer KYC information unless a separate business action explicitly performs that operation.
28. GPS Check-in must not create a financial transaction.
29. Money is always integer paise throughout the LMS; GPS Check-in has no monetary amount.
30. EMI due dates are DATE-only and Asia/Kolkata; GPS Check-in has no EMI due date.
31. Every money movement posts double-entry lines that sum to zero; GPS Check-in creates no money movement.
32. Payment posting is idempotent on `Idempotency-Key`; this financial rule does not apply to GPS Check-in.
33. The ledger is append-only; GPS Check-in never edits or deletes ledger entries.
34. Every record is scoped by organization and branch.
35. Deletion is blocked where downstream references exist; GPS check-in records, if persisted, must not be physically deleted when referenced by audit or operational history.
36. Deactivation is used instead of destructive deletion where the underlying business record supports lifecycle state.
37. All GPS check-in actions and outcomes are audit logged.
38. Sensitive location data must not be exposed beyond the permissions required for field operations and audit purposes.
39. The exact location-retention policy is not defined by the source and remains an Open Question.
40. The exact offline synchronization conflict rules for GPS check-in are not defined by the source and remain Open Questions.
41. A GPS check-in failure must not prevent normal application security from remaining enforced.
42. Logout remains a separate session action in the Field Employee flow. fileciteturn0file5
43. All actions are audit logged.

## Background

Given the user is a Field Employee / Collection Agent  
And the Field Employee has successfully authenticated  
And the Field Employee is entering the field-operations area

The source Field Employee flow starts with Field Employee Login and evaluates `Network Available?`.

When the network is available, the flow proceeds through `Online → GPS Check-in → Location Verified`.

When the network is unavailable, the flow proceeds through `Offline Mode → Load Cached Data → Customer List`. fileciteturn0file5

The GPS Check-in screen is therefore an online field-operation checkpoint. It must not be confused with the general authentication screen or with customer location information.

## Feature: Field Employee GPS Check-in Management

### Menu

Field Operations → GPS Check-in

Actions: Request Location, Check Location, Retry, Continue After Verification, Continue in Offline Mode where the source network path applies, Cancel/Back

# GPS Check-in — Fields

## Location Information

| Field Name                     | Mandatory |
| ------------------------------ | --------: |
| Current Location *             |         * |
| Location Verification Status * |         * |
| Location Timestamp *           |         * |

## Device / Verification Information

| Field Name                 | Mandatory |
| -------------------------- | --------: |
| GPS Accuracy               |           |
| Latitude                   |           |
| Longitude                  |           |
| Device Location Permission |         * |
| Network Status *           |         * |

**Important:** The exact UI visibility of latitude, longitude, accuracy and device-permission state is not defined by the source diagram. These are implementation-level fields required to represent the location-verification result and must be confirmed before final UI implementation.

# Location State

## Location Permission

The device must provide the application with the location capability required to obtain a GPS position.

If permission is denied or unavailable, verification cannot be treated as successful.

## Location Acquisition

The application requests the current device location.

## Location Verified

The source flow explicitly names `Location Verified` as the successful outcome of GPS Check-in. fileciteturn0file5

A location may be marked verified only after the finalized verification rules have passed.

## Location Verification Failed

The source does not define the exact failure node.

The system must fail closed: no successful location-verification state is created when location acquisition or verification fails.

The exact retry, fallback and escalation behavior remains an Open Question.

# Table Only (Not for UI)

| Internal Field        | Allowed Values / Storage                                      |
| --------------------- | ------------------------------------------------------------- |
| `user_id`             | Authenticated Field Employee reference                        |
| `organization_id`     | Existing organization reference                               |
| `branch_id`           | Existing Field Employee branch scope                          |
| `check_in_id`         | Unique GPS check-in reference                                 |
| `latitude`            | Decimal geographic coordinate, subject to finalized precision |
| `longitude`           | Decimal geographic coordinate, subject to finalized precision |
| `accuracy`            | Device-reported location accuracy where available             |
| `location_timestamp`  | Device/server timestamp according to finalized clock policy   |
| `network_status`      | `ONLINE`, `OFFLINE`                                           |
| `permission_status`   | `GRANTED`, `DENIED`, `UNAVAILABLE`, `UNKNOWN`                 |
| `verification_status` | `PENDING`, `VERIFIED`, `FAILED`, `EXPIRED`, `CANCELLED`       |
| `failure_reason`      | Controlled failure classification                             |
| `sync_status`         | `NOT_APPLICABLE`, `PENDING`, `SYNCED`, `CONFLICT`, `FAILED`   |
| `created_at`          | Record creation timestamp                                     |
| `verified_at`         | Nullable successful verification timestamp                    |
| `audit_event_id`      | Immutable audit reference                                     |

# Gherkin Scenarios

## Access and Online Path

### Scenario 1: Authenticated Field Employee enters GPS Check-in online

Given the Field Employee has successfully authenticated  
And the account is active  
And network connectivity is available  
When the Field Employee enters the field-operations flow  
Then the system enters the Online path  
And GPS Check-in is initiated  
And the user is shown the location-verification state  
And the transition is audit logged. fileciteturn0file5

### Scenario 2: Unauthenticated user cannot access GPS Check-in

Given the user does not have an active authenticated Field Employee session  
When the user attempts to open GPS Check-in directly  
Then the system denies access  
And no GPS check-in is recorded as verified  
And the access-denial event is audit logged.

### Scenario 3: Non-Field-Employee role cannot use Field Employee GPS Check-in

Given the authenticated user does not have the Field Employee / Collection Agent role  
When the user attempts to access the Field Employee GPS Check-in operation  
Then the system denies the operation  
And no Field Employee check-in is created  
And the permission denial is audit logged.

## Successful GPS Check-in

### Scenario 4: GPS location is successfully acquired and verified

Given the Field Employee is authenticated  
And network connectivity is available  
And device location permission is available  
And the device returns a valid current location  
And the finalized location-verification rules are satisfied  
When the Field Employee performs GPS Check-in  
Then the system marks the location as `VERIFIED`  
And records the applicable location information  
And associates the check-in with the Field Employee  
And associates the check-in with the user's organization and branch scope  
And records the successful verification timestamp  
And the successful check-in is audit logged. fileciteturn0file5

### Scenario 5: Verified location allows the online flow to continue

Given the Field Employee has completed a successful GPS Check-in  
And the location status is `VERIFIED`  
When the Field Employee continues  
Then the system allows the Field Employee to proceed through the verified online field-operation flow  
And the user remains restricted to the assigned organization and branch scope  
And the transition is audit logged.

## GPS Failure Paths

### Scenario 6: GPS cannot obtain a location

Given the Field Employee is online  
And GPS Check-in has been initiated  
And the device cannot obtain a current location  
When the system attempts location acquisition  
Then the system does not mark the location as verified  
And no successful GPS check-in is recorded  
And the user receives a controlled location-failure message  
And the failure is audit logged.

### Scenario 7: Location permission is denied

Given the Field Employee is online  
And the device location permission is denied  
When the Field Employee attempts GPS Check-in  
Then the system does not mark the location as verified  
And the system informs the user that required location permission is unavailable  
And the Field Employee cannot be represented as successfully location verified  
And the failure is audit logged.

### Scenario 8: Device location services are disabled

Given the Field Employee is online  
And device location services are disabled  
When the Field Employee attempts GPS Check-in  
Then the system cannot establish a verified current location  
And the check-in remains unverified  
And the system informs the user that location services are unavailable  
And the failure is audit logged.

### Scenario 9: Location result is unavailable or invalid

Given GPS Check-in has been initiated  
And the device returns no usable coordinate result  
When the system evaluates the location  
Then the verification fails  
And no verified check-in is created  
And the system displays the applicable failure state  
And the failure is audit logged.

### Scenario 10: Location accuracy does not satisfy the finalized rule

Given the device returns a location  
And the finalized product policy defines an acceptable accuracy threshold  
And the returned location is outside the permitted accuracy threshold  
When the system evaluates the location  
Then the system does not mark the location as verified  
And the check-in remains failed or pending according to the finalized state model  
And the failure is audit logged.

**Open Question:** The uploaded flow does not define the accuracy threshold.

### Scenario 11: GPS check-in times out

Given GPS Check-in has been initiated  
And the device does not return a valid location within the configured acquisition period  
When the acquisition timeout is reached  
Then the system does not mark the check-in as verified  
And the user receives a controlled timeout message  
And the timeout is audit logged.

**Open Question:** The source does not define the GPS timeout duration.

### Scenario 12: GPS provider returns an error

Given GPS Check-in is in progress  
And the device location provider returns an error  
When the system processes the error  
Then the check-in is not marked as verified  
And the user receives a controlled failure state  
And the system does not fabricate a location  
And the error is audit logged.

## Retry and Recovery

### Scenario 13: Field Employee retries after GPS failure

Given the previous GPS Check-in attempt failed  
And the Field Employee remains online  
When the Field Employee selects Retry  
Then the system starts a new location-acquisition attempt  
And the previous failed attempt remains recorded as a failed event where audit persistence applies  
And the new attempt receives its own outcome  
And the retry is audit logged.

### Scenario 14: Repeated GPS failures remain unverified

Given multiple GPS Check-in attempts have failed  
When another attempt fails  
Then the system does not convert the failed attempts into a successful verification  
And the Field Employee remains unverified  
And each relevant failure is audit logged.

### Scenario 15: Successful retry after an earlier failure

Given a previous GPS Check-in attempt failed  
And a subsequent GPS attempt obtains a valid location  
And the finalized verification rules are satisfied  
When the Field Employee retries GPS Check-in  
Then the subsequent attempt is marked `VERIFIED`  
And the successful check-in is associated with the current attempt  
And the previous failed attempt is not rewritten as successful  
And the successful retry is audit logged.

## Network Behaviour

### Scenario 16: Network is available and GPS check-in is initiated

Given the Field Employee has authenticated  
And network connectivity is available  
When the Field Employee enters the field flow  
Then the system follows the Online path  
And GPS Check-in is initiated  
And the application does not incorrectly enter Offline Mode. fileciteturn0file5

### Scenario 17: Network becomes unavailable before GPS verification completes

Given the Field Employee entered the Online path  
And GPS Check-in is in progress  
When network connectivity is lost before verification completes  
Then the system does not falsely mark the check-in as server-verified  
And the current check-in state is handled according to the finalized offline/synchronization policy  
And no unsynchronized state is presented as server-confirmed  
And the transition is audit logged.

**Open Question:** The source only defines the initial Network Available? decision and does not define a mid-check-in network-loss path.

### Scenario 18: Network is unavailable at Field Employee entry

Given the Field Employee has authenticated or has a valid offline application state  
And network connectivity is unavailable  
When the Field Employee enters the field flow  
Then the system follows Offline Mode  
And cached data is loaded  
And the system does not claim that GPS Check-in has been successfully server-verified  
And the offline transition is audit logged. fileciteturn0file5

### Scenario 19: Offline Mode loads cached operational data

Given the Field Employee is in Offline Mode  
And cached data is available  
When the Field Employee continues  
Then the system loads the cached data  
And the Customer List can be accessed according to the offline flow  
And the cached data is clearly treated as offline data  
And the offline operation is audit logged where supported. fileciteturn0file5

### Scenario 20: Offline Mode has no cached data required for the operation

Given the Field Employee is offline  
And the required cached operational data is unavailable  
When the Field Employee attempts to continue  
Then the system does not fabricate missing customer or operational records  
And the user receives an appropriate offline-data failure state  
And the failure is audit logged.

**Open Question:** The source shows Load Cached Data but does not define behavior when required cache data is absent.

## Stale Location and Security

### Scenario 21: Stale location is not treated as current without an approved rule

Given the device has a previously captured location  
And a current GPS acquisition has not succeeded  
When the Field Employee attempts GPS Check-in  
Then the system must not silently mark the stale location as the current verified location  
And the check-in remains unverified unless an explicit finalized stale-location policy permits it  
And the outcome is audit logged.

### Scenario 22: Location from another user cannot be reused

Given the device contains location data associated with another user or prior account context  
When the current Field Employee attempts GPS Check-in  
Then the system associates the check-in only with the authenticated Field Employee  
And the system does not reuse another user's verification state  
And the security event is audit logged.

### Scenario 23: GPS check-in cannot change user role

Given a Field Employee has a valid GPS location  
When the location is verified  
Then the user's role remains Field Employee / Collection Agent  
And GPS verification does not grant administrative permissions  
And the role remains unchanged.

### Scenario 24: GPS check-in cannot change branch assignment

Given the Field Employee belongs to Branch A  
And the GPS location is physically closer to Branch B  
When GPS Check-in is verified  
Then the user's branch assignment remains Branch A  
And the GPS result does not automatically change organizational scope  
And Branch B records remain inaccessible.

## Branch Scoping

### Scenario 25: Branch Employee sees only their branch-scoped operational data after verification

Given the Field Employee belongs to Branch A  
And the GPS check-in is verified  
When the Field Employee continues into field operations  
Then operational data remains scoped to the user's organization and Branch A  
And Branch B records are not exposed  
And any cross-branch access attempt is denied and audit logged.

### Scenario 26: Cross-organization location verification does not grant access

Given the Field Employee belongs to Organization A  
And the device location is physically within or near an area associated with Organization B  
When GPS Check-in succeeds  
Then the user's organization scope remains Organization A  
And Organization B records are not exposed  
And location verification does not alter tenant authorization.

## Active / Inactive Behaviour

### Scenario 27: Active Field Employee can perform GPS Check-in

Given the Field Employee account status is `ACTIVE`  
And the user has an authenticated session  
And network connectivity is available  
When the Field Employee performs GPS Check-in  
Then the system permits the verification flow  
And a successful location may be recorded if the location rules pass  
And the event is audit logged.

### Scenario 28: Inactive Field Employee cannot establish a new verified field session

Given the Field Employee account status is `INACTIVE`  
When the user attempts to enter a new field-operation session  
Then the system denies the protected operation  
And no new GPS check-in is accepted as an authorization bypass  
And the denial is audit logged.

### Scenario 29: Existing session is revalidated against account status

Given a Field Employee previously authenticated  
And the account is subsequently deactivated  
When the user attempts a new GPS Check-in  
Then the system validates the current account status  
And does not allow a deactivated user to use GPS Check-in to bypass account controls  
And the denial is audit logged.

## Permission Denial

### Scenario 30: Wrong role attempts Field Employee GPS Check-in

Given the authenticated user does not have Field Employee / Collection Agent permission  
When the user attempts GPS Check-in  
Then the system denies the operation  
And no verified Field Employee check-in is created  
And the permission denial is audit logged.

## Mandatory Validation

### Scenario Outline: GPS Check-in rejects missing mandatory information

Given the Field Employee is on the GPS Check-in screen  
When the user attempts to continue without `<field>`  
Then the system shows "<message>"  
And the check-in is not marked as verified  
And the failure is audit logged.

Examples:

| field                        | message                                  |
| ---------------------------- | ---------------------------------------- |
| Current Location             | Current Location is required             |
| Location Verification Status | Location Verification Status is required |
| Location Timestamp           | Location Timestamp is required           |
| Device Location Permission   | Device Location Permission is required   |
| Network Status               | Network Status is required               |

**Note:** These UI-level mandatory fields are derived from the need to represent the source's GPS Check-in and Network Available states; the exact UI field list is not explicitly shown in the source and requires confirmation.

## Downstream Transactions

### Scenario 31: GPS verification does not itself create a financial transaction

Given the Field Employee successfully completes GPS Check-in  
When the location becomes verified  
Then the system does not create a payment transaction  
And no debit or credit ledger lines are posted  
And no EMI payment is recorded  
And the GPS event is audit logged.

### Scenario 32: GPS verification does not alter repayment amounts

Given a Field Employee has a verified location  
When the Field Employee continues into collection operations  
Then loan principal, interest, penalty and fees remain unchanged until an authorized collection action occurs  
And no financial appropriation occurs as part of GPS Check-in.

## Audit and Persistence

### Scenario 33: Successful GPS check-in is audit logged

Given a valid location is successfully verified  
When the check-in is committed  
Then an immutable audit event is recorded  
And the event identifies the Field Employee  
And the organization and branch scope are recorded  
And the verification result is recorded  
And sensitive information is handled according to the location-data policy.

### Scenario 34: Failed GPS check-in is audit logged

Given GPS Check-in fails  
When the system records the failure  
Then an audit event is created  
And the failure category is recorded  
And no false successful verification event is created.

### Scenario 35: GPS check-in persistence fails

Given the location has passed the verification rules  
When the system cannot persist the check-in record  
Then the system does not claim that the check-in was durably recorded  
And the user receives a controlled failure state  
And the persistence failure is audit logged where possible.

## Sync Conflict

### Scenario 36: Offline location event conflicts during synchronization

Given an offline Field Employee event exists locally  
And the event later attempts synchronization  
And the server identifies a conflicting check-in state  
When synchronization processes the event  
Then the system must not silently overwrite authoritative server state  
And the conflict is recorded according to the finalized synchronization policy  
And the Field Employee is informed when user action is required  
And the conflict is audit logged.

**Open Question:** The source does not define the GPS synchronization conflict-resolution strategy.

### Scenario 37: Duplicate GPS event does not create uncontrolled duplicate verification

Given the same GPS check-in event is submitted more than once due to retry or synchronization  
When the server receives the duplicate event  
Then the system must detect the duplicate according to the finalized event identity/idempotency mechanism  
And must not create uncontrolled duplicate authoritative check-ins  
And the duplicate handling is audit logged.

## Logout

### Scenario 38: Field Employee can leave the authenticated field session through Logout

Given the Field Employee has an authenticated session  
And the Field Employee has completed or abandoned GPS Check-in  
When the Field Employee selects Logout  
Then the session is terminated according to the session policy  
And subsequent protected field operations require valid authentication  
And the logout is audit logged. fileciteturn0file5

# Acceptance Criteria

- GPS Check-in is available only to an authenticated Field Employee / Collection Agent with the required permission.
- The Field Employee online flow proceeds through GPS Check-in before the `Location Verified` state. fileciteturn0file5
- A successful current location can be marked `VERIFIED` only after the finalized verification rules pass.
- GPS failure never creates a false successful verification.
- Location permission failure is handled as a verification failure.
- Disabled/unavailable device location services are handled as a verification failure.
- Invalid or unavailable location results are rejected.
- GPS timeout is handled safely.
- GPS provider errors are handled safely.
- GPS retry does not rewrite previous failed attempts as successful.
- Offline Mode is distinct from successful GPS verification.
- When the network is unavailable at the source decision point, the Field Employee follows Offline Mode and loads cached data. fileciteturn0file5
- Offline Mode does not claim server-confirmed GPS verification.
- Branch and organization scope remain unchanged by GPS verification.
- GPS verification cannot change the user's role or permissions.
- Inactive Field Employees cannot use GPS Check-in to bypass account controls.
- Wrong roles cannot access Field Employee GPS Check-in.
- Mandatory GPS/network verification data is validated before completion.
- GPS Check-in does not create financial transactions.
- GPS Check-in does not post debit/credit ledger lines.
- GPS Check-in does not modify loan balances or repayment amounts.
- GPS events preserve organization and branch scope.
- GPS failures are audit logged.
- GPS successes are audit logged.
- Synchronization conflicts are not silently overwritten.
- Duplicate synchronization events do not create uncontrolled duplicate authoritative check-ins.
- No plaintext password or sensitive authentication secret is stored as part of GPS Check-in.
- All actions are audit logged.
