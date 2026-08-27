# User Story — Users, Employees, Roles & Permissions

## Module

Users, Employees, Roles & Permissions

## Epic

User & Access Management

## Feature

User Account, Employee Assignment, Role & Permission Management

## User Stories

As a Super Admin  
I want to create and manage administrators  
So that authorized people can operate the LMS according to their assigned access.

As a Super Admin  
I want to add, assign and deactivate employees  
So that employees can be associated with the appropriate operational scope and removed from active operations when necessary.

As an authorized administrator  
I want to create roles and assign module permissions  
So that LMS access can be controlled without hard-coding permissions solely by job title.

As an LMS user  
I want my access to be restricted by my organization, branch, role and permissions  
So that I cannot access data or operations outside my authorized scope.

**Source boundary:** The LMS baseline identifies Employee & Role Management as a core capability. The Super Admin flow explicitly exposes **Admin Management — Create & Manage Admins**, **Employee Management — Add, Assign, Deactivate**, and **Role & Permission Management → Create Role → Assign Module Permissions → Save & Activate**. The source does not define the detailed admin form, employee assignment target, complete permission catalog, or full user lifecycle, so those gaps remain Open Questions rather than being presented as source-defined facts. fileciteturn1file7 fileciteturn1file10

## Scope Relationship

This module controls:

- User identity/account lifecycle
- Employee lifecycle
- Role definitions
- Module permissions
- Organization scope
- Branch scope
- Assignment of users/employees to operational scope
- Account activation/deactivation
- Authorization enforcement

This module does **not** replace:

- Authentication/session lifecycle from the authentication/session module
- Organization/branch master-data management from Module 2
- Customer management
- Loan management
- Collection management
- Reports
- Notifications

The session-management source explicitly states that user-account creation, editing, activation, deactivation and deletion belong to Module 3. fileciteturn3file2

# Source-Defined Navigation

## Super Admin

Super Admin Dashboard

→ Admin Management — Create & Manage Admins

→ Employee Management — Add, Assign, Deactivate

→ Role & Permission Management

→ Create Role

→ Assign Module Permissions

→ Save & Activate

The Super Admin flow exposes these actions directly. fileciteturn1file10

## Branch Admin

Branch Admin Dashboard

→ Employee Management

The Branch Admin diagram exposes Employee Management but does not define its internal workflow or prove that Branch Admin receives the same Add / Assign / Deactivate permissions shown for Super Admin. This remains an Open Question. fileciteturn1file3

# Business Rules & Constraints

1. Every user account must have an explicit account identity.
2. Every operational user must have an authorized organization scope.
3. Branch-scoped users must have an authorized branch scope.
4. A user must not access data outside the authenticated organization scope.
5. A Branch Admin must remain restricted to the assigned branch unless an explicit permission allows broader access.
6. A Field Employee / Collection Agent must remain restricted to the assigned organization and branch scope.
7. Role and permission checks must be enforced server-side.
8. Client-supplied role, organization or branch identifiers cannot override authenticated authorization context.
9. A user account cannot establish a new valid session while inactive.
10. A locked account cannot establish a new valid session while the lock is active.
11. Deactivating a user must stop future authenticated access according to the finalized session policy.
12. Existing sessions of a deactivated user must not be allowed to bypass account deactivation.
13. User deactivation must not delete historical business records created by that user.
14. Historical audit records must preserve the actor reference even after account deactivation.
15. Employee deactivation must not silently delete historical collection, assignment, loan or audit records.
16. Deactivated employees must not receive new operational assignments.
17. Deactivated Field Employees must not receive new collection assignments.
18. Existing historical assignments remain queryable according to authorization.
19. Role assignment must be explicit.
20. A user must not inherit permissions merely because a similarly named job title exists.
21. A role contains module permissions.
22. Permission assignment is managed through Role & Permission Management.
23. Saving a role does not grant it to a user unless the user is assigned that role.
24. An inactive role must not grant new authorization.
25. Role activation/deactivation must be controlled by authorized administrators.
26. A user must not activate or deactivate a role unless the user has the required permission.
27. A user must not grant another user permissions that the acting user is not authorized to delegate.
28. Super Admin permissions are not explicitly defined as restrictable by the source; whether Super Admin is always unrestricted remains an Open Question.
29. Organization scope is an authorization boundary.
30. Branch scope is an authorization boundary.
31. Scope filtering must occur at the server/API/data-access layer, not only in the UI.
32. A Branch Admin cannot change branch scope through request parameters.
33. A Field Employee cannot change assigned branch scope through client input.
34. A role permission must not grant cross-organization access unless that capability is explicitly modeled and authorized.
35. Report permissions must remain permission-based rather than hard-coded solely by role.
36. Report permissions include, where finalized by the Reports module, actions such as view, generate, export PDF, export Excel, email and view-all-branches.
37. User and employee changes must be audit logged.
38. Role and permission changes must be audit logged.
39. Permission-denied attempts must be audit logged.
40. Account activation/deactivation must be audit logged.
41. Role activation/deactivation must be audit logged.
42. Assignment changes must be audit logged.
43. Deleting a user is blocked when retained historical references require the actor record.
44. Deactivation is preferred over destructive deletion where historical/audit references exist.
45. A user account must not be physically deleted merely to remove operational access.
46. User credentials/secrets must not be exposed in audit logs.
47. Session identifiers must not be stored in reusable/plaintext form in audit logs.
48. Password/security operations remain part of authentication/security workflows and are not duplicated here.
49. User role/permission changes must not silently rewrite historical transactions.
50. A change of employee branch assignment must not move historical collections or financial records to the new branch.
51. New assignments use the employee's current authorized organization/branch scope.
52. Existing loans, collections, accounting records and audit events retain their historical organizational context.
53. A deactivated employee cannot be selected for a new field-collection assignment.
54. A user with insufficient permission cannot create, edit, activate, deactivate or assign roles/users.
55. Failed authorization must fail closed.
56. Authorization errors must not reveal protected data.
57. An authorization decision must be based on the authenticated server-side identity and current permission state.
58. Cached/offline Field Employee data does not prove that a server session remains valid.
59. Offline Field Employee operations remain subject to the employee's assigned scope during synchronization.
60. A role/permission change must not be implemented as a client-only feature; API authorization must enforce it.

# Account Status Model

The exact status names are not fully defined by the Super Admin diagram. The following states are the implementation baseline used by this module and must be confirmed against the final status dictionary.

| Status     | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `ACTIVE`   | User can authenticate and perform authorized operations                 |
| `INACTIVE` | User cannot establish a new valid session                               |
| `LOCKED`   | Authentication is blocked while the lock is active                      |
| `PENDING`  | Account exists but is not yet active, if onboarding requires this state |

The session-management baseline explicitly treats inactive and locked accounts as unable to establish valid new sessions. fileciteturn3file2

# Role Status Model

| Status     | Meaning                                           |
| ---------- | ------------------------------------------------- |
| `ACTIVE`   | Role can be assigned/used according to permission |
| `INACTIVE` | Role cannot be used for new authorization         |

Exact role status naming is an implementation detail not explicitly defined in the uploaded Super Admin diagram.

# User Fields

## Account Identity

| Field                       | Mandatory |
| --------------------------- | --------: |
| User ID *                   |         * |
| Full Name *                 |         * |
| Mobile / Login Identifier * |         * |
| Email                       |           |
| Account Status *            |         * |
| Role *                      |         * |
| Organization *              |         * |
| Branch                      |           |

**Source limitation:** The diagrams do not enumerate exact Admin/User form fields. The table is a proposed minimum domain structure and must be finalized.

## Employee Fields

| Field                       | Mandatory |
| --------------------------- | --------: |
| Employee ID *               |         * |
| Employee Name *             |         * |
| Mobile / Login Identifier * |         * |
| Employee Type / Role *      |         * |
| Organization *              |         * |
| Branch *                    |         * |
| Status *                    |         * |

The source explicitly defines Employee Management as Add, Assign and Deactivate but does not define the exact employee form. fileciteturn1file10

# Role Fields

| Field                | Mandatory |
| -------------------- | --------: |
| Role Name *          |         * |
| Role Code *          |         * |
| Description          |           |
| Organization Scope   |           |
| Branch Scope         |           |
| Status *             |         * |
| Module Permissions * |         * |

# Permission Model

The source only explicitly says **Assign Module Permissions**. Therefore the exact permission catalog is not source-defined.

A permission should logically represent:

`MODULE + ACTION + SCOPE`

Example structure:

| Permission | Example    |
| ---------- | ---------- |
| Module     | CUSTOMER   |
| Action     | VIEW       |
| Scope      | OWN_BRANCH |

Possible actions may include:

- VIEW
- CREATE
- EDIT
- DELETE
- APPROVE
- ASSIGN
- ACTIVATE
- DEACTIVATE
- EXPORT
- GENERATE
- EMAIL
- REVIEW
- POST

These action names are implementation candidates, not source-defined permission IDs.

# Role Assignment

Role assignment must be separate from permission definition.

`Role → Module Permissions`

and

`User → Role`

A role change affects authorization for future/current requests according to the finalized session/authorization policy.

The source does not define whether role changes immediately invalidate existing sessions or simply take effect on the next authorization check. This remains an Open Question.

# Employee Assignment

The Super Admin diagram says **Employee Management — Add, Assign, Deactivate**, but does not specify what "Assign" means. fileciteturn1file10

Possible assignment targets that appear elsewhere in the LMS include:

- Organization
- Branch
- Field collection responsibility
- Customer list
- Collection schedule
- Route

However, only the first two are scope concepts and Field Collection Assignment is separately shown under Branch Admin. The source does not prove that all of these belong to Employee Management.

Therefore:

**Confirmed:** Employee Add / Assign / Deactivate exists for Super Admin.

**Not confirmed:** The exact assignment target and whether assignment is employee-to-branch, employee-to-role, employee-to-field workload, or another relationship.

# Gherkin Scenarios

## User / Admin Creation

### Scenario 1: Super Admin opens Admin Management

Given the Super Admin has access to Admin Management  
When the Super Admin opens Admin Management  
Then the system displays the admin-management area  
And the access is audit logged.

### Scenario 2: Super Admin creates an admin

Given the Super Admin has permission to create admins  
And the required account information is valid  
When the Super Admin submits the admin  
Then the system creates the admin account  
And assigns the selected organization scope  
And assigns the selected role  
And records the creation in the audit log.

The source explicitly labels Admin Management as Create & Manage Admins. fileciteturn1file10

### Scenario 3: Duplicate login identifier is rejected

Given an active or existing user already uses the submitted login identifier  
When an administrator creates another user with the same identifier  
Then the system rejects the creation  
And the existing user is not modified  
And the failed creation is audit logged.

### Scenario Outline: Mandatory user-field validation

Given the administrator is creating a user  
When the administrator submits without `<field>`  
Then the system shows "<message>"  
And the account is not created.

Examples:

| field            | message                      |
| ---------------- | ---------------------------- |
| Full Name        | Full Name is required        |
| Login Identifier | Login Identifier is required |
| Organization     | Organization is required     |
| Role             | Role is required             |
| Account Status   | Account Status is required   |

### Scenario 4: User cannot be created outside authorized organization scope

Given the acting administrator is authorized only for Organization A  
When the administrator attempts to create a user for Organization B  
Then the system denies the operation  
And no Organization B account is created  
And the denial is audit logged.

## User Editing

### Scenario 5: Authorized administrator edits user

Given a user exists  
And the administrator has user-edit permission  
When the administrator changes an allowed user attribute  
Then the system validates the change  
And saves the update  
And records the change in the audit log.

### Scenario 6: Unauthorized user cannot edit another user

Given the acting user lacks user-edit permission  
When the acting user submits a user update  
Then the system denies the operation  
And the target user remains unchanged  
And the denial is audit logged.

### Scenario 7: User edit does not rewrite historical transactions

Given a user has historical collection or operational records  
When the user's profile or assignment is edited  
Then historical transactions retain their original actor and business scope  
And the history is not silently rewritten  
And the edit is audit logged.

## User Activation / Deactivation

### Scenario 8: Administrator deactivates a user

Given an active user exists  
And the administrator has deactivation permission  
When the administrator deactivates the user  
Then the account becomes inactive  
And the user cannot establish a new valid session  
And the deactivation is audit logged.

The session-management baseline explicitly requires inactive accounts to be unable to establish new sessions. fileciteturn3file2

### Scenario 9: Deactivated user cannot authenticate

Given the user's account is `INACTIVE`  
When the user attempts to authenticate  
Then the system rejects authentication  
And no valid session is established  
And the security event is audit logged.

### Scenario 10: Deactivated user cannot receive new assignment

Given an employee is inactive  
When an administrator attempts to assign new field-collection work to that employee  
Then the system rejects the assignment  
And the employee receives no new assignment  
And the failure is audit logged.

### Scenario 11: Deactivation preserves historical records

Given an employee has historical assignments and collections  
When the employee is deactivated  
Then historical records remain preserved  
And historical actor references remain valid  
And the employee is unavailable for new active work.

### Scenario 12: Authorized administrator reactivates a user

Given a user is inactive  
And the administrator has activation permission  
When the administrator activates the user  
Then the account becomes active  
And the account can authenticate according to authentication rules  
And the activation is audit logged.

### Scenario 13: Unauthorized administrator cannot reactivate user

Given the acting administrator lacks activation permission  
When the administrator attempts to activate an inactive user  
Then the operation is denied  
And the user remains inactive  
And the denial is audit logged.

## Employee Management

### Scenario 14: Super Admin opens Employee Management

Given the Super Admin has employee-management access  
When the Super Admin opens Employee Management  
Then the system provides employee-management actions  
And the access is audit logged.

### Scenario 15: Super Admin adds an employee

Given the Super Admin has permission to add employees  
And the employee information is valid  
When the Super Admin submits the employee  
Then the employee is created  
And the employee receives the selected organization/branch scope  
And the creation is audit logged.

### Scenario 16: Employee cannot be added to an inactive branch

Given the selected branch is inactive  
When an administrator attempts to create or assign an operational employee to that branch  
Then the system rejects the operation  
And the employee is not activated for that branch  
And the failure is audit logged.

### Scenario 17: Employee assignment is recorded

Given an active employee exists  
And the administrator has employee-assignment permission  
When the administrator assigns the employee to the finalized supported scope  
Then the assignment is saved  
And the employee's active scope reflects the assignment  
And the assignment is audit logged.

### Scenario 18: Employee cannot be assigned outside organization scope

Given the administrator is authorized for Organization A  
When the administrator attempts to assign an employee to Organization B  
Then the operation is denied  
And the employee's existing assignment remains unchanged  
And the denial is audit logged.

### Scenario 19: Employee branch assignment is restricted

Given an employee belongs to Organization A  
And Branch A and Branch B belong to Organization A  
When the acting administrator lacks cross-branch assignment permission  
And the administrator attempts to assign the employee to Branch B  
Then the operation is denied  
And the existing branch assignment remains unchanged  
And the denial is audit logged.

### Scenario 20: Deactivated employee cannot be selected for field assignment

Given an employee is inactive  
When a Branch Admin opens the field-collection assignment flow  
Then the inactive employee is not eligible for new assignment  
And the employee cannot be selected for new collection work.

This is consistent with the Branch Admin flow exposing Field Collection Assignment → Select Field Agent → Assign Customer List → Set Route & Schedule. fileciteturn1file3

### Scenario 21: Employee deactivation preserves collection history

Given an employee has completed historical collections  
When the employee is deactivated  
Then completed collections remain associated with the employee  
And collection history is not deleted  
And the deactivation is audit logged.

## Branch Admin Employee Access

### Scenario 22: Branch Admin opens Employee Management

Given the Branch Admin has access to the Branch Dashboard  
When the Branch Admin opens Employee Management  
Then the system displays the employee-management area according to the Branch Admin's assigned permissions  
And the branch scope is enforced.

The Branch Admin diagram exposes Employee Management but does not define its internal actions. fileciteturn1file3

### Scenario 23: Branch Admin cannot access another branch's employees

Given Branch Admin A is assigned to Branch A  
And Employee B belongs to Branch B  
When Branch Admin A requests Employee B  
Then the system denies access  
And Employee B's protected information is not returned  
And the denial is audit logged.

### Scenario 24: Branch Admin cannot change branch scope by request parameter

Given the Branch Admin session is scoped to Branch A  
When the client submits Branch B as the target branch  
Then the server rejects or ignores the unauthorized branch value  
And the operation remains scoped to Branch A  
And the attempted violation is audit logged.

### Scenario 25: Branch Admin employee-management actions are permission controlled

Given the Branch Admin has Employee Management access  
When the Branch Admin attempts an action such as Add, Assign or Deactivate  
Then the system evaluates the explicit permission for that action  
And the operation proceeds only when the permission is granted  
And denied actions are audit logged.

The source explicitly states that Branch Admin Employee Management internal behavior is not defined, so the exact action matrix remains unresolved. fileciteturn1file3

## Role Management

### Scenario 26: Super Admin opens Role & Permission Management

Given the Super Admin has access to Role & Permission Management  
When the Super Admin opens the module  
Then the system displays role-management functionality  
And the access is audit logged.

### Scenario 27: Create Role

Given the administrator has role-create permission  
When the administrator submits a valid role  
Then the system creates the role  
And the role remains inactive or follows the finalized default status  
And the creation is audit logged.

The source-defined sequence is Create Role → Assign Module Permissions → Save & Activate. fileciteturn1file10

### Scenario 28: Duplicate role code is rejected

Given a role code already exists within the applicable scope  
When the administrator creates another role using the same role code  
Then the system rejects the operation  
And no duplicate role is created  
And the failure is audit logged.

### Scenario 29: Assign module permissions to a role

Given a role exists  
And the administrator has permission to configure roles  
When the administrator assigns module permissions  
Then the selected permissions are associated with the role  
And the change is audit logged.

### Scenario 30: Save and activate role

Given a role has valid configuration  
When the administrator selects Save & Activate  
Then the role becomes active  
And its approved permissions become eligible for authorization  
And the activation is audit logged.

### Scenario 31: Role without permission cannot perform protected operation

Given a user has an active role  
And the role does not contain the required permission  
When the user attempts the protected operation  
Then the system denies the operation  
And no protected business transaction is committed  
And the denial is audit logged.

### Scenario 32: Permission is enforced server-side

Given the client UI hides an operation  
But the user manually calls the protected API  
When the API receives the request  
Then the server evaluates the user's role and permissions  
And denies the operation when authorization is insufficient  
And no protected data is returned.

### Scenario 33: Client cannot inject permissions

Given a user does not have `LOAN_APPROVE` permission  
When the client submits a request claiming that permission  
Then the server ignores the client-supplied permission claim  
And evaluates the authenticated authorization context  
And denies the operation  
And the security event is audit logged.

## Role Assignment

### Scenario 34: Assign an active role to a user

Given an active role exists  
And the administrator has user-role assignment permission  
When the administrator assigns the role to the user  
Then the user's role assignment is saved  
And subsequent authorization checks use the assigned role according to policy  
And the assignment is audit logged.

### Scenario 35: Inactive role cannot be assigned for active access

Given a role is inactive  
When an administrator attempts to assign it as an active authorization role  
Then the system rejects the assignment  
And the user does not receive permissions from the inactive role  
And the rejection is audit logged.

### Scenario 36: Role change does not rewrite historical business data

Given a user has historical transactions under Role A  
When the user is assigned Role B  
Then historical records retain their original actor and historical context  
And only current/future authorization is affected according to policy  
And the role change is audit logged.

### Scenario 37: Unauthorized user cannot assign a privileged role

Given the acting administrator does not have permission to delegate Role X  
When the administrator attempts to assign Role X to another user  
Then the system denies the operation  
And the target user retains the existing role  
And the denial is audit logged.

## Permission Changes

### Scenario 38: Remove permission from role

Given an active role contains a permission  
And the administrator has permission to modify roles  
When the administrator removes the permission  
Then the permission is removed from the role  
And future authorization checks no longer grant that permission according to the finalized session policy  
And the change is audit logged.

### Scenario 39: Add permission to role

Given an active role does not contain a permission  
When an authorized administrator adds the permission  
Then the role contains the new permission  
And future authorization checks can grant it according to the finalized session policy  
And the change is audit logged.

### Scenario 40: Unauthorized permission modification is denied

Given the acting user lacks role-permission management permission  
When the user attempts to change a role's permissions  
Then the system denies the operation  
And the role remains unchanged  
And the denial is audit logged.

## Scope Enforcement

### Scenario 41: User cannot access another organization

Given User A is authorized only for Organization A  
And protected data belongs to Organization B  
When User A requests Organization B data  
Then the server denies access  
And Organization B data is not returned  
And the denial is audit logged.

### Scenario 42: Branch Admin cannot access another branch

Given Branch Admin A belongs to Branch A  
And Branch B exists  
When Branch Admin A requests Branch B records  
Then the server denies access  
And Branch B data is not returned  
And the denial is audit logged.

The Branch Admin/session baseline explicitly requires branch-level scope enforcement. fileciteturn3file2

### Scenario 43: Field Employee cannot change branch scope

Given a Field Employee is assigned to Branch A  
When the Field Employee submits Branch B in a collection request  
Then the server rejects or ignores the unauthorized scope  
And the transaction cannot be posted under Branch B  
And the attempted scope violation is audit logged.

### Scenario 44: Current role cannot be overridden by request data

Given the authenticated user has Role A  
When the client submits Role B in a request  
Then the server uses the authenticated authorization context  
And Role B is not treated as the user's active role  
And the operation is authorized only using Role A.

## Session Interaction

### Scenario 45: Deactivated user cannot continue protected activity

Given a user has an existing authenticated session  
And the user's account is deactivated  
When the user makes a protected request  
Then the system revalidates account/session state  
And the inactive account cannot bypass deactivation  
And the security event is audit logged.

### Scenario 46: Role change cannot escalate through stale client state

Given a user's role is changed from Role A to Role B  
When the client continues sending stale Role A/Role B data  
Then the server uses authoritative authorization state  
And client-side role data cannot grant unauthorized access  
And the authorization decision is audit logged when denied.

### Scenario 47: Permission removal cannot be bypassed by cached UI

Given a permission is removed from a user's effective role  
When the user attempts the previously authorized operation using a stale UI  
Then the server evaluates the current authorization state  
And denies the operation if the permission is no longer available  
And no protected business transaction is committed.

## Audit Logging

### Scenario 48: User creation is audit logged

Given an authorized administrator creates a user  
When the creation succeeds  
Then an immutable audit event records the actor, target user, organization scope and outcome  
And authentication secrets are not recorded.

### Scenario 49: User deactivation is audit logged

Given an authorized administrator deactivates a user  
When the state change commits  
Then the system records the actor, target user, organization/branch scope, timestamp and outcome  
And the audit record is immutable.

### Scenario 50: Employee assignment is audit logged

Given an authorized administrator assigns an employee  
When the assignment succeeds  
Then the system records the old and new assignment context according to audit policy  
And the event identifies the organization and branch scope.

### Scenario 51: Role creation is audit logged

Given an administrator creates a role  
When the role is created  
Then the system records the role creation event  
And the actor and applicable organization scope are captured.

### Scenario 52: Permission changes are audit logged

Given an administrator modifies module permissions  
When the change succeeds  
Then the system records the affected role  
And records the permission change according to audit policy  
And records the actor and outcome.

### Scenario 53: Permission denial is audit logged

Given a user attempts a protected action without the required permission  
When the system denies the action  
Then an authorization-denial audit event is recorded  
And no protected operation is committed.

## Deletion / Historical Integrity

### Scenario 54: User deletion is blocked when historical references exist

Given a user has historical audit, collection or operational references  
When an administrator attempts physical deletion  
Then the system blocks destructive deletion  
And historical records remain intact  
And the blocked deletion is audit logged.

### Scenario 55: Employee deletion does not delete historical collections

Given an employee has historical collection records  
When deletion is requested  
Then historical collection records remain intact  
And the employee should be deactivated instead when required by retention policy  
And the decision is audit logged.

### Scenario 56: Role deletion is blocked when assigned

Given a role is currently assigned to users  
When an administrator attempts to delete the role  
Then the system blocks deletion  
And existing user assignments remain intact  
And the blocked operation is audit logged.

### Scenario 57: Permission removal does not delete historical transactions

Given a role loses a permission  
When the permission change commits  
Then historical business transactions remain unchanged  
And only authorization behavior is affected.

## Failure Paths

### Scenario 58: User creation persistence failure

Given all user validation succeeds  
When database persistence fails  
Then no partial user account is created  
And no incomplete role assignment is committed  
And the failure is audit logged.

### Scenario 59: Role permission save fails

Given role and permission validation succeeds  
When persistence fails  
Then the role does not enter a falsely activated state  
And the previous committed permission set remains authoritative  
And the failure is audit logged.

### Scenario 60: Employee assignment persistence fails

Given an employee assignment is valid  
When persistence fails  
Then the previous employee scope remains authoritative  
And the employee is not falsely displayed as reassigned  
And the failure is audit logged.

### Scenario 61: Authorization service failure fails closed

Given a protected operation requires permission evaluation  
When the authorization subsystem fails unexpectedly  
Then the system denies the protected operation  
And no protected business transaction is committed  
And the failure is audit logged without exposing security secrets.

# Acceptance Criteria

- Super Admin can access Admin Management according to the source-defined flow.
- Super Admin can add, assign and deactivate employees according to the source-defined Employee Management capability.
- Super Admin can create roles.
- Super Admin can assign module permissions to roles.
- Super Admin can save and activate roles.
- User accounts have explicit organization scope.
- Branch-scoped users have explicit branch scope.
- Server-side authorization enforces organization and branch scope.
- Client-supplied organization, branch, role or permission data cannot override authoritative authorization context.
- Inactive users cannot establish new valid sessions.
- Locked users cannot establish new valid sessions while locked.
- Deactivated users cannot bypass deactivation using existing sessions.
- Deactivated employees cannot receive new operational assignments.
- Historical business records remain preserved after user/employee deactivation.
- Historical actor references remain available for audit/history.
- Role permissions are evaluated before protected operations.
- Users cannot perform operations not granted by their effective permissions.
- Role activation is required before a role can be used as active authorization.
- Unauthorized users cannot create or modify roles.
- Unauthorized users cannot grant permissions they are not authorized to delegate.
- Cross-organization access is denied.
- Branch Admin cross-branch access is denied unless explicitly authorized.
- Field Employee branch scope cannot be overridden by client input.
- Role and permission changes do not rewrite historical financial/business records.
- User creation, edit, activation, deactivation and assignment actions are audit logged.
- Role creation, activation and permission changes are audit logged.
- Authorization denials are audit logged.
- Destructive deletion is blocked when historical references require retention.
- Authorization failures fail closed.
- Authentication/session secrets are not written to audit logs.
- Exact permission IDs, exact user/admin form fields and Branch Admin employee-management actions remain Open Questions where the source does not define them.

---

# Source Traceability

- The consolidated LMS baseline identifies **Employee & Role Management** as a core LMS capability and identifies Super Admin as having full system control, Branch Admin as the branch-level operational role, and Field Employee / Collection Agent as the field-collection role. fileciteturn1file7
- The Super Admin flow explicitly exposes **Admin Management — Create & Manage Admins**, **Employee Management — Add, Assign, Deactivate**, and **Role & Permission Management → Create Role → Assign Module Permissions → Save & Activate**. fileciteturn1file10
- The Branch Admin flow exposes Employee Management but explicitly states that its internal workflow is not defined, so this module does not assume Branch Admin has the same Add/Assign/Deactivate powers as Super Admin. fileciteturn1file3
- The session-management baseline explicitly places user-account creation, editing, activation, deactivation and deletion in Module 3 and requires inactive/locked accounts to be prevented from establishing valid sessions. fileciteturn3file2
- The session baseline also requires organization/branch scope enforcement and prevents client-controlled scope manipulation. fileciteturn3file9
- The Reports module establishes permission-based report access rather than hard-coding report visibility solely by role. fileciteturn1file10
- The architecture reference places `users` under backend domain modules and keeps business logic inside domain modules, with cross-cutting authorization infrastructure in `common/`. fileciteturn1file0

# End of Module 3
