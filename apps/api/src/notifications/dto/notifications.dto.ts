import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { trim } from '../../common/transforms/trim';
import { NOTIFICATION_LIMITS } from '../notification-policy';

/**
 * Module 16 — notification DTOs.
 *
 * # Three absences are the security model
 *
 * **No `recipientUserId`, anywhere.** The notification centre always reads the
 * caller's own rows, taken from the JWT. Scenario 1 requires that User A never
 * sees User B's notifications, and a filter field would be a way to ask for
 * them. `forbidNonWhitelisted` in `main.ts` turns an attempt to send one into a
 * 400 rather than a silent ignore.
 *
 * **No `userId` on the preferences DTO.** Rules 49 and 50 scope preferences to
 * the authenticated user, and Scenario 19 requires User A cannot edit User B's.
 * The route has no slot for a user either — which makes that structural rather
 * than a permission check someone could remove.
 *
 * **No `orgId`.** It comes from the JWT on every surface in this application.
 *
 * `branchId` appears on exactly one DTO — rule configuration — and only as a
 * *request* the server may narrow or refuse (Rules 34, 41; Scenario 41).
 *
 * # These classes must be value imports
 *
 * Not `import type`. The global `ValidationPipe` reads the runtime class through
 * `reflect-metadata`, and a type-only import is erased at compile time, leaving
 * a controller whose body is never validated at all.
 */

const CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const;

const EVENT_TYPES = [
  'APPLICATION_SUBMITTED',
  'APPLICATION_RETURNED',
  'APPLICATION_REJECTED',
  'APPROVAL_REQUESTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'APPROVAL_ESCALATED',
  'LOAN_APPROVED',
  'LOAN_REJECTED',
  'DISBURSAL_COMPLETED',
  'DISBURSAL_FAILED',
  'EMI_DUE_TOMORROW',
  'EMI_DUE_TODAY',
  'EMI_MISSED',
  'EMI_OVERDUE',
  'EMI_PARTIALLY_PAID',
  'EMI_PAID',
  'PENALTY_ADDED',
  'RECEIPT_GENERATED',
  'RECEIPT_POSTED',
  'RECEIPT_REVERSED',
  'FIELD_SYNC_EXCEPTION',
  'CASH_SHORTAGE',
  'CASH_EXCESS',
  'RECOVERY_ASSIGNED',
  'PROMISE_TO_PAY_REMINDER',
  'PROMISE_TO_PAY_MISSED',
  'LOAN_FORECLOSED',
  'LOAN_CLOSED',
  'LOAN_WRITTEN_OFF',
  'NPA_STATE_CHANGED',
  'SECURITY_ALERT',
] as const;

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;

const TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;

const RECIPIENT_STRATEGIES = [
  'ROLE',
  'ASSIGNED_USER',
  'RECORD_OWNER',
  'BRANCH_USER_GROUP',
  'EXPLICIT',
] as const;

const DELIVERY_STATUSES = [
  'PENDING',
  'ACCEPTED_BY_PROVIDER',
  'DELIVERED',
  'FAILED',
  'RETRY_SCHEDULED',
  'PERMANENT_FAILURE',
] as const;

const PREFERENCE_CATEGORIES = [
  'APPLICATION',
  'APPROVAL',
  'DISBURSAL',
  'EMI',
  'COLLECTION',
  'FIELD_COLLECTION',
  'OVERDUE',
  'RECOVERY',
  'SECURITY',
] as const;

/** `YYYY-MM-DD`, Asia/Kolkata. Rejects `2026-02-31` via the round trip. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- Notification centre -----------------------------------------------------

/** Rule 54 and Scenario 5: the filters a notification list supports. */
export class ListNotificationsDto {
  @IsOptional()
  @IsIn(['ALL', 'READ', 'UNREAD'])
  readStatus?: 'ALL' | 'READ' | 'UNREAD';

  @IsOptional()
  @IsIn(EVENT_TYPES)
  eventType?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  sourceModule?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  /**
   * Archived notifications are excluded unless asked for (Rule 71, Scenario 46).
   * Archiving removes a row from the active list; it never deletes it.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  fromDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE)
  pageSize?: number;
}

// --- Preferences -------------------------------------------------------------

/**
 * The nine category toggles.
 *
 * A nested object rather than nine flat booleans so the shape matches what is
 * stored and what `@lms/types` declares, and so adding a category is one line
 * in three places rather than nine.
 */
export class EventPreferencesDto {
  @IsOptional()
  @IsBoolean()
  APPLICATION?: boolean;

  @IsOptional()
  @IsBoolean()
  APPROVAL?: boolean;

  @IsOptional()
  @IsBoolean()
  DISBURSAL?: boolean;

  @IsOptional()
  @IsBoolean()
  EMI?: boolean;

  @IsOptional()
  @IsBoolean()
  COLLECTION?: boolean;

  @IsOptional()
  @IsBoolean()
  FIELD_COLLECTION?: boolean;

  @IsOptional()
  @IsBoolean()
  OVERDUE?: boolean;

  @IsOptional()
  @IsBoolean()
  RECOVERY?: boolean;

  @IsOptional()
  @IsBoolean()
  SECURITY?: boolean;
}

/**
 * A preference update.
 *
 * Carries no `userId` — see the file header. `version` is required rather than
 * optional-with-a-default: Rules 65 and 66 want a stale update *detected*, and
 * a default would let a client that never read the record silently overwrite a
 * newer change made on another device (Scenarios 21, 51).
 */
export class UpdatePreferencesDto {
  @IsBoolean()
  inAppEnabled!: boolean;

  @IsBoolean()
  emailEnabled!: boolean;

  @IsBoolean()
  smsEnabled!: boolean;

  @IsOptional()
  @Type(() => EventPreferencesDto)
  eventPreferences?: EventPreferencesDto;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

// --- Templates ---------------------------------------------------------------

export class CreateTemplateDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Template Name is required' })
  @MaxLength(150)
  name!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Template Code is required' })
  @MaxLength(100)
  code!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Category is required' })
  @MaxLength(50)
  category!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(50)
  sourceModule!: string;

  @IsIn(EVENT_TYPES, { message: 'Event Type is required' })
  eventType!: string;

  @IsIn(CHANNELS, { message: 'Channel is required' })
  channel!: string;

  @IsIn(TEMPLATE_STATUSES, { message: 'Status is required' })
  status!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  subject?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NOTIFICATION_LIMITS.MAX_TITLE_TEMPLATE_LENGTH)
  titleTemplate?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Message Template is required' })
  @MaxLength(NOTIFICATION_LIMITS.MAX_MESSAGE_TEMPLATE_LENGTH)
  messageTemplate!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(10)
  locale?: string;

  /**
   * Whether rendered output may carry personal or financial detail.
   *
   * Refused on SMS and EMAIL by the service, by the renderer and by a CHECK
   * constraint (Rules 55, 56). Three layers because the failure — customer data
   * leaving on an unencrypted channel — is not recoverable once it happens.
   */
  @IsOptional()
  @IsBoolean()
  containsPii?: boolean;

  @IsOptional()
  @IsIn(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'])
  sensitivity?: string;
}

/**
 * A template edit.
 *
 * `code` and `channel` are deliberately absent: together they are the
 * template's identity (`@@unique([orgId, code, channel])`), and rules reference
 * a template by id. Allowing either to change would silently repoint every rule
 * that names it — Rule 39 and Scenario 8 want history stable, not mutable.
 */
export class UpdateTemplateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Template Name is required' })
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Category is required' })
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(250)
  subject?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(NOTIFICATION_LIMITS.MAX_TITLE_TEMPLATE_LENGTH)
  titleTemplate?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Message Template is required' })
  @MaxLength(NOTIFICATION_LIMITS.MAX_MESSAGE_TEMPLATE_LENGTH)
  messageTemplate?: string;

  @IsOptional()
  @IsBoolean()
  containsPii?: boolean;

  @IsOptional()
  @IsIn(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL'])
  sensitivity?: string;

  /** Optimistic concurrency, as every editable record in this system uses. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ListTemplatesDto {
  @IsOptional()
  @IsIn(TEMPLATE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(CHANNELS)
  channel?: string;

  @IsOptional()
  @IsIn(EVENT_TYPES)
  eventType?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE)
  pageSize?: number;
}

// --- Event rules -------------------------------------------------------------

export class CreateRuleDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Rule Name is required' })
  @MaxLength(150)
  name!: string;

  @IsIn(EVENT_TYPES, { message: 'Event Type is required' })
  eventType!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(50)
  sourceModule!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sourceTrigger!: string;

  /**
   * A request, never an authority.
   *
   * The service narrows it to the caller's own scope and refuses a branch they
   * do not hold (Rules 34, 41; Scenario 41). Null means organization-wide.
   */
  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsIn(RECIPIENT_STRATEGIES, { message: 'Recipient Strategy is required' })
  recipientStrategy!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  recipientRoleCode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  recipientPermissionCode?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  explicitRecipientUserIds?: string[];

  @IsIn(CHANNELS, { message: 'Channel is required' })
  channel!: string;

  @IsUUID('4')
  templateId!: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  /**
   * A mandatory rule ignores personal preferences entirely (Rules 47, 48).
   *
   * Defaults to false: making a notification unsuppressible is a deliberate act,
   * and defaulting the other way would make every new rule mandatory by
   * accident.
   */
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS)
  backoffBaseSeconds?: number;

  @IsOptional()
  @IsBoolean()
  sendImmediately?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-365)
  @Max(365)
  scheduledOffsetDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * A rule edit.
 *
 * `eventType` and `sourceModule` are absent: changing what a rule listens to
 * makes it a different rule, and the notifications already attributed to it
 * would then cite a rule that never produced them.
 */
export class UpdateRuleDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Rule Name is required' })
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsIn(RECIPIENT_STRATEGIES)
  recipientStrategy?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  recipientRoleCode?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  recipientPermissionCode?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  explicitRecipientUserIds?: string[];

  @IsOptional()
  @IsUUID('4')
  templateId?: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxAttempts?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS)
  backoffBaseSeconds?: number;

  @IsOptional()
  @IsBoolean()
  sendImmediately?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-365)
  @Max(365)
  scheduledOffsetDays?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ListRulesDto {
  @IsOptional()
  @IsIn(EVENT_TYPES)
  eventType?: string;

  @IsOptional()
  @IsIn(CHANNELS)
  channel?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE)
  pageSize?: number;
}

// --- Delivery monitoring -----------------------------------------------------

/**
 * Delivery Monitoring's filters.
 *
 * This is the one read that spans recipients, which is why it needs a
 * permission the notification centre does not. `branchId` is a request the
 * service narrows (Scenario 40).
 */
export class ListDeliveriesDto {
  @IsOptional()
  @IsIn(DELIVERY_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(CHANNELS)
  channel?: string;

  @IsOptional()
  @IsIn(EVENT_TYPES)
  eventType?: string;

  @IsOptional()
  @IsUUID('4')
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  fromDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE)
  pageSize?: number;
}

/**
 * A manual retry (Scenario 45).
 *
 * The reason is required because a manual retry overrides an automatic
 * decision, and the audit trail should record who judged the failure transient
 * and why. It does not bypass the attempt cap — Rules 19 and 20 still bound it.
 */
export class RetryDeliveryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Reason is required' })
  @MaxLength(500)
  reason!: string;
}

export { CHANNELS, EVENT_TYPES, ISO_DATE, PREFERENCE_CATEGORIES };
