import { ALL_PERMISSION_CODES } from '../../users/rbac/permission-catalog';
import {
  BRANCH_ADMIN_PERMISSION_CODES,
  CORE_ROLE_GRANTS,
  CORE_ROLE_SPECS,
  FIELD_EMPLOYEE_PERMISSION_CODES,
  SUPER_ADMIN_EXCLUSIONS,
  SUPER_ADMIN_PERMISSION_CODES,
  roleDisplayName,
} from './role-specs';

describe('core role specs', () => {
  it('defines exactly the three roles every organization starts with', () => {
    expect(CORE_ROLE_SPECS.map((spec) => spec.code)).toEqual([
      'SUPER_ADMIN',
      'BRANCH_ADMIN',
      'FIELD_EMPLOYEE',
    ]);
  });

  it('marks SUPER_ADMIN as a system role and the others as ordinary', () => {
    const bySystemFlag = Object.fromEntries(
      CORE_ROLE_SPECS.map((spec) => [spec.code, spec.isSystem]),
    );

    // A system role cannot be renamed, deactivated, deleted or stripped of
    // permissions, so an organization cannot administer away its own last
    // administrator (Module 03 Rules 25/26).
    expect(bySystemFlag).toEqual({
      SUPER_ADMIN: true,
      BRANCH_ADMIN: false,
      FIELD_EMPLOYEE: false,
    });
  });

  it('starts every core role ACTIVE', () => {
    for (const spec of CORE_ROLE_SPECS) {
      expect(spec.status).toBe('ACTIVE');
    }
  });

  it('derives a display name from the code', () => {
    expect(roleDisplayName('SUPER_ADMIN')).toBe('super admin');
  });
});

describe('core role grants', () => {
  /**
   * The guard that matters most in this file.
   *
   * A code that is not in the catalog resolves to `undefined` when the grant
   * loop looks up its permission id. In the seed that surfaces as a Prisma
   * error a developer sees immediately; on the signup path it would be a 503
   * for a real user creating an organization. Catching a typo here turns that
   * into a red test.
   */
  it('grants only permissions that exist in the catalog', () => {
    const catalog = new Set(ALL_PERMISSION_CODES);

    for (const [roleCode, permissionCodes] of Object.entries(
      CORE_ROLE_GRANTS,
    )) {
      const unknown = permissionCodes.filter((code) => !catalog.has(code));
      expect({ roleCode, unknown }).toEqual({ roleCode, unknown: [] });
    }
  });

  it('grants no permission twice within a role', () => {
    for (const [roleCode, permissionCodes] of Object.entries(
      CORE_ROLE_GRANTS,
    )) {
      const duplicates = permissionCodes.filter(
        (code, index) => permissionCodes.indexOf(code) !== index,
      );
      expect({ roleCode, duplicates }).toEqual({ roleCode, duplicates: [] });
    }
  });

  it('covers every core role', () => {
    expect(Object.keys(CORE_ROLE_GRANTS).sort()).toEqual(
      CORE_ROLE_SPECS.map((spec) => spec.code).sort(),
    );
  });
});

describe('super admin exclusions', () => {
  it('withholds exactly the three deliberately excluded permissions', () => {
    // Each exclusion makes a specific denial provable: an authenticated admin
    // refused a GPS check-in (Scenarios 3/30), refused a write-off posting
    // (Scenario 43), and refused a retention purge (Scenario 58). Granting any
    // of them would silently make the corresponding test unprovable.
    expect([...SUPER_ADMIN_EXCLUSIONS].sort()).toEqual([
      'field.checkin',
      'recovery.writeoff.post',
      'retention.purge.run',
    ]);
  });

  it('grants a Super Admin the whole catalog minus those three', () => {
    expect(SUPER_ADMIN_PERMISSION_CODES).toHaveLength(
      ALL_PERMISSION_CODES.length - SUPER_ADMIN_EXCLUSIONS.length,
    );

    for (const excluded of SUPER_ADMIN_EXCLUSIONS) {
      expect(SUPER_ADMIN_PERMISSION_CODES).not.toContain(excluded);
    }
  });

  it('keeps the exclusion list itself in the catalog', () => {
    // An exclusion naming a code that no longer exists would silently stop
    // excluding anything the day the catalog is renamed.
    for (const excluded of SUPER_ADMIN_EXCLUSIONS) {
      expect(ALL_PERMISSION_CODES).toContain(excluded);
    }
  });
});

describe('withheld grants that make a denial provable', () => {
  // These omissions are load-bearing rather than oversights. Each one gives an
  // e2e scenario an account that reaches the screen and is refused the action.
  it.each([
    ['customers.delete', 'Scenario 23'],
    ['customers.guarantors.delete', 'Module 05 Scenario 40'],
    ['loans.approve', 'Scenario 17/28'],
    ['loans.disbursements.confirm', 'Scenarios 29/30'],
    ['collections.reverse', 'Scenario 36'],
    ['accounting.journals.post', 'Scenarios 44/48'],
    ['accounting.ledger.reconcile', 'Scenario 50'],
    ['reports.financial.view', 'Scenarios 28/49'],
    ['reports.export.pii', 'Scenario 35'],
  ])('withholds %s from a Branch Admin (%s)', (code) => {
    expect(BRANCH_ADMIN_PERMISSION_CODES).not.toContain(code);
  });

  it.each([
    ['sessions.revoke', 'Scenario 23'],
    ['cash.handovers.receive', 'Scenario 43'],
    ['field.collections.verify', 'self-verification'],
    ['recovery.cases.assign', 'Scenario 42'],
    ['collections.reverse', 'an agent erasing their own receipt'],
    // Q-CUST-23. The role registers a customer but decides nothing about one:
    // editing the identity it collected against, verifying its own
    // registration, or changing status are all branch work.
    ['customers.update', 'altering an identity after collecting against it'],
    ['customers.kyc.submit', 'verifying its own registration'],
    ['customers.kyc.approve', 'verifying its own registration'],
    ['customers.activate', 'status is not a field call'],
    ['customers.convert', 'status is not a field call'],
    ['customers.delete', 'status is not a field call'],
  ])('withholds %s from a Field Employee (%s)', (code) => {
    expect(FIELD_EMPLOYEE_PERMISSION_CODES).not.toContain(code);
  });

  it('lets a Field Employee register a customer but not maintain one', () => {
    // Q-CUST-23. Onboarding at the doorstep is field work; every act that
    // decides something about the customer afterwards is withheld above.
    expect(FIELD_EMPLOYEE_PERMISSION_CODES).toContain('customers.create');
    // The create form's gender dropdown resolves through master data, which is
    // why registering needs no grant beyond `customers.create`.
    expect(FIELD_EMPLOYEE_PERMISSION_CODES).toContain('master_data.view');
  });

  it('gives a Field Employee the check-in a Branch Admin is refused', () => {
    expect(FIELD_EMPLOYEE_PERMISSION_CODES).toContain('field.checkin');
    expect(BRANCH_ADMIN_PERMISSION_CODES).not.toContain('field.checkin');
    // Reviewing someone's check-in history is not permission to create one.
    expect(BRANCH_ADMIN_PERMISSION_CODES).toContain('field.checkin.view');
  });
});
