import { Injectable } from '@nestjs/common';
import type { PermissionSummary } from '@lms/types';

import { AuditAction, AuditService } from '../../audit/audit.service';
import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSION_CATALOG } from './permission-catalog';

export const PERMISSIONS_VIEW_PERMISSION = 'permissions.view';

/**
 * The permission catalog, as the role editor needs it.
 *
 * Read-only by design. Permissions are not user-authored: a permission code only
 * means something because a `@RequirePermissions()` somewhere in the API names
 * it, so allowing one to be created through the API would produce a row that
 * grants nothing and can never grant anything. The catalog changes when the code
 * changes, which is what `PERMISSION_CATALOG` and {@link syncCatalogForOrg} are
 * for.
 */
@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The organization's catalog, each entry flagged with whether the caller may
   * actually grant it.
   *
   * `delegable` is the delegation subset rule (Rule 27) made visible *before* a
   * submit rather than only in its rejection. Without it the editor would offer
   * an administrator checkboxes for permissions they do not hold, and the only
   * feedback would be a 403 after they had composed the whole role.
   */
  async list(
    actor: AuthContext,
    meta: RequestMeta,
  ): Promise<PermissionSummary[]> {
    const rows = await this.prisma.permission.findMany({
      where: { orgId: actor.orgId },
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
      select: {
        code: true,
        module: true,
        action: true,
        description: true,
      },
    });

    const held = new Set(actor.permissions);

    await this.audit.record({
      orgId: actor.orgId,
      action: AuditAction.PERMISSION_CATALOG_VIEWED,
      entityType: 'PERMISSION',
      entityId: null,
      actorUserId: actor.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { count: rows.length },
    });

    return rows.map((row) => ({
      code: row.code,
      module: row.module,
      action: row.action,
      description: row.description ?? undefined,
      delegable: held.has(row.code),
    }));
  }

  /**
   * Brings one organization's permission rows in line with the catalog.
   *
   * Permissions are per-organization (`@@id([orgId, permissionId])`), so a newly
   * created organization starts with none — meaning no role inside it can grant
   * anything and its first administrator is locked out of their own tenant. This
   * is the call that prevents that, and it is why the catalog lives in a shared
   * constant rather than being written out in the seed.
   *
   * Idempotent, and additive only: a code no longer in the catalog is left alone
   * rather than deleted, because deleting it would cascade to `role_permissions`
   * and silently strip roles of a grant during a deploy where two API versions
   * are briefly live.
   */
  async syncCatalogForOrg(
    orgId: string,
    tx?: Pick<PrismaService, 'permission'>,
  ): Promise<number> {
    const client = tx ?? this.prisma;

    for (const spec of PERMISSION_CATALOG) {
      await client.permission.upsert({
        where: { orgId_code: { orgId, code: spec.code } },
        update: {
          module: spec.module,
          action: spec.action,
          description: spec.description,
        },
        create: { orgId, ...spec },
      });
    }

    return PERMISSION_CATALOG.length;
  }
}
