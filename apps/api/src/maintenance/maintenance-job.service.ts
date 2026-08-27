import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBranchScope } from '../reports/report-scope';

export const MAINTENANCE_JOBS_VIEW_PERMISSION = 'maintenance.jobs.view';
export const MAINTENANCE_JOBS_RUN_PERMISSION = 'maintenance.jobs.run';
export const MAINTENANCE_JOBS_RETRY_PERMISSION = 'maintenance.jobs.retry';

const NOT_REACHABLE = 'Maintenance job not found';

/** Statuses from which a retry is meaningful. */
const RETRYABLE_STATUSES = new Set(['FAILED', 'RECOVERY_REQUIRED']);

/** Statuses that mean work is already under way or done. */
const ACTIVE_STATUSES = new Set(['QUEUED', 'RUNNING']);

export interface MaintenanceStepDetail {
  jobStepId: string;
  stepCode: string;
  sequence: number;
  status: string;
  processedCount: number;
  failureCode: string | null;
  failureSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface MaintenanceJobDetail {
  jobRunId: string;
  branchId: string | null;
  jobType: string;
  businessDate: string | null;
  triggerType: string;
  executionKey: string;
  status: string;
  attemptNumber: number;
  startedAt: string | null;
  completedAt: string | null;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  failureCode: string | null;
  failureSummary: string | null;
  retryable: boolean;
  createdBy: string | null;
  createdAt: string;
  steps: MaintenanceStepDetail[];
  /** True when this reader is not permitted to see failure detail. */
  isFailureRedacted: boolean;
}

/**
 * Maintenance run records and their lifecycle (Scenarios 26-31, 66).
 *
 * # `executionKey` is the entire duplicate-prevention design
 *
 * Format: `{jobType}:{branchId ?? 'ORG'}:{businessDate}`, unique per
 * organization. Starting a run INSERTs against that constraint and treats a
 * P2002 as "already running or already done" — returning the existing row
 * idempotently rather than raising (Scenarios 22, 66). A read-then-insert would
 * race exactly where it matters most: two schedulers waking at the same second.
 *
 * `triggerType` is deliberately NOT part of the key. A scheduled run and a
 * manual run for the same scope and business date MUST collide with each other,
 * which is what Scenario 66 asks for. Adding it to the key — an easy, plausible
 * "fix" — silently breaks that with no test failure unless both paths are
 * exercised together, which `eod.service.spec.ts` does.
 *
 * # A retry never inserts
 *
 * It updates the same row and increments `attemptNumber` (Scenarios 24, 30). A
 * new row per attempt would make "how many times did this run" a COUNT over
 * rows that all claim the same execution identity, and the unique constraint
 * would refuse the second one anyway.
 */
@Injectable()
export class MaintenanceJobService {
  private readonly logger = new Logger(MaintenanceJobService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The execution identity for a scope and date. See the class header. */
  static executionKey(
    jobType: string,
    branchId: string | null,
    businessDate: string,
  ): string {
    return `${jobType}:${branchId ?? 'ORG'}:${businessDate}`;
  }

  async list(
    actor: AuthContext,
    filters: {
      jobType?: string;
      status?: string;
      branchId?: string;
      businessDate?: string;
    },
  ): Promise<MaintenanceJobDetail[]> {
    const branchScope = resolveBranchScope(actor, filters.branchId);

    const rows = await this.prisma.maintenanceJobRun.findMany({
      where: {
        orgId: actor.orgId,
        ...(filters.jobType ? { jobType: filters.jobType } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.businessDate
          ? { businessDate: new Date(`${filters.businessDate}T00:00:00.000Z`) }
          : {}),
        ...(branchScope
          ? { OR: [{ branchId: branchScope }, { branchId: null }] }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });

    return rows.map((row) => this.toDetail(row, actor));
  }

  async get(
    actor: AuthContext,
    jobRunId: string,
  ): Promise<MaintenanceJobDetail> {
    const row = await this.findInScope(actor, jobRunId);
    return this.toDetail(row, actor);
  }

  /**
   * Claim the execution identity for a run, or recognise an existing one.
   *
   * Returns `created: false` when the key was already taken — the caller then
   * knows no new work should begin (Scenarios 22, 66).
   */
  async claim(
    actor: AuthContext,
    input: {
      jobType: string;
      branchId: string | null;
      businessDate: string;
      triggerType: 'SCHEDULED' | 'MANUAL' | 'RECOVERY';
      stepCodes: Array<{ code: string; sequence: number }>;
    },
    meta: RequestMeta,
  ): Promise<{ created: boolean; jobRunId: string; status: string }> {
    const executionKey = MaintenanceJobService.executionKey(
      input.jobType,
      input.branchId,
      input.businessDate,
    );

    try {
      const created = await this.prisma.maintenanceJobRun.create({
        data: {
          orgId: actor.orgId,
          branchId: input.branchId,
          jobType: input.jobType,
          businessDate: new Date(`${input.businessDate}T00:00:00.000Z`),
          triggerType: input.triggerType,
          executionKey,
          status: 'QUEUED',
          // Null for a SCHEDULED run: there is no human actor (Rule 63).
          createdBy: input.triggerType === 'SCHEDULED' ? null : actor.userId,
        },
      });

      // Steps are created separately rather than nested under the run.
      // `MaintenanceJobStep` carries BOTH an `organization` relation and a
      // `jobRun` relation, each including `org_id`, so a nested create cannot
      // say which one supplies it — Prisma rejects the payload as invalid at
      // runtime, and the failure surfaces through AllExceptionsFilter as a 503
      // naming an unrelated service.
      //
      // Doing it in a second statement is safe here because the run has already
      // claimed the execution key: a crash between the two leaves a QUEUED run
      // with no steps, which the runner completes as a no-op and a retry
      // repairs, rather than a duplicate run.
      await this.prisma.maintenanceJobStep.createMany({
        data: input.stepCodes.map((step) => ({
          orgId: actor.orgId,
          jobRunId: created.jobRunId,
          stepCode: step.code,
          sequence: step.sequence,
          status: 'PENDING' as const,
        })),
      });

      await this.audit.record({
        orgId: actor.orgId,
        branchId: input.branchId,
        actorUserId: input.triggerType === 'SCHEDULED' ? null : actor.userId,
        action: AuditAction.MAINTENANCE_JOB_STARTED,
        entityType: 'maintenance_job_run',
        entityId: created.jobRunId,
        metadata: {
          jobType: input.jobType,
          businessDate: input.businessDate,
          triggerType: input.triggerType,
          executionKey,
        },
        ...meta,
      });

      return {
        created: true,
        jobRunId: created.jobRunId,
        status: created.status,
      };
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      // The key was already claimed. This is the designed outcome, not a
      // failure — recognise it and report what is already happening.
      const existing = await this.prisma.maintenanceJobRun.findFirst({
        where: { orgId: actor.orgId, executionKey },
      });
      if (!existing) throw error;

      await this.audit
        .record({
          orgId: actor.orgId,
          branchId: input.branchId,
          actorUserId: actor.userId,
          action: AuditAction.MAINTENANCE_JOB_DUPLICATE_IGNORED,
          entityType: 'maintenance_job_run',
          entityId: existing.jobRunId,
          metadata: {
            executionKey,
            existingStatus: existing.status,
            requestedTrigger: input.triggerType,
          },
          ...meta,
        })
        .catch(() => undefined);

      return {
        created: false,
        jobRunId: existing.jobRunId,
        status: existing.status,
      };
    }
  }

  /**
   * Retry a failed run (Scenarios 24, 30).
   *
   * Updates the SAME row — see the class header. Steps that already reached
   * SUCCEEDED are left alone, so completed deterministic work is not repeated;
   * the runner skips them on the next pass.
   */
  async retry(
    actor: AuthContext,
    jobRunId: string,
    meta: RequestMeta,
  ): Promise<MaintenanceJobDetail> {
    const row = await this.findInScope(actor, jobRunId);

    if (!RETRYABLE_STATUSES.has(row.status)) {
      throw new ConflictException(
        `A ${row.status.toLowerCase()} job cannot be retried.`,
      );
    }
    if (!row.retryable) {
      // Scenario 31: terminal and non-retryable. The remedy is a recovery
      // action, not another attempt.
      throw new ConflictException(
        'This job failed in a way that cannot be retried automatically. It requires operational recovery.',
      );
    }

    await this.prisma.maintenanceJobRun.update({
      where: { orgId_jobRunId: { orgId: actor.orgId, jobRunId } },
      data: {
        status: 'QUEUED',
        attemptNumber: { increment: 1 },
        failureCode: null,
        failureSummary: null,
        completedAt: null,
      },
    });

    // Failed steps go back to PENDING; SUCCEEDED ones are untouched.
    await this.prisma.maintenanceJobStep.updateMany({
      where: {
        orgId: actor.orgId,
        jobRunId,
        status: { in: ['FAILED', 'RUNNING'] },
      },
      data: { status: 'PENDING', failureCode: null, failureSummary: null },
    });

    await this.audit.record({
      orgId: actor.orgId,
      branchId: row.branchId,
      actorUserId: actor.userId,
      action: AuditAction.MAINTENANCE_JOB_RETRIED,
      entityType: 'maintenance_job_run',
      entityId: jobRunId,
      metadata: {
        executionKey: row.executionKey,
        attemptNumber: row.attemptNumber + 1,
      },
      ...meta,
    });

    return this.get(actor, jobRunId);
  }

  /** Mark a run RUNNING as its first step begins. */
  async markRunning(orgId: string, jobRunId: string): Promise<void> {
    await this.prisma.maintenanceJobRun.update({
      where: { orgId_jobRunId: { orgId, jobRunId } },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  async completeRun(
    orgId: string,
    jobRunId: string,
    outcome: {
      status: 'SUCCEEDED' | 'FAILED' | 'RECOVERY_REQUIRED';
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      failureCode?: string | null;
      failureSummary?: string | null;
      retryable?: boolean;
    },
    context: { actorUserId: string | null; branchId: string | null },
  ): Promise<void> {
    await this.prisma.maintenanceJobRun.update({
      where: { orgId_jobRunId: { orgId, jobRunId } },
      data: {
        status: outcome.status,
        completedAt: new Date(),
        processedCount: outcome.processedCount,
        succeededCount: outcome.succeededCount,
        failedCount: outcome.failedCount,
        failureCode: outcome.failureCode ?? null,
        failureSummary: outcome.failureSummary ?? null,
        retryable: outcome.retryable ?? false,
      },
    });

    const action =
      outcome.status === 'SUCCEEDED'
        ? AuditAction.MAINTENANCE_JOB_SUCCEEDED
        : outcome.status === 'RECOVERY_REQUIRED'
          ? AuditAction.MAINTENANCE_JOB_RECOVERY_REQUIRED
          : AuditAction.MAINTENANCE_JOB_FAILED;

    await this.audit
      .record({
        orgId,
        branchId: context.branchId,
        actorUserId: context.actorUserId,
        action,
        entityType: 'maintenance_job_run',
        entityId: jobRunId,
        metadata: {
          processed: outcome.processedCount,
          succeeded: outcome.succeededCount,
          failed: outcome.failedCount,
          failureCode: outcome.failureCode ?? null,
        },
      })
      .catch(() => undefined);
  }

  async startStep(orgId: string, jobStepId: string): Promise<void> {
    await this.prisma.maintenanceJobStep.update({
      where: { orgId_jobStepId: { orgId, jobStepId } },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
  }

  async finishStep(
    orgId: string,
    jobStepId: string,
    outcome: {
      status: 'SUCCEEDED' | 'FAILED';
      processedCount?: number;
      failureCode?: string | null;
      failureSummary?: string | null;
    },
  ): Promise<void> {
    await this.prisma.maintenanceJobStep.update({
      where: { orgId_jobStepId: { orgId, jobStepId } },
      data: {
        status: outcome.status,
        completedAt: new Date(),
        processedCount: outcome.processedCount ?? 0,
        failureCode: outcome.failureCode ?? null,
        failureSummary: outcome.failureSummary ?? null,
      },
    });
  }

  /** The steps still to run for an attempt — SUCCEEDED ones are skipped. */
  async pendingSteps(
    orgId: string,
    jobRunId: string,
  ): Promise<Array<{ jobStepId: string; stepCode: string; sequence: number }>> {
    return this.prisma.maintenanceJobStep.findMany({
      where: { orgId, jobRunId, status: { not: 'SUCCEEDED' } },
      orderBy: { sequence: 'asc' },
      select: { jobStepId: true, stepCode: true, sequence: true },
    });
  }

  // --- internals ----------------------------------------------------------

  private async findInScope(actor: AuthContext, jobRunId: string) {
    const row = await this.prisma.maintenanceJobRun.findFirst({
      where: { orgId: actor.orgId, jobRunId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });
    if (!row) throw new NotFoundException(NOT_REACHABLE);

    // Scenario 45's scope half: a branch-confined operator reaching another
    // branch's job is refused even though they hold the retry permission.
    if (actor.branchId && row.branchId && row.branchId !== actor.branchId) {
      void this.audit
        .record({
          orgId: actor.orgId,
          branchId: actor.branchId,
          actorUserId: actor.userId,
          action: AuditAction.MAINTENANCE_SCOPE_DENIED,
          entityType: 'maintenance_job_run',
          entityId: jobRunId,
          metadata: { targetBranchId: row.branchId },
        })
        .catch(() => undefined);
      throw new NotFoundException(NOT_REACHABLE);
    }
    return row;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private toDetail(
    row: {
      jobRunId: string;
      branchId: string | null;
      jobType: string;
      businessDate: Date | null;
      triggerType: string;
      executionKey: string;
      status: string;
      attemptNumber: number;
      startedAt: Date | null;
      completedAt: Date | null;
      processedCount: number;
      succeededCount: number;
      failedCount: number;
      failureCode: string | null;
      failureSummary: string | null;
      retryable: boolean;
      createdBy: string | null;
      createdAt: Date;
      steps?: Array<{
        jobStepId: string;
        stepCode: string;
        sequence: number;
        status: string;
        processedCount: number;
        failureCode: string | null;
        failureSummary: string | null;
        startedAt: Date | null;
        completedAt: Date | null;
      }>;
    },
    actor: AuthContext,
  ): MaintenanceJobDetail {
    // Scenario 27 — failure detail is restricted by permission. A viewer sees
    // that it failed; what it says is for whoever may act on it.
    const maySeeFailure =
      actor.permissions.includes(MAINTENANCE_JOBS_RUN_PERMISSION) ||
      actor.permissions.includes(MAINTENANCE_JOBS_RETRY_PERMISSION);

    return {
      jobRunId: row.jobRunId,
      branchId: row.branchId,
      jobType: row.jobType,
      businessDate: row.businessDate?.toISOString().slice(0, 10) ?? null,
      triggerType: row.triggerType,
      executionKey: row.executionKey,
      status: row.status,
      attemptNumber: row.attemptNumber,
      startedAt: row.startedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      processedCount: row.processedCount,
      succeededCount: row.succeededCount,
      failedCount: row.failedCount,
      failureCode: maySeeFailure ? row.failureCode : null,
      failureSummary: maySeeFailure ? row.failureSummary : null,
      retryable: row.retryable,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      steps: (row.steps ?? []).map((step) => ({
        jobStepId: step.jobStepId,
        stepCode: step.stepCode,
        sequence: step.sequence,
        status: step.status,
        processedCount: step.processedCount,
        failureCode: maySeeFailure ? step.failureCode : null,
        failureSummary: maySeeFailure ? step.failureSummary : null,
        startedAt: step.startedAt?.toISOString() ?? null,
        completedAt: step.completedAt?.toISOString() ?? null,
      })),
      isFailureRedacted: !maySeeFailure,
    };
  }
}
