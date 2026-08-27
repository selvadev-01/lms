import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { AuthContext } from '../common/auth-context';
import { resolveDateBasis } from './report-date-basis';
import {
  assertDateRange,
  assertExportSize,
  buildMeta,
  canSeePii,
  inclusiveDaySpan,
  maskMobile,
  maskName,
  orgBranchWhere,
  REPORT_LIMITS,
  resolveBranchScope,
} from './report-scope';

/**
 * Module 15 — scope, bounds and masking.
 *
 * These are the tests that matter most in this module. Every report delegates
 * its scope decision to `resolveBranchScope` and its bounds to
 * `assertDateRange`, so a bug here is a bug in all eight categories at once —
 * and the failure mode is a branch reading another branch's book, which no
 * amount of care in the individual services would catch.
 *
 * Named after the scenarios they prove, so traceability survives.
 */

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    orgId: '22222222-2222-4222-8222-222222222222',
    orgCode: 'DEMO',
    sessionId: '33333333-3333-4333-8333-333333333333',
    branchId: null,
    roles: ['SUPER_ADMIN'],
    permissions: [],
    ...overrides,
  };
}

const BRANCH_A = '44444444-4444-4444-8444-444444444444';
const BRANCH_B = '55555555-5555-4555-8555-555555555555';

describe('REPORT_LIMITS', () => {
  it('matches the values the web app and the zod schema use', () => {
    // The same two numbers are declared three times: here for the CJS Nest
    // build, in `@lms/constants` for the web app, and in
    // `packages/validation/src/reports.ts` for the browser-side schema. The
    // duplication is forced — `@lms/constants` ships raw ESM that the API build
    // cannot require, and the validation package is a leaf that must not depend
    // on constants — but nothing else would notice if one copy drifted, and a
    // range the browser accepts and the server refuses is a form that cannot be
    // submitted and does not say why.
    expect(REPORT_LIMITS.MAX_DATE_RANGE_DAYS).toBe(366);
    expect(REPORT_LIMITS.MAX_EXPORT_ROWS).toBe(10_000);
  });
});

describe('resolveBranchScope', () => {
  describe('Scenario 11: client-supplied branch cannot override authorization', () => {
    it('refuses a branch-confined caller who names another branch', () => {
      // The heart of it. A Branch Admin asking for Branch B is refused rather
      // than silently served Branch A's rows under Branch B's heading — a
      // caller who believes they are reading another branch must not be handed
      // their own data mislabelled.
      expect(() =>
        resolveBranchScope(actor({ branchId: BRANCH_A }), BRANCH_B),
      ).toThrow(ForbiddenException);
    });

    it('allows a branch-confined caller to name their own branch', () => {
      expect(resolveBranchScope(actor({ branchId: BRANCH_A }), BRANCH_A)).toBe(
        BRANCH_A,
      );
    });

    it('confines a branch caller who names no branch at all', () => {
      // Omitting the filter must not mean "everything". This is the case a
      // forgotten scope spread would produce, and it is the one that leaks.
      expect(resolveBranchScope(actor({ branchId: BRANCH_A }))).toBe(BRANCH_A);
    });
  });

  describe('Scenario 53: organization-wide callers may compare branches', () => {
    it('honours a named branch for an unscoped caller', () => {
      expect(resolveBranchScope(actor(), BRANCH_B)).toBe(BRANCH_B);
    });

    it('returns organization-wide when an unscoped caller names none', () => {
      expect(resolveBranchScope(actor())).toBeNull();
    });
  });
});

describe('orgBranchWhere', () => {
  it('always carries the organization', () => {
    // Scenario 54: cross-organization access is denied. The organization is not
    // optional and does not come from the request, so there is no shape of
    // query that omits it.
    expect(orgBranchWhere(actor())).toEqual({
      orgId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('adds the branch for a confined caller', () => {
    expect(orgBranchWhere(actor({ branchId: BRANCH_A }))).toEqual({
      orgId: '22222222-2222-4222-8222-222222222222',
      branchId: BRANCH_A,
    });
  });

  it('omits the branch key entirely when organization-wide', () => {
    // `branchId: undefined` would be a Prisma filter matching only rows whose
    // branch is null. Omitting the key is what makes it "all branches".
    expect(Object.keys(orgBranchWhere(actor()))).toEqual(['orgId']);
  });
});

describe('assertDateRange', () => {
  describe('Scenario 9: reject invalid date range', () => {
    it('rejects a From Date after the To Date', () => {
      expect(() => assertDateRange('2026-02-01', '2026-01-01')).toThrow(
        BadRequestException,
      );
    });

    it('accepts a single-day range', () => {
      expect(() => assertDateRange('2026-01-15', '2026-01-15')).not.toThrow();
    });
  });

  describe('Scenario 62: report query exceeds configured limits', () => {
    it('accepts a full financial year', () => {
      expect(() => assertDateRange('2026-01-01', '2026-12-31')).not.toThrow();
    });

    it('rejects a range beyond the ceiling', () => {
      expect(() => assertDateRange('2025-01-01', '2026-12-31')).toThrow(
        BadRequestException,
      );
    });

    it('accepts exactly the ceiling and rejects one day more', () => {
      // The boundary from both sides. An off-by-one here refuses a legitimate
      // leap-year report, which looks like a bug in the data rather than in the
      // limit.
      const from = '2026-01-01';
      const atLimit = new Date('2026-01-01T12:00:00Z');
      atLimit.setUTCDate(
        atLimit.getUTCDate() + REPORT_LIMITS.MAX_DATE_RANGE_DAYS - 1,
      );
      const overLimit = new Date(atLimit);
      overLimit.setUTCDate(overLimit.getUTCDate() + 1);

      const iso = (date: Date): string => date.toISOString().slice(0, 10);

      expect(inclusiveDaySpan(from, iso(atLimit))).toBe(
        REPORT_LIMITS.MAX_DATE_RANGE_DAYS,
      );
      expect(() => assertDateRange(from, iso(atLimit))).not.toThrow();
      expect(() => assertDateRange(from, iso(overLimit))).toThrow(
        BadRequestException,
      );
    });
  });

  it('counts days inclusively of both ends', () => {
    expect(inclusiveDaySpan('2026-01-01', '2026-01-01')).toBe(1);
    expect(inclusiveDaySpan('2026-01-01', '2026-01-31')).toBe(31);
  });
});

describe('assertExportSize', () => {
  describe('Scenario 62: an over-sized export is refused, never truncated', () => {
    it('accepts a result set at the limit', () => {
      expect(() =>
        assertExportSize(REPORT_LIMITS.MAX_EXPORT_ROWS),
      ).not.toThrow();
    });

    it('rejects one row beyond it', () => {
      // Truncating instead would produce a file indistinguishable from a
      // complete one once it is open in a spreadsheet, and someone would act on
      // it. The refusal names the row count so the user knows what to narrow.
      expect(() => assertExportSize(REPORT_LIMITS.MAX_EXPORT_ROWS + 1)).toThrow(
        BadRequestException,
      );
    });
  });
});

describe('resolveDateBasis', () => {
  describe('Scenario 12: a report uses its declared date basis', () => {
    it('defaults to the category basis when none is named', () => {
      expect(resolveDateBasis('COLLECTIONS')).toBe('COLLECTION_DATE');
      expect(resolveDateBasis('APPLICATIONS')).toBe('APPLICATION_DATE');
      expect(resolveDateBasis('FINANCIAL')).toBe('ACCOUNTING_DATE');
    });

    it('accepts a basis the category permits', () => {
      expect(resolveDateBasis('DASHBOARD', 'DISBURSAL_DATE')).toBe(
        'DISBURSAL_DATE',
      );
    });
  });

  describe('Scenario 10: reject unsupported filter combination', () => {
    it('refuses a basis the category does not permit', () => {
      // An application report filtered by disbursal date would silently exclude
      // every application that was never disbursed. Refusing is the only
      // outcome that does not quietly answer a different question.
      expect(() => resolveDateBasis('APPLICATIONS', 'DISBURSAL_DATE')).toThrow(
        BadRequestException,
      );
      expect(() => resolveDateBasis('FINANCIAL', 'COLLECTION_DATE')).toThrow(
        BadRequestException,
      );
    });
  });
});

describe('buildMeta', () => {
  it('reports the scope enforced, not the scope requested', () => {
    // Scenario 11 again, from the response side: a caller whose branch was
    // narrowed learns it from `meta`, rather than reading Branch A's numbers
    // believing them to be Branch B's.
    const meta = buildMeta({
      category: 'COLLECTIONS',
      dateBasis: 'COLLECTION_DATE',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
      branchId: BRANCH_A,
      piiMasked: false,
    });

    expect(meta.branchId).toBe(BRANCH_A);
    expect(meta.dateBasis).toBe('COLLECTION_DATE');
  });

  describe('Scenario 4: freshness is stated', () => {
    it('carries a data-fresh timestamp', () => {
      // Rule 36: aggregated data must not be presented as real-time without an
      // indicator. Nothing is cached today, so this is the moment of the query
      // — honest rather than absent, and already the place a cache's staleness
      // would be reported.
      const meta = buildMeta({
        category: 'DASHBOARD',
        dateBasis: 'COLLECTION_DATE',
        fromDate: '',
        toDate: '',
        branchId: null,
        piiMasked: false,
      });

      expect(Date.parse(meta.dataFreshAt)).not.toBeNaN();
    });
  });
});

describe('PII masking', () => {
  describe('Scenario 35: an export without PII permission masks rather than fails', () => {
    it('passes names through for a caller holding the permission', () => {
      expect(maskName('Asha Patel', true)).toBe('Asha Patel');
      expect(maskMobile('9876543210', true)).toBe('9876543210');
    });

    it('masks names and mobiles for a caller without it', () => {
      // Initials rather than a blank: Rule 49 requires a report to distinguish
      // an unavailable value from a masked one, and an empty cell reads as "no
      // customer" rather than "not shown to you".
      expect(maskName('Asha Patel', false)).toBe('A••••');
      expect(maskMobile('9876543210', false)).toBe('••••••10');
    });

    it('masks an empty name without crashing', () => {
      expect(maskName('', false)).toBe('••••');
    });
  });

  it('reads the permission from the actor, not from a parameter', () => {
    expect(canSeePii(actor({ permissions: [] }))).toBe(false);
    expect(canSeePii(actor({ permissions: ['reports.export.pii'] }))).toBe(
      true,
    );
  });
});
