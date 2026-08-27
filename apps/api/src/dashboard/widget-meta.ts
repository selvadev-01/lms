import { BadRequestException } from '@nestjs/common';
import { formatIsoDate, todayInKolkata } from '@lms/emi';
import type {
  DashboardPeriodType,
  DashboardScope,
  DashboardWidgetMeta,
} from '@lms/types';

import {
  assertDateRange,
  civilToDate,
  civilToExclusiveEnd,
} from '../reports/report-scope';
import type { WidgetSpec } from './widget-registry';

/**
 * The period a request asked for, resolved against the business date.
 *
 * `fromDate` and `toDate` are always present once resolved, even for a preset:
 * the caller should not have to know which periods carry dates, and a widget
 * that reports the range it used can be checked against the number it returned.
 */
export interface ResolvedPeriod {
  periodType: DashboardPeriodType;
  fromDate: string;
  toDate: string;
}

/** The shape a Prisma date filter takes for an inclusive civil-date range. */
export interface PeriodRange {
  gte: Date;
  lt: Date;
}

/**
 * The default period.
 *
 * `THIS_MONTH` rather than `TODAY`: a dashboard opened on the first of the
 * month with a `TODAY` default shows a collection figure of zero on a portfolio
 * that is performing normally, which reads as a fault. A month-to-date figure
 * is never empty for a branch that is operating.
 */
export const DEFAULT_PERIOD: DashboardPeriodType = 'THIS_MONTH';

/**
 * The day of the week, Monday = 0.
 *
 * Read from a UTC date built from the civil parts, never from a local `Date`:
 * a server in a western timezone would otherwise compute yesterday's weekday
 * for an Asia/Kolkata business date and start the week one day early.
 */
function mondayIndex(iso: string): number {
  const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  return (day + 6) % 7;
}

/** Subtracts whole days from an ISO civil date, staying in UTC throughout. */
function minusDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * The authoritative business date, as an ISO civil date.
 *
 * Deliberately takes no argument. Rule 16 requires the dashboard to use the
 * authoritative business date, and the overdue module documents why it must not
 * come from the client: an `asOf` parameter would let a wrong device clock move
 * a borrower into or out of the overdue book. There is no such parameter
 * anywhere in this module, so the question cannot arise.
 */
export function businessDate(): string {
  return formatIsoDate(todayInKolkata());
}

/**
 * Turn a requested period into a concrete date range.
 *
 * The three presets are derived here, on the server, from the business date.
 * Deriving them in the browser would have been simpler and would have meant a
 * user in another timezone — or with a wrong clock — silently seeing a
 * different "today" than the one their branch is operating on.
 *
 * `CUSTOM` is the only period that reads the caller's dates, and it is bounded
 * by the same 366-day limit a report is (Rule 37, Scenario 5). A dashboard that
 * permitted a wider range than the report behind it would produce a KPI that no
 * report could reconcile, and Rule 42 sends anything larger to the reporting
 * path regardless.
 */
export function resolveDashboardPeriod(
  query: { periodType?: string; fromDate?: string; toDate?: string },
  today: string = businessDate(),
): ResolvedPeriod {
  const periodType = (query.periodType ??
    DEFAULT_PERIOD) as DashboardPeriodType;

  switch (periodType) {
    case 'TODAY':
      return { periodType, fromDate: today, toDate: today };

    case 'THIS_WEEK':
      // Monday to today, not a rolling seven days: a branch reconciles against
      // a calendar week, and "this week" that moved every day could not be
      // compared with the same figure read yesterday.
      return {
        periodType,
        fromDate: minusDays(today, mondayIndex(today)),
        toDate: today,
      };

    case 'THIS_MONTH': {
      // Month-to-date, not the whole month. A figure that included dates in the
      // future would report a collection rate against EMIs not yet due.
      const [year, month] = today.split('-');
      return { periodType, fromDate: `${year}-${month}-01`, toDate: today };
    }

    case 'CUSTOM': {
      if (!query.fromDate) {
        throw new BadRequestException('Period Start Date is required');
      }
      if (!query.toDate) {
        throw new BadRequestException('Period End Date is required');
      }

      // Reuses the report bound rather than restating it, so the two cannot
      // drift into permitting different spans.
      assertDateRange(query.fromDate, query.toDate);
      return {
        periodType,
        fromDate: query.fromDate,
        toDate: query.toDate,
      };
    }

    default:
      // An unknown period reaching here means the DTO's enum was bypassed.
      // Refused rather than defaulted: silently substituting a period would
      // return a number for a range the caller never asked for.
      throw new BadRequestException('Period is not a supported value');
  }
}

/**
 * The period as a Prisma filter.
 *
 * `lt` the day after `toDate`, so the range is inclusive of its last day
 * regardless of whether the column is a DATE or a timestamp.
 */
export function periodRange(period: ResolvedPeriod): PeriodRange {
  return {
    gte: civilToDate(period.fromDate),
    lt: civilToExclusiveEnd(period.toDate),
  };
}

/**
 * A calendar day as a Prisma filter, for the widgets pinned to the business
 * date rather than to the selected period.
 */
export function dayRange(iso: string): PeriodRange {
  return { gte: civilToDate(iso), lt: civilToExclusiveEnd(iso) };
}

/**
 * Build a widget's metadata.
 *
 * The `fromDate`/`toDate` pair appears only when the period was actually
 * applied. An as-of-now widget that echoed the requested range would suggest
 * its number was filtered by it, which is exactly the silent basis-mixing Rule
 * 11 forbids — so instead it carries `periodApplied: false` and a caption
 * saying why.
 */
export function buildWidgetMeta(
  spec: WidgetSpec,
  scope: DashboardScope,
  period: ResolvedPeriod,
): DashboardWidgetMeta {
  const periodApplied = spec.scopeType === 'RANGE_BOUNDED';

  return {
    widgetCode: spec.code,
    title: spec.title,
    scopeType: spec.scopeType,
    periodApplied,
    periodNote: spec.periodNote,
    source: spec.source,
    drillDownHref: spec.drillDownHref,
    // Nothing is cached, so every figure is computed during this request. The
    // field exists so that a cache added later has a declared place to report
    // staleness from, rather than needing a change to the response shape.
    freshness: 'LIVE',
    computedAt: new Date().toISOString(),
    scope,
    ...(periodApplied
      ? { fromDate: period.fromDate, toDate: period.toDate }
      : {}),
  };
}
