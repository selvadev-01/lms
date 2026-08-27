import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthContext } from '../common/auth-context';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type {
  CreateRetentionPolicyDto,
  UpdateRetentionPolicyDto,
} from './dto/retention-policy.dto';

/**
 * Data retention and archival policies (Scenarios 55-58).
 *
 * # Immutability is decided by category, once, at write time
 *
 * `IMMUTABLE_CATEGORIES` is the authority for Rule 76, and the flag it produces
 * is stored on the row. The caller does NOT get to say whether a category is
 * immutable: accepting that from a DTO would let a client mark ledger evidence
 * purgeable, which is precisely what the rule forbids. It is stored rather than
 * recomputed on read so a later change to this list cannot retroactively
 * unprotect evidence an existing policy was created to preserve.
 *
 * # Deletion is blocked once a policy has governed processing
 *
 * `referencedAt` is what makes Scenario 56 structural. A policy that has never
 * run can be deleted outright; one that has is deactivated or replaced. The
 * alternative — deleting a policy whose decisions are already reflected in
 * purged data — would leave audit history pointing at a policy that no longer
 * exists.
 *
 * # There is no branch scope
 *
 * `RetentionPolicy` has no `branchId`, so no method here takes one. See the
 * model comment: retention answers an organization-wide compliance question,
 * and a per-branch policy is not expressible rather than expressible-and-ignored.
 */

export const RETENTION_POLICIES_VIEW_PERMISSION = 'retention.policies.view';
export const RETENTION_POLICIES_MANAGE_PERMISSION = 'retention.policies.manage';
export const RETENTION_PURGE_RUN_PERMISSION = 'retention.purge.run';

/**
 * Categories that Rule 76 protects from purge outright.
 *
 * Financial, ledger and audit evidence. A policy over one of these may describe
 * how long it is kept and when it is archived, but never when it is destroyed —
 * the database CHECK `retention_policies_immutable_never_purges` enforces the
 * same thing, so a raw insert cannot get around this either.
 */
const IMMUTABLE_CATEGORIES = new Set([
  'AUDIT_LOG',
  'LEDGER_ENTRY',
  'JOURNAL_ENTRY',
]);

export interface RetentionPolicyDetail {
  retentionPolicyId: string;
  name: string;
  recordCategory: string;
  retentionPeriodDays: number;
  archiveAfterDays: number | null;
  purgeAfterDays: number | null;
  immutableEvidence: boolean;
  legalHoldSupported: boolean;
  status: string;
  /** Null until the policy has governed real processing (Scenario 56). */
  referencedAt: string | null;
  /** Whether deletion is available, so a UI need not re-derive the rule. */
  deletable: boolean;
  version: number;
  updatedAt: string;
}

@Injectable()
export class RetentionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    filters: { recordCategory?: string; includeInactive?: boolean } = {},
  ): Promise<RetentionPolicyDetail[]> {
    const rows = await this.prisma.retentionPolicy.findMany({
      where: {
        orgId: actor.orgId,
        ...(filters.recordCategory
          ? { recordCategory: filters.recordCategory as never }
          : {}),
        // Scenario 57: retention PROCESSING never selects an inactive policy —
        // that is enforced in `resolveForProcessing` below. This list is an
        // administrative view, where hiding retired policies would make the
        // deactivate-then-replace history unreadable.
        ...(filters.includeInactive ? {} : { status: 'ACTIVE' as const }),
      },
      orderBy: [{ recordCategory: 'asc' }, { status: 'asc' }],
    });

    return rows.map((row) => this.toDetail(row));
  }

  async get(
    actor: AuthContext,
    retentionPolicyId: string,
  ): Promise<RetentionPolicyDetail> {
    return this.toDetail(await this.findInScope(actor, retentionPolicyId));
  }

  /**
   * The policy that governs new processing for a category (Scenario 57).
   *
   * Returns null when no ACTIVE policy exists — the caller must then leave the
   * records alone. An inactive policy is never selected, and this is the only
   * method the purge path may use to choose one.
   */
  async resolveForProcessing(
    orgId: string,
    recordCategory: string,
  ): Promise<RetentionPolicyDetail | null> {
    const row = await this.prisma.retentionPolicy.findFirst({
      where: {
        orgId,
        recordCategory: recordCategory as never,
        status: 'ACTIVE',
      },
    });

    return row ? this.toDetail(row) : null;
  }

  async create(
    actor: AuthContext,
    dto: CreateRetentionPolicyDto,
  ): Promise<RetentionPolicyDetail> {
    const immutableEvidence = IMMUTABLE_CATEGORIES.has(dto.recordCategory);

    // Refused here rather than left to the CHECK constraint so the caller gets
    // an explanation naming the rule, not an opaque 500 from a constraint whose
    // name means nothing to them.
    if (immutableEvidence && dto.purgeAfterDays != null) {
      throw new BadRequestException(
        `${dto.recordCategory} is immutable evidence and can never be purged. Remove the purge schedule; retention and archival may still be set.`,
      );
    }
    this.assertCoherent(dto);

    try {
      const row = await this.prisma.retentionPolicy.create({
        data: {
          orgId: actor.orgId,
          name: dto.name,
          recordCategory: dto.recordCategory as never,
          retentionPeriodDays: dto.retentionPeriodDays,
          archiveAfterDays: dto.archiveAfterDays ?? null,
          purgeAfterDays: dto.purgeAfterDays ?? null,
          immutableEvidence,
          legalHoldSupported: dto.legalHoldSupported ?? false,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        },
      });

      await this.audit.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: 'RETENTION_POLICY_CREATED',
        entityType: 'RETENTION_POLICY',
        entityId: row.retentionPolicyId,
        newData: this.toDetail(row) as unknown as Record<string, unknown>,
      });

      return this.toDetail(row);
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }
  }

  async update(
    actor: AuthContext,
    retentionPolicyId: string,
    dto: UpdateRetentionPolicyDto,
  ): Promise<RetentionPolicyDetail> {
    const existing = await this.findInScope(actor, retentionPolicyId);

    const merged = {
      recordCategory: existing.recordCategory,
      retentionPeriodDays:
        dto.retentionPeriodDays ?? existing.retentionPeriodDays,
      archiveAfterDays:
        dto.archiveAfterDays === undefined
          ? existing.archiveAfterDays
          : dto.archiveAfterDays,
      purgeAfterDays:
        dto.purgeAfterDays === undefined
          ? existing.purgeAfterDays
          : dto.purgeAfterDays,
    };

    if (existing.immutableEvidence && merged.purgeAfterDays != null) {
      throw new BadRequestException(
        `${existing.recordCategory} is immutable evidence and can never be purged.`,
      );
    }
    this.assertCoherent(merged);

    // Conditional update on `version`, matching `Setting`: a read-then-write
    // check would race, and `count === 0` is the conflict rather than an
    // exception we would have to distinguish from a missing row.
    const result = await this.prisma.retentionPolicy.updateMany({
      where: {
        orgId: actor.orgId,
        retentionPolicyId,
        version: dto.expectedVersion,
      },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name }),
        retentionPeriodDays: merged.retentionPeriodDays,
        archiveAfterDays: merged.archiveAfterDays,
        purgeAfterDays: merged.purgeAfterDays,
        ...(dto.legalHoldSupported === undefined
          ? {}
          : { legalHoldSupported: dto.legalHoldSupported }),
        ...(dto.status === undefined ? {} : { status: dto.status as never }),
        version: { increment: 1 },
        updatedBy: actor.userId,
      },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'This retention policy was changed by someone else. Reload and try again.',
      );
    }

    const updated = await this.findInScope(actor, retentionPolicyId);

    await this.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action:
        dto.status && dto.status !== existing.status
          ? 'RETENTION_POLICY_STATUS_CHANGED'
          : 'RETENTION_POLICY_UPDATED',
      entityType: 'RETENTION_POLICY',
      entityId: retentionPolicyId,
      oldData: this.toDetail(existing) as unknown as Record<string, unknown>,
      newData: this.toDetail(updated) as unknown as Record<string, unknown>,
    });

    return this.toDetail(updated);
  }

  /**
   * Delete a policy that has never governed processing (Scenario 56).
   *
   * A referenced policy is refused with the sanctioned alternative named, rather
   * than a bare 409 — the caller needs to know that deactivation exists, or they
   * will reasonably conclude the policy is stuck.
   */
  async remove(actor: AuthContext, retentionPolicyId: string): Promise<void> {
    const existing = await this.findInScope(actor, retentionPolicyId);

    if (existing.referencedAt) {
      throw new ConflictException(
        'This retention policy has already governed archival or purge processing and cannot be deleted. Deactivate it, or replace it with a new policy for the same category.',
      );
    }

    await this.prisma.retentionPolicy.deleteMany({
      where: { orgId: actor.orgId, retentionPolicyId },
    });

    await this.audit.record({
      orgId: actor.orgId,
      actorUserId: actor.userId,
      action: 'RETENTION_POLICY_DELETED',
      entityType: 'RETENTION_POLICY',
      entityId: retentionPolicyId,
      oldData: this.toDetail(existing) as unknown as Record<string, unknown>,
    });
  }

  /**
   * Refuse a purge that Rule 76 or a legal hold protects (Scenario 58).
   *
   * **No caller yet, and that is deliberate — do not delete it as dead code.**
   * No purge executor exists (`Q-SET-6`, DEFERRED), and `retention.purge.run`
   * is granted to no seeded role. This is the guard the executor must call when
   * one is built: writing the destructive path first and bolting the check on
   * afterwards is how evidence gets purged in the window between.
   *
   * Called by the purge path BEFORE any deletion. It throws rather than
   * returning false so a caller cannot proceed by ignoring a return value —
   * the failure mode this guards against is silent destruction of evidence.
   *
   * The outcome is audited either way, because Scenario 58 requires the blocked
   * attempt to be recorded "for authorized operational review": a purge that was
   * refused and left no trace is indistinguishable from one never attempted.
   */
  async assertPurgeAllowed(
    actor: AuthContext,
    recordCategory: string,
    options: { legalHold?: boolean } = {},
  ): Promise<RetentionPolicyDetail> {
    const policy = await this.resolveForProcessing(actor.orgId, recordCategory);

    const refuse = async (reason: string): Promise<never> => {
      await this.audit.record({
        orgId: actor.orgId,
        actorUserId: actor.userId,
        action: 'RETENTION_PURGE_BLOCKED',
        entityType: 'RETENTION_POLICY',
        entityId: policy?.retentionPolicyId ?? null,
        newData: { recordCategory, reason },
      });
      throw new ForbiddenException(reason);
    };

    // Scenario 57: no ACTIVE policy means nothing authorizes this processing.
    // Defaulting to "purge anyway" would make an unconfigured system the most
    // destructive one.
    if (!policy) {
      await refuse(
        `No active retention policy governs ${recordCategory}, so nothing may be purged.`,
      );
    }

    if (policy!.immutableEvidence) {
      await refuse(
        `${recordCategory} is immutable financial, ledger or audit evidence and is protected from purge.`,
      );
    }

    if (policy!.purgeAfterDays == null) {
      await refuse(
        `The active retention policy for ${recordCategory} sets no purge schedule, so records are retained indefinitely.`,
      );
    }

    if (options.legalHold) {
      await refuse(
        `These records are under legal hold and cannot be purged until it is lifted.`,
      );
    }

    return policy!;
  }

  /**
   * Mark a policy as having governed processing, making it undeletable.
   *
   * **No caller yet** — same reason as `assertPurgeAllowed` above. The archival
   * or purge run that acts under a policy is what must stamp it, which is why
   * this is not called from the write paths on this screen: creating a policy is
   * not the same as it having governed anything.
   *
   * Idempotent: the timestamp records THAT the policy has been applied, not how
   * many times, so re-stamping it on every run would only move a value nothing
   * reads for ordering.
   */
  async markReferenced(
    orgId: string,
    retentionPolicyId: string,
  ): Promise<void> {
    await this.prisma.retentionPolicy.updateMany({
      where: { orgId, retentionPolicyId, referencedAt: null },
      data: { referencedAt: new Date() },
    });
  }

  /**
   * Cross-field coherence, checked before the database sees the row.
   *
   * The CHECK constraints enforce the same rules, but a constraint violation
   * surfaces as an opaque failure naming an index. These messages name the
   * field the caller has to change.
   */
  private assertCoherent(policy: {
    retentionPeriodDays: number;
    archiveAfterDays?: number | null;
    purgeAfterDays?: number | null;
  }): void {
    if (policy.retentionPeriodDays <= 0) {
      throw new BadRequestException(
        'Retention Period must be at least one day.',
      );
    }

    if (
      policy.purgeAfterDays != null &&
      policy.purgeAfterDays < policy.retentionPeriodDays
    ) {
      throw new BadRequestException(
        'Purge After cannot be earlier than the Retention Period — that would destroy records the policy requires be kept.',
      );
    }

    if (
      policy.archiveAfterDays != null &&
      policy.purgeAfterDays != null &&
      policy.archiveAfterDays > policy.purgeAfterDays
    ) {
      throw new BadRequestException(
        'Archive After cannot be later than Purge After.',
      );
    }
  }

  private async findInScope(actor: AuthContext, retentionPolicyId: string) {
    const row = await this.prisma.retentionPolicy.findFirst({
      where: { orgId: actor.orgId, retentionPolicyId },
    });

    // Out-of-scope, cross-tenant and absent all return the same opaque 404, so
    // the response never confirms that another organization's policy exists.
    if (!row) throw new NotFoundException('Retention policy not found');
    return row;
  }

  private toDetail(row: {
    retentionPolicyId: string;
    name: string;
    recordCategory: string;
    retentionPeriodDays: number;
    archiveAfterDays: number | null;
    purgeAfterDays: number | null;
    immutableEvidence: boolean;
    legalHoldSupported: boolean;
    status: string;
    referencedAt: Date | null;
    version: number;
    updatedAt: Date;
  }): RetentionPolicyDetail {
    return {
      retentionPolicyId: row.retentionPolicyId,
      name: row.name,
      recordCategory: row.recordCategory,
      retentionPeriodDays: row.retentionPeriodDays,
      archiveAfterDays: row.archiveAfterDays,
      purgeAfterDays: row.purgeAfterDays,
      immutableEvidence: row.immutableEvidence,
      legalHoldSupported: row.legalHoldSupported,
      status: row.status,
      referencedAt: row.referencedAt?.toISOString() ?? null,
      deletable: row.referencedAt === null,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * P2002 here is the partial unique index refusing a second ACTIVE policy for
   * one category. Translated for the same reason as in `SettingService`: an
   * untranslated Prisma error surfaces as a 503 naming an unrelated service.
   */
  private translateUniqueViolation(error: unknown): unknown {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(
        'An active retention policy already exists for this record category. Deactivate it before creating a replacement.',
      );
    }
    return error;
  }
}
