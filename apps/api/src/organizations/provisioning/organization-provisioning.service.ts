import { ConflictException, Injectable, Logger } from '@nestjs/common';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import { Prisma } from '../../generated/prisma/client';
import { LEDGER_ACCOUNT_SPECS } from '../../loans/disbursal/ledger-accounts';
import {
  NOTIFICATION_RULE_SPECS,
  NOTIFICATION_TEMPLATE_SPECS,
} from '../../notifications/notification-seed-specs';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSION_CATALOG } from '../../users/rbac/permission-catalog';
import { MASTER_DATA_SPECS, withDisplayOrder } from './master-data-specs';
import {
  CORE_ROLE_GRANTS,
  CORE_ROLE_SPECS,
  roleDisplayName,
} from './role-specs';

/** Everything a caller must supply to stand up a new organization. */
export interface ProvisionOrganizationInput {
  orgName: string;
  /** Canonical (already uppercased) organization code. */
  orgCode: string;
  adminName: string;
  adminMobile: string;
  /**
   * Already hashed by the caller. This service never sees a plaintext password
   * — hashing is deliberately done before the transaction opens, because
   * argon2 costs ~19 MiB and a few hundred milliseconds of CPU and holding a
   * database transaction open across it is pure waste.
   */
  adminPasswordHash: string;
  /** Defaults to MAIN / Head Office. The seed overrides these for BR001. */
  branchCode?: string;
  branchName?: string;
}

export interface ProvisionedOrganization {
  orgId: string;
  orgCode: string;
  branchId: string;
  userId: string;
  counts: {
    permissions: number;
    roles: number;
    grants: number;
    masterDataValues: number;
    accounts: number;
    templates: number;
    eventRules: number;
  };
}

const DEFAULT_BRANCH_CODE = 'MAIN';
const DEFAULT_BRANCH_NAME = 'Head Office';

/**
 * A branch row needs an address and the columns are NOT NULL, but signup
 * deliberately does not ask for one — five fields is the whole point of the
 * form. The placeholder is visible rather than blank so it reads as unfinished
 * wherever it surfaces, and the dashboard prompts the new administrator to
 * complete it.
 */
const PLACEHOLDER_ADDRESS = 'Not set';
const PLACEHOLDER_PINCODE = '000000';

/**
 * Stands up a new organization with everything it needs to be usable, and
 * nothing it does not.
 *
 * "Usable" is a specific claim: 167 permissions, the three core roles and their
 * grants, 26 master-data values, 8 ledger accounts, 16 notification templates,
 * 14 event rules, one branch and one Super Admin. No customers, products,
 * schemes or loans — those are the new organization's own work.
 *
 * Every piece is load-bearing rather than decorative. An organization without
 * its ledger accounts signs in perfectly well and then fails at the first
 * disbursal with a 409 from `LedgerService.requireActiveAccount`; one without
 * master data renders empty gender and document-type dropdowns and cannot
 * register a customer at all. That is why this runs as a single transaction:
 * the half-provisioned organization is the failure mode worth designing out.
 */
@Injectable()
export class OrganizationProvisioningService {
  private readonly logger = new Logger(OrganizationProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Provisions an organization in one transaction and records its creation.
   *
   * @param timeoutMs Interactive-transaction budget. The work is ~12 statements
   *   rather than the ~470 a per-row loop would issue, so the default is
   *   headroom for a cold pool rather than a figure the writes need.
   */
  async provision(
    input: ProvisionOrganizationInput,
    meta: RequestMeta,
    timeoutMs = 30_000,
  ): Promise<ProvisionedOrganization> {
    const result = await this.prisma
      .$transaction(
        async (tx) => {
          const provisioned = await this.provisionWithin(tx, input);

          // Written inside the transaction, and last, so an organization's
          // audit trail cannot begin with a gap where its own creation was.
          //
          // The objection recorded against organization-create in
          // OPEN-QUESTIONS §8 — that it would have no orgId to scope its audit
          // row against — describes a cross-tenant administrator, who belongs
          // to a different organization than the one being created. It does not
          // apply here: this path mints the actor itself, moments earlier, in
          // this same transaction. Both halves of the composite actor key exist
          // by the time the row is written.
          await this.audit.record(
            {
              orgId: provisioned.orgId,
              branchId: provisioned.branchId,
              actorUserId: provisioned.userId,
              action: AuditAction.ORG_SIGNUP_COMPLETED,
              entityType: 'ORGANIZATION',
              entityId: provisioned.orgId,
              requestId: meta.requestId ?? undefined,
              ipAddress: meta.ipAddress ?? undefined,
              userAgent: meta.userAgent ?? undefined,
              metadata: {
                orgCode: provisioned.orgCode,
                ...provisioned.counts,
              },
            },
            tx,
          );

          return provisioned;
        },
        { timeout: timeoutMs, maxWait: 10_000 },
      )
      .catch((error: unknown) => {
        throw this.translateProvisioningError(error, input.orgCode);
      });

    this.logger.log(
      `Provisioned organization ${result.orgCode} (${result.orgId}) with ` +
        `${result.counts.permissions} permissions and ${result.counts.grants} grants`,
    );

    return result;
  }

  /**
   * The provisioning body, callable inside a caller-supplied transaction so a
   * caller with its own writes to make can compose them atomically with these.
   *
   * Create-only by design. A brand-new organization has no rows to reconcile,
   * so upsert semantics would buy nothing and cost 470 round-trips where 12 do.
   */
  async provisionWithin(
    tx: Prisma.TransactionClient,
    input: ProvisionOrganizationInput,
  ): Promise<ProvisionedOrganization> {
    const orgCode = input.orgCode;

    // A courtesy, not the guarantee. The unique index is what actually decides
    // the race; this just spares the common case a rolled-back transaction.
    const existing = await tx.organization.findUnique({
      where: { code: orgCode },
      select: { orgId: true },
    });
    if (existing) {
      throw new ConflictException(
        `The organization code "${orgCode}" is already taken. Choose another.`,
      );
    }

    const organization = await tx.organization.create({
      data: {
        code: orgCode,
        name: input.orgName,
        status: 'ACTIVE',
      },
      select: { orgId: true },
    });
    const orgId = organization.orgId;

    const branch = await tx.branch.create({
      data: {
        orgId,
        code: input.branchCode ?? DEFAULT_BRANCH_CODE,
        name: input.branchName ?? DEFAULT_BRANCH_NAME,
        addressLine1: PLACEHOLDER_ADDRESS,
        city: PLACEHOLDER_ADDRESS,
        state: PLACEHOLDER_ADDRESS,
        pincode: PLACEHOLDER_PINCODE,
        status: 'ACTIVE',
      },
      select: { branchId: true },
    });

    // --- Permissions ------------------------------------------------------
    // Per-organization rows, not a global catalog. An organization with none
    // has no role able to grant anything, which locks its own administrator
    // out of their tenant.
    const permissions = await tx.permission.createManyAndReturn({
      data: PERMISSION_CATALOG.map((spec) => ({ orgId, ...spec })),
      select: { permissionId: true, code: true },
    });
    const permissionIdByCode = new Map(
      permissions.map((row) => [row.code, row.permissionId]),
    );

    // --- Roles ------------------------------------------------------------
    const roles = await tx.role.createManyAndReturn({
      data: CORE_ROLE_SPECS.map((spec) => ({
        orgId,
        code: spec.code,
        name: roleDisplayName(spec.code),
        status: spec.status,
        isSystem: spec.isSystem,
      })),
      select: { roleId: true, code: true },
    });
    const roleIdByCode = new Map(roles.map((row) => [row.code, row.roleId]));

    // --- Role grants ------------------------------------------------------
    const grantRows: Array<{
      orgId: string;
      roleId: string;
      permissionId: string;
    }> = [];
    for (const [roleCode, permissionCodes] of Object.entries(
      CORE_ROLE_GRANTS,
    )) {
      const roleId = roleIdByCode.get(roleCode);
      if (!roleId) {
        throw new Error(
          `Provisioning bug: role ${roleCode} has grants but no spec.`,
        );
      }

      for (const permissionCode of permissionCodes) {
        const permissionId = permissionIdByCode.get(permissionCode);
        if (!permissionId) {
          // Guarded by `role-specs.spec.ts`, so this should be unreachable —
          // but an unguarded undefined here would surface to a real user as an
          // opaque 503 rather than as the configuration fault it is.
          throw new Error(
            `Provisioning bug: ${roleCode} grants unknown permission ${permissionCode}.`,
          );
        }
        grantRows.push({ orgId, roleId, permissionId });
      }
    }
    await tx.rolePermission.createMany({ data: grantRows });

    // --- Master data ------------------------------------------------------
    const masterData = withDisplayOrder(MASTER_DATA_SPECS);
    await tx.masterDataValue.createMany({
      data: masterData.map((spec) => ({
        orgId,
        category: spec.category,
        code: spec.code,
        label: spec.label,
        displayOrder: spec.displayOrder,
        status: 'ACTIVE' as const,
        isSystem: true,
      })),
    });

    // --- Chart of accounts ------------------------------------------------
    // Without these the organization posts nothing: the first disbursal or
    // collection fails in the ledger rather than at a validation.
    await tx.account.createMany({
      data: LEDGER_ACCOUNT_SPECS.map((spec) => ({
        orgId,
        accountCode: spec.accountCode,
        accountName: spec.accountName,
        accountType: spec.accountType,
        normalBalance: spec.normalBalance,
        status: 'ACTIVE' as const,
        isManualPostingAllowed: spec.isManualPostingAllowed,
        isControlAccount: spec.isControlAccount,
      })),
    });

    // --- Notification templates -------------------------------------------
    // Templates before rules: a rule carries a RESTRICT foreign key to one, so
    // an out-of-order insert fails rather than silently pointing at nothing.
    const templates = await tx.notificationTemplate.createManyAndReturn({
      data: NOTIFICATION_TEMPLATE_SPECS.map((spec) => ({
        orgId,
        code: spec.code,
        name: spec.name,
        category: spec.category,
        sourceModule: spec.sourceModule,
        eventType: spec.eventType as never,
        channel: spec.channel,
        subject: spec.subject ?? null,
        titleTemplate: spec.titleTemplate ?? null,
        body: spec.body,
        containsPii: spec.containsPii,
        status: 'ACTIVE' as const,
        // Rule 33: editable, never deletable. An organization that deleted its
        // own approval template would stop notifying approvers, and the failure
        // would look like a delivery bug.
        isSystem: true,
      })),
      select: { templateId: true, code: true, channel: true },
    });
    const templateIdByKey = new Map(
      templates.map((row) => [`${row.code}:${row.channel}`, row.templateId]),
    );

    // --- Notification event rules -----------------------------------------
    const ruleRows = NOTIFICATION_RULE_SPECS.map((spec) => {
      const key = `${spec.templateCode}:${spec.channel}`;
      const templateId = templateIdByKey.get(key);
      if (!templateId) {
        throw new Error(
          `Provisioning bug: event rule "${spec.name}" names template ${key}, which is not seeded.`,
        );
      }

      return {
        orgId,
        name: spec.name,
        // Null: organization-wide, which is the wider authority. A branch that
        // wants its own adds one.
        branchId: null,
        eventType: spec.eventType as never,
        sourceModule: spec.sourceModule,
        sourceTrigger: spec.sourceTrigger,
        recipientStrategy: spec.recipientStrategy,
        recipientRoleCode: spec.recipientRoleCode ?? null,
        recipientPermissionCode: spec.recipientPermissionCode ?? null,
        explicitRecipientUserIds: [],
        channel: spec.channel,
        templateId,
        priority: spec.priority,
        isMandatory: spec.isMandatory,
        isActive: true,
      };
    });
    await tx.notificationEventRule.createMany({ data: ruleRows });

    // --- The first Super Admin --------------------------------------------
    // `branchId: null` means organization-wide rather than "no branch": a Super
    // Admin confined to the branch they happened to create would be unable to
    // administer the second one.
    const user = await tx.user.create({
      data: {
        orgId,
        branchId: null,
        name: input.adminName,
        mobile: input.adminMobile,
        passwordHash: input.adminPasswordHash,
        status: 'ACTIVE',
        passwordChangedAt: new Date(),
      },
      select: { userId: true },
    });

    const superAdminRoleId = roleIdByCode.get('SUPER_ADMIN');
    if (!superAdminRoleId) {
      throw new Error('Provisioning bug: SUPER_ADMIN role was not created.');
    }
    await tx.userRole.create({
      data: { orgId, userId: user.userId, roleId: superAdminRoleId },
    });

    return {
      orgId,
      orgCode,
      branchId: branch.branchId,
      userId: user.userId,
      counts: {
        permissions: permissions.length,
        roles: roles.length,
        grants: grantRows.length,
        masterDataValues: masterData.length,
        accounts: LEDGER_ACCOUNT_SPECS.length,
        templates: templates.length,
        eventRules: ruleRows.length,
      },
    };
  }

  /**
   * Turns a unique-constraint violation into the 409 it is.
   *
   * Without this the global exception filter collapses it into a 503 reading
   * "Authentication service is temporarily unavailable", which for a taken
   * organization code is wrong in every particular and sends the user away
   * instead of to the one field they can fix.
   */
  private translateProvisioningError(error: unknown, orgCode: string): unknown {
    if (typeof error !== 'object' || error === null) return error;
    if ((error as { code?: unknown }).code !== 'P2002') return error;

    // Every other unique constraint in this transaction is scoped to the
    // organization we just minted and cannot collide, so the code is the only
    // realistic cause. Deliberately not narrowed on `meta.target`: a 409 that
    // is slightly wrong beats a 503 that is entirely wrong, and the detail is
    // in the log either way.
    this.logger.warn(`Signup rejected: organization code ${orgCode} is taken`);
    return new ConflictException(
      `The organization code "${orgCode}" is already taken. Choose another.`,
    );
  }
}
