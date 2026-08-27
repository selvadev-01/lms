import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

/** One user a notification will be addressed to. */
export interface ResolvedRecipient {
  userId: string;
  name: string;
  email: string | null;
  mobile: string | null;
  /** The user's own branch; null means organization-wide authority. */
  branchId: string | null;
  /**
   * What roles the user held at resolution time (Rule 3). Stored on the
   * notification as the evidence of what point-in-time resolution actually saw,
   * so a later role change does not rewrite the history of who was notified and
   * why.
   */
  roleSnapshot: string;
}

/** The parts of a rule this service reads. */
export interface RecipientRule {
  recipientStrategy: string;
  recipientRoleCode: string | null;
  recipientPermissionCode: string | null;
  explicitRecipientUserIds: string[];
}

/** The parts of an event this service reads. */
export interface RecipientEvent {
  orgId: string;
  branchId: string | null;
  sourceModule: string;
  sourceRecordId: string | null;
}

/**
 * Where each source module keeps its assignee and its owner.
 *
 * A table rather than a `switch` so that adding a module is a data change, and
 * so the set of supported modules is readable in one place.
 *
 * `assignee` is null where the concept does not exist — a disbursement is not
 * assigned to anyone — and a rule using ASSIGNED_USER against such a module
 * resolves nobody rather than silently falling back to the owner. Falling back
 * would send a notification to someone the rule did not name, which Scenario 53
 * forbids in the same breath as sending to an arbitrary user.
 */
const SOURCE_ACCESSORS: Readonly<
  Record<
    string,
    {
      delegate: string;
      idField: string;
      assignee: string | null;
      owner: string | null;
    }
  >
> = {
  recovery: {
    delegate: 'recoveryCase',
    idField: 'recoveryCaseId',
    assignee: 'assignedAgentId',
    owner: 'createdBy',
  },
  loan_application: {
    delegate: 'loanApplication',
    idField: 'applicationId',
    assignee: null,
    owner: 'createdBy',
  },
  approval: {
    delegate: 'loanApplication',
    idField: 'applicationId',
    assignee: null,
    owner: 'createdBy',
  },
  loan: {
    delegate: 'loan',
    idField: 'loanId',
    assignee: null,
    owner: 'createdBy',
  },
  disbursal: {
    delegate: 'disbursement',
    idField: 'disbursementId',
    assignee: null,
    owner: 'createdBy',
  },
  collection: {
    delegate: 'collection',
    idField: 'collectionId',
    assignee: 'collectorUserId',
    owner: 'collectorUserId',
  },
  field_collection: {
    delegate: 'fieldAssignment',
    idField: 'assignmentId',
    assignee: 'fieldAgentId',
    owner: 'createdBy',
  },
};

/**
 * Turns a rule and an event into the users to notify (Rule 42).
 *
 * # Every strategy ends in the same two filters
 *
 * That is the whole reason resolution is centralised rather than inlined per
 * strategy. Whichever way a candidate was found, they must be:
 *
 *  * **ACTIVE** (Rules 43, 44; Scenario 54). A deactivated user receives no new
 *    notification, full stop.
 *  * **within the event's branch** (Rules 3, 4; Scenario 40). A user carrying a
 *    `branchId` sees only events in that branch or organization-wide ones; a
 *    user with `branchId: null` holds organization-wide authority and sees
 *    everything in the organization.
 *
 * Five strategies times two filters is ten places to forget one. Applying them
 * once, at the end, is what makes "a deactivated user was notified" impossible
 * rather than merely unlikely.
 *
 * # Assignments are read live, not from the payload
 *
 * ASSIGNED_USER and RECORD_OWNER query the source row at processing time.
 * Scenario 16 asks for the recipient to come from the authoritative assignment,
 * and an assignment can change between the event being raised and being
 * processed — a case reassigned in that window must notify whoever holds it
 * now, not whoever held it then.
 *
 * # There is no fallback
 *
 * A strategy that resolves nobody returns an empty array, and the caller
 * records that and sends nothing. Falling back to an administrator would be
 * sending a notification to an arbitrary user, which Scenario 53 refuses
 * explicitly.
 */
@Injectable()
export class RecipientResolverService {
  private readonly logger = new Logger(RecipientResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    rule: RecipientRule,
    event: RecipientEvent,
  ): Promise<ResolvedRecipient[]> {
    const candidateIds = await this.candidates(rule, event);
    if (candidateIds.length === 0) return [];

    return this.loadEligible(event, candidateIds);
  }

  /**
   * The user ids a strategy names, before eligibility is applied.
   *
   * Deliberately returns ids rather than users: every strategy then goes
   * through one loader, so the ACTIVE and branch filters cannot be applied
   * inconsistently between them.
   */
  private async candidates(
    rule: RecipientRule,
    event: RecipientEvent,
  ): Promise<string[]> {
    switch (rule.recipientStrategy) {
      case 'ROLE':
        return this.byRole(event.orgId, rule.recipientRoleCode);
      case 'BRANCH_USER_GROUP':
        return this.byPermission(event.orgId, rule.recipientPermissionCode);
      case 'EXPLICIT':
        return rule.explicitRecipientUserIds ?? [];
      case 'ASSIGNED_USER':
        return this.fromSource(event, 'assignee');
      case 'RECORD_OWNER':
        return this.fromSource(event, 'owner');
      default:
        // A strategy the database allows and this service does not implement.
        // Logged and resolved to nobody rather than throwing: an unrecognised
        // strategy must not take down the ingestion worker for every other rule.
        this.logger.error(
          `Unknown recipient strategy "${rule.recipientStrategy}"; resolved nobody.`,
        );
        return [];
    }
  }

  private async byRole(
    orgId: string,
    roleCode: string | null,
  ): Promise<string[]> {
    if (!roleCode) return [];

    const rows = await this.prisma.userRole.findMany({
      where: { orgId, role: { code: roleCode } },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /**
   * Every user in the organization whose roles carry a permission.
   *
   * Resolved through role grants rather than by asking an authorization service
   * per user: this runs once per rule, and the alternative is one permission
   * resolution per candidate.
   *
   * The branch narrowing happens in the shared filter, not here — that is what
   * makes BRANCH_USER_GROUP mean "in this event's branch" without this method
   * having to know about the event at all.
   */
  private async byPermission(
    orgId: string,
    permissionCode: string | null,
  ): Promise<string[]> {
    if (!permissionCode) return [];

    const rows = await this.prisma.userRole.findMany({
      where: {
        orgId,
        role: {
          // An inactive role grants nothing, so a user whose only route to the
          // permission is a deactivated role is correctly not a candidate.
          status: 'ACTIVE',
          rolePermissions: { some: { permission: { code: permissionCode } } },
        },
      },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  /**
   * The assignee or owner recorded on the source row, read now.
   *
   * Returns nobody when the module is unmapped, the record is gone, or the
   * field is null — all three are "this rule names no one", which the caller
   * records as an unresolved recipient rather than treating as an error.
   */
  private async fromSource(
    event: RecipientEvent,
    role: 'assignee' | 'owner',
  ): Promise<string[]> {
    const accessor = SOURCE_ACCESSORS[event.sourceModule];
    if (!accessor || !event.sourceRecordId) return [];

    const field = accessor[role];
    if (!field) return [];

    const delegate = (
      this.prisma as unknown as Record<
        string,
        {
          findUnique: (args: {
            where: Record<string, unknown>;
            select: Record<string, boolean>;
          }) => Promise<Record<string, string | null> | null>;
        }
      >
    )[accessor.delegate];
    if (!delegate) return [];

    try {
      const row = await delegate.findUnique({
        where: {
          [`orgId_${accessor.idField}`]: {
            orgId: event.orgId,
            [accessor.idField]: event.sourceRecordId,
          },
        },
        select: { [field]: true },
      });

      const userId = row?.[field];
      return userId ? [userId] : [];
    } catch (error) {
      this.logger.error(
        `Could not read ${role} from ${event.sourceModule}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  /**
   * Load the candidates that are actually eligible, applying both filters.
   *
   * The branch predicate is expressed in the query rather than in JavaScript so
   * that a large ROLE or BRANCH_USER_GROUP fan-out does not load an
   * organization's whole user table to discard most of it — and so the rule is
   * enforced by the database rather than by a filter someone can forget.
   */
  private async loadEligible(
    event: RecipientEvent,
    candidateIds: string[],
  ): Promise<ResolvedRecipient[]> {
    // Deduplicated before the query: a user matching a rule two ways gets one
    // notification, not two. Rule 11 permits several *deliveries* of one event,
    // not duplicate logical notifications to the same person.
    const unique = [...new Set(candidateIds)];

    const users = await this.prisma.user.findMany({
      where: {
        orgId: event.orgId,
        userId: { in: unique },
        // Rules 43, 44 and Scenario 54.
        status: 'ACTIVE',
        // Rules 3, 4 and Scenario 40. A branch-scoped user receives only their
        // own branch's events; a null-branch user is organization-wide.
        ...(event.branchId
          ? { OR: [{ branchId: event.branchId }, { branchId: null }] }
          : {}),
      },
      select: {
        userId: true,
        name: true,
        email: true,
        mobile: true,
        branchId: true,
        userRoles: { select: { role: { select: { code: true } } } },
      },
    });

    return users.map((user) => ({
      userId: user.userId,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      branchId: user.branchId,
      roleSnapshot: user.userRoles
        .map((assignment) => assignment.role.code)
        .sort()
        .join(','),
    }));
  }
}
