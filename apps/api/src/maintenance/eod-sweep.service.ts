import { Injectable, Logger } from '@nestjs/common';
import { formatIsoDate, todayInKolkata } from '@lms/emi';

import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessCalendarService } from '../settings/business-calendar.service';
import { EodService } from './eod.service';

export interface EodSweepResult {
  businessDate: string;
  organizations: number;
  started: number;
  alreadyHandled: number;
  skippedNonWorkingDay: number;
  failed: number;
}

/**
 * The nightly end-of-day sweep (Rule 63, Scenario 21).
 *
 * # There is no authenticated user here
 *
 * A scheduled run has no actor, but `EodService.run` needs an `AuthContext` for
 * scope and audit. This builds a SYSTEM context per organization with
 * organization-wide reach and only the EOD permission — never a borrowed
 * administrator identity. Two things follow:
 *
 *  * the audit trail records `actorUserId: null` with `triggerType: SCHEDULED`,
 *    which is what makes scheduled work distinguishable from manual (Rule 63);
 *  * the context cannot be used to do anything but run EOD, so a future change
 *    that reached for it would find no authority to borrow.
 *
 * # A non-working day is skipped, not failed
 *
 * The calendar decides. A holiday produces no run at all rather than a failed
 * one, because "we chose not to process today" and "processing broke" are
 * different operational states and an alert should only fire for the second.
 *
 * # Duplicate protection is not this file's job
 *
 * Every run claims a unique `executionKey`, so a manual run that already
 * happened today is recognised and this sweep reports `alreadyHandled` rather
 * than starting a second one (Scenarios 22, 66). This file may therefore be
 * safely re-run by hand for a missed night — which is why `now` is injectable.
 */
@Injectable()
export class EodSweepService {
  private readonly logger = new Logger(EodSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eod: EodService,
    private readonly calendar: BusinessCalendarService,
  ) {}

  async run(now: Date = new Date()): Promise<EodSweepResult> {
    const businessDate = formatIsoDate(todayInKolkata(now));

    const result: EodSweepResult = {
      businessDate,
      organizations: 0,
      started: 0,
      alreadyHandled: 0,
      skippedNonWorkingDay: 0,
      failed: 0,
    };

    const organizations = await this.prisma.organization.findMany({
      where: { status: 'ACTIVE' },
      select: { orgId: true, code: true },
    });
    result.organizations = organizations.length;

    for (const org of organizations) {
      // Each organization independently: the sweep runs unattended, so one
      // organization's bad data must not skip every organization after it.
      try {
        const isWorkingDay = await this.calendar.isWorkingDay(
          org.orgId,
          null,
          businessDate,
        );
        if (!isWorkingDay) {
          result.skippedNonWorkingDay += 1;
          continue;
        }

        const outcome = await this.eod.run(
          this.systemActor(org.orgId, org.code),
          { branchId: null, businessDate, triggerType: 'SCHEDULED' },
          // No HTTP request behind this, so no request id and no client
          // address. `userAgent` names the scheduler so an auditor reading the
          // trail can tell unattended work from a browser without joining to
          // the run row.
          { requestId: undefined, ipAddress: null, userAgent: 'scheduler' },
        );

        if (outcome.outcome === 'STARTED') result.started += 1;
        else result.alreadyHandled += 1;
      } catch (error) {
        result.failed += 1;
        this.logger.error(
          `EOD sweep failed for org ${org.code} on ${businessDate}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    this.logger.log(
      `EOD sweep ${businessDate}: ${result.started} started, ${result.alreadyHandled} already handled, ${result.skippedNonWorkingDay} non-working, ${result.failed} failed.`,
    );

    return result;
  }

  /**
   * A scope-only context for unattended work. See the class header.
   *
   * `userId` is null — there is no human actor, and inventing one would put a
   * real person's id on work they did not do.
   */
  private systemActor(orgId: string, orgCode: string): AuthContext {
    return {
      userId: null,
      orgId,
      orgCode,
      sessionId: null,
      branchId: null,
      roles: [],
      permissions: ['maintenance.eod.run'],
    } as unknown as AuthContext;
  }
}
