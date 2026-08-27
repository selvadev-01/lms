import { BadRequestException } from '@nestjs/common';
import type { DashboardScope } from '@lms/types';

import {
  buildWidgetMeta,
  businessDate,
  dayRange,
  periodRange,
  resolveDashboardPeriod,
} from './widget-meta';
import { findWidget } from './widget-registry';

/**
 * Period and scope resolution.
 *
 * Three properties are worth pinning here, and each corresponds to a way the
 * dashboard could be quietly wrong rather than visibly broken:
 *
 *  1. **The presets are derived from the business date, never from input.** A
 *     `TODAY` that honoured a caller-supplied date would let a wrong device
 *     clock decide which day's collections a branch is judged on. The tests
 *     pass a fixed `today` and assert the caller's dates are ignored.
 *  2. **A custom range is bounded and ordered.** Scenario 5 and Rule 37. The
 *     bound is the report module's own, so the two cannot drift into permitting
 *     different spans.
 *  3. **An as-of-now widget does not echo the range.** Reporting `fromDate` on
 *     a figure the range never touched would suggest a filter that was not
 *     applied — the silent basis-mixing Rule 11 forbids.
 */

const SCOPE: DashboardScope = {
  branchId: null,
  branchLocked: false,
  businessDate: '2026-08-26',
};

describe('businessDate', () => {
  it('returns an ISO civil date', () => {
    expect(businessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('takes no argument, so a caller cannot supply one', () => {
    // Rule 16. The signature is the enforcement: there is no parameter for a
    // client-supplied date to arrive through.
    expect(businessDate).toHaveLength(0);
  });
});

describe('resolveDashboardPeriod', () => {
  it('defaults to month-to-date when no period is named', () => {
    // Not TODAY: a dashboard opened on the first of the month would show a
    // collection figure of zero on a healthy portfolio, which reads as a fault.
    const period = resolveDashboardPeriod({}, '2026-08-26');

    expect(period.periodType).toBe('THIS_MONTH');
    expect(period.fromDate).toBe('2026-08-01');
    expect(period.toDate).toBe('2026-08-26');
  });

  it('resolves TODAY to a single day', () => {
    const period = resolveDashboardPeriod(
      { periodType: 'TODAY' },
      '2026-08-26',
    );

    expect(period).toEqual({
      periodType: 'TODAY',
      fromDate: '2026-08-26',
      toDate: '2026-08-26',
    });
  });

  it('resolves THIS_WEEK from Monday to today', () => {
    // 2026-08-26 is a Wednesday, so the week began Monday the 24th.
    const period = resolveDashboardPeriod(
      { periodType: 'THIS_WEEK' },
      '2026-08-26',
    );

    expect(period.fromDate).toBe('2026-08-24');
    expect(period.toDate).toBe('2026-08-26');
  });

  it('treats Monday as the first day of its own week, not the last of the previous', () => {
    // 2026-08-24 is a Monday. An off-by-one here would silently report a week
    // of data on a day that should show one.
    const period = resolveDashboardPeriod(
      { periodType: 'THIS_WEEK' },
      '2026-08-24',
    );

    expect(period.fromDate).toBe('2026-08-24');
  });

  it('rolls THIS_WEEK back across a month boundary', () => {
    // 2026-09-01 is a Tuesday; its week began Monday 2026-08-31.
    const period = resolveDashboardPeriod(
      { periodType: 'THIS_WEEK' },
      '2026-09-01',
    );

    expect(period.fromDate).toBe('2026-08-31');
  });

  it('resolves THIS_MONTH to month-to-date, never to the whole month', () => {
    // A range extending past today would compute a collection rate against
    // EMIs that are not yet due.
    const period = resolveDashboardPeriod(
      { periodType: 'THIS_MONTH' },
      '2026-02-10',
    );

    expect(period.fromDate).toBe('2026-02-01');
    expect(period.toDate).toBe('2026-02-10');
  });

  it.each(['TODAY', 'THIS_WEEK', 'THIS_MONTH'])(
    'ignores caller-supplied dates for %s',
    (periodType) => {
      // The point of deriving on the server. A caller cannot widen a preset by
      // attaching dates to it.
      const period = resolveDashboardPeriod(
        { periodType, fromDate: '2020-01-01', toDate: '2020-12-31' },
        '2026-08-26',
      );

      expect(period.fromDate).not.toBe('2020-01-01');
      expect(period.toDate).toBe('2026-08-26');
    },
  );

  it('accepts a valid custom range', () => {
    const period = resolveDashboardPeriod(
      { periodType: 'CUSTOM', fromDate: '2026-01-01', toDate: '2026-01-31' },
      '2026-08-26',
    );

    expect(period).toEqual({
      periodType: 'CUSTOM',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });
  });

  it('refuses a custom range with no start date', () => {
    expect(() =>
      resolveDashboardPeriod(
        { periodType: 'CUSTOM', toDate: '2026-01-31' },
        '2026-08-26',
      ),
    ).toThrow(BadRequestException);
  });

  it('refuses a custom range with no end date', () => {
    expect(() =>
      resolveDashboardPeriod(
        { periodType: 'CUSTOM', fromDate: '2026-01-01' },
        '2026-08-26',
      ),
    ).toThrow(BadRequestException);
  });

  it('refuses an inverted custom range (Scenario 5)', () => {
    expect(() =>
      resolveDashboardPeriod(
        { periodType: 'CUSTOM', fromDate: '2026-01-31', toDate: '2026-01-01' },
        '2026-08-26',
      ),
    ).toThrow('To Date must be on or after From Date');
  });

  it('accepts a custom range of exactly the maximum span', () => {
    // 2024 is a leap year: Jan 1 to Dec 31 is 366 days inclusive.
    expect(() =>
      resolveDashboardPeriod(
        { periodType: 'CUSTOM', fromDate: '2024-01-01', toDate: '2024-12-31' },
        '2026-08-26',
      ),
    ).not.toThrow();
  });

  it('refuses a custom range one day beyond the maximum span', () => {
    // Rule 42 sends anything larger to the reporting path.
    expect(() =>
      resolveDashboardPeriod(
        { periodType: 'CUSTOM', fromDate: '2024-01-01', toDate: '2025-01-01' },
        '2026-08-26',
      ),
    ).toThrow(BadRequestException);
  });

  it('refuses an unknown period rather than defaulting to one', () => {
    // Substituting a period silently would return a number for a range the
    // caller never asked for.
    expect(() =>
      resolveDashboardPeriod({ periodType: 'THIS_QUARTER' }, '2026-08-26'),
    ).toThrow(BadRequestException);
  });
});

describe('periodRange', () => {
  it('makes the last day inclusive by ending before the next', () => {
    const range = periodRange({
      periodType: 'CUSTOM',
      fromDate: '2026-01-01',
      toDate: '2026-01-31',
    });

    expect(range.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    // Not the 31st: a `lt` on the 31st would drop every row dated that day.
    expect(range.lt.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('spans a single day for TODAY', () => {
    const range = periodRange({
      periodType: 'TODAY',
      fromDate: '2026-08-26',
      toDate: '2026-08-26',
    });

    expect(range.gte.toISOString()).toBe('2026-08-26T00:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-08-27T00:00:00.000Z');
  });
});

describe('dayRange', () => {
  it('covers exactly one calendar day', () => {
    const range = dayRange('2026-08-26');

    expect(range.gte.toISOString()).toBe('2026-08-26T00:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-08-27T00:00:00.000Z');
  });

  it('rolls across a month boundary', () => {
    expect(dayRange('2026-08-31').lt.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });
});

describe('buildWidgetMeta', () => {
  const period = {
    periodType: 'CUSTOM' as const,
    fromDate: '2026-01-01',
    toDate: '2026-01-31',
  };

  it('reports the range on a range-bounded widget', () => {
    const meta = buildWidgetMeta(
      findWidget('COLLECTION_SUMMARY')!,
      SCOPE,
      period,
    );

    expect(meta.periodApplied).toBe(true);
    expect(meta.fromDate).toBe('2026-01-01');
    expect(meta.toDate).toBe('2026-01-31');
  });

  it('omits the range entirely on an as-of-now widget', () => {
    // Echoing a range the query never used would suggest a filter that was not
    // applied — the silent basis-mixing Rule 11 forbids.
    const meta = buildWidgetMeta(findWidget('LOAN_SUMMARY')!, SCOPE, period);

    expect(meta.periodApplied).toBe(false);
    expect(meta).not.toHaveProperty('fromDate');
    expect(meta).not.toHaveProperty('toDate');
  });

  it('carries the caption that explains the period to the reader', () => {
    const meta = buildWidgetMeta(findWidget('CASH_SUMMARY')!, SCOPE, period);

    expect(meta.periodNote).toContain('business date');
  });

  it('reports LIVE freshness, because nothing is cached', () => {
    const meta = buildWidgetMeta(findWidget('LOAN_SUMMARY')!, SCOPE, period);

    expect(meta.freshness).toBe('LIVE');
    expect(Date.parse(meta.computedAt)).not.toBeNaN();
  });

  it('carries the resolved scope, not the requested one', () => {
    const meta = buildWidgetMeta(findWidget('LOAN_SUMMARY')!, SCOPE, period);

    expect(meta.scope).toEqual(SCOPE);
  });
});
