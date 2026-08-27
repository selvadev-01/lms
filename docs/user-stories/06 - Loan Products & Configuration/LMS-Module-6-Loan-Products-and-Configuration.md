# User Story — Loan Products & Configuration

## Epic

Loan Product, Scheme, Interest & Penalty Configuration

## Feature

Loan Scheme Management, Interest Configuration, Duration Configuration and Penalty/Grace Configuration

## User Story

As a Super Admin
I want to create and manage loan products and loan schemes
So that the LMS can offer controlled loan types with approved interest and repayment configurations.

As a Super Admin
I want to configure interest rules and duration options
So that loan applications and EMI calculations use controlled product configuration instead of arbitrary unsupported terms.

As a Super Admin
I want to configure grace-period and penalty rules
So that overdue behavior can be applied consistently with the configured hierarchy.

As an authorized LMS user
I want only active configurations to be selectable
So that inactive or deprecated schemes cannot be used to create new loan applications.

## Rules & Business Constraints

1. Loan Product and Loan Scheme configuration is administrative configuration and is managed by Super Admin according to the source flow. fileciteturn6file2
2. The source-defined Loan Scheme Management flow is: Create Loan Scheme → Set Interest Type & Rate → Set Duration Options → Activate Scheme. fileciteturn6file2
3. Supported loan types are Personal, Business, Gold and Vehicle. fileciteturn5file1
4. Supported interest types are Flat, Reducing and Custom Rate. fileciteturn6file16
5. Supported repayment frequencies are Daily, Weekly, Monthly, Quarterly and Yearly. fileciteturn6file16
6. A loan scheme must have a unique code within the organization.
7. A loan product must have a unique code within the organization.
8. A loan scheme belongs to a loan product.
9. A loan scheme cannot reference a non-existent loan product.
10. A duration option belongs to a loan scheme.
11. A duration option must have a positive duration count.
12. The same scheme cannot contain duplicate frequency + duration combinations within the same organization.
13. Interest rate configuration must use integer basis points, not floating-point storage; for example, 12.50% is stored as 1250 bps. fileciteturn5file1
14. Interest rates must be stored as non-negative integer basis points.
15. Money amounts, limits, fees and other monetary configuration are always stored as integer paise; never float.
16. EMI due dates are DATE-only and use Asia/Kolkata for the LMS.
17. A scheme must not be activated until its required interest and duration configuration is valid.
18. An inactive scheme cannot be selected for a new loan application.
19. Deactivation does not rewrite or invalidate historical loans already created under that scheme.
20. Historical loans retain the terms captured at application/loan creation rather than dynamically inheriting later scheme changes.
21. Editing an active scheme must not silently change already-created loan terms.
22. If a configuration change affects future applications only, the change must be effective for new applications according to the finalized effective-date policy.
23. The source contains a separate Interest Configuration destination, but the exact relationship between global Interest Configuration and Loan Scheme interest configuration is explicitly unresolved. fileciteturn6file2turn6file6
24. The system must not silently treat global interest configuration and scheme-specific interest configuration as the same record until the relationship is finalized.
25. The source defines Penalty Rules as Grace Period & Rate under Super Admin configuration. fileciteturn6file2
26. Grace period supports Global, Loan Scheme and Individual Loan levels using an override hierarchy. fileciteturn6file6
27. The effective grace period must be deterministic: Global Default → Loan Scheme Override → Individual Loan Override, with the more specific applicable level taking precedence. fileciteturn6file7
28. Penalty can be generated automatically or manually. fileciteturn6file6
29. Supported penalty formulas are fixed amount, daily fixed amount, percentage × outstanding × days, and percentage × EMI × days. fileciteturn6file6
30. Admin can keep, adjust, waive or cancel a generated penalty. fileciteturn6file6
31. Penalty adjustments are represented as adjustment transactions, not silent edits.
32. Penalty waivers are represented as waiver transactions, not silent edits.
33. Penalty cancellations are represented as cancellation transactions, not silent deletion.
34. Configuration of a penalty rule does not itself create a customer financial transaction.
35. Applying a configured penalty to a loan is handled by the Overdue & Recovery domain, not by this configuration module.
36. Configuration changes must be audit logged.
37. Configuration activation/deactivation must be audit logged.
38. Permission-denied configuration attempts must be audit logged.
39. Deletion is blocked where a product, scheme, duration, interest configuration or penalty rule is referenced downstream.
40. Deactivation is preferred over destructive deletion when downstream references exist.
41. A referenced active scheme cannot be physically deleted.
42. A referenced duration option cannot be physically deleted if historical applications/loans depend on it.
43. A referenced interest configuration cannot be physically deleted if historical applications/loans depend on it.
44. A referenced penalty rule cannot be physically deleted if historical loans or penalty transactions depend on it.
45. Organization scope must be enforced server-side.
46. Branch scope must be enforced for operational usage and selection; the current database schema stores loan_products and loan_schemes with org_id but not branch_id, so the exact branch-ownership model for configuration is an unresolved schema/business-rule question. fileciteturn5file1
47. A client cannot override organization scope using a request payload.
48. A client cannot select an unauthorized branch to bypass branch access restrictions.
49. If a configuration is organization-wide, Branch Admin may consume it only according to the final permission/scope matrix; Branch Admin is not shown as a configuration owner in the source.
50. Super Admin is the source-defined owner of Loan Scheme Management, Interest Configuration and Penalty Rules. fileciteturn6file15
51. A loan application must select only an active supported scheme/type combination.
52. A loan application must not use a duration frequency that is not configured for the selected scheme.
53. A loan application must not use a negative interest rate.
54. A custom rate must still pass the configured validation constraints.
55. The source does not define rate caps, minimum rates or exact custom-rate constraints; those remain Open Questions.
56. The source does not define loan amount minimum/maximum configuration fields in Loan Scheme Management; do not invent them as mandatory scheme fields.
57. The source does not define whether processing fees belong to Loan Scheme configuration; do not silently add them to the scheme model.
58. The source does not define whether insurance, late fees or other charges are product-configured; those remain Open Questions unless specified elsewhere.
59. Any fee that is eventually configured as money must be integer paise.
60. Any configuration used by the calculation engine must be versionable or otherwise historically reproducible so a past loan can be recalculated deterministically.
61. Changing the active interest rate must not retroactively change the interest rate stored on an existing application/loan.
62. Changing a scheme's duration options must not modify existing repayment schedules.
63. Changing a penalty rule must not rewrite already-posted penalty transactions.
64. Ledger is append-only; configuration changes never edit or delete ledger entries.
65. Every money movement generated later from configured rules must post double-entry ledger lines whose debit and credit amounts sum to zero.
66. Payment posting is idempotent on Idempotency-Key; this applies to money-posting APIs, not ordinary configuration CRUD.
67. Receipt numbers are gapless per branch/agent and are unrelated to product configuration; configuration changes must never allocate receipt numbers.
68. Offline Field Employees do not create or modify authoritative loan-product configuration.
69. Cached configuration on a Field Employee device must be treated as a snapshot.
70. If an offline application uses a configuration snapshot, the server must validate that the scheme and terms are still allowed when synchronization/submission occurs.
71. A stale/inactive scheme must not become active merely because an offline device cached it.
72. If an offline application references a deactivated scheme, the final synchronization policy must determine whether the application is rejected, migrated or reviewed; this is an Open Question.
73. Configuration changes must not leave partially saved schemes.
74. Activation must be atomic with all required validation.
75. If activation fails, the scheme must remain in its prior committed state.
76. Concurrent edits must not silently overwrite a committed configuration change.
77. Concurrent activation/deactivation must result in one deterministic final state.
78. A scheme cannot be active while required configuration is invalid.
79. Deactivation must prevent new selection but preserve historical references.
80. All actions are audit logged.

## Background

Given the user is logged into the system
And the user has Super Admin permission to manage loan products and configuration
And the user is operating within an authorized organization
And the applicable configuration has not been physically deleted or archived
And the user is creating or maintaining a supported loan configuration

The source Super Admin flow explicitly shows:

Loan Scheme Management
→ Create Loan Scheme
→ Set Interest Type & Rate
→ Set Duration Options
→ Activate Scheme

It also exposes separate Interest Configuration and Penalty Rules areas. fileciteturn6file2turn6file15

## Feature: Loan Product & Scheme Management

### Menu

Super Admin Dashboard
→ Loan Scheme Management

Actions: List, View Details, Add, Edit, Delete, Activate, Deactivate

### Loan Product — Fields

#### Product Identity

Product Code *
Product Name *
Loan Type *

#### Status

Status

### Loan Scheme — Fields

#### Scheme Identity

Loan Scheme Code *
Loan Scheme Name *
Loan Product *
Loan Type *

#### Interest

Interest Type *
Interest Rate *

Allowed interest types:

- Flat
- Reducing
- Custom Rate

#### Duration Options

Frequency *
Duration Count *

Allowed frequencies:

- Daily
- Weekly
- Monthly
- Quarterly
- Yearly

A scheme may contain multiple duration options.

#### Status

Status

### Table Only (Not for UI)

#### `loan_products`

```text
org_id UUID NOT NULL
loan_product_id UUID NOT NULL
code VARCHAR(50) NOT NULL
name VARCHAR(150) NOT NULL
loan_type loan_type NOT NULL
status loan_product_status NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL

PRIMARY KEY (org_id, loan_product_id)
UNIQUE (org_id, code)
```

Supported `loan_type` values:

```text
PERSONAL
BUSINESS
GOLD
VEHICLE
```

#### `loan_schemes`

```text
org_id UUID NOT NULL
loan_scheme_id UUID NOT NULL
loan_product_id UUID NOT NULL
code VARCHAR(50) NOT NULL
name VARCHAR(150) NOT NULL
interest_type interest_type NOT NULL
interest_rate_bps BIGINT NOT NULL
status loan_scheme_status NOT NULL
created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL

PRIMARY KEY (org_id, loan_scheme_id)
UNIQUE (org_id, code)
CHECK (interest_rate_bps >= 0)
```

The current database baseline does not include `branch_id` on these configuration records. That conflicts with the broader project rule that every record is organization and branch scoped; this must be resolved rather than silently changing the schema. fileciteturn5file1

#### `loan_scheme_durations`

```text
org_id UUID NOT NULL
loan_scheme_duration_id UUID NOT NULL
loan_scheme_id UUID NOT NULL
frequency repayment_frequency NOT NULL
duration_count INTEGER NOT NULL
status record_status NOT NULL

PRIMARY KEY (org_id, loan_scheme_duration_id)
UNIQUE (org_id, loan_scheme_id, frequency, duration_count)
CHECK (duration_count > 0)
```

The source database explicitly defines these structures and constraints. fileciteturn5file1

## Feature: Interest Configuration

### Menu

Super Admin Dashboard
→ Interest Configuration

Actions: List/View, Add, Edit, Save/Update, Activate/Deactivate if supported by the finalized status model

The screen inventory identifies `INT-001 Interest Configuration` at `/admin/interest-configuration` for Super Admin and marks the exact relationship to scheme-level interest as Direct/Open. fileciteturn6file0

### Interest Configuration — Fields

#### Configuration Identity

Configuration Name *
Interest Type *
Rate *
Effective From *
Effective To
Status

#### Table Only (Not for UI)

```text
org_id UUID NOT NULL
interest_config_id UUID NOT NULL
name VARCHAR(150) NOT NULL
interest_type interest_type NOT NULL
rate_bps BIGINT NOT NULL
effective_from DATE NOT NULL
effective_to DATE
status record_status NOT NULL
created_at TIMESTAMPTZ NOT NULL

PRIMARY KEY (org_id, interest_config_id)
CHECK (rate_bps >= 0)
CHECK (
    effective_to IS NULL
    OR effective_to >= effective_from
)
```

Rates are stored as integer basis points. fileciteturn5file1

### Interest Configuration Rules

1. Rate is integer basis points.
2. Rate cannot be negative.
3. Effective From is mandatory.
4. Effective To, if supplied, cannot be before Effective From.
5. Overlapping effective configurations are not permitted unless the final versioning policy explicitly allows them.
6. Historical loans retain their captured terms.
7. A later configuration does not silently rewrite prior loan terms.
8. Exact precedence between global interest configuration and scheme-specific interest configuration remains unresolved.

## Feature: Penalty & Grace Configuration

### Menu

Super Admin Dashboard
→ Penalty Rules

Actions: List, View, Add, Edit, Delete, Activate, Deactivate

The source labels this area **Penalty Rules — Grace Period & Rate**. fileciteturn6file15

### Penalty Rule — Fields

#### Rule Identity

Rule Name *
Rule Scope *
Status

#### Grace Period

Grace Period Days *
Override Level *

Allowed override levels from the finalized business rule:

- Global
- Loan Scheme
- Individual Loan

#### Penalty

Penalty Generation Mode *
Penalty Formula *
Penalty Value *

Allowed generation modes:

- Automatic
- Manual

Allowed formulas:

- Fixed Amount
- Daily Fixed Amount
- Percentage × Outstanding × Days
- Percentage × EMI × Days

The supported formulas and automatic/manual modes are explicitly finalized in the source. fileciteturn6file6

#### Table Only (Not for UI)

Suggested internal representation must preserve the exact formula type and parameters needed for deterministic replay.

Do not collapse different formulas into a generic untyped percentage field.

The source does not define the exact database table for penalty rules, exact caps, minimums, or rounding parameters. Those remain Open Questions.

# Configuration State Rules

## Draft / Inactive

The configuration exists but cannot be selected for new operational use.

## Active

The configuration is valid and can be selected where the user and branch are authorized.

## Deactivated

The configuration cannot be selected for new applications or future configuration-dependent operations, while historical references remain intact.

## Historical

A configuration referenced by an existing application/loan must remain reproducible even if the current configuration is later deactivated or replaced.

# Gherkin Scenarios

## Loan Product / Scheme List & View

### Scenario 1: List active loan schemes

Given the Super Admin has Loan Scheme Management permission
When the Super Admin opens Loan Scheme Management
Then the system displays loan schemes within the authorized organization scope
And the list shows scheme code, name, loan type, interest type/rate, duration options and status.

The screen inventory defines the Loan Scheme List with these fields and actions. fileciteturn6file0

### Scenario 2: View loan scheme details

Given an existing loan scheme is visible to the Super Admin
When the Super Admin opens the scheme
Then the system displays its configured loan type
And interest type/rate
And duration options
And current status.

### Scenario 3: Branch-scoped user cannot view unauthorized configuration

Given Branch Admin A is operating in Branch A
And a configuration is not available to Branch A under the finalized scope rules
When Branch Admin A attempts to access the configuration directly
Then the system denies access
And does not expose configuration records outside the authorized scope.

The source defines Super Admin as the configuration owner; the exact Branch Admin configuration access is not defined and remains an Open Question.

### Scenario 4: Cross-organization scheme access denied

Given Organization A and Organization B are separate organizations
And a scheme belongs to Organization B
When a user from Organization A requests that scheme
Then the system denies access
And no scheme configuration is returned.

## Add

### Scenario 5: Create loan scheme

Given the Super Admin has permission to create loan schemes
When the Super Admin selects Create Loan Scheme
Then the system opens the scheme form
And requires scheme identity
And requires interest configuration
And requires at least one valid duration option before activation.

The source sequence is Create Loan Scheme → Set Interest Type & Rate → Set Duration Options → Activate Scheme. fileciteturn6file2

### Scenario 6: Create scheme with valid configuration

Given a valid loan product exists
And the Super Admin enters a unique scheme code and name
And selects a supported loan type
And selects a supported interest type
And enters a valid non-negative interest rate
And adds a valid duration option
When the Super Admin saves the scheme
Then the system persists the scheme
And the scheme remains inactive until activation
And the creation is audit logged.

### Scenario Outline: Mandatory scheme fields

Given the Create Loan Scheme form is open
When the user submits without <field>
Then the system shows "<message>"
And the scheme is not activated

Examples:
| field | message |
| Loan Scheme Code | Loan Scheme Code is required |
| Loan Scheme Name | Loan Scheme Name is required |
| Loan Product | Loan Product is required |
| Loan Type | Loan Type is required |
| Interest Type | Interest Type is required |
| Interest Rate | Interest Rate is required |
| Frequency | Frequency is required |
| Duration Count | Duration Count is required |

### Scenario 7: Unsupported loan type is rejected

Given the scheme form is open
When the request contains a loan type outside Personal, Business, Gold or Vehicle
Then the system rejects the configuration
And does not activate the scheme.

### Scenario 8: Negative interest rate is rejected

Given the Super Admin is creating a scheme
When the Super Admin enters a negative interest rate
Then the system rejects the value
And the scheme is not activated.

The database baseline explicitly requires `interest_rate_bps >= 0`. fileciteturn5file1

### Scenario 9: Duplicate scheme code is rejected

Given a scheme code already exists within the organization
When the Super Admin creates another scheme with the same code
Then the system rejects the duplicate
And no second scheme with that code is created.

The database baseline explicitly defines `UNIQUE (org_id, code)`. fileciteturn5file1

### Scenario 10: Duplicate duration option is rejected

Given a scheme already contains Monthly / 12
When the Super Admin adds Monthly / 12 again
Then the system rejects the duplicate duration option
And the scheme retains only one such configuration.

The database baseline explicitly defines uniqueness across organization, scheme, frequency and duration count. fileciteturn5file1

## Edit

### Scenario 11: Edit inactive scheme

Given an inactive scheme exists
And the Super Admin has edit permission
When the Super Admin changes an allowed configuration field
Then the system validates the change
And saves the updated configuration
And records the edit in the audit log.

### Scenario 12: Edit active scheme without retroactive effect

Given an active scheme has already been used by existing loans
When the Super Admin changes the scheme configuration
Then existing loan terms remain unchanged
And the new configuration applies only according to the finalized effective-date rules
And the configuration change is audit logged.

This protects the source requirement that loan applications capture their own interest rate, frequency and duration rather than dynamically inheriting later configuration changes. fileciteturn5file1

### Scenario 13: Invalid edit is rejected

Given an active or inactive scheme exists
When the Super Admin changes the interest rate to an invalid value
Then the update is rejected
And the previous committed configuration remains unchanged.

## Activate / Deactivate

### Scenario 14: Activate valid scheme

Given a scheme contains valid interest configuration
And at least one valid duration option
And the scheme has a unique code
When the Super Admin selects Activate
Then the system activates the scheme
And the scheme becomes selectable for new loan applications
And activation is audit logged.

### Scenario 15: Activation blocked for incomplete scheme

Given a scheme has missing or invalid required configuration
When the Super Admin selects Activate
Then activation is rejected
And the scheme remains inactive
And the failure is audit logged.

### Scenario 16: Deactivate scheme

Given an active scheme exists
And the Super Admin has deactivation permission
When the Super Admin deactivates the scheme
Then the scheme becomes inactive
And new loan applications cannot select it
And existing loans using the scheme remain unchanged
And deactivation is audit logged.

### Scenario 17: Inactive scheme cannot be selected

Given a scheme is inactive
When a user creates a new loan application
Then the inactive scheme is not selectable
And a direct attempt to submit its ID is rejected by the server.

The Loan Application wireframe requires an active loan scheme. fileciteturn6file13

## Delete

### Scenario 18: Delete unreferenced scheme

Given a scheme has no downstream application or loan references
And the finalized policy permits physical deletion
And the Super Admin has delete permission
When the Super Admin deletes the scheme
Then the system deletes it according to the approved deletion policy
And the deletion is audit logged.

### Scenario 19: Delete referenced scheme is blocked

Given a scheme is referenced by a loan application or loan
When the Super Admin attempts to delete it
Then the system blocks deletion
And historical references remain intact
And the blocked deletion is audit logged.

### Scenario 20: Deactivate instead of delete

Given a scheme has downstream references
When the Super Admin needs to stop new usage
Then the system allows deactivation
And does not require destructive deletion
And historical applications/loans remain linked to the scheme.

## Interest Configuration

### Scenario 21: Create global interest configuration

Given the Super Admin has Interest Configuration permission
When the Super Admin enters a valid configuration name, interest type, non-negative rate and effective-from date
Then the system saves the configuration
And records the configuration as organization scoped
And audit logs the creation.

### Scenario 22: Invalid effective date range

Given Interest Configuration is being edited
When Effective To is earlier than Effective From
Then the system rejects the configuration
And no invalid effective period is saved.

The database baseline explicitly requires Effective To to be null or greater than/equal to Effective From. fileciteturn5file1

### Scenario 23: Interest rate stored as basis points

Given the Super Admin enters a rate of 12.50%
When the system saves the rate
Then the persisted rate is represented as 1250 basis points
And no floating-point rate is stored.

### Scenario 24: Interest configuration does not retroactively change loans

Given an existing loan has a captured interest rate
When the Super Admin changes the global interest configuration
Then the existing loan's stored interest rate remains unchanged
And only future applicable configuration uses the new rule.

### Scenario 25: Global vs scheme-level interest conflict

Given a global Interest Configuration exists
And a Loan Scheme contains its own interest type and rate
When a new loan application selects that scheme
Then the system must use the finalized precedence rule
And must not silently choose one configuration without an approved precedence definition.

The exact relationship is explicitly an Open Question in the source. fileciteturn6file6

## Penalty / Grace Configuration

### Scenario 26: Create penalty rule

Given the Super Admin has Penalty Rules permission
When the Super Admin creates a valid penalty rule
Then the system stores the rule
And stores its grace-period context
And stores its penalty generation mode
And stores its penalty formula
And audit logs the creation.

### Scenario 27: Configure automatic penalty

Given the Super Admin selects Automatic generation
When a valid supported formula is configured
Then the rule can be activated
And future eligible overdue processing can use the rule.

### Scenario 28: Configure manual penalty

Given the Super Admin selects Manual generation
When the rule is activated
Then the rule permits authorized administrative penalty generation according to the overdue workflow.

### Scenario 29: Unsupported penalty formula is rejected

Given the Super Admin is configuring a penalty rule
When an unsupported formula is submitted
Then the system rejects the configuration
And does not activate the rule.

### Scenario 30: Global grace period

Given a Global grace-period rule is active
When a loan has no more specific override
Then the global grace period is the applicable configured grace period.

### Scenario 31: Loan Scheme override

Given a Global grace period exists
And the selected Loan Scheme has an active override
When the effective grace period is calculated
Then the Loan Scheme override takes precedence over the global default.

### Scenario 32: Individual Loan override

Given Global and Loan Scheme grace periods exist
And the individual loan has an active override
When the effective grace period is calculated
Then the individual loan override takes precedence over the scheme and global values.

The override hierarchy is explicitly finalized as Global → Loan Scheme → Individual Loan. fileciteturn6file7

### Scenario 33: Penalty formula fixed amount

Given the active rule uses Fixed Amount
When the overdue workflow evaluates the rule
Then the configured fixed amount is used as the penalty basis
And the amount is represented in integer paise.

### Scenario 34: Penalty formula daily fixed amount

Given the active rule uses Daily Fixed Amount
When eligible overdue days are evaluated
Then the rule calculates the penalty according to the configured daily fixed amount and applicable days
And the calculation is deterministic.

### Scenario 35: Penalty formula percentage of outstanding

Given the active rule uses Percentage × Outstanding × Days
When eligible overdue processing occurs
Then the calculation uses the configured percentage, outstanding amount and applicable days
And the resulting monetary amount is represented in integer paise.

### Scenario 36: Penalty formula percentage of EMI

Given the active rule uses Percentage × EMI × Days
When eligible overdue processing occurs
Then the calculation uses the configured percentage, EMI and applicable days
And the resulting monetary amount is represented in integer paise.

### Scenario 37: Penalty adjustment does not edit original transaction

Given a penalty has already been posted
When an authorized Admin adjusts the penalty
Then the original financial history remains unchanged
And an adjustment transaction represents the correction
And the adjustment is audit logged.

### Scenario 38: Penalty waiver does not delete original penalty

Given a penalty has already been posted
When an authorized Admin waives it
Then the original penalty transaction remains historical
And a waiver transaction represents the waiver
And the waiver is audit logged.

### Scenario 39: Penalty cancellation does not delete history

Given a penalty has already been generated
When an authorized Admin cancels it
Then the original event remains auditable
And the cancellation is represented as an explicit cancellation/adjustment transaction.

The financial principles explicitly prohibit silently overwriting financial history. fileciteturn6file6

## Permission Denial

### Scenario 40: Wrong role attempts create scheme

Given the user does not have Loan Scheme Management create permission
When the user submits Create Loan Scheme
Then the system denies the operation
And no scheme is created
And the denial is audit logged.

### Scenario 41: Wrong role attempts edit scheme

Given the user lacks scheme-edit permission
When the user changes a scheme
Then the system denies the operation
And the committed scheme remains unchanged
And the denial is audit logged.

### Scenario 42: Wrong role attempts activation

Given the user lacks scheme-activation permission
When the user attempts activation
Then the system denies the operation
And the scheme remains in its previous state
And the denial is audit logged.

### Scenario 43: Wrong role attempts penalty configuration

Given the user lacks Penalty Rules permission
When the user attempts to create or modify a penalty rule
Then the system denies the operation
And no configuration change is committed
And the denial is audit logged.

## Branch / Organization Scope

### Scenario 44: Organization scope is enforced

Given a scheme belongs to Organization A
When a user from Organization B requests the scheme
Then the server denies access
And no configuration is returned.

### Scenario 45: Branch scope is enforced for operational selection

Given a user is authorized only for Branch A
And the final configuration model restricts a scheme to Branch A
When the user attempts to select the scheme for Branch B
Then the server rejects the unauthorized branch selection
And no application is created using the unauthorized configuration.

### Scenario 46: Client cannot override organization

Given the authenticated user belongs to Organization A
When the client sends Organization B in the create/update request
Then the server ignores or rejects the unauthorized organization value
And the operation cannot cross the tenant boundary.

### Scenario 47: Branch Admin cannot administer Super Admin configuration

Given Branch Admin has operational loan permissions
When Branch Admin attempts to create or edit a Loan Scheme
Then the system denies the configuration action
And the denial is audit logged.

The source places Loan Scheme Management under Super Admin and does not grant Branch Admin configuration ownership. fileciteturn6file15

## Failure / Concurrency

### Scenario 48: Scheme persistence failure

Given the scheme passes validation
When database persistence fails
Then no partially committed active scheme exists
And the failure is audit logged
And the previous committed configuration remains authoritative.

### Scenario 49: Activation transaction failure

Given a scheme is valid but activation persistence fails
When the activation request commits
Then the system does not falsely report the scheme as active
And the previous state remains authoritative.

### Scenario 50: Concurrent scheme edit

Given two Super Admin sessions edit the same scheme
When conflicting updates are submitted
Then the finalized concurrency strategy prevents silent loss of a committed update
And the conflict is audit logged.

### Scenario 51: Concurrent activation/deactivation

Given two authorized sessions attempt opposite state changes
When the requests race
Then the system produces one deterministic final state
And audit records identify both actions and their outcomes.

### Scenario 52: Stale scheme selection

Given a user opened an application while a scheme was active
And the scheme becomes inactive before submission
When the user submits the application
Then the server revalidates the scheme status
And rejects the submission if the scheme is no longer eligible
And does not rely on the stale client state.

### Scenario 53: Offline cached configuration

Given a Field Employee device contains cached loan configuration
When the device is offline
Then the cached configuration is treated as a snapshot
And the device cannot modify authoritative product configuration.

### Scenario 54: Offline application uses deactivated scheme

Given an offline application was prepared using a scheme that later becomes inactive
When the application synchronizes
Then the server revalidates the scheme
And applies the finalized stale-configuration policy
And does not silently activate the scheme.

The source defines offline synchronization at the operational collection level but does not define this exact loan-configuration conflict behavior. Therefore the final synchronization outcome remains an Open Question.

## Downstream Protection

### Scenario 55: Referenced duration cannot be deleted

Given a duration option is referenced by an application or loan
When the Super Admin attempts to delete it
Then deletion is blocked
And the historical reference remains intact
And the deletion attempt is audit logged.

### Scenario 56: Referenced interest configuration cannot be deleted

Given an interest configuration is referenced by historical loan/application terms
When deletion is requested
Then deletion is blocked
And historical configuration remains reproducible.

### Scenario 57: Referenced penalty rule cannot be deleted

Given a penalty rule has been used by an existing loan/penalty process
When deletion is requested
Then deletion is blocked
And the historical relationship remains intact
And deactivation is used when future usage must stop.

## Active / Inactive Behavior

### Scenario 58: Inactive product cannot be selected

Given a loan product is inactive
When a new loan application is created
Then the inactive product/scheme is not available for selection.

### Scenario 59: Reactivated scheme becomes selectable

Given a scheme was inactive
And the Super Admin reactivates it successfully
When a new eligible loan application is created
Then the scheme becomes selectable again
And activation is audit logged.

Whether reactivation is permitted for all configuration types is an Open Question where the source does not explicitly define it.

### Scenario 60: Historical loan remains valid after scheme deactivation

Given an active loan was created using Scheme A
When Scheme A is deactivated
Then the existing loan remains valid
And its captured terms remain unchanged
And future applications cannot select Scheme A.

# Acceptance Criteria

- Super Admin can list and view configured loan schemes.
- Super Admin can create a loan scheme.
- Loan Scheme creation follows Create → Set Interest Type & Rate → Set Duration Options → Activate.
- Supported loan types are Personal, Business, Gold and Vehicle.
- Supported interest types are Flat, Reducing and Custom Rate.
- Supported frequencies are Daily, Weekly, Monthly, Quarterly and Yearly.
- Scheme codes are unique within the organization.
- Loan Product codes are unique within the organization.
- Duration combinations are unique per scheme/frequency/duration.
- Duration count must be positive.
- Interest rates are non-negative integer basis points.
- Monetary configuration is integer paise.
- A scheme cannot be activated while required configuration is invalid.
- Inactive schemes cannot be selected for new applications.
- Deactivating a scheme does not invalidate historical loans.
- Historical loan terms remain unchanged after configuration edits.
- Global Interest Configuration exists separately from scheme configuration.
- The relationship between global and scheme-level interest is not silently assumed.
- Grace period supports Global → Loan Scheme → Individual Loan override hierarchy.
- Penalty generation supports Automatic and Manual modes.
- Supported penalty formulas are Fixed Amount, Daily Fixed Amount, Percentage × Outstanding × Days, and Percentage × EMI × Days.
- Penalty adjustments, waivers and cancellations are represented as transactions rather than destructive edits.
- Referenced configurations cannot be destructively deleted.
- Configuration changes are audit logged.
- Permission denials are audit logged.
- Organization scope is enforced server-side.
- Branch scope is enforced for operational configuration selection according to the finalized branch model.
- The current database schema's lack of `branch_id` on loan-product configuration is explicitly tracked as an unresolved design issue.
- Offline clients cannot modify authoritative configuration.
- Stale configuration is revalidated at server submission.
- Configuration persistence and activation are atomic.
- Concurrent configuration changes cannot silently lose committed data.
- Existing money movements remain double-entry and sum to zero.
- Payment posting remains idempotent on Idempotency-Key.
- Ledger remains append-only.
- All actions are audit logged.

# Open Questions

1. What is the exact difference between a Loan Product and a Loan Scheme in the business model?
2. Can one Loan Product contain multiple Loan Schemes?
3. Is Loan Type stored at product level, scheme level, or both?
4. Are Personal, Business, Gold and Vehicle the complete loan-type list?
5. Can additional loan types be configured?
6. Is Loan Product itself a selectable object in loan applications, or only the Loan Scheme?
7. Are Product Code and Scheme Code both mandatory?
8. Are codes case-sensitive?
9. Are codes unique only within an organization?
10. Can codes be reused after deactivation?
11. Is physical deletion ever permitted for loan products?
12. Is physical deletion ever permitted for loan schemes?
13. Should deactivation be the only production removal mechanism?
14. Can an active scheme be edited?
15. Which scheme fields can be edited after activation?
16. Does editing an active scheme create a new version?
17. Is configuration versioning required?
18. What is the effective-date behavior for scheme interest changes?
19. What is the exact relationship between global Interest Configuration and Loan Scheme interest configuration?
20. Does scheme-level interest override global interest?
21. Does global interest act as a default only?
22. Can a scheme inherit interest from global configuration?
23. Can a scheme override only the rate while inheriting interest type?
24. Can a scheme override interest type and rate independently?
25. Are effective dates supported on scheme-level interest?
26. Are overlapping global interest configurations allowed?
27. What prevents two active interest configurations from applying on the same date?
28. What exact interest-rate caps/minimums apply?
29. What precision is allowed when entering a percentage before converting to basis points?
30. Are rates entered as percentage values such as 12.50% and converted to bps?
31. Are duration counts always integers?
32. Can duration be fractional for any frequency?
33. Can a scheme support multiple durations for the same frequency?
34. Can a scheme support all five frequencies?
35. Can a scheme support only selected frequencies?
36. Are duration options required before scheme activation?
37. Can duration options be deactivated independently?
38. Can a duration option be changed after applications exist?
39. Are minimum/maximum loan amounts configurable per scheme?
40. Are minimum/maximum tenure constraints configurable?
41. Are processing fees configured here?
42. Are service charges configured here?
43. Are insurance charges configured here?
44. Are other loan charges configured here?
45. If fees are configured, are they fixed paise amounts or percentage-based?
46. Are fees included in EMI?
47. What exact calculation-engine configuration belongs to Loan Scheme?
48. Is reducing interest calculated on daily/monthly outstanding balance?
49. Is Flat interest calculated using principal × rate × duration?
50. What does Custom Rate mean: custom annual rate, custom periodic rate, or another method?
51. Are day-count conventions configured?
52. Are rounding rules configurable?
53. How is EMI rounding residue handled?
54. Which configuration version is captured on a loan application?
55. Which configuration version is captured on disbursement?
56. Can a pending application retain old terms if the scheme changes before approval?
57. Does modifying loan terms during Admin Review create a new application-term version?
58. Does scheme deactivation affect already-submitted but not-yet-approved applications?
59. What happens when an offline application references a newly deactivated scheme?
60. Should stale offline applications be rejected, migrated, or manually reviewed?
61. Can Branch Admin view loan product configuration?
62. Can Branch Admin select any organization-wide active scheme?
63. Is configuration branch-specific?
64. If configuration is branch-specific, should `branch_id` be added to loan_products and loan_schemes?
65. If configuration is organization-wide, how is branch scoping represented for the project's rule that every record is organization and branch scoped?
66. Can the same scheme be enabled for only selected branches?
67. Can different branches use different duration options for the same scheme?
68. Can a scheme be assigned/unassigned to branches?
69. Who can assign schemes to branches?
70. What exact penalty-rule fields are required?
71. What are penalty caps?
72. What are penalty minimums?
73. What rounding rules apply to penalties?
74. Are penalty rates stored in basis points?
75. Are penalty fixed amounts stored in paise?
76. How are percentage penalties rounded?
77. What happens when the calculated penalty is below a configured minimum?
78. What happens when it exceeds a configured cap?
79. Is the penalty rule evaluated daily or on-read?
80. Is penalty generation idempotent?
81. How is a generated penalty tied to the exact configuration version?
82. Can a penalty rule be changed after penalties have already been generated?
83. Which users can adjust penalties?
84. Which users can waive penalties?
85. Which users can cancel penalties?
86. Are adjustment/waiver/cancellation thresholds permission-based?
87. Does penalty configuration include grace-period days only or other grace rules?
88. Can Global grace period be zero?
89. Can Loan Scheme grace override Global?
90. Can Individual Loan override both?
91. Who can configure an Individual Loan override?
92. Can Branch Admin configure an individual loan grace period?
93. Are grace periods always measured in calendar days?
94. Are holidays/weekends relevant to grace-period calculation?
95. Is Asia/Kolkata used for all configuration effective dates?
96. What happens if Effective To equals Effective From?
97. Can configurations be scheduled for future activation?
98. Can a configuration be backdated?
99. If backdating is allowed, what historical data must remain unchanged?
100. Is audit history required to store before/after configuration values?
101. What is the retention period for configuration audit records?
102. Can Super Admin restore a deleted/deactivated configuration?
103. Is there a draft state before activation?
104. Can multiple Super Admins edit the same configuration concurrently?
105. What optimistic-lock/version strategy should be used?
106. What exact permissions exist for create/edit/activate/deactivate/delete?
107. Is Super Admin the only role allowed to manage configuration?
108. Can custom roles receive product-configuration permissions?
109. Should configuration changes require maker-checker approval?
110. Are notifications required when a scheme is activated/deactivated?
111. Should Branch Admins be notified when a scheme changes?
112. Should customers be notified when a scheme changes before their application?
113. Is bulk scheme import/export required?
114. Are product/scheme changes included in reports?
115. Are inactive schemes visible in application history?
116. Should inactive schemes remain searchable for audit/reporting?
117. What is the exact archive policy for retired configurations?

# Source Traceability

- The Super Admin flow defines Loan Scheme Management as Create Loan Scheme → Set Interest Type & Rate → Set Duration Options → Activate Scheme. fileciteturn6file2
- The Super Admin dashboard exposes separate Loan Scheme Management, Penalty Rules and Interest Configuration areas. fileciteturn6file15
- The screen inventory defines PROD-001 Loan Scheme List, PROD-002 Loan Scheme Form, INT-001 Interest Configuration and PEN-001 Penalty Rules. fileciteturn6file0
- The database baseline defines `loan_products`, `loan_schemes`, `loan_scheme_durations` and `interest_configs`, including organization-scoped uniqueness and integer basis-point rates. fileciteturn5file1
- Supported loan types are Personal, Business, Gold and Vehicle. fileciteturn5file1
- Supported interest types are Flat, Reducing and Custom Rate; supported duration frequencies are Daily, Weekly, Monthly, Quarterly and Yearly. fileciteturn6file16
- The Local Customer flow explicitly uses loan scheme/type selection, interest/duration configuration and EMI preview. fileciteturn6file11
- The finalized financial rules define Global → Loan Scheme → Individual Loan grace-period overrides, automatic/manual penalty generation and the supported penalty formulas. fileciteturn6file6turn6file7
- The source explicitly identifies the relationship between global Interest Configuration and scheme-level interest configuration as unresolved. fileciteturn6file6

# End of Module 6
