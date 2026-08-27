import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  GuarantorDetail,
  GuarantorProfileResponse,
  GuarantorSummary,
} from '@lms/types';

import {
  AuditAction,
  AuditService,
  maskMobile,
} from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { ListGuarantorsDto } from './dto/list-guarantors.dto';
import { GuarantorDocumentService } from './guarantor-document.service';
import { toGuarantorSummary } from './guarantor.service';

const NOT_REACHABLE = 'Guarantor not found';

/**
 * The organization-scoped guarantor directory (GUA-001, GUA-002).
 *
 * **Read-only, deliberately.** Every mutation stays on the customer-nested
 * routes in `GuarantorController`, because a guarantor's customer relationship
 * is what defines its scope: a top-level `PATCH /guarantors/:id` would accept an
 * id without naming the customer, and the check that the caller may reach that
 * customer would become a thing to remember rather than a consequence of the
 * route. Rule 8 and Scenario 14 both point the same way — the customer
 * association is authoritative and must never come from the client.
 *
 * **Branch confinement runs through the customer relation.** `Guarantor` has no
 * `branchId` of its own (Rule 10), so a branch-scoped caller is filtered by
 * `customer.branchId`. That keeps one answer to "whose guarantor is this" and
 * means a customer moving branch takes their guarantors with them without a
 * second column needing to be updated.
 *
 * Mobile numbers are masked in the list and shown in full on the detail view.
 * A directory is a browsing surface where a full column of third-party mobile
 * numbers is a standing disclosure; opening one record is a deliberate act that
 * is separately audited (Q-GUAR-65).
 */
@Injectable()
export class GuarantorDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: GuarantorDocumentService,
  ) {}

  /** Scenario 1 — the searchable directory. */
  async list(
    actor: AuthContext,
    query: ListGuarantorsDto,
    meta: RequestMeta,
  ): Promise<GuarantorSummary[]> {
    const search = query.search?.trim();

    const rows = await this.prisma.guarantor.findMany({
      where: {
        orgId: actor.orgId,
        ...this.branchScope(actor),
        ...(query.status ? { status: query.status } : {}),
        ...(query.kycStatus ? { kycStatus: query.kycStatus } : {}),
        ...(query.consentStatus ? { consentStatus: query.consentStatus } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(search
          ? {
              OR: [
                // Partial and case-insensitive on the name, as the customer list
                // does: staff search by what someone said their name was.
                {
                  fullName: { contains: search, mode: 'insensitive' as const },
                },
                // Prefix on mobile, so a half-remembered number narrows the list.
                { mobile: { startsWith: search } },
                // And by the borrower, since "who guaranteed CUST005" is the
                // question a branch actually asks (Q-GUAR-63).
                {
                  customer: {
                    fullName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
                {
                  customer: {
                    customerCode: {
                      equals: search,
                      mode: 'insensitive' as const,
                    },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ fullName: 'asc' }],
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
      metadata: { search: search ?? null, count: rows.length },
    });

    return rows.map((row) => ({
      ...toGuarantorSummary(row),
      mobile: maskMobile(row.mobile),
    }));
  }

  /**
   * Scenario 2 — one guarantor with their customer and documents.
   *
   * A miss is answered 404 rather than 403, and the two are indistinguishable to
   * the caller. Scenario 5 asks that a direct identifier not be usable to reach
   * another organization's data; a 403 would confirm the id exists, which is
   * itself the disclosure.
   */
  async findOne(
    actor: AuthContext,
    guarantorId: string,
    meta: RequestMeta,
  ): Promise<GuarantorProfileResponse> {
    const row = await this.prisma.guarantor.findFirst({
      where: {
        orgId: actor.orgId,
        guarantorId,
        ...this.branchScope(actor),
      },
      include: {
        customer: {
          select: { fullName: true, customerCode: true, branchId: true },
        },
      },
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
        metadata: { actorBranchId: actor.branchId, via: 'DIRECTORY' },
      });

      throw new NotFoundException(NOT_REACHABLE);
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_GUARANTOR_VIEWED,
      entityType: 'GUARANTOR',
      entityId: guarantorId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { customerId: row.customerId, via: 'DIRECTORY' },
    });

    const guarantor: GuarantorDetail = {
      ...toGuarantorSummary(row),
      customerName: row.customer.fullName,
      customerCode: row.customer.customerCode,
      branchId: row.customer.branchId,
      kycSubmittedAt: row.kycSubmittedAt?.toISOString(),
      kycReviewedAt: row.kycReviewedAt?.toISOString(),
      kycReviewedBy: row.kycReviewedBy ?? undefined,
      kycRevisionReason: row.kycRevisionReason ?? undefined,
    };

    const documents = await this.documents.list(
      actor,
      row.customerId,
      guarantorId,
      meta,
    );

    return { guarantor, documents };
  }

  /**
   * Branch confinement, expressed through the customer.
   *
   * A caller with no `branchId` is organization-wide (a Super Admin); one with a
   * branch sees only guarantors whose *customer* belongs to it. The filter lives
   * in the query rather than in a post-fetch check, so an out-of-scope guarantor
   * is never loaded into memory at all.
   */
  private branchScope(actor: AuthContext): { customer?: { branchId: string } } {
    return actor.branchId ? { customer: { branchId: actor.branchId } } : {};
  }
}
