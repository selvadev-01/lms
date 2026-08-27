import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CustomerDeleteBlocker,
  CustomerDetail,
  CustomerLifecycleStatus,
  CustomerSummary,
  CustomerType,
  KycLifecycleStatus,
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
import {
  CUSTOMER_DEPENDENCIES,
  type CustomerDependencyEntity,
  summarizeCustomerBlockers,
} from './customer-dependencies';
import { ConvertCustomerTypeDto } from './dto/convert-customer-type.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';
import { SetCustomerStatusDto } from './dto/set-customer-status.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

export const CUSTOMERS_VIEW_PERMISSION = 'customers.view';
export const CUSTOMERS_CREATE_PERMISSION = 'customers.create';
export const CUSTOMERS_UPDATE_PERMISSION = 'customers.update';
export const CUSTOMERS_DELETE_PERMISSION = 'customers.delete';
export const CUSTOMERS_ACTIVATE_PERMISSION = 'customers.activate';
export const CUSTOMERS_CONVERT_PERMISSION = 'customers.convert';

/**
 * One message for every way a customer can be unreachable.
 *
 * Non-existent, another tenant's and another branch's all produce this.
 * Distinguishing them would let a Branch Admin enumerate the organization's
 * customers by watching which ids answer differently — Scenario 19 asks for the
 * customer to be returned "only if within authorized scope", and a 403 that
 * confirms existence is not that. The real cause goes to the audit log.
 */
const NOT_REACHABLE = 'Customer not found';

/**
 * The delete-guard's view of a Prisma client: one countable delegate per entry
 * in `CUSTOMER_DEPENDENCIES`, and nothing else.
 *
 * Keyed off the dependency list itself, so adding a blocking relation there
 * without a matching Prisma model is a compile error rather than a runtime
 * "cannot read property count of undefined".
 */
type CountableDelegates = Record<
  CustomerDependencyEntity,
  { count: (args: { where: Record<string, unknown> }) => Promise<number> }
>;

type CustomerRow = {
  orgId: string;
  customerId: string;
  branchId: string;
  customerCode: string;
  customerType: CustomerType;
  fullName: string;
  mobile: string;
  mobileVerifiedAt: Date | null;
  email: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  status: CustomerLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  branch?: { name: string } | null;
  kycRecords?: Array<{ status: KycLifecycleStatus }>;
};

const ROW_INCLUDE = {
  branch: { select: { name: true } },
  // Only the newest KYC record matters to a summary. Conversion can leave an
  // older one behind (Scenario 27 starts a fresh cycle), and showing the stale
  // status would report an approved customer as still pending.
  kycRecords: {
    select: { status: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
} as const;

/**
 * List rows carry a masked mobile (Q-CUST-21).
 *
 * A search screen is the widest surface in the module — one query can return
 * every customer in a branch — and should not double as a bulk PII export. The
 * unmasked number is on the detail view, which is one record and one audit entry
 * per read.
 */
function toSummary(row: CustomerRow): CustomerSummary {
  return {
    customerId: row.customerId,
    customerCode: row.customerCode,
    customerType: row.customerType,
    fullName: row.fullName,
    mobile: maskMobile(row.mobile),
    status: row.status,
    branchId: row.branchId,
    branchName: row.branch?.name ?? undefined,
    kycStatus: row.kycRecords?.[0]?.status,
    mobileVerified: row.mobileVerifiedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDetail(row: CustomerRow): CustomerDetail {
  return {
    ...toSummary(row),
    mobile: row.mobile,
    email: row.email ?? undefined,
    // Date-only column: the time part is an artifact of the JS Date, and sending
    // it would imply a precision the field does not have.
    dateOfBirth: row.dateOfBirth?.toISOString().slice(0, 10),
    gender: row.gender ?? undefined,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2 ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    pincode: row.pincode ?? undefined,
    updatedAt: row.updatedAt.toISOString(),
    version: row.updatedAt.toISOString(),
  };
}

/**
 * Customer registration, search, profile and lifecycle (Module 04).
 *
 * The governing rule is the one Modules 02 and 03 established: **the permission
 * grants the action, the service confines the reach.** `customers.view` says a
 * caller may search customers; it never says which customers, and this file is
 * where that second half is decided. Every query is filtered by `actor.orgId`
 * unconditionally and by `actor.branchId` whenever the caller carries one, so a
 * Branch Admin's widest possible query still returns only their branch.
 */
@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchService,
  ) {}

  /**
   * Search and list (Scenarios 18-20).
   *
   * One `search` term rather than three fields, because the source describes a
   * single box. The term is matched against name, customer code and mobile at
   * once: a user who types a phone number into what they think is a name search
   * should still find their customer.
   */
  async list(
    actor: AuthContext,
    query: ListCustomersDto,
    meta: RequestMeta,
  ): Promise<CustomerSummary[]> {
    const search = query.search?.trim();

    const rows = await this.prisma.customer.findMany({
      where: {
        orgId: actor.orgId,
        ...this.branchScope(actor),
        ...(query.customerType ? { customerType: query.customerType } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.kycStatus
          ? { kycRecords: { some: { status: query.kycStatus } } }
          : {}),
        ...(search
          ? {
              OR: [
                // Partial, case-insensitive on the name (Q-CUST-19): branch staff
                // search by what the customer said their name was, not by an
                // exact string.
                {
                  fullName: { contains: search, mode: 'insensitive' as const },
                },
                // Exact on the code — it is an identifier, and a partial match
                // would make CUST1 return CUST100.
                {
                  customerCode: {
                    equals: search,
                    mode: 'insensitive' as const,
                  },
                },
                // Prefix on mobile, so a half-remembered number narrows the list.
                { mobile: { startsWith: search } },
              ],
            }
          : {}),
      },
      orderBy: [{ fullName: 'asc' }],
      include: ROW_INCLUDE,
    });

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_LISTED,
      entityType: 'CUSTOMER',
      entityId: null,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        count: rows.length,
        // The term itself is recorded because a KYC search is a regulated
        // lookup — "who searched for whom" is the record. It is not PII the
        // caller did not already hold.
        search: search ?? null,
        branchConfined: actor.branchId !== null,
      },
    });

    return rows.map(toSummary);
  }

  /** Profile read (Scenario 22's entry point). */
  async getById(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<CustomerDetail> {
    const row = await this.findInScope(actor, customerId, meta);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_VIEWED,
      entityType: 'CUSTOMER',
      entityId: customerId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return toDetail(row);
  }

  /**
   * Registration (Scenarios 1-5).
   *
   * The customer always lands in the caller's own branch. A Branch Admin has one
   * and it is used; a Super Admin has none, and rather than letting them supply
   * one — which would be a `branchId` field a client could set, exactly what
   * Scenario 31 forbids — the DTO carries no branch at all and an org-wide
   * caller must name the branch through a dedicated, validated field.
   */
  async create(
    actor: AuthContext,
    dto: CreateCustomerDto,
    meta: RequestMeta,
  ): Promise<CustomerDetail> {
    const branchId = await this.resolveCreateBranch(actor, dto, meta);

    // Scenario 5 — a possible duplicate is surfaced, never silently created.
    // Checked before the transaction so the common case does not open one.
    if (!dto.force) {
      const duplicates = await this.prisma.customer.findMany({
        where: { orgId: actor.orgId, mobile: dto.mobile },
        select: {
          customerId: true,
          customerCode: true,
          fullName: true,
          status: true,
        },
        take: 5,
      });

      if (duplicates.length > 0) {
        await this.audit.record({
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_DUPLICATE_FLAGGED,
          entityType: 'CUSTOMER',
          entityId: null,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            mobile: maskMobile(dto.mobile),
            matches: duplicates.map((row) => row.customerCode),
          },
        });

        throw new ConflictException({
          message:
            'A customer with this mobile number already exists. Confirm to continue.',
          duplicateOf: duplicates,
        });
      }
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Rules 47/50 via Module 02's seam: an inactive organization or branch
        // takes no new customers. This is that method's first real caller.
        await this.branches.assertBranchOperational(tx, actor.orgId, branchId);

        const customer = await tx.customer.create({
          data: {
            orgId: actor.orgId,
            branchId,
            customerCode:
              dto.customerCode ??
              (await this.nextCustomerCode(tx, actor.orgId)),
            customerType: dto.customerType,
            fullName: dto.fullName,
            mobile: dto.mobile,
            email: dto.email ?? null,
            dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
            gender: dto.gender ?? null,
            addressLine1: dto.addressLine1,
            addressLine2: dto.addressLine2 ?? null,
            city: dto.city ?? null,
            state: dto.state ?? null,
            pincode: dto.pincode ?? null,
            // Never ACTIVE on creation, for either type. A KYC customer needs an
            // approval (Rule 6) and a LOCAL customer needs a verified mobile
            // (Rule 12); creating one ACTIVE would bypass both.
            status: 'PENDING',
          },
          include: ROW_INCLUDE,
        });

        // A KYC customer gets its KYC record here so the workflow has something
        // to advance. A LOCAL customer deliberately gets none: absence is how
        // "no KYC required" is represented (Q-CUST-2), which keeps a LOCAL
        // customer from ever appearing in a KYC review queue.
        if (dto.customerType === 'KYC') {
          await tx.customerKyc.create({
            data: {
              orgId: actor.orgId,
              customerId: customer.customerId,
              status: 'PENDING',
            },
          });
        }

        await this.audit.record(
          {
            orgId: actor.orgId,
            action: AuditAction.CUSTOMER_CREATED,
            entityType: 'CUSTOMER',
            entityId: customer.customerId,
            actorUserId: actor.userId,
            requestId: meta.requestId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
            // Scenario 33 names actor, customer, organization, branch, type,
            // timestamp and outcome. Timestamp and org are columns on the audit
            // row itself; the rest are here.
            metadata: {
              customerCode: customer.customerCode,
              customerType: customer.customerType,
              branchId,
              mobile: maskMobile(customer.mobile),
              duplicateOverride: dto.force === true,
            },
            newData: {
              fullName: customer.fullName,
              customerType: customer.customerType,
              status: customer.status,
              branchId,
            },
          },
          tx,
        );

        if (dto.force) {
          await this.audit.record(
            {
              orgId: actor.orgId,
              action: AuditAction.CUSTOMER_DUPLICATE_OVERRIDDEN,
              entityType: 'CUSTOMER',
              entityId: customer.customerId,
              actorUserId: actor.userId,
              requestId: meta.requestId,
              ipAddress: meta.ipAddress,
              userAgent: meta.userAgent,
              metadata: { mobile: maskMobile(customer.mobile) },
            },
            tx,
          );
        }

        return customer;
      });

      return toDetail(created);
    } catch (error) {
      // Scenario 38 — validation passed but persistence failed. The transaction
      // has already rolled back, so no half-built customer exists; this records
      // that it was attempted, which is the part an auditor cannot otherwise
      // see.
      await this.recordPersistenceFailure(actor, null, meta, error);

      /**
       * A duplicate customer code is a conflict, not a server fault.
       *
       * Rethrowing it raw sends a `PrismaClientKnownRequestError` to
       * `AllExceptionsFilter`, which cannot tell it from a crash and answers 503
       * "temporarily unavailable" — telling the branch to try again later for a
       * request that will fail identically every time. Two cases reach here:
       * a caller-supplied `customerCode` that is already taken, which is theirs
       * to correct, and an allocation that lost a race with a concurrent
       * creation, where retrying genuinely does succeed.
       */
      throw this.translateUniqueViolation(error, dto.customerCode);
    }
  }

  /**
   * Profile edit (Scenario 23's target, Scenario 36's guarantee).
   *
   * Touches only profile columns. Loans, payments and receipts are separate
   * tables and are not reachable from here, which is how Rule 22 is honoured —
   * not by a check, but by there being nothing to check.
   */
  async update(
    actor: AuthContext,
    customerId: string,
    dto: UpdateCustomerDto,
    meta: RequestMeta,
  ): Promise<CustomerDetail> {
    const existing = await this.findInScope(actor, customerId, meta);
    await this.assertVersion(actor, existing, dto.expectedVersion, meta);

    // Q-CUST-28 — the verification attaches to the number, not to the customer.
    // Changing it must not leave a LOCAL customer ACTIVE on the strength of an
    // OTP sent to a number they no longer use.
    const mobileChanged = dto.mobile !== existing.mobile;
    const clearsVerification =
      mobileChanged && existing.mobileVerifiedAt !== null;
    const demotesToPending =
      clearsVerification &&
      existing.customerType === 'LOCAL' &&
      existing.status === 'ACTIVE';

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.customer.update({
        where: {
          orgId_customerId: { orgId: actor.orgId, customerId },
        },
        data: {
          fullName: dto.fullName,
          mobile: dto.mobile,
          email: dto.email ?? null,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          gender: dto.gender ?? null,
          addressLine1: dto.addressLine1,
          addressLine2: dto.addressLine2 ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          pincode: dto.pincode ?? null,
          ...(clearsVerification ? { mobileVerifiedAt: null } : {}),
          ...(demotesToPending ? { status: 'PENDING' as const } : {}),
        },
        include: ROW_INCLUDE,
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_UPDATED,
          entityType: 'CUSTOMER',
          entityId: customerId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: {
            mobileChanged,
            verificationCleared: clearsVerification,
            statusDemoted: demotesToPending,
          },
          // Before/after, so Q-CUST-29's "no edit triggers re-KYC" stays
          // reviewable: an auditor can see exactly what moved on an approved
          // customer even though the approval stands.
          oldData: {
            fullName: existing.fullName,
            mobile: maskMobile(existing.mobile),
            addressLine1: existing.addressLine1,
            city: existing.city,
            pincode: existing.pincode,
            status: existing.status,
          },
          newData: {
            fullName: row.fullName,
            mobile: maskMobile(row.mobile),
            addressLine1: row.addressLine1,
            city: row.city,
            pincode: row.pincode,
            status: row.status,
          },
        },
        tx,
      );

      return row;
    });

    return toDetail(updated);
  }

  /**
   * Activation and deactivation (Q-CUST-11, Q-CUST-12).
   *
   * The two refusals here are the module's core invariants, and neither is
   * configurable: a KYC customer cannot be activated without an approval
   * (Rule 6), and a LOCAL customer cannot be activated without a verified mobile
   * (Rule 12, Scenario 14).
   */
  async setStatus(
    actor: AuthContext,
    customerId: string,
    dto: SetCustomerStatusDto,
    meta: RequestMeta,
  ): Promise<CustomerDetail> {
    const existing = await this.findInScope(actor, customerId, meta);

    if (dto.status === 'ACTIVE') {
      await this.assertActivatable(actor, existing, meta);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.customer.update({
        where: { orgId_customerId: { orgId: actor.orgId, customerId } },
        data: { status: dto.status },
        include: ROW_INCLUDE,
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action:
            dto.status === 'ACTIVE'
              ? AuditAction.CUSTOMER_ACTIVATED
              : AuditAction.CUSTOMER_DEACTIVATED,
          entityType: 'CUSTOMER',
          entityId: customerId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: dto.reason ?? null },
          oldData: { status: existing.status },
          newData: { status: row.status },
        },
        tx,
      );

      return row;
    });

    return toDetail(updated);
  }

  /**
   * LOCAL → KYC conversion (Scenarios 27, 28).
   *
   * The existing row is retained and its `customerId` never changes, which is
   * what keeps loans, applications and collections attached — Scenario 28 is
   * satisfied by not touching them rather than by migrating them.
   *
   * There is no KYC → LOCAL direction. Allowing it would let an approved
   * customer's verification be discarded by a type change, turning conversion
   * into a way to erase a KYC record.
   */
  async convertToKyc(
    actor: AuthContext,
    customerId: string,
    dto: ConvertCustomerTypeDto,
    meta: RequestMeta,
  ): Promise<CustomerDetail> {
    const existing = await this.findInScope(actor, customerId, meta);
    await this.assertVersion(actor, existing, dto.expectedVersion, meta);

    if (existing.customerType !== 'LOCAL') {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_CONVERT_REJECTED,
        entityType: 'CUSTOMER',
        entityId: customerId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { currentType: existing.customerType },
      });

      throw new ConflictException(
        'Only a Local customer can be converted to KYC',
      );
    }

    const converted = await this.prisma.$transaction(async (tx) => {
      const row = await tx.customer.update({
        where: { orgId_customerId: { orgId: actor.orgId, customerId } },
        data: {
          customerType: 'KYC',
          // Back to PENDING: the customer now carries a KYC requirement they
          // have not met, and leaving them ACTIVE would mean an unapproved KYC
          // customer is active, which Rule 6 forbids.
          status: 'PENDING',
        },
        include: ROW_INCLUDE,
      });

      await tx.customerKyc.create({
        data: {
          orgId: actor.orgId,
          customerId,
          status: 'PENDING',
        },
      });

      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_TYPE_CONVERTED,
          entityType: 'CUSTOMER',
          entityId: customerId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          metadata: { reason: dto.reason ?? null },
          // Scenario 35 — the selected customer type is retained in history, in
          // both its previous and new form.
          oldData: {
            customerType: existing.customerType,
            status: existing.status,
          },
          newData: { customerType: row.customerType, status: row.status },
        },
        tx,
      );

      return row;
    });

    return toDetail(converted);
  }

  /**
   * Physical delete, guarded (Rule 23, Scenario 37).
   *
   * Returns rather than throws on the blocked path so the controller can answer
   * 409 with the blockers listed. A customer with any financial history is
   * permanently undeletable, which is the intended outcome — the delete path
   * exists for the record created by mistake five minutes ago.
   */
  async remove(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<
    { deleted: true } | { deleted: false; blockedBy: CustomerDeleteBlocker[] }
  > {
    const existing = await this.findInScope(actor, customerId, meta);

    const delegates = this.prisma as unknown as CountableDelegates;
    const counts: Record<string, number> = {};

    for (const dependency of CUSTOMER_DEPENDENCIES) {
      counts[dependency.entity] = await delegates[dependency.entity].count({
        where: { orgId: actor.orgId, [dependency.field]: customerId },
      });
    }

    const blockedBy = summarizeCustomerBlockers(counts);

    if (blockedBy.length > 0) {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_DELETE_BLOCKED,
        entityType: 'CUSTOMER',
        entityId: customerId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { blockedBy },
      });

      return { deleted: false, blockedBy };
    }

    await this.prisma.$transaction(async (tx) => {
      // Audited before the delete, not after: the composite FK on
      // `audit_logs.actor_user_id` is unaffected, but writing the record first
      // means a failure in the delete leaves an attempted-deletion trail rather
      // than a successful-deletion claim for a row that still exists.
      await this.audit.record(
        {
          orgId: actor.orgId,
          action: AuditAction.CUSTOMER_DELETED,
          entityType: 'CUSTOMER',
          entityId: customerId,
          actorUserId: actor.userId,
          requestId: meta.requestId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          oldData: {
            customerCode: existing.customerCode,
            fullName: existing.fullName,
            customerType: existing.customerType,
            status: existing.status,
          },
        },
        tx,
      );

      // Addresses, documents, KYC records, mobile verifications and guarantors
      // all cascade — they are this customer's own record, not history shared
      // with another party.
      await tx.customer.delete({
        where: { orgId_customerId: { orgId: actor.orgId, customerId } },
      });
    });

    return { deleted: true };
  }

  /**
   * Resolves a customer the caller is entitled to reach, or refuses.
   *
   * Exported to the other services in this module (KYC, documents, guarantors)
   * so the scope rule is written once. A sibling service that re-implemented
   * this would be the easiest place in the module to omit the branch filter.
   */
  async findInScope(
    actor: AuthContext,
    customerId: string,
    meta: RequestMeta,
  ): Promise<CustomerRow> {
    const row = await this.prisma.customer.findFirst({
      where: {
        // Both filters live in the query rather than in a post-fetch check, so
        // an out-of-scope customer is never loaded into memory at all.
        orgId: actor.orgId,
        customerId,
        ...this.branchScope(actor),
      },
      include: ROW_INCLUDE,
    });

    if (!row) {
      await this.recordScopeDenial(actor, customerId, meta);
      throw new NotFoundException(NOT_REACHABLE);
    }

    return row;
  }

  /**
   * The branch half of the scope rule.
   *
   * A caller with no `branchId` is organization-wide and gets no branch filter;
   * a caller with one is confined to it. Expressed as a spread so it composes
   * into any `where` without a conditional at each call site — the shape that
   * makes forgetting it visible.
   */
  private branchScope(actor: AuthContext): { branchId?: string } {
    return actor.branchId ? { branchId: actor.branchId } : {};
  }

  /**
   * Optimistic concurrency (Q-CUST-22, Scenarios 40, 41).
   *
   * The client echoes back the `updatedAt` it last read. If the row has moved
   * since, the write is refused rather than applied — the losing edit is not
   * silently discarded, which is what "prevents silent loss of committed data"
   * asks for.
   */
  private async assertVersion(
    actor: AuthContext,
    row: CustomerRow,
    expectedVersion: string,
    meta: RequestMeta,
  ): Promise<void> {
    if (row.updatedAt.toISOString() === expectedVersion) return;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_CONCURRENT_EDIT_REJECTED,
      entityType: 'CUSTOMER',
      entityId: row.customerId,
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
      'This customer was changed by someone else. Reload and try again.',
    );
  }

  /**
   * The two activation invariants (Rules 6, 12; Scenarios 9, 14).
   *
   * Deliberately not configurable. A deployment that could switch either off
   * would be able to activate an unverified or unapproved customer, which is the
   * one thing the module exists to prevent.
   */
  private async assertActivatable(
    actor: AuthContext,
    row: CustomerRow,
    meta: RequestMeta,
  ): Promise<void> {
    const reason =
      row.customerType === 'LOCAL'
        ? row.mobileVerifiedAt === null
          ? 'Mobile number must be verified before this customer can be activated'
          : null
        : row.kycRecords?.[0]?.status !== 'APPROVED'
          ? 'KYC must be approved before this customer can be activated'
          : null;

    if (!reason) return;

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_ACTIVATION_REJECTED,
      entityType: 'CUSTOMER',
      entityId: row.customerId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        customerType: row.customerType,
        kycStatus: row.kycRecords?.[0]?.status ?? null,
        mobileVerified: row.mobileVerifiedAt !== null,
      },
    });

    throw new ConflictException(reason);
  }

  /**
   * Decides which branch a new customer belongs to.
   *
   * A branch-scoped caller gets their own, always — the DTO has no branch field,
   * so there is nothing for a client to override (Scenario 31). An org-wide
   * caller must name one explicitly, and it is validated against the tenant
   * before use.
   */
  private async resolveCreateBranch(
    actor: AuthContext,
    dto: CreateCustomerDto,
    meta: RequestMeta,
  ): Promise<string> {
    if (actor.branchId) return actor.branchId;

    if (!dto.branchId) {
      throw new ConflictException('Branch is required');
    }

    const branch = await this.prisma.branch.findFirst({
      where: { orgId: actor.orgId, branchId: dto.branchId },
      select: { branchId: true },
    });

    if (!branch) {
      // A branch in another tenant and a branch that does not exist answer
      // identically, for the same reason customers do.
      await this.recordScopeDenial(actor, null, meta, {
        attemptedBranchId: dto.branchId,
      });
      throw new NotFoundException('Branch not found');
    }

    return branch.branchId;
  }

  /**
   * Allocates the next customer code for an organization.
   *
   * Runs inside the caller's transaction so two concurrent registrations cannot
   * both read the same maximum. The unique index on `(orgId, customerCode)` is
   * the real guarantee — this is the allocation, not the enforcement.
   *
   * **The maximum is computed numerically, not by string order.** An earlier
   * version took the first row of `orderBy: { customerCode: 'desc' }` and parsed
   * it, which broke on any code whose suffix is not purely numeric: `CUSTZZ04`
   * sorts above `CUST007` because `Z` > `0`, `parseInt('ZZ04')` is `NaN`, and the
   * `NaN` fallback then re-proposed `CUST001` — a code that already existed. The
   * result was a unique-constraint violation surfacing as an opaque 503 on every
   * create. Codes with non-numeric suffixes are real: the e2e suite mints
   * `CUSTZZ*` fixtures, and a branch may type its own code at creation.
   *
   * So every candidate is read and only the numeric ones are considered. The set
   * is bounded by customers per organization, and this runs once per creation.
   */
  /**
   * Turns a duplicate customer-code collision into the 409 it is.
   *
   * Without this the unique-constraint violation reaches `AllExceptionsFilter`
   * as an unrecognized Prisma error and is rendered as a 503 about the
   * authentication service — the same trap `BranchService` and `RoleService`
   * document, which Customers was missing. It told the branch to try again later
   * for a request that would have failed identically every time.
   *
   * The two cases read differently to the caller: a code they chose is theirs to
   * change, while a lost allocation race really does succeed on retry.
   */
  private translateUniqueViolation(error: unknown, code?: string): unknown {
    const prismaError = error as { code?: string };
    if (prismaError?.code === 'P2002') {
      return new ConflictException(
        code
          ? `Customer ID "${code}" is already in use`
          : 'Could not allocate a Customer ID. Please try again.',
      );
    }
    return error;
  }

  private async nextCustomerCode(
    tx: Pick<PrismaService, 'customer'>,
    orgId: string,
  ): Promise<string> {
    const rows = await tx.customer.findMany({
      where: { orgId, customerCode: { startsWith: 'CUST' } },
      select: { customerCode: true },
    });

    const highest = rows.reduce((max, row) => {
      // Only `CUST` followed by digits to the end. `CUSTZZ04` is skipped rather
      // than coerced, because it is not part of this sequence.
      const match = /^CUST(\d+)$/.exec(row.customerCode);
      if (!match) return max;

      const value = Number.parseInt(match[1], 10);
      return Number.isFinite(value) && value > max ? value : max;
    }, 0);

    return `CUST${String(highest + 1).padStart(3, '0')}`;
  }

  private async recordScopeDenial(
    actor: AuthContext,
    customerId: string | null,
    meta: RequestMeta,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.CUSTOMER_SCOPE_DENIED,
      entityType: 'CUSTOMER',
      entityId: customerId,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      // The caller is told only "not found"; this is where the distinction
      // between out-of-branch, out-of-tenant and absent is actually kept.
      metadata: { actorBranchId: actor.branchId, ...extra },
    });
  }

  private async recordPersistenceFailure(
    actor: AuthContext,
    customerId: string | null,
    meta: RequestMeta,
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      `Customer persistence failed for org ${actor.orgId}`,
      error instanceof Error ? error.stack : String(error),
    );

    try {
      await this.audit.record({
        orgId: actor.orgId,
        action: AuditAction.CUSTOMER_PERSISTENCE_FAILED,
        entityType: 'CUSTOMER',
        entityId: customerId,
        actorUserId: actor.userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: {
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
    } catch {
      // The audit write is outside the rolled-back transaction, but if the
      // database is the thing that failed it will fail too. Swallowed rather
      // than thrown so the caller sees the original error, which is the one that
      // explains what happened.
    }
  }
}
