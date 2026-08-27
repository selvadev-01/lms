import { z } from "zod";

import { optionsFrom } from "./options";
import { idSchema, isoDateSchema, optionalText } from "./primitives";

/**
 * Module 16 schemas — notifications.
 *
 * Same cycle-avoiding rule as every other module file: imports reach
 * `./options` and `./primitives` directly, never `./index`.
 *
 * Four things are specific to this module.
 *
 * **Nothing that decides a recipient is accepted from the client.** There is no
 * `recipientUserId` in any schema here, and the preferences schema carries no
 * `userId` at all. Rules 49 and 50 scope preferences to the authenticated user,
 * and Scenario 19 requires that User A cannot edit User B's — expressing that
 * as an absent field rather than as a permission check is what makes it hold
 * structurally. `branchId` appears only on rule configuration, and only as a
 * *request* the server may narrow or refuse (Rules 34, 41; Scenario 41).
 *
 * **Preference updates carry a version.** Rules 65 and 66 require conflict
 * detection rather than last-write-wins, so `version` is required — not
 * optional-with-a-default, which would let a client that never read the record
 * silently overwrite a newer change made on another device (Scenarios 21, 51).
 *
 * **Recipient strategy coherence is a cross-field rule.** A rule naming ROLE
 * without a role code cannot resolve anybody, and the failure appears far from
 * its cause — as an absence of notifications at 2 a.m., not as a validation
 * error. The `.superRefine` below mirrors the `notification_event_rules_strategy_fields`
 * CHECK constraint. The constraint is the guarantee; this is what makes the form
 * say so before the round trip.
 *
 * **These schemas run in the browser.** They are not what guards the API — the
 * DTOs are. A rule written only here is enforced only here, which is why the
 * API's notification DTOs re-express these bounds rather than importing a
 * `.parse` and calling it validation.
 */

// --- Limits ------------------------------------------------------------------

/**
 * Bounds the notification pipeline enforces.
 *
 * Duplicated in `apps/api/src/notifications/notification-policy.ts` and pinned
 * by a test in `notifications.test.ts`. The duplication is not an oversight:
 * `@lms/constants` ships raw ESM with no build step, so the CommonJS Nest build
 * cannot require it. `REPORT_LIMITS`, `auth/session-state.ts` and
 * `field/gps-verification.ts` all carry the same duplication for the same
 * reason.
 */
export const NOTIFICATION_LIMITS = {
  /**
   * Rule 20: permanent failures must not retry indefinitely, so there is a cap
   * at all. Five attempts across the backoff below spans roughly 31 minutes,
   * which outlasts an ordinary provider blip without holding a dead message for
   * hours.
   */
  MAX_ATTEMPTS: 5,
  /**
   * Rule 21: deterministic backoff. `base * 2^(attempt-1)` gives 60, 120, 240,
   * 480, 960 seconds — no jitter, because the rule asks for predictability and
   * a support engineer being able to say when the next attempt lands is worth
   * more here than spreading load.
   */
  BACKOFF_BASE_SECONDS: 60,
  MAX_BACKOFF_SECONDS: 3600,
  LIST_PAGE_SIZE: 25,
  MAX_LIST_PAGE_SIZE: 100,
  /** Sized to fit an SMS segment budget without truncation mid-word. */
  MAX_MESSAGE_TEMPLATE_LENGTH: 2000,
  MAX_TITLE_TEMPLATE_LENGTH: 500,
} as const;

// --- Enums -------------------------------------------------------------------

/**
 * A required `<select>`, where "not chosen" and "not sent" mean the same thing.
 *
 * `z.enum`'s `required_error` fires only on `undefined`, but an untouched
 * `<select>` posts `""` — so without this an unfilled dropdown produces
 * "Invalid enum value. Expected 'IN_APP' | 'EMAIL' | 'SMS', received ''"
 * instead of the message the Mandatory Field Validation table names. The
 * scenario asserts the wording, not merely the refusal, so the raw enum message
 * is a failed scenario that looks like a working form.
 *
 * Wrapping in `preprocess` rather than adding a `.refine` keeps a single issue
 * on the field: a refinement would report both the enum mismatch and the
 * mandatory message, and the form renders the first.
 */
function requiredEnum<T extends [string, ...string[]]>(
  values: T,
  message: string,
) {
  return z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.enum(values, {
      required_error: message,
      invalid_type_error: message,
    }),
  );
}

/**
 * The three channels Module 16 delivers on.
 *
 * The database enum also carries `PUSH` and `AUTO_CALL`, kept only because
 * dropping a Postgres enum value rewrites the type. Neither is selectable: a
 * rule targeting a channel with no provider would accumulate permanent failures
 * instead of failing at configuration time, which is why the API refuses them
 * and a CHECK constraint refuses them again.
 */
const notificationChannelValues = ["IN_APP", "EMAIL", "SMS"] as const;

/** The plain enum, for option registries and for reads where absence is fine. */
export const notificationChannelSchema = z.enum(notificationChannelValues);

/** The form-facing variant: an untouched select must say "Channel is required". */
export const requiredNotificationChannelSchema = requiredEnum(
  [...notificationChannelValues],
  "Channel is required",
);

export const NOTIFICATION_CHANNEL_OPTIONS = optionsFrom(
  notificationChannelSchema.options,
  {
    IN_APP: "In-App",
    EMAIL: "Email",
    SMS: "SMS",
  },
  {
    IN_APP: { hint: "Delivered inside the LMS. Always available." },
    EMAIL: { hint: "Requires SMTP configuration for the organization." },
    SMS: { hint: "Requires an SMS gateway. Content must exclude customer PII." },
  },
);

/** The authoritative source events a rule may listen to (Rule 41). */
export const notificationEventSchema = z.enum([
    "APPLICATION_SUBMITTED",
    "APPLICATION_RETURNED",
    "APPLICATION_REJECTED",
    "APPROVAL_REQUESTED",
    "APPROVAL_APPROVED",
    "APPROVAL_REJECTED",
    "APPROVAL_ESCALATED",
    "LOAN_APPROVED",
    "LOAN_REJECTED",
    "DISBURSAL_COMPLETED",
    "DISBURSAL_FAILED",
    "EMI_DUE_TOMORROW",
    "EMI_DUE_TODAY",
    "EMI_MISSED",
    "EMI_OVERDUE",
    "EMI_PARTIALLY_PAID",
    "EMI_PAID",
    "PENALTY_ADDED",
    "RECEIPT_GENERATED",
    "RECEIPT_POSTED",
    "RECEIPT_REVERSED",
    "FIELD_SYNC_EXCEPTION",
    "CASH_SHORTAGE",
    "CASH_EXCESS",
    "RECOVERY_ASSIGNED",
    "PROMISE_TO_PAY_REMINDER",
    "PROMISE_TO_PAY_MISSED",
    "LOAN_FORECLOSED",
    "LOAN_CLOSED",
    "LOAN_WRITTEN_OFF",
    "NPA_STATE_CHANGED",
    "SECURITY_ALERT",
  ] as const,
);

/** The form-facing variant: an untouched select must say "Event Type is required". */
export const requiredNotificationEventSchema = requiredEnum(
  [...notificationEventSchema.options],
  "Event Type is required",
);

export const NOTIFICATION_EVENT_OPTIONS = optionsFrom(
  notificationEventSchema.options,
  {
    APPLICATION_SUBMITTED: "Application submitted",
    APPLICATION_RETURNED: "Application returned",
    APPLICATION_REJECTED: "Application rejected",
    APPROVAL_REQUESTED: "Approval requested",
    APPROVAL_APPROVED: "Approval approved",
    APPROVAL_REJECTED: "Approval rejected",
    APPROVAL_ESCALATED: "Approval escalated",
    LOAN_APPROVED: "Loan approved",
    LOAN_REJECTED: "Loan rejected",
    DISBURSAL_COMPLETED: "Disbursal completed",
    DISBURSAL_FAILED: "Disbursal failed",
    EMI_DUE_TOMORROW: "EMI due tomorrow",
    EMI_DUE_TODAY: "EMI due today",
    EMI_MISSED: "EMI missed",
    EMI_OVERDUE: "EMI overdue",
    EMI_PARTIALLY_PAID: "EMI partially paid",
    EMI_PAID: "EMI paid",
    PENALTY_ADDED: "Penalty added",
    RECEIPT_GENERATED: "Receipt generated",
    RECEIPT_POSTED: "Receipt posted",
    RECEIPT_REVERSED: "Receipt reversed",
    FIELD_SYNC_EXCEPTION: "Field sync exception",
    CASH_SHORTAGE: "Cash shortage",
    CASH_EXCESS: "Cash excess",
    RECOVERY_ASSIGNED: "Recovery case assigned",
    PROMISE_TO_PAY_REMINDER: "Promise-to-pay reminder",
    PROMISE_TO_PAY_MISSED: "Promise-to-pay missed",
    LOAN_FORECLOSED: "Loan foreclosed",
    LOAN_CLOSED: "Loan closed",
    LOAN_WRITTEN_OFF: "Loan written off",
    NPA_STATE_CHANGED: "NPA state changed",
    SECURITY_ALERT: "Security alert",
  },
);

/**
 * How a rule resolves recipients (Rule 42).
 *
 * ASSIGNED_USER and RECORD_OWNER read the source record itself at processing
 * time rather than a value carried in the event, because Scenario 16 requires
 * the recipient come from the authoritative assignment — which may have changed
 * between the event and its processing.
 */
export const recipientStrategySchema = z.enum([
  "ROLE",
  "ASSIGNED_USER",
  "RECORD_OWNER",
  "BRANCH_USER_GROUP",
  "EXPLICIT",
]);

/** The form-facing variant, for the Mandatory Field Validation table. */
export const requiredRecipientStrategySchema = requiredEnum(
  [...recipientStrategySchema.options],
  "Recipient Strategy is required",
);

export const RECIPIENT_STRATEGY_OPTIONS = optionsFrom(
  recipientStrategySchema.options,
  {
    ROLE: "Every user holding a role",
    ASSIGNED_USER: "The assigned user",
    RECORD_OWNER: "The record owner",
    BRANCH_USER_GROUP: "Every user in the branch holding a permission",
    EXPLICIT: "A named list of users",
  },
  {
    ROLE: { hint: "Requires a role. Inactive users are always excluded." },
    ASSIGNED_USER: {
      hint: "Read from the source record when the event is processed, not when it was raised.",
    },
    RECORD_OWNER: { hint: "Whoever created the source record." },
    BRANCH_USER_GROUP: { hint: "Requires a permission code." },
    EXPLICIT: { hint: "Requires at least one user." },
  },
);

export const notificationPrioritySchema = z.enum([
  "LOW",
  "NORMAL",
  "HIGH",
  "CRITICAL",
]);

export const NOTIFICATION_PRIORITY_OPTIONS = optionsFrom(
  notificationPrioritySchema.options,
  { LOW: "Low", NORMAL: "Normal", HIGH: "High", CRITICAL: "Critical" },
);

export const notificationTemplateStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
]);

/** The form-facing variant, for the Mandatory Field Validation table. */
export const requiredTemplateStatusSchema = requiredEnum(
  [...notificationTemplateStatusSchema.options],
  "Status is required",
);

export const NOTIFICATION_TEMPLATE_STATUS_OPTIONS = optionsFrom(
  notificationTemplateStatusSchema.options,
  { DRAFT: "Draft", ACTIVE: "Active", INACTIVE: "Inactive" },
  {
    INACTIVE: {
      hint: "Cannot be selected for new notifications. Existing history is preserved.",
    },
  },
);

/**
 * The canonical delivery-attempt outcomes (Rule 18).
 *
 * `ACCEPTED_BY_PROVIDER` is the terminal success for EMAIL and SMS. Rule 17 and
 * Scenario 27 are explicit that handing a message to a provider is not delivery,
 * and Module 16 ships no delivery webhooks to learn otherwise — so `DELIVERED`
 * is reachable only for IN_APP, where the LMS itself is the delivery.
 */
export const deliveryStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED_BY_PROVIDER",
  "DELIVERED",
  "FAILED",
  "RETRY_SCHEDULED",
  "PERMANENT_FAILURE",
]);

export const DELIVERY_STATUS_OPTIONS = optionsFrom(deliveryStatusSchema.options, {
  PENDING: "Pending",
  ACCEPTED_BY_PROVIDER: "Accepted by provider",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  RETRY_SCHEDULED: "Retry scheduled",
  PERMANENT_FAILURE: "Permanently failed",
});

/** The logical notification lifecycle. Stops at SENT — see `deliveryStatusSchema`. */
export const notificationStatusSchema = z.enum([
  "CREATED",
  "QUEUED",
  "PROCESSING",
  "SENT",
  "FAILED",
  "RETRYING",
  "SUPPRESSED",
  "ARCHIVED",
]);

export const NOTIFICATION_STATUS_OPTIONS = optionsFrom(
  notificationStatusSchema.options,
  {
    CREATED: "Created",
    QUEUED: "Queued",
    PROCESSING: "Processing",
    SENT: "Sent",
    FAILED: "Failed",
    RETRYING: "Retrying",
    SUPPRESSED: "Suppressed",
    ARCHIVED: "Archived",
  },
);

/**
 * The nine preference categories the specification names.
 *
 * A user toggles a category, not an individual event: nine switches is a screen
 * someone will actually configure, where thirty-two is one they will abandon.
 * Each rule's event maps into exactly one category.
 */
export const preferenceCategorySchema = z.enum([
  "APPLICATION",
  "APPROVAL",
  "DISBURSAL",
  "EMI",
  "COLLECTION",
  "FIELD_COLLECTION",
  "OVERDUE",
  "RECOVERY",
  "SECURITY",
]);

export const PREFERENCE_CATEGORY_OPTIONS = optionsFrom(
  preferenceCategorySchema.options,
  {
    APPLICATION: "Application alerts",
    APPROVAL: "Approval alerts",
    DISBURSAL: "Disbursal alerts",
    EMI: "EMI alerts",
    COLLECTION: "Collection alerts",
    FIELD_COLLECTION: "Field collection alerts",
    OVERDUE: "Overdue alerts",
    RECOVERY: "Recovery alerts",
    SECURITY: "Security alerts",
  },
);

export type PreferenceCategory = z.infer<typeof preferenceCategorySchema>;

// --- Templates ---------------------------------------------------------------

/**
 * Create or edit a notification template.
 *
 * The `required_error` strings are the specification's Mandatory Field
 * Validation table verbatim, because that scenario asserts the message text and
 * not merely that the save was refused.
 */
export const notificationTemplateSchema = z
  .object({
    name: z
      .string({ required_error: "Template Name is required" })
      .trim()
      .min(1, "Template Name is required")
      .max(150, "Template Name must be 150 characters or fewer"),
    code: z
      .string({ required_error: "Template Code is required" })
      .trim()
      .min(1, "Template Code is required")
      .max(100, "Template Code must be 100 characters or fewer")
      .regex(
        /^[A-Z0-9_]+$/,
        "Template Code may contain only uppercase letters, digits and underscores",
      ),
    category: z
      .string({ required_error: "Category is required" })
      .trim()
      .min(1, "Category is required")
      .max(50, "Category must be 50 characters or fewer"),
    sourceModule: z
      .string({ required_error: "Source Module is required" })
      .trim()
      .min(1, "Source Module is required")
      .max(50),
    eventType: requiredNotificationEventSchema,
    channel: requiredNotificationChannelSchema,
    status: requiredTemplateStatusSchema,
    subject: optionalText(250),
    titleTemplate: optionalText(NOTIFICATION_LIMITS.MAX_TITLE_TEMPLATE_LENGTH),
    messageTemplate: z
      .string({ required_error: "Message Template is required" })
      .trim()
      .min(1, "Message Template is required")
      .max(
        NOTIFICATION_LIMITS.MAX_MESSAGE_TEMPLATE_LENGTH,
        `Message Template must be ${NOTIFICATION_LIMITS.MAX_MESSAGE_TEMPLATE_LENGTH} characters or fewer`,
      ),
    locale: z.string().trim().max(10).default("en"),
    containsPii: z.boolean().default(false),
    sensitivity: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL"]).default("INTERNAL"),
  })
  .superRefine((value, ctx) => {
    // Rules 55, 56 and the `notification_templates_pii_channel_policy` CHECK.
    // SMS and email content must not carry unnecessary sensitive data; saying so
    // here means the form refuses before the round trip rather than surfacing a
    // constraint violation as an opaque 503.
    if (value.containsPii && value.channel !== "IN_APP") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["containsPii"],
        message:
          "Templates containing customer or financial detail may be used only on the in-app channel.",
      });
    }

    // An in-app notification without a title renders as a blank row in the
    // notification centre. Email carries `subject` instead.
    if (value.channel === "IN_APP" && !value.titleTemplate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["titleTemplate"],
        message: "Title Template is required for in-app notifications",
      });
    }

    if (value.channel === "EMAIL" && !value.subject) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject"],
        message: "Subject is required for email notifications",
      });
    }
  });

export type NotificationTemplateInput = z.infer<
  typeof notificationTemplateSchema
>;

// --- Event rules -------------------------------------------------------------

/**
 * The unrefined shape, exported so an update variant can be built from it.
 *
 * Deriving a partial from the refined schema via `.innerType()` silently drops
 * the `.superRefine` below, and a rule saved through that path would bypass
 * every strategy-coherence check. Build from this object and re-apply
 * `withRuleCoherence` instead.
 */
export const notificationEventRuleFields = z.object({
  name: z
    .string({ required_error: "Rule Name is required" })
    .trim()
    .min(1, "Rule Name is required")
    .max(150, "Rule Name must be 150 characters or fewer"),
  eventType: requiredNotificationEventSchema,
  sourceModule: z
    .string({ required_error: "Source Module is required" })
    .trim()
    .min(1, "Source Module is required")
    .max(50),
  sourceTrigger: z
    .string({ required_error: "Source State / Trigger is required" })
    .trim()
    .min(1, "Source State / Trigger is required")
    .max(100),
  /**
   * A *request*, never an authority. The server narrows it to the caller's own
   * scope and refuses a branch they do not hold (Rules 34, 41; Scenario 41).
   * Null means organization-wide.
   */
  branchId: idSchema.nullish(),
  recipientStrategy: requiredRecipientStrategySchema,
  recipientRoleCode: optionalText(50),
  recipientPermissionCode: optionalText(100),
  explicitRecipientUserIds: z.array(idSchema).default([]),
  channel: requiredNotificationChannelSchema,
  templateId: idSchema.refine((value) => value.length > 0, {
    message: "Template is required",
  }),
  priority: notificationPrioritySchema.default("NORMAL"),
  /**
   * Rules 47, 48 and Scenario 17: a mandatory rule is evaluated without reading
   * preferences at all, so a user cannot opt out of it.
   */
  isMandatory: z.boolean().default(false),
  maxAttempts: z
    .number()
    .int()
    .min(1, "At least one attempt is required")
    .max(10, "At most ten attempts are allowed")
    .default(NOTIFICATION_LIMITS.MAX_ATTEMPTS),
  backoffBaseSeconds: z
    .number()
    .int()
    .min(1)
    .max(NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS)
    .default(NOTIFICATION_LIMITS.BACKOFF_BASE_SECONDS),
  sendImmediately: z.boolean().default(true),
  scheduledOffsetDays: z.number().int().min(-365).max(365).nullish(),
  isActive: z.boolean().default(true),
});

/**
 * Strategy coherence, mirroring the `notification_event_rules_strategy_fields`
 * CHECK constraint.
 *
 * Applied as a named helper rather than inline so an update schema can re-apply
 * it — see the note on `notificationEventRuleFields`.
 */
export function withRuleCoherence<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value: unknown, ctx: z.RefinementCtx) => {
    const rule = value as Partial<z.infer<typeof notificationEventRuleFields>>;

    if (rule.recipientStrategy === "ROLE" && !rule.recipientRoleCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recipientRoleCode"],
        message: "Role is required when notifying by role",
      });
    }

    if (
      rule.recipientStrategy === "BRANCH_USER_GROUP" &&
      !rule.recipientPermissionCode
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recipientPermissionCode"],
        message: "Permission is required when notifying a branch user group",
      });
    }

    if (
      rule.recipientStrategy === "EXPLICIT" &&
      (rule.explicitRecipientUserIds ?? []).length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["explicitRecipientUserIds"],
        message: "At least one recipient is required",
      });
    }

    // A scheduled rule with no offset is indistinguishable from an immediate
    // one, and would fire on the source event rather than on the intended day.
    if (
      rule.sendImmediately === false &&
      (rule.scheduledOffsetDays === null ||
        rule.scheduledOffsetDays === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduledOffsetDays"],
        message: "Scheduled Offset is required when not sending immediately",
      });
    }
  });
}

export const notificationEventRuleSchema = withRuleCoherence(
  notificationEventRuleFields,
);

export type NotificationEventRuleInput = z.infer<
  typeof notificationEventRuleFields
>;

// --- Preferences -------------------------------------------------------------

/**
 * A user's own notification preferences.
 *
 * There is deliberately no `userId`. Rules 49 and 50 scope preferences to the
 * authenticated user, and Scenario 19 requires that User A cannot edit User B's
 * — an absent field enforces that more strongly than a permission check, because
 * there is no slot to put another user's id in.
 */
export const notificationPreferenceSchema = z.object({
  inAppEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  eventPreferences: z.record(preferenceCategorySchema, z.boolean()),
  /**
   * Rules 65, 66 and Scenarios 21, 51: the version the client read. Required,
   * not optional-with-a-default — a default would let a client that never read
   * the record overwrite a newer change made on another device, which is the
   * exact failure the rules forbid.
   */
  version: z
    .number({ required_error: "Version is required" })
    .int()
    .min(1, "Version is required"),
});

export type NotificationPreferenceInput = z.infer<
  typeof notificationPreferenceSchema
>;

// --- Reading and filtering ---------------------------------------------------

/** Rule 54 and Scenario 5: the filters a notification list supports. */
export const notificationFilterSchema = z
  .object({
    readStatus: z.enum(["ALL", "READ", "UNREAD"]).default("ALL"),
    eventType: notificationEventSchema.optional(),
    sourceModule: optionalText(50),
    priority: notificationPrioritySchema.optional(),
    includeArchived: z.boolean().default(false),
    fromDate: isoDateSchema("From Date").optional(),
    toDate: isoDateSchema("To Date").optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE)
      .default(NOTIFICATION_LIMITS.LIST_PAGE_SIZE),
  })
  .superRefine((value, ctx) => {
    if (value.fromDate && value.toDate && value.fromDate > value.toDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toDate"],
        message: "To Date must be on or after From Date",
      });
    }
  });

export const READ_STATUS_FILTER_OPTIONS = optionsFrom(
  ["ALL", "READ", "UNREAD"] as const,
  { ALL: "All", READ: "Read", UNREAD: "Unread" },
);

/** Delivery Monitoring's filters, which span recipients rather than one user. */
export const deliveryFilterSchema = z
  .object({
    status: deliveryStatusSchema.optional(),
    channel: notificationChannelSchema.optional(),
    eventType: notificationEventSchema.optional(),
    branchId: idSchema.nullish(),
    fromDate: isoDateSchema("From Date").optional(),
    toDate: isoDateSchema("To Date").optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE)
      .default(NOTIFICATION_LIMITS.LIST_PAGE_SIZE),
  })
  .superRefine((value, ctx) => {
    if (value.fromDate && value.toDate && value.fromDate > value.toDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toDate"],
        message: "To Date must be on or after From Date",
      });
    }
  });

/**
 * Manually re-enqueue a failed delivery (Scenario 45).
 *
 * A reason is required because a manual retry is an administrative override of
 * an automatic decision, and the audit trail should say who thought the failure
 * was transient and why.
 */
export const deliveryRetrySchema = z.object({
  reason: z
    .string({ required_error: "Reason is required" })
    .trim()
    .min(1, "Reason is required")
    .max(500, "Reason must be 500 characters or fewer"),
});
