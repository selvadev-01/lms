import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { LoanProductDetail, LoanProductSummary } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLoanProductDto } from './dto/create-loan-product.dto';
import { ListLoanProductsDto } from './dto/list-loan-products.dto';
import { SetLoanConfigStatusDto } from './dto/set-loan-config-status.dto';
import { UpdateLoanProductDto } from './dto/update-loan-product.dto';
import { toSchemeSummary, type LoanSchemeRow } from './loan-scheme.mapper';

export const LOAN_PRODUCTS_VIEW_PERMISSION = 'loans.products.view';
export const LOAN_PRODUCTS_MANAGE_PERMISSION = 'loans.products.manage';
export const LOAN_PRODUCTS_ACTIVATE_PERMISSION = 'loans.products.activate';

/**
 * One message for every way a product can be unreachable.
 *
 * A product that does not exist and one belonging to another organization
 * produce the same reply; distinguishing them would let a caller enumerate
 * another tenant's product ids by watching which ones answer differently. The
 * real cause goes to the audit log, where it is diagnostic without being a side
 * channel.
 */
const NOT_REACHABLE = 'Loan product not found';

export type LoanProductRow = {
  orgId: string;
  loanProductId: string;
  code: string;
  name: string;
  loanType: string;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
};

export function toProductSummary(row: LoanProductRow): LoanProductSummary {
  return {
    loanProductId: row.loanProductId,
    code: row.code,
    name: row.name,
    loanType: row.loanType,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // The optimistic-concurrency token. There is no `version` column; the
    // timestamp Prisma already maintains is the token, so there is one
    // concurrency idiom in this codebase rather than two that can drift.
    version: row.updatedAt.toISOString(),
  };
}

/**
 * Module 06 — Loan Products.
 *
 * A product is the coarse grouping (Personal, Business, Gold, Vehicle) that
 * schemes hang off. It carries the loan type, which is why `LoanApplication` has
 * no `loanType` column of its own: an application reads its type through its
 * product, and selecting a product *is* choosing the type (Module 07 Rule 12).
 *
 * Products are organization-wide, not branch-scoped: `LoanProduct` has no
 * `branchId`, and pricing that varied silently by branch is not something the
 * source asks for. So unlike most services here, there is no branch confinement
 * to apply — only the tenant one, which is applied unconditionally.
 */
@Injectable()
export class LoanProductService {
  private readonly logger = new Logger(LoanProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthContext,
    query: ListLoanProductsDto,
    meta: RequestMeta,
  ): Promise<LoanProductSummary[]> {
    const rows = await this.prisma.loanProduct.findMany({
      where: {
        orgId: actor.orgId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.loanType ? { loanType: query.loanType } : {}),
      },
      orderBy: { code: 'asc' },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_PRODUCT_LISTED,
      entityType: 'LOAN_PRODUCT',
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        returned: rows.length,
        status: query.status ?? null,
        loanType: query.loanType ?? null,
      },
    });

    return rows.map(toProductSummary);
  }

  async getById(
    actor: AuthContext,
    loanProductId: string,
    meta: RequestMeta,
  ): Promise<LoanProductDetail> {
    const row = await this.findInScope(actor, loanProductId, meta);

    const schemes = await this.prisma.loanScheme.findMany({
      where: { orgId: actor.orgId, loanProductId },
      orderBy: { code: 'asc' },
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_PRODUCT_VIEWED,
      entityType: 'LOAN_PRODUCT',
      entityId: loanProductId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      ...toProductSummary(row),
      schemes: (schemes as LoanSchemeRow[]).map(toSchemeSummary),
    };
  }

  /**
   * Creates a product in DRAFT.
   *
   * Never ACTIVE on creation, even for a caller holding the activate permission:
   * a product with no schemes cannot be borrowed against, so publishing it the
   * moment it is named would put an empty shell into the application wizard's
   * picker.
   */
  /**
   * Refuses a loan type that is not an ACTIVE `LOAN_TYPE` option in this org.
   *
   * The DTO can only check the shape of the code — loan types are per-tenant
   * master data, so whether one *exists* is a question only the database can
   * answer. Without this the column would accept any well-formed string, and a
   * typo would create a product of type `PERSONNAL` that no dropdown offers and
   * whose collateral requirement silently resolves to "not secured".
   *
   * INACTIVE is refused as well as absent: retiring a type is how an admin stops
   * new products being created against it, which only works if this is the layer
   * that enforces it. Products already carrying the type are untouched.
   */
  private async assertLoanTypeOffered(
    actor: AuthContext,
    meta: RequestMeta,
    loanType: string,
  ): Promise<void> {
    const option = await this.prisma.masterDataValue.findUnique({
      where: {
        orgId_category_code: {
          orgId: actor.orgId,
          category: 'LOAN_TYPE',
          code: loanType,
        },
      },
      select: { status: true },
    });

    if (option?.status === 'ACTIVE') return;

    await this.recordRejection(actor, meta, 'UNKNOWN_LOAN_TYPE', {
      loanType,
      reason: option ? 'INACTIVE' : 'NOT_FOUND',
    });
    throw new BadRequestException(
      `Loan Type ${loanType} is not an available option in this organization`,
    );
  }

  async create(
    actor: AuthContext,
    dto: CreateLoanProductDto,
    meta: RequestMeta,
  ): Promise<LoanProductDetail> {
    await this.assertLoanTypeOffered(actor, meta, dto.loanType);

    // Checked here for a clear message, and again by the unique constraint
    // below — this read cannot exclude a concurrent create, so the constraint is
    // what actually guarantees uniqueness.
    const existing = await this.prisma.loanProduct.findUnique({
      where: { orgId_code: { orgId: actor.orgId, code: dto.code } },
    });

    if (existing) {
      await this.recordRejection(actor, meta, 'DUPLICATE_CODE', {
        code: dto.code,
      });
      throw new ConflictException(
        `Product Code ${dto.code} is already in use in this organization`,
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.loanProduct.create({
          data: {
            orgId: actor.orgId,
            code: dto.code,
            name: dto.name,
            loanType: dto.loanType,
            status: 'DRAFT',
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_PRODUCT_CREATED,
            entityType: 'LOAN_PRODUCT',
            entityId: row.loanProductId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            newData: {
              code: row.code,
              name: row.name,
              loanType: row.loanType,
              status: row.status,
            },
          },
          tx,
        );

        return row;
      });

      return { ...toProductSummary(created), schemes: [] };
    } catch (error) {
      await this.recordPersistenceFailure(actor, meta, error, 'create', null);
      throw this.translateUniqueViolation(error, dto.code);
    }
  }

  async update(
    actor: AuthContext,
    loanProductId: string,
    dto: UpdateLoanProductDto,
    meta: RequestMeta,
  ): Promise<LoanProductDetail> {
    const before = await this.findInScope(actor, loanProductId, meta);
    await this.assertVersion(actor, before, dto.expectedVersion, meta);

    // Only when it actually changes. Re-checking an unchanged type would make a
    // product whose type was since retired uneditable — a rename would be
    // refused for a field the caller never touched.
    if (dto.loanType !== before.loanType) {
      await this.assertLoanTypeOffered(actor, meta, dto.loanType);
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.loanProduct.update({
          where: {
            orgId_loanProductId: { orgId: actor.orgId, loanProductId },
          },
          data: { name: dto.name, loanType: dto.loanType },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.LOAN_PRODUCT_UPDATED,
            entityType: 'LOAN_PRODUCT',
            entityId: loanProductId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            oldData: { name: before.name, loanType: before.loanType },
            newData: { name: row.name, loanType: row.loanType },
          },
          tx,
        );

        return row;
      });

      const schemes = await this.prisma.loanScheme.findMany({
        where: { orgId: actor.orgId, loanProductId },
        orderBy: { code: 'asc' },
      });

      return {
        ...toProductSummary(updated),
        schemes: (schemes as LoanSchemeRow[]).map(toSchemeSummary),
      };
    } catch (error) {
      await this.recordPersistenceFailure(
        actor,
        meta,
        error,
        'update',
        loanProductId,
      );
      throw error;
    }
  }

  /**
   * Activates or deactivates a product.
   *
   * Deactivating stops new applications reaching any of its schemes. It does not
   * cascade a status change onto those schemes, and deliberately so: a product
   * reinstated later should come back with the same schemes active as before,
   * which a cascade would have destroyed. The selectability check reads both
   * statuses instead.
   */
  async setStatus(
    actor: AuthContext,
    loanProductId: string,
    dto: SetLoanConfigStatusDto,
    meta: RequestMeta,
  ): Promise<LoanProductDetail> {
    const before = await this.findInScope(actor, loanProductId, meta);
    await this.assertVersion(actor, before, dto.expectedVersion, meta);

    if (before.status === dto.status) {
      throw new ConflictException(`Loan product is already ${dto.status}`);
    }

    const activating = dto.status === 'ACTIVE';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.loanProduct.update({
        where: { orgId_loanProductId: { orgId: actor.orgId, loanProductId } },
        data: { status: dto.status },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: activating
            ? AuditAction.LOAN_PRODUCT_ACTIVATED
            : AuditAction.LOAN_PRODUCT_DEACTIVATED,
          entityType: 'LOAN_PRODUCT',
          entityId: loanProductId,
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

      return row;
    });

    const schemes = await this.prisma.loanScheme.findMany({
      where: { orgId: actor.orgId, loanProductId },
      orderBy: { code: 'asc' },
    });

    return {
      ...toProductSummary(updated),
      schemes: (schemes as LoanSchemeRow[]).map(toSchemeSummary),
    };
  }

  /** Resolves a product in the caller's tenant, or refuses indistinguishably. */
  private async findInScope(
    actor: AuthContext,
    loanProductId: string,
    meta: RequestMeta,
  ): Promise<LoanProductRow> {
    const row = await this.prisma.loanProduct.findUnique({
      where: { orgId_loanProductId: { orgId: actor.orgId, loanProductId } },
    });

    if (!row) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_PRODUCT_SCOPE_DENIED,
        entityType: 'LOAN_PRODUCT',
        entityId: loanProductId,
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

  private async assertVersion(
    actor: AuthContext,
    row: LoanProductRow,
    expectedVersion: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (row.updatedAt.toISOString() === expectedVersion) return;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.LOAN_PRODUCT_CONCURRENT_EDIT_REJECTED,
      entityType: 'LOAN_PRODUCT',
      entityId: row.loanProductId,
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
      'This loan product was changed by someone else. Reload and try again.',
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
      action: AuditAction.LOAN_PRODUCT_CREATE_REJECTED,
      entityType: 'LOAN_PRODUCT',
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
    loanProductId: string | null,
  ): Promise<void> {
    this.logger.error(
      `Loan product ${operation} failed for org ${actor.orgId}`,
      error instanceof Error ? error.stack : undefined,
    );

    await this.audit
      .record({
        orgId: actor.orgId,
        action: AuditAction.LOAN_PRODUCT_PERSISTENCE_FAILED,
        entityType: 'LOAN_PRODUCT',
        entityId: loanProductId,
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

  /**
   * Turns a unique-constraint violation into the message it deserves.
   *
   * Without this a concurrent duplicate create reaches `AllExceptionsFilter`,
   * which collapses any non-HttpException into a 503 reading "Authentication
   * service is temporarily unavailable" — wrong in every particular for a
   * duplicate product code.
   */
  private translateUniqueViolation(error: unknown, code: string): unknown {
    const prismaCode = (error as { code?: string } | null)?.code;

    if (prismaCode === 'P2002') {
      return new ConflictException(
        `Product Code ${code} is already in use in this organization`,
      );
    }

    return error;
  }
}
