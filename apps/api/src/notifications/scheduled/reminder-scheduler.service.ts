import { Injectable, Logger } from '@nestjs/common';
import { formatIsoDate, todayInKolkata, type CivilDate } from '@lms/emi';

import { formatPaise } from '../../common/export/money-format';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationEventsService } from '../ingestion/notification-events.service';
import { isOverdueReminderDay } from '../notification-policy';

/** How many rows one page of a sweep loads. */
const BATCH_SIZE = 200;

/** What one sweep produced, for the log line and the spec. */
export interface SweepResult {
  businessDate: string;
  dueTomorrow: number;
  dueToday: number;
  overdue: number;
  promiseReminders: number;
  promisesMissed: number;
}

/**
 * The daily reminder sweep.
 *
 * # The business date is the whole design
 *
 * Every event this raises sets `sourceVersion` to the Asia/Kolkata business
 * date, so its deduplication key is
 * `EMI_DUE_TODAY:repayment_schedule:{emiId}:2026-08-27`.
 *
 * That single choice gives the sweep every property it needs, with no extra
 * machinery: running it twice on one day produces nothing the second time
 * (Rules 12, 22, 23), tomorrow's run produces tomorrow's reminders, and a
 * failed run can simply be re-run. The unique index on `(orgId,
 * deduplicationKey)` is what enforces it — not a "have I already run today?"
 * flag, which would be a second source of truth able to disagree with the data.
 *
 * # It reads authoritative state and computes nothing
 *
 * An overdue EMI is one whose `dueDate` has passed and whose
 * `outstandingAmountPaise` is above zero — both stored values. The sweep does
 * not classify accounts, recompute balances or decide what is owed; Rule 37
 * puts it plainly, and Scenario 39 says a missed promise must not itself change
 * a loan balance or recovery status. This service writes nothing but
 * `NotificationSourceEvent` rows.
 *
 * # Everything is paged
 *
 * An organization's EMI book can be large and this runs unattended. Each sweep
 * pages through its source query rather than loading it whole.
 */
@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: NotificationEventsService,
  ) {}

  /**
   * One day's reminders, for every organization.
   *
   * `now` is injectable so a test can pin the business date rather than
   * depending on when it runs — and so a missed day can be replayed by hand.
   */
  async run(now: Date = new Date()): Promise<SweepResult> {
    const today = todayInKolkata(now);
    const businessDate = formatIsoDate(today);

    const result: SweepResult = {
      businessDate,
      dueTomorrow: 0,
      dueToday: 0,
      overdue: 0,
      promiseReminders: 0,
      promisesMissed: 0,
    };

    const organizations = await this.prisma.organization.findMany({
      select: { orgId: true },
    });

    for (const { orgId } of organizations) {
      // Each organization is swept independently: one org's bad data must not
      // stop another's reminders. The sweep runs unattended, so a thrown error
      // here would silently skip every organization after it.
      try {
        result.dueToday += await this.sweepDue(orgId, today, businessDate, 0);
        result.dueTomorrow += await this.sweepDue(
          orgId,
          today,
          businessDate,
          1,
        );
        result.overdue += await this.sweepOverdue(orgId, today, businessDate);
        result.promiseReminders += await this.sweepPromiseReminders(
          orgId,
          today,
          businessDate,
        );
        result.promisesMissed += await this.sweepMissedPromises(
          orgId,
          today,
          businessDate,
        );
      } catch (error) {
        this.logger.error(
          `Reminder sweep failed for organization ${orgId}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Reminder sweep for ${businessDate}: ${result.dueTomorrow} due tomorrow, ` +
        `${result.dueToday} due today, ${result.overdue} overdue, ` +
        `${result.promiseReminders} promise reminders, ${result.promisesMissed} missed.`,
    );

    return result;
  }

  /**
   * EMIs falling due today or tomorrow.
   *
   * Both, because the specification's open question asked which and the honest
   * answer is that they serve different people: a day-ahead reminder gives a
   * borrower time to arrange funds, and a same-day one is what a field agent
   * works from. An organization that wants only one deactivates the other rule.
   */
  private async sweepDue(
    orgId: string,
    today: CivilDate,
    businessDate: string,
    offsetDays: 0 | 1,
  ): Promise<number> {
    const target = this.addDays(today, offsetDays);
    const eventType = offsetDays === 0 ? 'EMI_DUE_TODAY' : 'EMI_DUE_TOMORROW';

    let raised = 0;
    let cursor: string | undefined;

    for (;;) {
      const page = await this.prisma.emi.findMany({
        where: {
          orgId,
          dueDate: this.asDate(target),
          // Anything still owing. A PAID instalment needs no reminder, and a
          // partially paid one still does.
          status: { notIn: ['PAID', 'WAIVED'] },
          outstandingAmountPaise: { gt: 0 },
        },
        select: {
          emiId: true,
          installmentNumber: true,
          dueDate: true,
          outstandingAmountPaise: true,
          loan: {
            select: {
              loanNumber: true,
              branchId: true,
              customer: { select: { fullName: true } },
            },
          },
        },
        orderBy: { emiId: 'asc' },
        take: BATCH_SIZE,
        ...(cursor
          ? { skip: 1, cursor: { orgId_emiId: { orgId, emiId: cursor } } }
          : {}),
      });

      if (page.length === 0) break;

      for (const emi of page) {
        await this.events.emit({
          orgId,
          branchId: emi.loan.branchId,
          eventType,
          sourceModule: 'repayment_schedule',
          sourceRecordId: emi.emiId,
          // The business date, which is what makes a same-day re-run a no-op
          // and tomorrow's run a new event.
          sourceVersion: businessDate,
          payload: {
            loanNumber: emi.loan.loanNumber,
            customerName: emi.loan.customer?.fullName ?? '',
            installmentNumber: emi.installmentNumber,
            // DATE-only (Rules 26, 68; Scenario 36).
            dueDate: emi.dueDate.toISOString().slice(0, 10),
            amountPaise: emi.outstandingAmountPaise.toString(),
            amountFormatted: formatPaise(emi.outstandingAmountPaise.toString()),
          },
        });
        raised += 1;
      }

      if (page.length < BATCH_SIZE) break;
      cursor = page[page.length - 1].emiId;
    }

    return raised;
  }

  /**
   * Overdue instalments, on the configured cadence.
   *
   * The cadence lives in `notification-policy.ts` so it is one decision rather
   * than one per caller. Days past due is computed from stored dates only —
   * this sweep never decides whether an account *is* overdue, it reads that the
   * due date has passed and money is still owed (Rule 37).
   */
  private async sweepOverdue(
    orgId: string,
    today: CivilDate,
    businessDate: string,
  ): Promise<number> {
    let raised = 0;
    let cursor: string | undefined;

    for (;;) {
      const page = await this.prisma.emi.findMany({
        where: {
          orgId,
          dueDate: { lt: this.asDate(today) },
          status: { notIn: ['PAID', 'WAIVED'] },
          outstandingAmountPaise: { gt: 0 },
        },
        select: {
          emiId: true,
          installmentNumber: true,
          dueDate: true,
          outstandingAmountPaise: true,
          loan: {
            select: {
              loanNumber: true,
              branchId: true,
              customer: { select: { fullName: true } },
            },
          },
        },
        orderBy: { emiId: 'asc' },
        take: BATCH_SIZE,
        ...(cursor
          ? { skip: 1, cursor: { orgId_emiId: { orgId, emiId: cursor } } }
          : {}),
      });

      if (page.length === 0) break;

      for (const emi of page) {
        const daysPastDue = this.daysBetween(emi.dueDate, today);

        // Most overdue instalments raise nothing on most days. Reminding daily
        // would train recipients to ignore the reminder.
        if (!isOverdueReminderDay(daysPastDue)) continue;

        await this.events.emit({
          orgId,
          branchId: emi.loan.branchId,
          eventType: 'EMI_OVERDUE',
          sourceModule: 'overdue',
          sourceRecordId: emi.emiId,
          sourceVersion: businessDate,
          payload: {
            loanNumber: emi.loan.loanNumber,
            customerName: emi.loan.customer?.fullName ?? '',
            installmentNumber: emi.installmentNumber,
            dueDate: emi.dueDate.toISOString().slice(0, 10),
            daysPastDue,
            amountPaise: emi.outstandingAmountPaise.toString(),
            amountFormatted: formatPaise(emi.outstandingAmountPaise.toString()),
          },
        });
        raised += 1;
      }

      if (page.length < BATCH_SIZE) break;
      cursor = page[page.length - 1].emiId;
    }

    return raised;
  }

  /** Promises falling due tomorrow — a nudge before the date, not after. */
  private async sweepPromiseReminders(
    orgId: string,
    today: CivilDate,
    businessDate: string,
  ): Promise<number> {
    const tomorrow = this.asDate(this.addDays(today, 1));

    const promises = await this.prisma.recoveryAction.findMany({
      where: { orgId, promiseToPayDate: tomorrow },
      select: {
        recoveryActionId: true,
        recoveryCaseId: true,
        promiseToPayDate: true,
        promiseToPayAmountPaise: true,
        recoveryCase: {
          select: {
            caseNumber: true,
            branchId: true,
            status: true,
            loan: {
              select: {
                loanNumber: true,
                customer: { select: { fullName: true } },
              },
            },
          },
        },
      },
      take: BATCH_SIZE,
    });

    let raised = 0;
    for (const promise of promises) {
      if (promise.recoveryCase.status === 'CLOSED') continue;

      await this.events.emit({
        orgId,
        branchId: promise.recoveryCase.branchId,
        eventType: 'PROMISE_TO_PAY_REMINDER',
        sourceModule: 'recovery',
        sourceRecordId: promise.recoveryCaseId,
        // Keyed on the action, so two promises on one case each remind.
        sourceVersion: `${promise.recoveryActionId}:${businessDate}`,
        payload: {
          caseNumber: promise.recoveryCase.caseNumber,
          loanNumber: promise.recoveryCase.loan?.loanNumber ?? '',
          customerName: promise.recoveryCase.loan?.customer?.fullName ?? '',
          promiseDate: promise.promiseToPayDate!.toISOString().slice(0, 10),
          amountPaise: (promise.promiseToPayAmountPaise ?? 0n).toString(),
          amountFormatted: formatPaise(
            (promise.promiseToPayAmountPaise ?? 0n).toString(),
          ),
        },
      });
      raised += 1;
    }

    return raised;
  }

  /**
   * Promises whose date has passed without a qualifying payment (Scenario 39).
   *
   * The "was it kept?" test reads authoritative collection rows: a POSTED
   * collection on the same loan, on or after the promise date. It does **not**
   * recompute a balance or judge sufficiency — Rules 27 and 37 forbid this
   * module deciding what is owed, and Scenario 39 is explicit that raising a
   * missed-promise event must not change the loan or the case.
   */
  private async sweepMissedPromises(
    orgId: string,
    today: CivilDate,
    businessDate: string,
  ): Promise<number> {
    const todayDate = this.asDate(today);

    const promises = await this.prisma.recoveryAction.findMany({
      where: { orgId, promiseToPayDate: { lt: todayDate } },
      select: {
        recoveryActionId: true,
        recoveryCaseId: true,
        promiseToPayDate: true,
        promiseToPayAmountPaise: true,
        recoveryCase: {
          select: {
            caseNumber: true,
            branchId: true,
            status: true,
            loanId: true,
            loan: {
              select: {
                loanNumber: true,
                customer: { select: { fullName: true } },
              },
            },
          },
        },
      },
      orderBy: { promiseToPayDate: 'desc' },
      take: BATCH_SIZE,
    });

    let raised = 0;
    for (const promise of promises) {
      if (promise.recoveryCase.status === 'CLOSED') continue;

      const paid = await this.prisma.collection.count({
        where: {
          orgId,
          loanId: promise.recoveryCase.loanId,
          status: 'POSTED',
          collectionDate: { gte: promise.promiseToPayDate! },
        },
      });

      if (paid > 0) continue;

      await this.events.emit({
        orgId,
        branchId: promise.recoveryCase.branchId,
        eventType: 'PROMISE_TO_PAY_MISSED',
        sourceModule: 'recovery',
        sourceRecordId: promise.recoveryCaseId,
        // The promise date, not today's: a missed promise is announced once,
        // not every day until the case closes.
        sourceVersion: `${promise.recoveryActionId}:missed`,
        payload: {
          caseNumber: promise.recoveryCase.caseNumber,
          loanNumber: promise.recoveryCase.loan?.loanNumber ?? '',
          customerName: promise.recoveryCase.loan?.customer?.fullName ?? '',
          promiseDate: promise.promiseToPayDate!.toISOString().slice(0, 10),
          amountPaise: (promise.promiseToPayAmountPaise ?? 0n).toString(),
          amountFormatted: formatPaise(
            (promise.promiseToPayAmountPaise ?? 0n).toString(),
          ),
          businessDate,
        },
      });
      raised += 1;
    }

    return raised;
  }

  /** A `@db.Date` column compares against UTC midnight of the civil date. */
  private asDate(date: CivilDate): Date {
    return new Date(`${formatIsoDate(date)}T00:00:00.000Z`);
  }

  private addDays(date: CivilDate, days: number): CivilDate {
    const shifted = new Date(`${formatIsoDate(date)}T00:00:00.000Z`);
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    };
  }

  /** Whole days from a stored due date to the business date. */
  private daysBetween(from: Date, to: CivilDate): number {
    const start = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
    );
    const end = Date.UTC(to.year, to.month - 1, to.day);
    return Math.round((end - start) / (24 * 60 * 60 * 1000));
  }
}

// TODO(open-question): Q-NOTIF-38, Q-NOTIF-66 — holidays and branch business
// calendars. No calendar table exists anywhere in the schema, so reminders fire
// on calendar days including holidays. Adding one later changes only
// `sweepDue`'s target date and `isOverdueReminderDay`'s input.
//
// TODO(open-question): Q-NOTIF-64, Q-NOTIF-65 — quiet hours. Out of scope: the
// sweep runs at 06:00 IST, which is inside any plausible quiet-hours window
// anyway, and per-recipient quiet hours would belong in dispatch rather than
// here.
