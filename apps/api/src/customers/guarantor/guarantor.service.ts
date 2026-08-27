import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConsentStatus,
  GuarantorDeleteBlocker,
  GuarantorKycStatus,
  GuarantorReadiness,
  GuarantorReadinessBlocker,
  GuarantorReadinessReason,
  GuarantorStatus,
  GuarantorSummary,
} from '@lms/types';

import {
  AuditAction,
  AuditService,
  maskMobile,
} from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { BranchService } from '../../organizations/branch.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerService } from '../customer/customer.service';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { DeactivateGuarantorDto } from './dto/deactivate-guarantor.dto';
import { ReactivateGuarantorDto } from './dto/reactivate-guarantor.dto';
import { RecordConsentDto } from '../shared/dto/record-consent.dto';
import { UpdateGuarantorDto } from './dto/update-guarantor.dto';
import {
  GUARANTOR_DEPENDENCIES,
  type GuarantorDependencyEntity,
  summarizeGuarantorBlockers,
} from './guarantor-dependencies';

export const CUSTOMERS_GUARANTORS_VIEW_PERMISSION = 'customers.guarantors.view';
export const CUSTOMERS_GUARANTORS_MANAGE_PERMISSION =
  'customers.guarantors.manage';
export const CUSTOMERS_GUARANTORS_DEACTIVATE_PERMISSION =
  'customers.guarantors.deactivate';
export const CUSTOMERS_GUARANTORS_DELETE_PERMISSION =
  'customers.guarantors.delete';

const NOT_REACHABLE = 'Guarantor not found';

/**
 * The delete-guard's view of a Prisma client: one countable delegate per entry
 * in `GUARANTOR_DEPENDENCIES`, and nothing else. Keyed off the dependency list
 * itself, so adding a blocking relation there without a matching Prisma model is
 * a compile error rather than a runtime "cannot read property count of
 * undefined". Same construction as `CustomerService`.
 */
type CountableDelegates = Record<
  GuarantorDependencyEntity,
  { count: (args: { where: Record<string, unknown> }) => Promise<number> }
>;

export type GuarantorRow = {
  orgId: string;
  guarantorId: string;
  customerId: string;
  fullName: string;
  mobile: string;
  address: string | null;
  relationship: string | null;
  status: GuarantorStatus;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  consentStatus: ConsentStatus;
  consentAt: Date | null;
  consentBy: string | null;
  kycStatus: GuarantorKycStatus;
  createdAt: Date;
  updatedAt: Date;
};

export function toGuarantorSummary(row: GuarantorRow): GuarantorSummary {
  return {
    guarantorId: row.guarantorId,
    customerId: row.customerId,
    fullName: row.fullName,
    mobile: row.mobile,
    address: row.address ?? undefined,
    relationship: row.relationship ?? undefined,
    status: row.status,
    deactivatedAt: row.deactivatedAt?.toISOString(),
    deactivationReason: row.deactivationReason ?? undefined,
    consentStatus: row.consentStatus,
    consentAt: row.consentAt?.toISOString(),
    consentBy: row.consentBy ?? undefined,
    kycStatus: row.kycStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // The concurrency token is the row's own `updatedAt`, matching Customer —
    // see `CustomerService.assertVersion`.
    version: row.updatedAt.toISOString(),
  };
}

/**
 * Guarantors: identity, consent, lifecycle and the loan-application gate
 * (Module 04 Scenarios 24-26; Module 05 throughout).
 *
 * This module **stores** guarantors; it does not decide when one is required.
 * Module 05 Rule 3 is explicit that the requirement is set by the applicable
 * loan or business rule, and Rule 27 that a Local Customer's skipped KYC does
 * not by itself create or remove one. Encoding the requirement here would put
 * the same rule in two places that could disagree (Q-CUST-30, Q-GUAR-11) — so
 * {@link evaluateReadiness} answers "are these guarantors usable" and leaves
 * "was one needed" to the caller.
 *
 * Guarantor KYC lives in `GuarantorKycService` and `GuarantorDocumentService`,
 * not here. Scenario 22 asks that it be kept separate from the borrower's, and
 * the separation is structural: different tables, different permissions, and no
 * write path between them.
 *
 * Three invariants run through every method below:
 *
 * 1. **Scope is resolved through the customer, always.** Every entry point calls
 *    `CustomerService.findInScope` before touching a guarantor row, and every
 *    guarantor query carries `customerId` as well as `guarantorId`. A guarantor
 *    has no `branchId` of its own precisely so there is one answer to "whose is
 *    this" (Rule 10).
 * 2. **Nothing is inferred.** Consent is never implied by the record existing
 *    (Rule 22, Scenario 18); KYC is never implied by the borrower's (Rule 75).
 * 3. **History is never rewritten.** Deactivation leaves `LoanGuarantor` alone,
 *    and a delete that would orphan one is refused (Rules 35, 38).
 */
@Injectable()
export class GuarantorService {
  private readonly logger = new Logger(GuarantorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomerService,
    private readonly branches: BranchService,
  ) {}

  /**
   * Scenario 1 — the customer's guarantors, inactive ones included.
   *
   * Inactive rows are returned rather than filtered out: the story asks that
   * they be "clearly identified", which is a rendering decision. Hiding them
   * here would make a deactivated guarantor look deleted.
   */
  async list(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<GuarantorSummary[]> {
    await this.customers.findInScope(actor, customerId, meta);

    const rows = await this.prisma.guarantor.findMany({
      where: { orgId: actor.orgId, customerId },
      orderBy: [{ createdAt: 'asc' }],
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_GUARANTOR_LISTED,
      entityType: 'GUARANTOR',
      entityId: null,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId, count: rows.length },
    });

    return rows.map(toGuarantorSummary);
  }

  /** Scenario 2 — one guarantor, with the access recorded. */
  async findOne(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    meta: RequestMeta,
  ): Promise<GuarantorSummary> {
    await this.customers.findInScope(actor, customerId, meta);
    const row = await this.findInScope(actor, customerId, guarantorId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_GUARANTOR_VIEWED,
      entityType: 'GUARANTOR',
      entityId: guarantorId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId },
    });

    return toGuarantorSummary(row);
  }

  /**
   * Scenarios 6, 10, 34, 35, 44 — links a guarantor to the customer.
   *
   * Three gates before the row exists: the customer must be in scope, the
   * organization and branch must be operational, and a same-mobile guarantor on
   * the same customer must either be absent or explicitly confirmed.
   */
  async create(
    actor: AuthContext,
    customerId: string,
    dto: CreateGuarantorDto,
    meta: RequestMeta,
  ): Promise<GuarantorSummary> {
    const customer = await this.customers.findInScope(actor, customerId, meta);

    // Q-GUAR-4 — a soft flag rather than a unique constraint. The story leaves
    // the duplicate key undefined (Open Question 4), and the same person may
    // legitimately guarantee more than one customer, so the check is narrowed to
    // the one case that is unambiguously a mistake: the same mobile twice on the
    // same customer. `force` is the caller confirming they meant it.
    const duplicate = await this.prisma.guarantor.findFirst({
      where: { orgId: actor.orgId, customerId, mobile: dto.mobile },
    });

    if (duplicate && dto.force !== true) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_GUARANTOR_DUPLICATE_FLAGGED,
        entityType: 'GUARANTOR',
        entityId: duplicate.guarantorId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { customerId, mobile: maskMobile(dto.mobile) },
      });

      throw new ConflictException({
        message:
          'A guarantor with this mobile number is already on this customer. Confirm to continue.',
        duplicateOf: [
          {
            guarantorId: duplicate.guarantorId,
            fullName: duplicate.fullName,
            mobile: maskMobile(duplicate.mobile),
          },
        ],
      });
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Rule 71 / Scenario 35 via Module 02's seam: an inactive organization
        // or branch takes no new guarantor relationships. The branch is the
        // customer's, never one the caller named.
        await this.branches.assertBranchOperational(
          tx,
          actor.orgId,
          customer.branchId,
        );

        const row = await tx.guarantor.create({
          data: {
            orgId: actor.orgId,
            customerId,
            fullName: dto.fullName,
            mobile: dto.mobile,
            address: dto.address,
            relationship: dto.relationship ?? null,
            status: 'ACTIVE',
            // Consent is a separate, deliberate act (Scenario 18). Creating a
            // guarantor already consenting would record an agreement nobody gave.
            consentStatus: 'PENDING',
            // Whether this guarantor needs KYC at all is the loan product's
            // call, and that module does not exist yet (Q-GUAR-11).
            kycStatus: 'NOT_REQUIRED',
            createdBy: actor.userId,
            updatedBy: actor.userId,
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.CUSTOMER_GUARANTOR_ADDED,
            entityType: 'GUARANTOR',
            entityId: row.guarantorId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            metadata: {
              customerId,
              mobile: maskMobile(row.mobile),
              relationship: row.relationship,
            },
          },
          tx,
        );

        if (duplicate) {
          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.CUSTOMER_GUARANTOR_DUPLICATE_OVERRIDDEN,
              entityType: 'GUARANTOR',
              entityId: row.guarantorId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: {
                customerId,
                mobile: maskMobile(row.mobile),
                duplicateOf: duplicate.guarantorId,
              },
            },
            tx,
          );
        }

        return row;
      });

      return toGuarantorSummary(created);
    } catch (error) {
      // Scenario 44 — validation passed but nothing committed. The transaction
      // already guarantees no half-created relationship; what the story asks for
      // beyond that is that the failure leaves a trace.
      await this.recordPersistenceFailure(actor, customerId, meta, error);
      throw error;
    }
  }

  /**
   * Scenarios 11, 13, 46 — edits an existing guarantor.
   *
   * Editing a profile field never touches `LoanGuarantor`, so a guarantor
   * already attached to a loan keeps that relationship exactly as it was
   * (Scenario 13). The financial record is not this table's to rewrite.
   */
  async update(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    dto: UpdateGuarantorDto,
    meta: RequestMeta,
  ): Promise<GuarantorSummary> {
    await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.findInScope(
      actor,
      customerId,
      guarantorId,
      meta,
    );

    await this.assertVersion(actor, existing, dto.expectedVersion, meta);
    this.assertActive(existing, 'edited');

    const consentReset = dto.mobile !== existing.mobile;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.guarantor.update({
        where: {
          orgId_guarantorId: { orgId: actor.orgId, guarantorId },
        },
        data: {
          fullName: dto.fullName,
          mobile: dto.mobile,
          address: dto.address,
          relationship: dto.relationship ?? null,
          updatedBy: actor.userId,
          // Changing who the guarantor is invalidates any consent already given:
          // the person who agreed is not necessarily the person now recorded.
          //
          // KYC is deliberately *not* reset alongside it. Q-GUAR-42 asks which
          // edits require re-KYC and the source does not answer; forcing a
          // re-review here would invent a rule. The before/after is audited
          // instead, so a reviewer can see what moved under an approval.
          ...(consentReset
            ? {
                consentStatus: 'PENDING' as const,
                consentAt: null,
                consentBy: null,
              }
            : {}),
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_GUARANTOR_UPDATED,
          entityType: 'GUARANTOR',
          entityId: guarantorId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { customerId, consentReset },
          oldData: {
            fullName: existing.fullName,
            mobile: maskMobile(existing.mobile),
            address: existing.address,
            relationship: existing.relationship,
            consentStatus: existing.consentStatus,
            kycStatus: existing.kycStatus,
          },
          newData: {
            fullName: row.fullName,
            mobile: maskMobile(row.mobile),
            address: row.address,
            relationship: row.relationship,
            consentStatus: row.consentStatus,
            kycStatus: row.kycStatus,
          },
        },
        tx,
      );

      return row;
    });

    return toGuarantorSummary(updated);
  }

  /**
   * Scenarios 15, 18, 19 — records the consent decision.
   *
   * The timestamp and the actor are both the server's, never the caller's. A
   * consent record whose time was supplied by the party recording it proves
   * considerably less than one the system stamped on receipt (Rule 23).
   */
  async recordConsent(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    dto: RecordConsentDto,
    meta: RequestMeta,
  ): Promise<GuarantorSummary> {
    await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.findInScope(
      actor,
      customerId,
      guarantorId,
      meta,
    );

    await this.assertVersion(actor, existing, dto.expectedVersion, meta);
    this.assertActive(existing, 'given consent');

    const given = dto.consentStatus === 'GIVEN';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.guarantor.update({
        where: { orgId_guarantorId: { orgId: actor.orgId, guarantorId } },
        data: {
          consentStatus: dto.consentStatus,
          // Set only on GIVEN. A rejection has a decision but no consent, and a
          // timestamp against it would read as though one had been given.
          consentAt: given ? new Date() : null,
          consentBy: given ? actor.userId : null,
          updatedBy: actor.userId,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_GUARANTOR_CONSENT_RECORDED,
          entityType: 'GUARANTOR',
          entityId: guarantorId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { customerId, consentStatus: row.consentStatus },
          oldData: { consentStatus: existing.consentStatus },
          newData: {
            consentStatus: row.consentStatus,
            consentAt: row.consentAt?.toISOString() ?? null,
          },
        },
        tx,
      );

      return row;
    });

    return toGuarantorSummary(updated);
  }

  /**
   * Scenario 28 — deactivates a guarantor.
   *
   * **Touches nothing but this row.** Rules 35 and 38 are explicit that
   * deactivation must not delete historical guarantor references, and Scenario
   * 30 that a loan's view of the relationship survives it. `LoanGuarantor` is
   * therefore never read or written here — the guarantor stops being selectable
   * for *new* relationships (see {@link assertSelectable}) and nothing else
   * changes.
   */
  async deactivate(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    dto: DeactivateGuarantorDto,
    meta: RequestMeta,
  ): Promise<GuarantorSummary> {
    await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.findInScope(
      actor,
      customerId,
      guarantorId,
      meta,
    );

    await this.assertVersion(actor, existing, dto.expectedVersion, meta);

    if (existing.status === 'INACTIVE') {
      throw new ConflictException('This guarantor is already inactive.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.guarantor.update({
        where: { orgId_guarantorId: { orgId: actor.orgId, guarantorId } },
        data: {
          status: 'INACTIVE',
          deactivatedAt: new Date(),
          deactivationReason: dto.reason,
          updatedBy: actor.userId,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_GUARANTOR_DEACTIVATED,
          entityType: 'GUARANTOR',
          entityId: guarantorId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { customerId, reason: dto.reason },
          oldData: { status: existing.status },
          newData: { status: row.status },
        },
        tx,
      );

      return row;
    });

    return toGuarantorSummary(updated);
  }

  /** The reverse of {@link deactivate}; restores selectability. */
  async reactivate(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    dto: ReactivateGuarantorDto,
    meta: RequestMeta,
  ): Promise<GuarantorSummary> {
    await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.findInScope(
      actor,
      customerId,
      guarantorId,
      meta,
    );

    await this.assertVersion(actor, existing, dto.expectedVersion, meta);

    if (existing.status === 'ACTIVE') {
      throw new ConflictException('This guarantor is already active.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.guarantor.update({
        where: { orgId_guarantorId: { orgId: actor.orgId, guarantorId } },
        data: {
          status: 'ACTIVE',
          deactivatedAt: null,
          deactivationReason: null,
          updatedBy: actor.userId,
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_GUARANTOR_REACTIVATED,
          entityType: 'GUARANTOR',
          entityId: guarantorId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { customerId },
          oldData: {
            status: existing.status,
            deactivationReason: existing.deactivationReason,
          },
          newData: { status: row.status },
        },
        tx,
      );

      return row;
    });

    return toGuarantorSummary(updated);
  }

  /**
   * Physical delete, guarded (Rules 33, 34, 79; Scenarios 31-33, 55).
   *
   * Returns rather than throws on the blocked path so the controller can answer
   * 409 with the blockers listed and point at deactivation instead. A guarantor
   * a loan has ever referenced is permanently undeletable, which is the intended
   * outcome — the delete path exists for the row typed in by mistake.
   *
   * The pre-check is not redundant with the `Restrict` foreign key. The FK would
   * refuse the delete too, but as an opaque database error surfacing as a 503;
   * counting first is what lets the caller be told what is in the way and what
   * to do instead (Scenario 32), and what makes the blocked attempt auditable.
   */
  async remove(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    meta: RequestMeta,
  ): Promise<
    { deleted: true } | { deleted: false; blockedBy: GuarantorDeleteBlocker[] }
  > {
    await this.customers.findInScope(actor, customerId, meta);
    const existing = await this.findInScope(
      actor,
      customerId,
      guarantorId,
      meta,
    );

    const delegates = this.prisma as unknown as CountableDelegates;
    const counts: Record<string, number> = {};

    for (const dependency of GUARANTOR_DEPENDENCIES) {
      counts[dependency.entity] = await delegates[dependency.entity].count({
        where: { orgId: actor.orgId, [dependency.field]: guarantorId },
      });
    }

    const blockedBy = summarizeGuarantorBlockers(counts);

    if (blockedBy.length > 0) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_GUARANTOR_DELETE_BLOCKED,
        entityType: 'GUARANTOR',
        entityId: guarantorId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { customerId, blockedBy },
      });

      return { deleted: false, blockedBy };
    }

    await this.prisma.$transaction(async (tx) => {
      // Audited before the delete: writing the record first means a failure in
      // the delete leaves an attempted-deletion trail rather than a
      // successful-deletion claim for a row that still exists.
      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_GUARANTOR_REMOVED,
          entityType: 'GUARANTOR',
          entityId: guarantorId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { customerId },
          oldData: {
            fullName: existing.fullName,
            mobile: maskMobile(existing.mobile),
            status: existing.status,
            consentStatus: existing.consentStatus,
            kycStatus: existing.kycStatus,
          },
        },
        tx,
      );

      // `guarantor_documents` cascades: a guarantor's KYC pack is that
      // guarantor's own record, not history shared with another party. The
      // stored bytes are swept by the caller — see `GuarantorDocumentService`.
      await tx.guarantor.delete({
        where: { orgId_guarantorId: { orgId: actor.orgId, guarantorId } },
      });
    });

    return { deleted: true };
  }

  /**
   * Scenarios 26, 27 — may this guarantor be attached to something new?
   *
   * Exported for Module 07 rather than inlined there, so "an inactive guarantor
   * cannot be selected" has exactly one implementation. The loan module calls
   * this before creating a `LoanGuarantor` row; it must not re-derive the rule
   * from a status field it read itself.
   */
  async assertSelectable(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    meta: RequestMeta,
  ): Promise<GuarantorRow> {
    const row = await this.findInScope(actor, customerId, guarantorId, meta);

    if (row.status === 'ACTIVE') return row;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_GUARANTOR_SELECTION_BLOCKED,
      entityType: 'GUARANTOR',
      entityId: guarantorId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId, status: row.status },
    });

    throw new ConflictException(
      'This guarantor is inactive and cannot be selected for a new application.',
    );
  }

  /**
   * The loan-application guarantor gate (Scenarios 17, 41-43).
   *
   * Answers one question — "are this customer's guarantors usable" — and
   * deliberately refuses the adjacent one. `required` is always `null` because
   * whether a guarantor is needed at all is a loan-product rule that does not
   * exist yet (Rule 3, Q-GUAR-11); Module 07 owns that decision and calls this
   * to fill in the other half.
   *
   * A customer with **no** guarantors is `satisfied: true` with no blockers.
   * That is Scenarios 7 and 43: the absence of a guarantor is only a problem if
   * something required one, and this method is not what decides that. Returning
   * `false` here would force every no-guarantor loan through a gate it should
   * never have met.
   */
  async evaluateReadiness(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<GuarantorReadiness> {
    await this.customers.findInScope(actor, customerId, meta);

    const rows = await this.prisma.guarantor.findMany({
      where: { orgId: actor.orgId, customerId },
      orderBy: [{ createdAt: 'asc' }],
    });

    const blockers: GuarantorReadinessBlocker[] = [];

    for (const row of rows) {
      const reasons: GuarantorReadinessReason[] = [];

      if (row.status !== 'ACTIVE') reasons.push('INACTIVE');
      if (row.consentStatus === 'PENDING') reasons.push('CONSENT_PENDING');
      if (row.consentStatus === 'REJECTED') reasons.push('CONSENT_REJECTED');

      // NOT_REQUIRED is complete, not incomplete: it means this guarantor was
      // never asked for KYC. Only a KYC that was started and has not been
      // approved blocks (Scenario 41).
      if (row.kycStatus !== 'APPROVED' && row.kycStatus !== 'NOT_REQUIRED') {
        reasons.push('KYC_INCOMPLETE');
      }

      if (reasons.length > 0) {
        blockers.push({
          guarantorId: row.guarantorId,
          fullName: row.fullName,
          reasons,
        });
      }
    }

    return { required: null, satisfied: blockers.length === 0, blockers };
  }

  /**
   * Resolves a guarantor within the customer, or refuses.
   *
   * As in `DocumentService`, `customerId` in the `where` is load-bearing:
   * without it a guarantor id from another customer in the same organization
   * would resolve, letting a caller reach another branch's record by pairing it
   * with a customer they can see. That is Scenario 5's direct-identifier attempt
   * in its most plausible form.
   *
   * The miss is audited and answered 404 rather than 403 — a 403 would confirm
   * the id exists, which is the disclosure Scenario 5 is about.
   */
  private async findInScope(
    actor: AuthContext,
    customerId: string,
    guarantorId: string,
    meta: RequestMeta,
  ): Promise<GuarantorRow> {
    const row = await this.prisma.guarantor.findFirst({
      where: { orgId: actor.orgId, customerId, guarantorId },
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_GUARANTOR_ACCESS_DENIED,
        entityType: 'GUARANTOR',
        entityId: guarantorId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { customerId, actorBranchId: actor.branchId },
      });

      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  /**
   * Optimistic concurrency (Q-GUAR-67, Scenario 46).
   *
   * The client echoes back the `updatedAt` it last read. If the row has moved
   * since, the write is refused rather than applied — the losing edit is not
   * silently discarded, which is what Rule 67 asks for.
   */
  private async assertVersion(
    actor: AuthContext,
    row: GuarantorRow,
    expectedVersion: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (row.updatedAt.toISOString() === expectedVersion) return;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_GUARANTOR_CONCURRENT_EDIT_REJECTED,
      entityType: 'GUARANTOR',
      entityId: row.guarantorId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        customerId: row.customerId,
        expected: expectedVersion,
        actual: row.updatedAt.toISOString(),
      },
    });

    throw new ConflictException(
      'This guarantor was changed by someone else. Reload and try again.',
    );
  }

  /**
   * Refuses a mutation on a deactivated guarantor (Rule 36).
   *
   * Editing or consenting on an inactive record would produce a guarantor that
   * looks current but cannot be used, which is worse than a plain refusal. The
   * caller is told to reactivate, an action with its own permission and its own
   * audit entry.
   */
  private assertActive(row: GuarantorRow, attempted: string): void {
    if (row.status === 'ACTIVE') return;

    throw new ConflictException(
      `This guarantor is inactive and cannot be ${attempted}. Reactivate it first.`,
    );
  }

  private async recordPersistenceFailure(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
    error: unknown,
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(`Guarantor create failed for ${customerId}: ${reason}`);

    try {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_GUARANTOR_PERSISTENCE_FAILED,
        entityType: 'GUARANTOR',
        entityId: null,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { customerId, reason },
      });
    } catch {
      // The original failure is what the caller needs to see. An audit write
      // that also fails must not replace it with a different error.
    }
  }
}
