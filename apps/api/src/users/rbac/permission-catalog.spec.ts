/**
 * Guards on the permission catalog itself.
 *
 * The catalog is hand-maintained and two of its failure modes are silent:
 *
 *  - **A code in the catalog with no constant in `@lms/constants`** is a
 *    permission the API enforces and the web app can never name. Its page
 *    guards and sidebar gating compare against those constants, so the screen
 *    simply never appears, with nothing logged and no type error.
 *  - **A constant with no catalog entry** is worse: `requirePermissions` would
 *    compare against a code that is never granted to anyone, so the page is
 *    permanently inaccessible and looks like a permissions bug rather than a
 *    typo.
 *
 * Neither is caught by a type check, because both sides are plain strings.
 */

import { PERMISSIONS } from '@lms/constants';

import { ALL_PERMISSION_CODES, PERMISSION_CATALOG } from './permission-catalog';

describe('permission catalog', () => {
  const constantCodes = Object.values(PERMISSIONS) as string[];

  it('has a unique code for every entry', () => {
    expect(new Set(ALL_PERMISSION_CODES).size).toBe(
      ALL_PERMISSION_CODES.length,
    );
  });

  it('has a unique module+action pair for every entry', () => {
    // `@@unique([orgId, module, action])` on the Permission model. A duplicate
    // pair fails the seed's upsert at runtime rather than here, and the error
    // it produces does not name the offending entry.
    const pairs = PERMISSION_CATALOG.map(
      (spec) => `${spec.module}:${spec.action}`,
    );

    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('describes every permission', () => {
    const undescribed = PERMISSION_CATALOG.filter(
      (spec) => spec.description.trim() === '',
    ).map((spec) => spec.code);

    expect(undescribed).toEqual([]);
  });

  it('exposes every catalog code as a constant the web app can name', () => {
    const missing = ALL_PERMISSION_CODES.filter(
      (code) => !constantCodes.includes(code),
    );

    expect(missing).toEqual([]);
  });

  it('backs every constant with a real catalog entry', () => {
    const orphaned = constantCodes.filter(
      (code) => !ALL_PERMISSION_CODES.includes(code),
    );

    expect(orphaned).toEqual([]);
  });

  describe('Module 14 — accounting', () => {
    const accounting = PERMISSION_CATALOG.filter(
      (spec) => spec.module === 'accounting',
    );

    it('declares all eight accounting permissions', () => {
      expect(accounting.map((spec) => spec.code).sort()).toEqual([
        'accounting.accounts.manage',
        'accounting.accounts.view',
        'accounting.journals.create',
        'accounting.journals.post',
        'accounting.journals.reverse',
        'accounting.journals.view',
        'accounting.ledger.reconcile',
        'accounting.ledger.view',
      ]);
    });

    it('keeps authoring a draft separate from posting it', () => {
      // Scenario 44 needs an account that can author a draft and is refused the
      // posting. Collapsing these two codes into one would make that state
      // unreachable, and the scenario unprovable.
      const codes = accounting.map((spec) => spec.code);

      expect(codes).toContain('accounting.journals.create');
      expect(codes).toContain('accounting.journals.post');
    });
  });

  describe('Module 15 — reports', () => {
    const reports = PERMISSION_CATALOG.filter(
      (spec) => spec.module === 'reports',
    );

    it('declares all twelve reporting permissions', () => {
      expect(reports.map((spec) => spec.code).sort()).toEqual([
        'reports.applications.view',
        'reports.collections.view',
        'reports.dashboard.view',
        'reports.disbursals.view',
        'reports.export',
        'reports.export.pii',
        'reports.field.view',
        'reports.financial.view',
        'reports.overdue.view',
        'reports.portfolio.view',
        'reports.saved.manage',
        'reports.saved.view',
      ]);
    });

    it('keeps the financial report separable from the operational ones', () => {
      // Scenarios 28 and 49 need an account that reaches the reports area and
      // is refused the financial report specifically. One `reports.view`
      // covering every category would make that state unreachable.
      const codes = reports.map((spec) => spec.code);

      expect(codes).toContain('reports.financial.view');
      expect(codes).toContain('reports.collections.view');
    });

    it('keeps viewing a report separate from exporting it', () => {
      // Scenario 51: a user who can view a limited report and lacks export
      // permission must be refused the file. Scenario 35 splits again inside
      // export, so that PII can be masked rather than the export refused.
      const codes = reports.map((spec) => spec.code);

      expect(codes).toContain('reports.export');
      expect(codes).toContain('reports.export.pii');
    });

    it('grants no write beyond saved definitions', () => {
      // Rules 5, 6 and 17: a report is a read-only view and generating one
      // cannot modify a source record. The only write the module owns is the
      // saved report definition, so no other verb belongs in this namespace.
      const writeish = reports
        .map((spec) => spec.code)
        .filter(
          (code) =>
            !code.endsWith('.view') &&
            code !== 'reports.export' &&
            code !== 'reports.export.pii' &&
            code !== 'reports.saved.manage',
        );

      expect(writeish).toEqual([]);
    });
  });
});
