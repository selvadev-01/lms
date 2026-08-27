import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatIsoDate, todayInKolkata } from '@lms/emi';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchScope } from '../reports/report-scope';

export const SETTINGS_CALENDAR_VIEW_PERMISSION = 'settings.calendar.view';
export const SETTINGS_CALENDAR_MANAGE_PERMISSION = 'settings.calendar.manage';

const NOT_REACHABLE = 'Business calendar not found';

/** The only timezone this system operates in (Rule 16). */
const SUPPORTED_TIMEZONE = 'Asia/Kolkata';

/** Monday–Friday, the default when a calendar is first created. */
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5];

export interface HolidayDetail {
  holidayId: string;
  holidayDate: string;
  name: string;
}

export interface BusinessCalendarDetail {
  calendarId: string;
  branchId: string | null;
  name: string;
  timezone: string;
  workingDays: number[];
  eodWindowStart: string | null;
  eodWindowEnd: string | null;
  allowControlledRerun: boolean;
  status: string;
  version: number;
  holidays: HolidayDetail[];
  /** Today, per this calendar. Derived, never stored. */
  currentBusinessDate: string;
  isWorkingDayToday: boolean;
}

/**
 * The business calendar — working days, holidays and the EOD window.
 *
 * # This is what closes a TODO that has been open since Module 16
 *
 * `notifications/scheduled/reminder-scheduler.service.ts` records that no
 * calendar table exists anywhere in the schema, and that reminders therefore
 * fire on calendar days including holidays. `isWorkingDay` below is the function
 * that file was waiting for. Wiring it into the reminder sweep is deliberately
 * NOT done here — that changes Module 16 behaviour and belongs with its own
 * tests.
 *
 * # Business dates are derived, never stored
 *
 * `currentBusinessDate` is computed from `todayInKolkata()` on every read. A
 * stored "current business date" column would be a second source of truth that a
 * missed EOD leaves permanently wrong, and every consumer would then be reading
 * a date that quietly stopped advancing (Rule 65, Scenario 23).
 *
 * # One calendar per scope
 *
 * Enforced by partial unique indexes in the migration, not by a read-then-write
 * check here, which would race.
 */
@Injectable()
export class BusinessCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The calendar governing a scope, falling back to the organization default.
   *
   * A branch without its own calendar is governed by the organization's — which
   * is why this resolves rather than simply fetching. Returning "not found" for
   * a branch that has never been configured would make EOD unrunnable there.
   */
  async resolve(
    orgId: string,
    branchId: string | null,
  ): Promise<{
    calendarId: string;
    branchId: string | null;
    timezone: string;
    workingDays: number[];
    eodWindowStart: string | null;
    eodWindowEnd: string | null;
    allowControlledRerun: boolean;
  } | null> {
    const rows = await this.prisma.businessCalendar.findMany({
      where: {
        orgId,
        status: 'ACTIVE',
        ...(branchId
          ? { OR: [{ branchId }, { branchId: null }] }
          : { branchId: null }),
      },
    });

    // The branch-specific calendar wins over the organization default.
    const specific = rows.find((row) => row.branchId === branchId);
    const chosen = specific ?? rows.find((row) => row.branchId === null);
    return chosen ?? null;
  }

  async get(
    actor: AuthContext,
    branchId?: string,
  ): Promise<BusinessCalendarDetail | null> {
    const scope = resolveBranchScope(actor, branchId);

    const row = await this.prisma.businessCalendar.findFirst({
      where: { orgId: actor.orgId, branchId: scope },
      include: { holidays: { orderBy: { holidayDate: 'asc' } } },
    });
    if (!row) return null;

    return this.toDetail(row);
  }

  async list(actor: AuthContext): Promise<BusinessCalendarDetail[]> {
    const scope = resolveBranchScope(actor);

    const rows = await this.prisma.businessCalendar.findMany({
      where: {
        orgId: actor.orgId,
        ...(scope ? { OR: [{ branchId: scope }, { branchId: null }] } : {}),
      },
      include: { holidays: { orderBy: { holidayDate: 'asc' } } },
      orderBy: { branchId: 'asc' },
    });

    return rows.map((row) => this.toDetail(row));
  }

  /**
   * Create or update the calendar for a scope.
   *
   * Every rule here is re-asserted server-side even though the zod schema in
   * `@lms/validation` already checks it: that schema runs in the browser and
   * guards nothing against a direct API caller.
   */
  async upsert(
    actor: AuthContext,
    input: {
      branchId?: string | null;
      name: string;
      timezone: string;
      workingDays?: number[];
      eodWindowStart?: string | null;
      eodWindowEnd?: string | null;
      allowControlledRerun?: boolean;
      expectedVersion?: number;
    },
    meta: RequestMeta,
  ): Promise<BusinessCalendarDetail> {
    const branchId = input.branchId
      ? resolveBranchScope(actor, input.branchId)
      : input.branchId === null
        ? null
        : (actor.branchId ?? null);

    this.assertTimezone(actor, input.timezone, branchId, meta);
    const workingDays = this.normalizeWorkingDays(input.workingDays);
    this.assertEodWindow(
      actor,
      input.eodWindowStart,
      input.eodWindowEnd,
      branchId,
      meta,
    );

    const existing = await this.prisma.businessCalendar.findFirst({
      where: { orgId: actor.orgId, branchId },
    });

    if (!existing) {
      const created = await this.prisma.businessCalendar.create({
        data: {
          orgId: actor.orgId,
          branchId,
          name: input.name,
          timezone: SUPPORTED_TIMEZONE,
          workingDays,
          eodWindowStart: input.eodWindowStart ?? null,
          eodWindowEnd: input.eodWindowEnd ?? null,
          allowControlledRerun: input.allowControlledRerun ?? true,
          status: 'ACTIVE',
          createdBy: actor.userId,
          updatedBy: actor.userId,
        },
        include: { holidays: true },
      });

      await this.audit.record({
        orgId: actor.orgId,
        branchId,
        actorUserId: actor.userId,
        action: AuditAction.BUSINESS_CALENDAR_UPDATED,
        entityType: 'business_calendar',
        entityId: created.calendarId,
        newData: { workingDays, name: input.name },
        ...meta,
      });

      return this.toDetail(created);
    }

    if (input.expectedVersion === undefined) {
      throw new BadRequestException(
        'This form is out of date. Reload and try again.',
      );
    }

    const result = await this.prisma.businessCalendar.updateMany({
      where: {
        orgId: actor.orgId,
        calendarId: existing.calendarId,
        version: input.expectedVersion,
      },
      data: {
        name: input.name,
        workingDays,
        eodWindowStart: input.eodWindowStart ?? null,
        eodWindowEnd: input.eodWindowEnd ?? null,
        allowControlledRerun:
          input.allowControlledRerun ?? existing.allowControlledRerun,
        updatedBy: actor.userId,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'This calendar was changed by someone else. Reload and try again.',
      );
    }

    const refreshed = await this.prisma.businessCalendar.findFirst({
      where: { orgId: actor.orgId, calendarId: existing.calendarId },
      include: { holidays: { orderBy: { holidayDate: 'asc' } } },
    });
    if (!refreshed) throw new NotFoundException(NOT_REACHABLE);

    await this.audit.record({
      orgId: actor.orgId,
      branchId,
      actorUserId: actor.userId,
      action: AuditAction.BUSINESS_CALENDAR_UPDATED,
      entityType: 'business_calendar',
      entityId: existing.calendarId,
      oldData: {
        workingDays: existing.workingDays,
        eodWindowStart: existing.eodWindowStart,
        eodWindowEnd: existing.eodWindowEnd,
      },
      newData: {
        workingDays,
        eodWindowStart: input.eodWindowStart ?? null,
        eodWindowEnd: input.eodWindowEnd ?? null,
      },
      ...meta,
    });

    return this.toDetail(refreshed);
  }

  async addHoliday(
    actor: AuthContext,
    calendarId: string,
    input: { holidayDate: string; name: string },
    meta: RequestMeta,
  ): Promise<HolidayDetail> {
    const calendar = await this.findCalendarInScope(actor, calendarId);

    const created = await this.prisma.calendarHoliday.create({
      data: {
        orgId: actor.orgId,
        calendarId,
        holidayDate: new Date(`${input.holidayDate}T00:00:00.000Z`),
        name: input.name,
        createdBy: actor.userId,
      },
    });

    await this.audit.record({
      orgId: actor.orgId,
      branchId: calendar.branchId,
      actorUserId: actor.userId,
      action: AuditAction.CALENDAR_HOLIDAY_ADDED,
      entityType: 'calendar_holiday',
      entityId: created.holidayId,
      newData: { holidayDate: input.holidayDate, name: input.name },
      ...meta,
    });

    return {
      holidayId: created.holidayId,
      holidayDate: input.holidayDate,
      name: created.name,
    };
  }

  async removeHoliday(
    actor: AuthContext,
    calendarId: string,
    holidayId: string,
    meta: RequestMeta,
  ): Promise<void> {
    const calendar = await this.findCalendarInScope(actor, calendarId);

    const holiday = await this.prisma.calendarHoliday.findFirst({
      where: { orgId: actor.orgId, calendarId, holidayId },
    });
    if (!holiday) throw new NotFoundException('Holiday not found');

    await this.prisma.calendarHoliday.delete({
      where: { orgId_holidayId: { orgId: actor.orgId, holidayId } },
    });

    await this.audit.record({
      orgId: actor.orgId,
      branchId: calendar.branchId,
      actorUserId: actor.userId,
      action: AuditAction.CALENDAR_HOLIDAY_REMOVED,
      entityType: 'calendar_holiday',
      entityId: holidayId,
      oldData: {
        holidayDate: holiday.holidayDate.toISOString().slice(0, 10),
        name: holiday.name,
      },
      ...meta,
    });
  }

  /**
   * Whether a date is a working day for a scope.
   *
   * The function `reminder-scheduler.service.ts` has been waiting for. A scope
   * with no calendar configured is treated as "every day is a working day",
   * which preserves today's behaviour rather than silently stopping work in an
   * organization that never configured one.
   */
  async isWorkingDay(
    orgId: string,
    branchId: string | null,
    isoDate: string,
  ): Promise<boolean> {
    const calendar = await this.resolve(orgId, branchId);
    if (!calendar) return true;

    // `getUTCDay` is 0=Sunday..6=Saturday; the stored array is ISO 1=Monday..7=Sunday.
    const weekday = new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
    const isoWeekday = weekday === 0 ? 7 : weekday;
    if (!calendar.workingDays.includes(isoWeekday)) return false;

    const holiday = await this.prisma.calendarHoliday.findFirst({
      where: {
        orgId,
        calendarId: calendar.calendarId,
        holidayDate: new Date(`${isoDate}T00:00:00.000Z`),
      },
    });
    return holiday === null;
  }

  /** Today in Asia/Kolkata. Never `new Date()` — see the class header. */
  currentBusinessDate(now: Date = new Date()): string {
    return formatIsoDate(todayInKolkata(now));
  }

  // --- internals ----------------------------------------------------------

  private assertTimezone(
    actor: AuthContext,
    timezone: string,
    branchId: string | null,
    meta: RequestMeta,
  ): void {
    if (timezone === SUPPORTED_TIMEZONE) return;

    void this.audit
      .record({
        orgId: actor.orgId,
        branchId,
        actorUserId: actor.userId,
        action: AuditAction.BUSINESS_CALENDAR_REJECTED,
        entityType: 'business_calendar',
        metadata: { reason: 'Unsupported timezone', timezone },
        ...meta,
      })
      .catch(() => undefined);

    throw new BadRequestException(
      `Only ${SUPPORTED_TIMEZONE} is supported as a business timezone`,
    );
  }

  /**
   * Scenario 20 — an EOD window that ends before it starts would never open.
   *
   * Both-or-neither, and end strictly after start. Compared as "HH:MM" strings,
   * which sort correctly because both are zero-padded.
   */
  private assertEodWindow(
    actor: AuthContext,
    start: string | null | undefined,
    end: string | null | undefined,
    branchId: string | null,
    meta: RequestMeta,
  ): void {
    const hasStart = Boolean(start);
    const hasEnd = Boolean(end);

    const fail = (reason: string): never => {
      void this.audit
        .record({
          orgId: actor.orgId,
          branchId,
          actorUserId: actor.userId,
          action: AuditAction.BUSINESS_CALENDAR_REJECTED,
          entityType: 'business_calendar',
          metadata: { reason, eodWindowStart: start, eodWindowEnd: end },
          ...meta,
        })
        .catch(() => undefined);
      throw new BadRequestException(reason);
    };

    if (hasStart !== hasEnd) {
      fail('Set both ends of the EOD window, or neither');
    }
    if (hasStart && hasEnd && end! <= start!) {
      fail('The EOD window must end after it starts');
    }
  }

  private normalizeWorkingDays(days?: number[]): number[] {
    if (!days || days.length === 0) return DEFAULT_WORKING_DAYS;

    const unique = [...new Set(days)].sort((a, b) => a - b);
    if (unique.some((day) => day < 1 || day > 7 || !Number.isInteger(day))) {
      throw new BadRequestException(
        'Working days must be ISO weekday numbers from 1 (Monday) to 7 (Sunday)',
      );
    }
    return unique;
  }

  private async findCalendarInScope(
    actor: AuthContext,
    calendarId: string,
  ): Promise<{ calendarId: string; branchId: string | null }> {
    const row = await this.prisma.businessCalendar.findFirst({
      where: { orgId: actor.orgId, calendarId },
    });
    if (!row) throw new NotFoundException(NOT_REACHABLE);

    if (actor.branchId && row.branchId && row.branchId !== actor.branchId) {
      throw new NotFoundException(NOT_REACHABLE);
    }
    return row;
  }

  private toDetail(row: {
    calendarId: string;
    branchId: string | null;
    name: string;
    timezone: string;
    workingDays: number[];
    eodWindowStart: string | null;
    eodWindowEnd: string | null;
    allowControlledRerun: boolean;
    status: string;
    version: number;
    holidays?: Array<{ holidayId: string; holidayDate: Date; name: string }>;
  }): BusinessCalendarDetail {
    const today = this.currentBusinessDate();
    const holidays = (row.holidays ?? []).map((holiday) => ({
      holidayId: holiday.holidayId,
      holidayDate: holiday.holidayDate.toISOString().slice(0, 10),
      name: holiday.name,
    }));

    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const isoWeekday = weekday === 0 ? 7 : weekday;

    return {
      calendarId: row.calendarId,
      branchId: row.branchId,
      name: row.name,
      timezone: row.timezone,
      workingDays: row.workingDays,
      eodWindowStart: row.eodWindowStart,
      eodWindowEnd: row.eodWindowEnd,
      allowControlledRerun: row.allowControlledRerun,
      status: row.status,
      version: row.version,
      holidays,
      currentBusinessDate: today,
      isWorkingDayToday:
        row.workingDays.includes(isoWeekday) &&
        !holidays.some((holiday) => holiday.holidayDate === today),
    };
  }
}
