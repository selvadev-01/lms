import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type {
  DeliveryAttempt,
  DeliveryMonitorResult,
  NotificationEventRuleDetail,
  NotificationEventRuleListResult,
  NotificationTemplateDetail,
  NotificationTemplateListResult,
} from '@lms/types';

import type { RequestMeta } from '../../auth/auth.service';
import type { AuthContext } from '../../common/auth-context';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateRuleDto,
  CreateTemplateDto,
  ListDeliveriesDto,
  ListRulesDto,
  ListTemplatesDto,
  RetryDeliveryDto,
  UpdateRuleDto,
  UpdateTemplateDto,
} from '../dto/notifications.dto';
import {
  DELIVERIES_RETRY_PERMISSION,
  DELIVERIES_VIEW_PERMISSION,
  NotificationDeliveryService,
} from './notification-delivery.service';
import {
  NotificationRuleService,
  RULES_DELETE_PERMISSION,
  RULES_MANAGE_PERMISSION,
  RULES_VIEW_PERMISSION,
} from './notification-rule.service';
import {
  NotificationTemplateService,
  TEMPLATES_DELETE_PERMISSION,
  TEMPLATES_MANAGE_PERMISSION,
  TEMPLATES_VIEW_PERMISSION,
} from './notification-template.service';

/**
 * The three administrative surfaces, in one file.
 *
 * Three controllers rather than one, because they carry different permissions
 * and Nest resolves a permission per handler — but one file, because they are
 * one screen's worth of concern and Module 13 set the precedent with its
 * recovery-case controllers.
 *
 * # The permission split is what makes the scenarios provable
 *
 * Every surface separates view / manage / delete, and Delivery Monitoring
 * separates view / retry. That is not symmetry for its own sake: Scenario 11
 * needs a role that can edit a template and is refused its deletion, Scenario
 * 41 one that can read rules and not write them, and Scenario 45 one that can
 * see a failed delivery and cannot retry it. A merged `manage` on any of the
 * three would make the corresponding scenario untestable.
 *
 * The seed withholds exactly those acting permissions from Branch Admin, which
 * is what gives the e2e suite an account to prove them with.
 */

// --- Templates ---------------------------------------------------------------

@Controller('admin/notifications/templates')
export class NotificationTemplateController {
  constructor(private readonly templates: NotificationTemplateService) {}

  @Get()
  @RequirePermissions(TEMPLATES_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListTemplatesDto,
    @Req() req: Request,
  ): Promise<NotificationTemplateListResult> {
    return this.templates.list(user, query, this.meta(req));
  }

  @Get(':templateId')
  @RequirePermissions(TEMPLATES_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('templateId', new ParseUUIDPipe({ version: '4' }))
    templateId: string,
    @Req() req: Request,
  ): Promise<NotificationTemplateDetail> {
    return this.templates.detail(user, templateId, this.meta(req));
  }

  /** Scenario 6, with Scenario 7's duplicate refusal. */
  @Post()
  @RequirePermissions(TEMPLATES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateTemplateDto,
    @Req() req: Request,
  ): Promise<NotificationTemplateDetail> {
    return this.templates.create(user, dto, this.meta(req));
  }

  /**
   * Scenario 8.
   *
   * Bumps the version; never rewrites a notification already created from this
   * template.
   */
  @Put(':templateId')
  @RequirePermissions(TEMPLATES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  update(
    @CurrentUser() user: AuthContext,
    @Param('templateId', new ParseUUIDPipe({ version: '4' }))
    templateId: string,
    @Body() dto: UpdateTemplateDto,
    @Req() req: Request,
  ): Promise<NotificationTemplateDetail> {
    return this.templates.update(user, templateId, dto, this.meta(req));
  }

  @Patch(':templateId/activate')
  @RequirePermissions(TEMPLATES_MANAGE_PERMISSION)
  activate(
    @CurrentUser() user: AuthContext,
    @Param('templateId', new ParseUUIDPipe({ version: '4' }))
    templateId: string,
    @Req() req: Request,
  ): Promise<NotificationTemplateDetail> {
    return this.templates.setStatus(user, templateId, 'ACTIVE', this.meta(req));
  }

  /** Scenario 10: the sanctioned way to retire a referenced template. */
  @Patch(':templateId/deactivate')
  @RequirePermissions(TEMPLATES_MANAGE_PERMISSION)
  deactivate(
    @CurrentUser() user: AuthContext,
    @Param('templateId', new ParseUUIDPipe({ version: '4' }))
    templateId: string,
    @Req() req: Request,
  ): Promise<NotificationTemplateDetail> {
    return this.templates.setStatus(
      user,
      templateId,
      'INACTIVE',
      this.meta(req),
    );
  }

  /** Scenario 48, refused per Scenario 11 when anything references it. */
  @Delete(':templateId')
  @RequirePermissions(TEMPLATES_DELETE_PERMISSION)
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthContext,
    @Param('templateId', new ParseUUIDPipe({ version: '4' }))
    templateId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.templates.remove(user, templateId, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return meta(req);
  }
}

// --- Event rules -------------------------------------------------------------

@Controller('admin/notifications/rules')
export class NotificationRuleController {
  constructor(private readonly rules: NotificationRuleService) {}

  @Get()
  @RequirePermissions(RULES_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListRulesDto,
    @Req() req: Request,
  ): Promise<NotificationEventRuleListResult> {
    return this.rules.list(user, query, this.meta(req));
  }

  @Get(':ruleId')
  @RequirePermissions(RULES_VIEW_PERMISSION)
  detail(
    @CurrentUser() user: AuthContext,
    @Param('ruleId', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Req() req: Request,
  ): Promise<NotificationEventRuleDetail> {
    return this.rules.detail(user, ruleId, this.meta(req));
  }

  /** Scenario 14, with Scenario 15's refusal of an unsupported pairing. */
  @Post()
  @RequirePermissions(RULES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  create(
    @CurrentUser() user: AuthContext,
    @Body() dto: CreateRuleDto,
    @Req() req: Request,
  ): Promise<NotificationEventRuleDetail> {
    return this.rules.create(user, dto, this.meta(req));
  }

  @Put(':ruleId')
  @RequirePermissions(RULES_MANAGE_PERMISSION)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  update(
    @CurrentUser() user: AuthContext,
    @Param('ruleId', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Body() dto: UpdateRuleDto,
    @Req() req: Request,
  ): Promise<NotificationEventRuleDetail> {
    return this.rules.update(user, ruleId, dto, this.meta(req));
  }

  @Patch(':ruleId/deactivate')
  @RequirePermissions(RULES_MANAGE_PERMISSION)
  deactivate(
    @CurrentUser() user: AuthContext,
    @Param('ruleId', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Req() req: Request,
  ): Promise<NotificationEventRuleDetail> {
    return this.rules.setActive(user, ruleId, false, this.meta(req));
  }

  @Patch(':ruleId/activate')
  @RequirePermissions(RULES_MANAGE_PERMISSION)
  activate(
    @CurrentUser() user: AuthContext,
    @Param('ruleId', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Req() req: Request,
  ): Promise<NotificationEventRuleDetail> {
    return this.rules.setActive(user, ruleId, true, this.meta(req));
  }

  @Delete(':ruleId')
  @RequirePermissions(RULES_DELETE_PERMISSION)
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthContext,
    @Param('ruleId', new ParseUUIDPipe({ version: '4' })) ruleId: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.rules.remove(user, ruleId, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return meta(req);
  }
}

// --- Delivery monitoring -----------------------------------------------------

@Controller('admin/notifications/deliveries')
export class NotificationDeliveryController {
  constructor(private readonly deliveries: NotificationDeliveryService) {}

  /**
   * Scenario 40.
   *
   * Message bodies appear only for a caller who also holds
   * `notifications.view` — Rule 55 controls content by permission, not by
   * channel alone.
   */
  @Get()
  @RequirePermissions(DELIVERIES_VIEW_PERMISSION)
  list(
    @CurrentUser() user: AuthContext,
    @Query() query: ListDeliveriesDto,
    @Req() req: Request,
  ): Promise<DeliveryMonitorResult> {
    return this.deliveries.list(user, query, this.meta(req));
  }

  /** Rule 15: the attempt history, separately from the logical notification. */
  @Get(':notificationId/attempts')
  @RequirePermissions(DELIVERIES_VIEW_PERMISSION)
  attempts(
    @CurrentUser() user: AuthContext,
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @Req() req: Request,
  ): Promise<DeliveryAttempt[]> {
    return this.deliveries.attempts(user, notificationId, this.meta(req));
  }

  /**
   * Scenario 45.
   *
   * A separate permission from viewing, so an account can reach this screen and
   * be refused the action. Throttled because a retry costs a provider call, and
   * because a stuck client should not be able to hammer a failing gateway.
   */
  @Post(':notificationId/retry')
  @RequirePermissions(DELIVERIES_RETRY_PERMISSION)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  retry(
    @CurrentUser() user: AuthContext,
    @Param('notificationId', new ParseUUIDPipe({ version: '4' }))
    notificationId: string,
    @Body() dto: RetryDeliveryDto,
    @Req() req: Request,
  ): Promise<{ queued: boolean }> {
    return this.deliveries.retry(user, notificationId, dto, this.meta(req));
  }

  private meta(req: Request): RequestMeta {
    return meta(req);
  }
}

/** Shared by the three controllers above, which are one screen's concern. */
function meta(req: Request): RequestMeta {
  return {
    requestId: (req as Request & { requestId?: string }).requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}
