import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchScope } from '../reports/report-scope';
import { BusinessCalendarService } from '../settings/business-calendar.service';
import { eodStepsInOrder, type EodStep } from './eod-step.registry';
import {
  MaintenanceJobService,
  type MaintenanceJobDetail,
} from './maintenance-job.service';

export const MAINTENANCE_EOD_RUN_PERMISSION = 'maintenance.eod.run';

export const EOD_JOB_TYPE = 'EOD';

/**
 * End-of-day processing (Scenarios 21-25, 66).
 *
 * # This service decides WHEN, never WHAT
 *
 * The steps come from `eod-step.registry.ts` and are all read-only over
 * authoritative data. Nothing here posts to the ledger, allocates a receipt or
 * closes a day — see that file's header for why that is the design rather than
 * an unfinished state.
 *
 * # A failed run never advances the business date
 *
 * There is no stored business date to advance. `currentBusinessDate` is derived
 * from the clock on every read, so Scenario 23 holds structurally: a failed EOD
 * cannot silently move a date that was never a stored value. What a failure does
 * do is stop the run and leave every unfinished step PENDING for the retry.
 *
 * # Scheduled and manual runs collide with each other, on purpose
 *
 * Both paths call `run()` and both derive the same `executionKey`, which
 * excludes `triggerType` precisely so they contend (Scenario 66). The test
 * exercises both in one case, because a key-format change would otherwise break
 * this silently.
 */
@Injectable()
export class EodService {
  private readonly logger = new Logger(EodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: MaintenanceJobService,
    private readonly calendar: BusinessCalendarService,
  ) {}

  /**
   * Run EOD for a scope and business date.
   *
   * Executes inline rather than enqueuing. The steps are counts over indexed
   * columns, so the request completes in the time an ordinary report takes; a
   * queue would add a moving part whose only benefit is for work this module
   * deliberately does not do.
   */
  async run(
    actor: AuthContext,
    input: {
      branchId?: string | null;
      businessDate?: string;
      triggerType?: 'SCHEDULED' | 'MANUAL' | 'RECOVERY';
    },
    meta: RequestMeta,
  ): Promise<{
    outcome: 'STARTED' | 'ALREADY_HANDLED';
    job: MaintenanceJobDetail;
  }> {
    const branchId =
      input.branchId === undefined
        ? (actor.branchId ?? null)
        : input.branchId === null
          ? null
          : resolveBranchScope(actor, input.branchId);

    const businessDate =
      input.businessDate ?? this.calendar.currentBusinessDate();

    // A future date has no closed books to process. Refused rather than run
    // against data that does not exist yet.
    if (businessDate > this.calendar.currentBusinessDate()) {
      throw new BadRequestException(
        'End of day cannot be run for a future business date',
      );
    }

    const steps = eodStepsInOrder();

    const claim = await this.jobs.claim(
      actor,
      {
        jobType: EOD_JOB_TYPE,
        branchId,
        businessDate,
        triggerType: input.triggerType ?? 'MANUAL',
        stepCodes: steps.map((step) => ({
          code: step.code,
          sequence: step.sequence,
        })),
      },
      meta,
    );

    // Scenarios 22 and 66: the key was already claimed. No new work begins, and
    // this is reported as an idempotent recognition rather than an error.
    if (!claim.created) {
      return {
        outcome: 'ALREADY_HANDLED',
        job: await this.jobs.get(actor, claim.jobRunId),
      };
    }

    await this.execute(actor, claim.jobRunId, branchId, businessDate, steps);

    return {
      outcome: 'STARTED',
      job: await this.jobs.get(actor, claim.jobRunId),
    };
  }

  /**
   * Resume a retried run.
   *
   * Reads its scope back from the row rather than taking it from the caller: a
   * retry must run exactly the work the original run identified, and accepting
   * a fresh scope here would let a retry quietly become a different job.
   */
  async resume(
    actor: AuthContext,
    jobRunId: string,
  ): Promise<MaintenanceJobDetail> {
    const job = await this.jobs.get(actor, jobRunId);
    const steps = eodStepsInOrder();

    await this.execute(
      actor,
      jobRunId,
      job.branchId,
      job.businessDate ?? this.calendar.currentBusinessDate(),
      steps,
    );

    return this.jobs.get(actor, jobRunId);
  }

  /**
   * Walk the pending steps in sequence.
   *
   * Stops at the first failure. Continuing past one would run later steps
   * against a state earlier steps were supposed to have established, and the
   * run summary would then describe work done on unsound footing.
   */
  private async execute(
    actor: AuthContext,
    jobRunId: string,
    branchId: string | null,
    businessDate: string,
    steps: EodStep[],
  ): Promise<void> {
    await this.jobs.markRunning(actor.orgId, jobRunId);

    // SUCCEEDED steps are absent from this list — that is the skip-on-retry
    // guarantee (Scenario 24), and it comes from the query rather than from a
    // condition here that somebody could later invert.
    const pending = await this.jobs.pendingSteps(actor.orgId, jobRunId);

    let processed = 0;
    let succeeded = 0;

    for (const pendingStep of pending) {
      const step = steps.find(
        (candidate) => candidate.code === pendingStep.stepCode,
      );
      if (!step) {
        // A step recorded on the run but no longer registered. Skipping it
        // silently would let a retry report success for work nothing performed.
        await this.jobs.finishStep(actor.orgId, pendingStep.jobStepId, {
          status: 'FAILED',
          failureCode: 'STEP_NOT_REGISTERED',
          failureSummary: `Step ${pendingStep.stepCode} is no longer registered.`,
        });
        await this.jobs.completeRun(
          actor.orgId,
          jobRunId,
          {
            status: 'RECOVERY_REQUIRED',
            processedCount: processed,
            succeededCount: succeeded,
            failedCount: 1,
            failureCode: 'STEP_NOT_REGISTERED',
            failureSummary: `Step ${pendingStep.stepCode} is no longer registered.`,
            retryable: false,
          },
          { actorUserId: actor.userId, branchId },
        );
        return;
      }

      await this.jobs.startStep(actor.orgId, pendingStep.jobStepId);

      try {
        const result = await step.run({
          orgId: actor.orgId,
          branchId,
          businessDate,
          prisma: this.prisma,
        });

        processed += result.processed;
        succeeded += 1;

        await this.jobs.finishStep(actor.orgId, pendingStep.jobStepId, {
          status: 'SUCCEEDED',
          processedCount: result.processed,
          failureSummary: result.summary ?? null,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown step failure';
        this.logger.error(`EOD step ${step.code} failed: ${message}`);

        await this.jobs.finishStep(actor.orgId, pendingStep.jobStepId, {
          status: 'FAILED',
          failureCode: 'STEP_FAILED',
          failureSummary: message,
        });

        // Scenario 23: the run stops here. Nothing marks the day closed and
        // nothing advances a business date.
        await this.jobs.completeRun(
          actor.orgId,
          jobRunId,
          {
            status: step.retryable ? 'FAILED' : 'RECOVERY_REQUIRED',
            processedCount: processed,
            succeededCount: succeeded,
            failedCount: 1,
            failureCode: 'STEP_FAILED',
            failureSummary: `${step.code}: ${message}`,
            retryable: step.retryable,
          },
          { actorUserId: actor.userId, branchId },
        );
        return;
      }
    }

    await this.jobs.completeRun(
      actor.orgId,
      jobRunId,
      {
        status: 'SUCCEEDED',
        processedCount: processed,
        succeededCount: succeeded,
        failedCount: 0,
      },
      { actorUserId: actor.userId, branchId },
    );
  }
}
