import { describe, expect, it } from "vitest";

import {
  DELIVERY_STATUS_OPTIONS,
  NOTIFICATION_CHANNEL_OPTIONS,
  NOTIFICATION_LIMITS,
  RECIPIENT_STRATEGY_OPTIONS,
  deliveryRetrySchema,
  notificationEventRuleFields,
  notificationEventRuleSchema,
  notificationFilterSchema,
  notificationPreferenceSchema,
  notificationTemplateSchema,
  withRuleCoherence,
} from "./notifications";

/**
 * Module 16 — notification configuration validation.
 *
 * Four properties are worth pinning here, each because its failure mode is
 * silent rather than loud:
 *
 *  1. **The mandatory-field table produces the exact messages the story names.**
 *     The Scenario Outline lists nine fields and nine messages; a screen showing
 *     different wording has failed the scenario while looking correct.
 *  2. **Strategy coherence survives extension.** It lives in a `.superRefine`,
 *     and the trap is that deriving an update variant via `.innerType()` drops
 *     it silently — a rule saved through that path would name ROLE with no role
 *     code and simply never notify anybody.
 *  3. **A PII template cannot reach SMS or email.** Rules 55 and 56. The CHECK
 *     constraint is the guarantee, but a form that submits and then surfaces a
 *     constraint violation as an opaque 503 is not a working screen.
 *  4. **Preference updates carry a version.** Rules 65, 66. Optional-with-a-
 *     default here would let a client that never read the record overwrite a
 *     newer change, which is exactly what Scenarios 21 and 51 forbid.
 */

function messagesFor(result: { success: boolean; error?: unknown }): string[] {
  if (result.success) return [];
  const error = result.error as { issues: { message: string }[] };
  return error.issues.map((issue) => issue.message);
}

const validTemplate = {
  name: "Recovery Assignment (In-App)",
  code: "RECOVERY_ASSIGNED_IN_APP",
  category: "RECOVERY",
  sourceModule: "recovery",
  eventType: "RECOVERY_ASSIGNED",
  channel: "IN_APP",
  status: "ACTIVE",
  titleTemplate: "Case {{caseNumber}} assigned to you",
  messageTemplate: "Recovery case {{caseNumber}} is now yours.",
  containsPii: false,
};

const validRule = {
  name: "Recovery assignment notifies the officer",
  eventType: "RECOVERY_ASSIGNED",
  sourceModule: "recovery",
  sourceTrigger: "case_assigned",
  recipientStrategy: "ASSIGNED_USER",
  channel: "IN_APP",
  templateId: "11111111-1111-1111-1111-111111111111",
};

describe("limits", () => {
  it("matches the values the API uses", () => {
    // Two declarations of the same numbers — here, and in the API's
    // `notification-policy.ts` for the CJS Nest build, which cannot require
    // this package's ESM. The duplication is forced; the drift it invites is
    // not. A retry cap the browser shows and the server ignores produces a
    // configuration screen that lies about when a message stops being retried.
    expect(NOTIFICATION_LIMITS.MAX_ATTEMPTS).toBe(5);
    expect(NOTIFICATION_LIMITS.BACKOFF_BASE_SECONDS).toBe(60);
    expect(NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS).toBe(3600);
    expect(NOTIFICATION_LIMITS.LIST_PAGE_SIZE).toBe(25);
    expect(NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE).toBe(100);
  });

  it("produces the deterministic backoff the rule requires", () => {
    // Rule 21: deterministic, no jitter. Written out rather than computed so
    // that changing the base is a visible edit to an expected sequence and not
    // a silent change to when a support engineer expects the next attempt.
    const { BACKOFF_BASE_SECONDS, MAX_ATTEMPTS } = NOTIFICATION_LIMITS;
    const schedule = Array.from({ length: MAX_ATTEMPTS }, (_, index) =>
      Math.min(
        BACKOFF_BASE_SECONDS * 2 ** index,
        NOTIFICATION_LIMITS.MAX_BACKOFF_SECONDS,
      ),
    );

    expect(schedule).toEqual([60, 120, 240, 480, 960]);
  });
});

describe("channel registry", () => {
  it("offers only the three channels the module delivers on", () => {
    // The database enum also carries PUSH and AUTO_CALL, kept because dropping
    // a Postgres enum value rewrites the type. Neither may be configurable: a
    // rule targeting a channel with no provider accumulates permanent failures
    // instead of failing when it is saved.
    expect(NOTIFICATION_CHANNEL_OPTIONS.map((o) => o.value)).toEqual([
      "IN_APP",
      "EMAIL",
      "SMS",
    ]);
  });

  it("keeps DELIVERED and ACCEPTED_BY_PROVIDER as distinct outcomes", () => {
    // Rule 17 and Scenario 27. Collapsing these is the single most likely way
    // to make the system claim a delivery it cannot know about.
    const values = DELIVERY_STATUS_OPTIONS.map((o) => o.value);

    expect(values).toContain("ACCEPTED_BY_PROVIDER");
    expect(values).toContain("DELIVERED");
    expect(
      DELIVERY_STATUS_OPTIONS.find((o) => o.value === "ACCEPTED_BY_PROVIDER")
        ?.label,
    ).toBe("Accepted by provider");
  });

  it("labels every recipient strategy", () => {
    // `optionsFrom` makes a missing label a compile error, but not a missing
    // *option* — this catches a strategy added to the enum and left out of the
    // registry, which would render as an unselectable value on the rule form.
    expect(RECIPIENT_STRATEGY_OPTIONS).toHaveLength(5);
    for (const option of RECIPIENT_STRATEGY_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});

describe("notificationTemplateSchema", () => {
  it("accepts a well-formed template", () => {
    expect(notificationTemplateSchema.safeParse(validTemplate).success).toBe(
      true,
    );
  });

  describe("Scenario Outline: mandatory notification configuration validation", () => {
    // The story's Examples table, verbatim for the template half. Organization
    // is absent by design: it comes from the JWT, so there is no field to omit.
    it.each([
      ["name", "Template Name is required"],
      ["code", "Template Code is required"],
      ["category", "Category is required"],
      ["channel", "Channel is required"],
      ["messageTemplate", "Message Template is required"],
      ["eventType", "Event Type is required"],
    ])("rejects a missing %s with %s", (field, message) => {
      const input: Record<string, unknown> = { ...validTemplate };
      delete input[field];

      const result = notificationTemplateSchema.safeParse(input);

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(message);
    });

    it("treats an untouched select the same as a missing one", () => {
      // An untouched `<select>` posts "", not undefined. Both must produce the
      // mandatory-field message rather than an enum-shaped one.
      const result = notificationTemplateSchema.safeParse({
        ...validTemplate,
        channel: "",
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain("Channel is required");
    });

    it("treats whitespace as absent for a required text field", () => {
      const result = notificationTemplateSchema.safeParse({
        ...validTemplate,
        messageTemplate: "   ",
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain("Message Template is required");
    });
  });

  describe("Rules 55, 56: PII may not reach an external channel", () => {
    it.each(["SMS", "EMAIL"])("refuses a PII template on %s", (channel) => {
      const result = notificationTemplateSchema.safeParse({
        ...validTemplate,
        channel,
        containsPii: true,
        subject: "Subject",
        titleTemplate: undefined,
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        "Templates containing customer or financial detail may be used only on the in-app channel.",
      );
    });

    it("allows a PII template in-app", () => {
      // The in-app channel is inside the authenticated session, so Rule 55's
      // "minimised and controlled by channel policy" permits it there.
      const result = notificationTemplateSchema.safeParse({
        ...validTemplate,
        containsPii: true,
      });

      expect(result.success).toBe(true);
    });
  });

  it("requires a title for in-app and a subject for email", () => {
    // An in-app notification with no title renders as a blank row in the
    // notification centre; an email with no subject arrives as "(no subject)".
    expect(
      messagesFor(
        notificationTemplateSchema.safeParse({
          ...validTemplate,
          titleTemplate: undefined,
        }),
      ),
    ).toContain("Title Template is required for in-app notifications");

    expect(
      messagesFor(
        notificationTemplateSchema.safeParse({
          ...validTemplate,
          channel: "EMAIL",
          subject: undefined,
        }),
      ),
    ).toContain("Subject is required for email notifications");
  });

  it("constrains the template code to a stable identifier shape", () => {
    // The code is referenced by seeds and by the rule form; allowing spaces or
    // case variation makes two templates that differ only in presentation
    // collide on the `(orgId, code, channel)` unique index at save time.
    const result = notificationTemplateSchema.safeParse({
      ...validTemplate,
      code: "recovery assigned",
    });

    expect(result.success).toBe(false);
  });
});

describe("notificationEventRuleSchema", () => {
  it("accepts a well-formed rule", () => {
    expect(notificationEventRuleSchema.safeParse(validRule).success).toBe(true);
  });

  describe("Scenario Outline: mandatory notification configuration validation", () => {
    it.each([
      ["name", "Rule Name is required"],
      ["recipientStrategy", "Recipient Strategy is required"],
      ["eventType", "Event Type is required"],
      ["channel", "Channel is required"],
    ])("rejects a missing %s with %s", (field, message) => {
      const input: Record<string, unknown> = { ...validRule };
      delete input[field];

      const result = notificationEventRuleSchema.safeParse(input);

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(message);
    });
  });

  describe("Rule 42: strategy coherence", () => {
    // Each of these mirrors a branch of the
    // `notification_event_rules_strategy_fields` CHECK. A rule that cannot
    // resolve anybody does not fail when it is saved — it fails silently at
    // 2 a.m. as an absence of notifications, which is Scenario 53.
    it("refuses ROLE without a role code", () => {
      const result = notificationEventRuleSchema.safeParse({
        ...validRule,
        recipientStrategy: "ROLE",
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        "Role is required when notifying by role",
      );
    });

    it("refuses BRANCH_USER_GROUP without a permission code", () => {
      const result = notificationEventRuleSchema.safeParse({
        ...validRule,
        recipientStrategy: "BRANCH_USER_GROUP",
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        "Permission is required when notifying a branch user group",
      );
    });

    it("refuses EXPLICIT with an empty recipient list", () => {
      const result = notificationEventRuleSchema.safeParse({
        ...validRule,
        recipientStrategy: "EXPLICIT",
        explicitRecipientUserIds: [],
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        "At least one recipient is required",
      );
    });

    it("accepts ASSIGNED_USER and RECORD_OWNER with no extra field", () => {
      // These two resolve from the source record itself and carry no
      // configuration of their own — requiring one would be busywork.
      for (const recipientStrategy of ["ASSIGNED_USER", "RECORD_OWNER"]) {
        expect(
          notificationEventRuleSchema.safeParse({
            ...validRule,
            recipientStrategy,
          }).success,
        ).toBe(true);
      }
    });

    it("refuses a scheduled rule with no offset", () => {
      const result = notificationEventRuleSchema.safeParse({
        ...validRule,
        sendImmediately: false,
      });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        "Scheduled Offset is required when not sending immediately",
      );
    });
  });

  describe("Rules 19-21: the retry policy must be able to terminate", () => {
    it.each([
      ["maxAttempts", 0],
      ["maxAttempts", 11],
      ["backoffBaseSeconds", 0],
      ["backoffBaseSeconds", 7200],
    ])("refuses %s of %s", (field, value) => {
      const result = notificationEventRuleSchema.safeParse({
        ...validRule,
        [field]: value,
      });

      expect(result.success).toBe(false);
    });

    it("defaults to the shared limits when unspecified", () => {
      const result = notificationEventRuleSchema.safeParse(validRule);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxAttempts).toBe(NOTIFICATION_LIMITS.MAX_ATTEMPTS);
        expect(result.data.backoffBaseSeconds).toBe(
          NOTIFICATION_LIMITS.BACKOFF_BASE_SECONDS,
        );
      }
    });
  });

  describe("the .innerType() trap", () => {
    // Extending a refined schema drops its refinements silently. A partial
    // update built that way would accept a ROLE rule with no role code — the
    // exact configuration the CHECK constraint then refuses, surfacing as an
    // opaque 503 instead of a field error.
    it("loses coherence when a partial is derived by extension", () => {
      const naive = notificationEventRuleFields.partial();

      // Documents the hazard rather than endorsing it: this is what NOT to ship.
      expect(
        naive.safeParse({ recipientStrategy: "ROLE" }).success,
      ).toBe(true);
    });

    it("keeps coherence when the refinement is re-applied", () => {
      const correct = withRuleCoherence(notificationEventRuleFields.partial());

      const result = correct.safeParse({ recipientStrategy: "ROLE" });

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain(
        "Role is required when notifying by role",
      );
    });
  });
});

describe("notificationPreferenceSchema", () => {
  const validPreferences = {
    inAppEnabled: true,
    emailEnabled: false,
    smsEnabled: false,
    eventPreferences: { EMI: true, RECOVERY: false },
    version: 3,
  };

  it("accepts a well-formed update", () => {
    expect(notificationPreferenceSchema.safeParse(validPreferences).success).toBe(
      true,
    );
  });

  describe("Rules 65, 66: stale updates must be detectable", () => {
    it("requires a version", () => {
      // Scenarios 21 and 51. Optional-with-a-default would let a client that
      // never read the record overwrite a newer change made on another device
      // — the silent overwrite the rules exist to prevent.
      const input: Record<string, unknown> = { ...validPreferences };
      delete input.version;

      const result = notificationPreferenceSchema.safeParse(input);

      expect(result.success).toBe(false);
      expect(messagesFor(result)).toContain("Version is required");
    });

    it("refuses a version below the initial one", () => {
      expect(
        notificationPreferenceSchema.safeParse({
          ...validPreferences,
          version: 0,
        }).success,
      ).toBe(false);
    });
  });

  it("carries no userId at all", () => {
    // Rules 49, 50 and Scenario 19. The absence is the enforcement: with no
    // field for another user's id, User A cannot address User B's preferences
    // even if a permission check were mistakenly removed. `strip` (zod's
    // default) discards the extra key rather than honouring it.
    const result = notificationPreferenceSchema.safeParse({
      ...validPreferences,
      userId: "22222222-2222-2222-2222-222222222222",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("userId");
    }
  });

  it("rejects an unknown preference category", () => {
    const result = notificationPreferenceSchema.safeParse({
      ...validPreferences,
      eventPreferences: { NOT_A_CATEGORY: true },
    });

    expect(result.success).toBe(false);
  });
});

describe("notificationFilterSchema", () => {
  it("defaults to the first page of unfiltered, unarchived notifications", () => {
    const result = notificationFilterSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.readStatus).toBe("ALL");
      expect(result.data.includeArchived).toBe(false);
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(NOTIFICATION_LIMITS.LIST_PAGE_SIZE);
    }
  });

  it("bounds the page size", () => {
    // Rule 54's filtering must not become an unbounded query.
    expect(
      notificationFilterSchema.safeParse({
        pageSize: NOTIFICATION_LIMITS.MAX_LIST_PAGE_SIZE + 1,
      }).success,
    ).toBe(false);
  });

  it("refuses an inverted date range", () => {
    const result = notificationFilterSchema.safeParse({
      fromDate: "2026-08-27",
      toDate: "2026-08-01",
    });

    expect(result.success).toBe(false);
    expect(messagesFor(result)).toContain(
      "To Date must be on or after From Date",
    );
  });

  it("carries no recipient field", () => {
    // Rules 5, 53 and Scenario 1. The list is always the caller's own; a
    // recipient filter would be a way to ask for someone else's.
    const result = notificationFilterSchema.safeParse({
      recipientUserId: "33333333-3333-3333-3333-333333333333",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("recipientUserId");
    }
  });
});

describe("deliveryRetrySchema", () => {
  it("requires a reason", () => {
    // A manual retry overrides an automatic decision, so the audit trail should
    // record who judged the failure transient and why (Scenario 45, Rule 73).
    const result = deliveryRetrySchema.safeParse({});

    expect(result.success).toBe(false);
    expect(messagesFor(result)).toContain("Reason is required");
  });

  it("accepts a stated reason", () => {
    expect(
      deliveryRetrySchema.safeParse({ reason: "SMTP host was down; restored." })
        .success,
    ).toBe(true);
  });
});
