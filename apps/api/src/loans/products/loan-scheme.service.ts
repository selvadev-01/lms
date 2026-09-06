import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { LoanSchemeDetail, LoanSchemeSummary } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLoanSchemeDto } from './dto/create-loan-scheme.dto';
import { ListLoanSchemesDto } from './dto/list-loan-schemes.dto';
import {
  CreateSchemeDurationDto,
  UpdateSchemeDurationDto,
  validateSchemeDurationRange,
} from './dto/scheme-duration.dto';
import { SetLoanConfigStatusDto } from './dto/set-loan-config-status.dto';
import { UpdateLoanSchemeDto } from './dto/update-loan-scheme.dto';
import {
  toDurationOption,
  toSchemeSummary,
  type LoanSchemeDurationRow,
  type LoanSchemeRow,
} from './loan-scheme.mapper';

export const LOAN_SCHEMES_VIEW_PERMISSION = 'loans.schemes.view';
export const LOAN_SCHEMES_MANAGE_PERMISSION = 'loans.schemes.manage';
export const LOAN_SCHEMES_ACTIVATE_PERMISSION = 'loans.schemes.activate';

const NOT_REACHABLE = 'Loan scheme not found';

type SchemeWithProduct = LoanSchemeRow & {
  loanProduct: {
    code: string;
    name: string;
    loanType: string;
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  };
  durations: LoanSchemeDurationRow[];
};

/**
 * Whether a scheme offers this exact `(frequency, durationCount)`.
 *
 * **Exported, and the only implementation of this rule.** It is checked in two
 * places — here, inside the submit transaction, and again by the completeness
 * service for the advisory summary. Those were two hand-written copies of the
 * same `.some(...)`, which was survivable while the rule was "the counts must be
 * equal" and stops being so now that a row may describe a range: a drifted copy
 * would show a green tick on the review screen for a term submit then refuses.
 *
 * A row with null bounds matches its own count and nothing else — the original
 * behaviour, and why no existing scheme changes meaning. A row with bounds
 * accepts anything inside them, which is what lets a daily loan carry whatever
 * count the borrower's dates imply.
 */
export function termIsOffered(
  durations: ReadonlyArray<{
    status: string;
    frequency: string;
    durationCount: number;
    minDurationCount?: number | null;
    maxDurationCount?: number | null;
  }>,
  frequency: string,
  durationCount: number,
): boolean {
  return durations.some((duration) => {
    if (duration.status !== 'ACTIVE') return false;
    if (duration.frequency !== frequency) return false;

    const { minDurationCount: min, maxDurationCount: max } = duration;

    // Both bounds or neither — the CHECK constraint guarantees it, and this
    // reads the pair rather than trusting one of them alone.
    //
    // `== null` deliberately, catching undefined as well as null: Prisma returns
    // null, but a caller assembling this shape by hand — a mapper, a test
    // fixture — naturally omits the field, and treating that as "range starts at
    // undefined" would silently accept every count.
    if (min == null || max == null) {
      return duration.durationCount === durationCount;
    }

    return durationCount >= min && durationCount <= max;
  });
}

/**
 * Module 06 — Loan Schemes.
 *
 * A scheme is a priced, term-bounded offering under a product: an interest type,
 * a rate, and the set of frequency/duration pairs a borrower may choose. It is
 * the thing an application actually selects.
 *
 * Two rules govern everything here:
 *
 * 1. **A scheme's terms are copied onto an application at creation, not
 *    referenced.** Repricing a scheme therefore changes what *new* applications
 *    are offered and nothing else, which is what makes Module 07 Scenario 39
 *    hold without this module doing anything special.
 *
 * 2. **Selectability is a three-part condition** — the scheme is ACTIVE, its
 *    product is ACTIVE, and it has at least one ACTIVE duration option. All
 *    three are checked again at submit inside the submitting transaction, so the
 *    picker's answer is a convenience and never the authority (Rule 72).
 */
@Injectable()
export class LoanSchemeService {
  private readonly logger = new Logger(LoanSchemeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    query: ListLoanSchemesDto,
    meta: RequestMeta,
  ): Promise<LoanSchemeSummary[]> {
    const rows = await this.prisma.loanScheme.findMany({
      where: {
        orgId: actor.orgId,
        ...(query.productId ? { loanProductId: query.productId } : {}),
        ...(query.status ? { status: query.status } : {}),
        // The wizard's picker. All three conditions, because a scheme active
        // under a withdrawn product, or one with no term a borrower could pick,
        // is not something an application may be created against.
        ...(query.selectable
          ? {
              status: 'ACTIVE' as const,
              loanProduct: { status: 'ACTIVE' as const },
              durations: { some: { status: 'ACTIVE' as const } },
            }
          : {}),
      },
      orderBy: { code: 'asc' },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_SCHEME_LISTED,
      entityType: 'LOAN_SCHEME',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        returned: rows.length,
        productId: query.productId ?? null,
        status: query.status ?? null,
        selectable: query.selectable ?? false,
      },
    });

    return (rows as LoanSchemeRow[]).map(toSchemeSummary);
  }

  async getById(
    actor: AuthContext,
    loanSchemeId: string,
    meta: RequestMeta,
  ): Promise<LoanSchemeDetail> {
    const row = await this.findInScope(actor, loanSchemeId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_SCHEME_VIEWED,
      entityType: 'LOAN_SCHEME',
      entityId: loanSchemeId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.toDetail(row);
  }

  /**
   * Creates a scheme in DRAFT under an existing product.
   *
   * DRAFT rather than ACTIVE because a scheme with no duration options cannot be
   * borrowed over; `setStatus` refuses to activate one, so creating it active
   * would be a state the activate path itself rejects.
   */
  async create(
    actor: AuthContext,
    dto: CreateLoanSchemeDto,
    meta: RequestMeta,
  ): Promise<LoanSchemeDetail> {
    const product = await this.prisma.loanProduct.findUnique({
      where: {
        orgId_loanProductId: {
          orgId: actor.orgId,
          loanProductId: dto.loanProductId,
        },
      },
    });

    // Same message as a missing product elsewhere: a caller must not learn that
    // a product id exists in another tenant by the shape of the refusal.
    if (!product) {
      await this.recordRejection(actor, meta, 'PRODUCT_NOT_REACHABLE', {
        loanProductId: dto.loanProductId,
      });
      throw new NotFoundException('Loan product not found');
    }

    const existing = await this.prisma.loanScheme.findUnique({
      where: { orgId_code: { orgId: actor.orgId, code: dto.code } },
    });

    if (existing) {
      await this.recordRejection(actor, meta, 'DUPLICATE_CODE', {
        code: dto.code,
      });
      throw new ConflictException(
        `Scheme Code ${dto.code} is already in use in this organization`,
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.loanScheme.create({
          data: {
            orgId: actor.orgId,
            loanProductId: dto.loanProductId,
            code: dto.code,
            name: dto.name,
            interestType: dto.interestType,
            interestRateBps: BigInt(dto.interestRateBps),
            status: 'DRAFT',
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_SCHEME_CREATED,
            entityType: 'LOAN_SCHEME',
            entityId: row.loanSchemeId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            newData: {
              code: row.code,
              name: row.name,
              interestType: row.interestType,
              interestRateBps: row.interestRateBps.toString(),
              loanProductId: row.loanProductId,
              status: row.status,
            },
          },
          tx,
        );

        return row;
      });

      return this.toDetail(
        await this.loadWithRelations(actor.orgId, created.loanSchemeId),
      );
    } catch (error) {
      await this.recordPersistenceFailure(actor, meta, error, 'create', null);
      throw this.translateUniqueViolation(error, dto.code);
    }
  }

  async update(
    actor: AuthContext,
    loanSchemeId: string,
    dto: UpdateLoanSchemeDto,
    meta: RequestMeta,
  ): Promise<LoanSchemeDetail> {
    const before = await this.findInScope(actor, loanSchemeId, meta);
    await this.assertVersion(actor, before, dto.expectedVersion, meta);

    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.loanScheme.update({
          where: { orgId_loanSchemeId: { orgId: actor.orgId, loanSchemeId } },
          data: {
            name: dto.name,
            interestType: dto.interestType,
            interestRateBps: BigInt(dto.interestRateBps),
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_SCHEME_UPDATED,
            entityType: 'LOAN_SCHEME',
            entityId: loanSchemeId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: {
              name: before.name,
              interestType: before.interestType,
              interestRateBps: before.interestRateBps.toString(),
            },
            newData: {
              name: row.name,
              interestType: row.interestType,
              interestRateBps: row.interestRateBps.toString(),
            },
          },
          tx,
        );
      });

      return this.toDetail(
        await this.loadWithRelations(actor.orgId, loanSchemeId),
      );
    } catch (error) {
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'update',
        loanSchemeId,
      );
      throw error;
    }
  }

  /**
   * Activates or deactivates a scheme.
   *
   * Activation is refused unless the scheme has at least one ACTIVE duration
   * option. A scheme nothing can be borrowed over would appear in the wizard's
   * picker and then fail every submission against it — better to refuse the
   * activation, where the administrator can act on it.
   */
  async setStatus(
    actor: AuthContext,
    loanSchemeId: string,
    dto: SetLoanConfigStatusDto,
    meta: RequestMeta,
  ): Promise<LoanSchemeDetail> {
    const before = await this.findInScope(actor, loanSchemeId, meta);
    await this.assertVersion(actor, before, dto.expectedVersion, meta);

    if (before.status === dto.status) {
      throw new ConflictException(`Loan scheme is already ${dto.status}`);
    }

    const activating = dto.status === 'ACTIVE';

    if (activating) {
      const activeDurations = before.durations.filter(
        (duration) => duration.status === 'ACTIVE',
      ).length;

      if (activeDurations === 0) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.LOAN_SCHEME_ACTIVATION_BLOCKED,
          entityType: 'LOAN_SCHEME',
          entityId: loanSchemeId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: 'NO_ACTIVE_DURATION' },
        });

        throw new ConflictException(
          'Add at least one active duration option before activating this scheme',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.loanScheme.update({
        where: { orgId_loanSchemeId: { orgId: actor.orgId, loanSchemeId } },
        data: { status: dto.status },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: activating
            ? AuditAction.LOAN_SCHEME_ACTIVATED
            : AuditAction.LOAN_SCHEME_DEACTIVATED,
          entityType: 'LOAN_SCHEME',
          entityId: loanSchemeId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: dto.reason ?? null },
          oldData: { status: before.status },
          newData: { status: row.status },
        },
        tx,
      );
    });

    return this.toDetail(
      await this.loadWithRelations(actor.orgId, loanSchemeId),
    );
  }

  /** Adds one frequency/duration option to a scheme. */
  async addDuration(
    actor: AuthContext,
    loanSchemeId: string,
    dto: CreateSchemeDurationDto,
    meta: RequestMeta,
  ): Promise<LoanSchemeDetail> {
    await this.findInScope(actor, loanSchemeId, meta);

    // Cross-field rules the decorators cannot express. Refused before the write
    // so the caller gets the reason rather than a CHECK-constraint violation,
    // which would surface as an opaque 503.
    const rangeError = validateSchemeDurationRange(dto);
    if (rangeError) {
      throw new BadRequestException(rangeError);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const row = await tx.loanSchemeDuration.create({
          data: {
            orgId: actor.orgId,
            loanSchemeId,
            frequency: dto.frequency,
            durationCount: dto.durationCount,
            // Null unless both were given — `validateSchemeDurationRange` has
            // already refused one without the other.
            minDurationCount: dto.minDurationCount ?? null,
            maxDurationCount: dto.maxDurationCount ?? null,
            status: 'ACTIVE',
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_SCHEME_DURATION_ADDED,
            entityType: 'LOAN_SCHEME',
            entityId: loanSchemeId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            newData: {
              loanSchemeDurationId: row.loanSchemeDurationId,
              frequency: row.frequency,
              durationCount: row.durationCount,
              // Audited because they widen what the submit gate accepts.
              minDurationCount: row.minDurationCount,
              maxDurationCount: row.maxDurationCount,
            },
          },
          tx,
        );
      });

      return this.toDetail(
        await this.loadWithRelations(actor.orgId, loanSchemeId),
      );
    } catch (error) {
      const prismaCode = (error as { code?: string } | null)?.code;

      // @@unique([orgId, loanSchemeId, frequency, durationCount]). Translated
      // here for the same reason as everywhere else: untranslated, P2002 reaches
      // AllExceptionsFilter and renders as a 503 about the auth service.
      if (prismaCode === 'P2002') {
        throw new ConflictException(
          `This scheme already offers ${dto.durationCount} ${dto.frequency.toLowerCase()} periods`,
        );
      }

      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'addDuration',
        loanSchemeId,
      );
      throw error;
    }
  }

  /**
   * Activates or deactivates one duration option.
   *
   * Deactivating the last active option does not deactivate the scheme, but does
   * make it unselectable through the `selectable` filter — the scheme's own
   * status is left to an administrator rather than changed underneath them.
   */
  async setDurationStatus(
    actor: AuthContext,
    loanSchemeId: string,
    loanSchemeDurationId: string,
    dto: UpdateSchemeDurationDto,
    meta: RequestMeta,
  ): Promise<LoanSchemeDetail> {
    const scheme = await this.findInScope(actor, loanSchemeId, meta);

    const duration = scheme.durations.find(
      (candidate) => candidate.loanSchemeDurationId === loanSchemeDurationId,
    );

    if (!duration) {
      throw new NotFoundException('Duration option not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.loanSchemeDuration.update({
        where: {
          orgId_loanSchemeDurationId: {
            orgId: actor.orgId,
            loanSchemeDurationId,
          },
        },
        data: { status: dto.status },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.LOAN_SCHEME_DURATION_UPDATED,
          entityType: 'LOAN_SCHEME',
          entityId: loanSchemeId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: { status: duration.status },
          newData: { status: dto.status, loanSchemeDurationId },
        },
        tx,
      );
    });

    return this.toDetail(
      await this.loadWithRelations(actor.orgId, loanSchemeId),
    );
  }

  /**
   * Deletes a duration option, unless an application already uses it.
   *
   * The check runs inside the deleting transaction so an application created
   * between check and delete cannot be orphaned. There is no FK from
   * `LoanApplication` to `LoanSchemeDuration` — the application stores the
   * frequency and count as values — so nothing in the database would stop this;
   * the guard is the only thing that does.
   */
  async removeDuration(
    actor: AuthContext,
    loanSchemeId: string,
    loanSchemeDurationId: string,
    meta: RequestMeta,
  ): Promise<LoanSchemeDetail> {
    const scheme = await this.findInScope(actor, loanSchemeId, meta);

    const duration = scheme.durations.find(
      (candidate) => candidate.loanSchemeDurationId === loanSchemeDurationId,
    );

    if (!duration) {
      throw new NotFoundException('Duration option not found');
    }

    await this.prisma.$transaction(async (tx) => {
      const referencing = await tx.loanApplication.count({
        where: {
          orgId: actor.orgId,
          loanSchemeId,
          repaymentFrequency: duration.frequency,
          durationCount: duration.durationCount,
        },
      });

      if (referencing > 0) {
        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_SCHEME_DURATION_DELETE_BLOCKED,
            entityType: 'LOAN_SCHEME',
            entityId: loanSchemeId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: { loanSchemeDurationId, applications: referencing },
          },
          tx,
        );

        throw new ConflictException(
          `${referencing} application(s) use this duration. Deactivate it instead of deleting it.`,
        );
      }

      await tx.loanSchemeDuration.delete({
        where: {
          orgId_loanSchemeDurationId: {
            orgId: actor.orgId,
            loanSchemeDurationId,
          },
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.LOAN_SCHEME_DURATION_REMOVED,
          entityType: 'LOAN_SCHEME',
          entityId: loanSchemeId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            loanSchemeDurationId,
            frequency: duration.frequency,
            durationCount: duration.durationCount,
          },
        },
        tx,
      );
    });

    return this.toDetail(
      await this.loadWithRelations(actor.orgId, loanSchemeId),
    );
  }

  /**
   * The seam Module 07 uses to validate an application's scheme choice.
   *
   * Takes a `tx` so the caller can check and write atomically — that is what
   * makes Rule 72 hold, since a scheme deactivated between the wizard's preview
   * and the submit must still be caught.
   *
   * Returns the scheme so the caller can copy its terms rather than re-reading.
   */
  async assertSelectable(
    tx: Pick<PrismaService, 'loanScheme'>,
    orgId: string,
    loanSchemeId: string,
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY',
    durationCount: number,
  ): Promise<LoanSchemeRow & { loanProductId: string }> {
    const scheme = await tx.loanScheme.findUnique({
      where: { orgId_loanSchemeId: { orgId, loanSchemeId } },
      include: { loanProduct: true, durations: true },
    });

    if (!scheme) {
      throw new NotFoundException(NOT_REACHABLE);
    }

    const typed = scheme as unknown as SchemeWithProduct;

    if (typed.loanProduct.status !== 'ACTIVE') {
      throw new ConflictException(
        'This loan product is no longer available for new applications',
      );
    }

    if (typed.status !== 'ACTIVE') {
      throw new ConflictException(
        'This loan scheme is no longer available for new applications',
      );
    }

    if (!termIsOffered(typed.durations, frequency, durationCount)) {
      throw new ConflictException(
        'This scheme does not offer the selected duration and frequency',
      );
    }

    return typed;
  }

  private async loadWithRelations(
    orgId: string,
    loanSchemeId: string,
  ): Promise<SchemeWithProduct> {
    const row = await this.prisma.loanScheme.findUnique({
      where: { orgId_loanSchemeId: { orgId, loanSchemeId } },
      include: {
        loanProduct: true,
        durations: { orderBy: { durationCount: 'asc' } },
      },
    });

    if (!row) {
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private async findInScope(
    actor: AuthContext,
    loanSchemeId: string,
    meta: RequestMeta,
  ): Promise<SchemeWithProduct> {
    const row = await this.prisma.loanScheme.findUnique({
      where: { orgId_loanSchemeId: { orgId: actor.orgId, loanSchemeId } },
      include: {
        loanProduct: true,
        durations: { orderBy: { durationCount: 'asc' } },
      },
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_SCHEME_SCOPE_DENIED,
        entityType: 'LOAN_SCHEME',
        entityId: loanSchemeId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { reason: 'NOT_FOUND_OR_OTHER_ORG' },
      });
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  private toDetail(row: SchemeWithProduct): LoanSchemeDetail {
    return {
      ...toSchemeSummary(row),
      productCode: row.loanProduct.code,
      productName: row.loanProduct.name,
      loanType: row.loanProduct.loanType,
      durations: row.durations.map(toDurationOption),
    };
  }

  private async assertVersion(
    actor: AuthContext,
    row: LoanSchemeRow,
    expectedVersion: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (row.updatedAt.toISOString() === expectedVersion) return;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_SCHEME_CONCURRENT_EDIT_REJECTED,
      entityType: 'LOAN_SCHEME',
      entityId: row.loanSchemeId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        expected: expectedVersion,
        actual: row.updatedAt.toISOString(),
      },
    });

    throw new ConflictException(
      'This loan scheme was changed by someone else. Reload and try again.',
    );
  }

  private async recordRejection(
    actor: AuthContext,
    meta: RequestMeta,
    reason: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_SCHEME_CREATE_REJECTED,
      entityType: 'LOAN_SCHEME',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason, ...details },
    });
  }

  private async recordPersistenceFailure(
    actor: AuthContext,
    meta: RequestMeta,
    error: unknown,
    operation: string,
    loanSchemeId: string | null,
  ): Promise<void> {
    this.logger.error(
      `Loan scheme ${operation} failed for org ${actor.orgId}`,
      error instanceof Error ? error.stack : undefined,
    );

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_SCHEME_PERSISTENCE_FAILED,
        entityType: 'LOAN_SCHEME',
        entityId: loanSchemeId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { operation },
      })
      .catch(() => {
        // The store is already failing; a second failure must not mask the
        // original error the caller needs to see.
      });
  }

  private translateUniqueViolation(error: unknown, code: string): unknown {
    const prismaCode = (error as { code?: string } | null)?.code;

    if (prismaCode === 'P2002') {
      return new ConflictException(
        `Scheme Code ${code} is already in use in this organization`,
      );
    }

    return error;
  }
}
