import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MASTER_DATA_CATEGORIES, type SelectOption } from '@lms/validation';

import { AuditAction, AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMasterDataValueDto } from './dto/create-master-data-value.dto';
import { ListMasterDataDto } from './dto/list-master-data.dto';
import { UpdateMasterDataValueDto } from './dto/update-master-data-value.dto';

export const MASTER_DATA_VIEW_PERMISSION = 'master_data.view';
export const MASTER_DATA_MANAGE_PERMISSION = 'master_data.manage';

/**
 * One message for every way a value can be unreachable — absent, or another
 * tenant's. Following `CustomerService`: distinguishing them would confirm the
 * existence of rows the caller cannot see, and the real cause goes to the audit
 * log instead.
 */
const NOT_REACHABLE = 'Option value not found';

export interface MasterDataValueDetail extends SelectOption {
  valueId: string;
  category: string;
  code: string;
  displayOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  isSystem: boolean;
  version: string;
}

/**
 * Admin-maintained option lists (the values behind dropdown fields).
 *
 * # Why this is not branch-scoped
 * Every other listable entity here confines a Branch Admin to their own branch.
 * Master data deliberately does not: an option list is organization-wide by
 * definition, and a branch-specific set of genders or document types would mean
 * the same customer record could not be edited in two branches. The `orgId`
 * filter is still absolute — it is the tenant boundary — but there is no
 * `branchScope` here, and that absence is the design rather than an omission.
 *
 * # Why reads are not audited
 * Unlike the customer surfaces, list reads write no audit row. These endpoints
 * are hit on nearly every form render and carry no personal data, so auditing
 * them would bury the mutations that matter. Mutations are audited in full.
 */
@Injectable()
export class MasterDataService {
  private readonly logger = new Logger(MasterDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The values in one category, ordered for display.
   *
   * Returns `SelectOption[]` — the same shape the code-defined enum registries
   * carry — so the web layer's `<SelectField>` cannot tell an admin-managed list
   * from a compiled-in one.
   *
   * `activeOnly` is the filter a form uses; the admin screen omits it to see
   * what it is managing. Filtering happens here rather than in the browser,
   * following the convention `activeOnly`/`selectable` already set elsewhere.
   */
  async list(
    actor: AuthContext,
    query: ListMasterDataDto,
  ): Promise<SelectOption[]> {
    const rows = await this.prisma.masterDataValue.findMany({
      where: {
        orgId: actor.orgId,
        category: query.category,
        ...(query.activeOnly ? { status: 'ACTIVE' } : {}),
      },
      // `code` breaks ties so a list with every displayOrder left at 0 — which
      // is what bulk-seeded data looks like — still renders in a stable order
      // rather than whatever the planner returns.
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
    });

    return rows.map((row) => ({
      value: row.code,
      label: row.label,
      // An INACTIVE value is still rendered when the admin screen asks for it,
      // but never selectable. A form passing `activeOnly` will not see it here.
      ...(row.status === 'INACTIVE' ? { disabled: true } : {}),
    }));
  }

  /** The management view: every column the admin screen edits. */
  async listDetailed(
    actor: AuthContext,
    query: ListMasterDataDto,
  ): Promise<MasterDataValueDetail[]> {
    const rows = await this.prisma.masterDataValue.findMany({
      where: {
        orgId: actor.orgId,
        category: query.category,
        ...(query.activeOnly ? { status: 'ACTIVE' } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
    });

    return rows.map((row) => this.toDetail(row));
  }

  async create(
    actor: AuthContext,
    dto: CreateMasterDataValueDto,
    meta: RequestMeta,
  ): Promise<MasterDataValueDetail> {
    const created = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.masterDataValue.create({
          data: {
            orgId: actor.orgId,
            category: dto.category,
            code: dto.code,
            label: dto.label,
            displayOrder: dto.displayOrder ?? 0,
            status: dto.status ?? 'ACTIVE',
            // Never settable through the API. `isSystem` marks rows the seed
            // owns and business logic reads; letting a caller claim it would
            // let them make a row undeletable at will.
            isSystem: false,
          },
        });

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.MASTER_DATA_VALUE_CREATED,
            entityType: 'MASTER_DATA_VALUE',
            entityId: row.valueId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            newData: {
              category: row.category,
              code: row.code,
              label: row.label,
            },
          },
          tx,
        );

        return row;
      })
      .catch((error: unknown) => {
        throw this.translateUniqueViolation(error, dto.category, dto.code);
      });

    return this.toDetail(created);
  }

  /**
   * Edit a value's label, order or status.
   *
   * `code` is deliberately absent from the DTO: existing records store it, so
   * changing it would orphan every row that already carries the old value while
   * appearing to be a rename.
   */
  async update(
    actor: AuthContext,
    valueId: string,
    dto: UpdateMasterDataValueDto,
    meta: RequestMeta,
  ): Promise<MasterDataValueDetail> {
    const existing = await this.findInScope(actor, valueId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.masterDataValue.update({
        where: { orgId_valueId: { orgId: actor.orgId, valueId } },
        data: {
          ...(dto.label === undefined ? {} : { label: dto.label }),
          ...(dto.displayOrder === undefined
            ? {}
            : { displayOrder: dto.displayOrder }),
          ...(dto.status === undefined ? {} : { status: dto.status }),
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.MASTER_DATA_VALUE_UPDATED,
          entityType: 'MASTER_DATA_VALUE',
          entityId: valueId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            label: existing.label,
            displayOrder: existing.displayOrder,
            status: existing.status,
          },
          newData: {
            label: row.label,
            displayOrder: row.displayOrder,
            status: row.status,
          },
        },
        tx,
      );

      return row;
    });

    return this.toDetail(updated);
  }

  /**
   * Remove a value.
   *
   * A seeded (`isSystem`) row is refused: the KYC completeness check iterates
   * document categories by code, so deleting `ID` would not fail loudly — it
   * would quietly stop requiring an identity document. Deactivating such a row
   * is allowed, because that hides it from new forms while leaving the code it
   * defines intact for existing records.
   *
   * There is no dependency scan of business tables. Values are stored as loose
   * strings across several models, so a scan would be both expensive and
   * incomplete; the honest guard is `isSystem` for rows code depends on, and
   * deactivation as the sanctioned way to retire everything else.
   */
  async remove(
    actor: AuthContext,
    valueId: string,
    meta: RequestMeta,
  ): Promise<{ valueId: string; deleted: true }> {
    const existing = await this.findInScope(actor, valueId);

    if (existing.isSystem) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.MASTER_DATA_SYSTEM_VALUE_DELETE_REFUSED,
        entityType: 'MASTER_DATA_VALUE',
        entityId: valueId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { category: existing.category, code: existing.code },
      });

      throw new ConflictException(
        'This is a standard value the system depends on. Set it to Inactive instead of deleting it.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.masterDataValue.delete({
        where: { orgId_valueId: { orgId: actor.orgId, valueId } },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.MASTER_DATA_VALUE_DELETED,
          entityType: 'MASTER_DATA_VALUE',
          entityId: valueId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            category: existing.category,
            code: existing.code,
            label: existing.label,
          },
        },
        tx,
      );
    });

    return { valueId, deleted: true };
  }

  /**
   * The single definition of reach. A miss is a 404 whether the row belongs to
   * another tenant or does not exist.
   */
  private async findInScope(actor: AuthContext, valueId: string) {
    const row = await this.prisma.masterDataValue.findFirst({
      where: { orgId: actor.orgId, valueId },
    });

    if (!row) {
      this.logger.warn(
        `Master data value ${valueId} not reachable for org ${actor.orgId}`,
      );
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  /**
   * A unique-constraint violation means the code is already taken in this
   * category. Translated here because an untranslated P2002 surfaces to the
   * caller as a 500 that reads like an outage rather than a correctable input.
   */
  private translateUniqueViolation(
    error: unknown,
    category: string,
    code: string,
  ): unknown {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return new ConflictException(
        `The code "${code}" is already used in ${category}.`,
      );
    }
    return error;
  }

  private toDetail(row: {
    valueId: string;
    category: string;
    code: string;
    label: string;
    displayOrder: number;
    status: string;
    isSystem: boolean;
    updatedAt: Date;
  }): MasterDataValueDetail {
    return {
      valueId: row.valueId,
      category: row.category,
      code: row.code,
      // `value`/`label` make this a `SelectOption` too, so the admin screen and
      // a form can share rendering code.
      value: row.code,
      label: row.label,
      displayOrder: row.displayOrder,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      isSystem: row.isSystem,
      // The optimistic-concurrency handle, as everywhere else here.
      version: row.updatedAt.toISOString(),
    };
  }
}

/** Re-exported so DTOs and the seed share one list. */
export { MASTER_DATA_CATEGORIES };
