import { describe, expect, it } from "vitest";

import {
  SETTING_CODES,
  SETTING_DEFINITIONS,
  businessCalendarSchema,
  getSettingDefinition,
  isScopeAllowed,
  maintenanceModeSchema,
  rejectChangeSchema,
  settingCodeSchema,
  updateSettingSchema,
  validateSettingValue,
} from "./settings";

/**
 * Module 17 — the setting definition registry.
 *
 * Five properties are pinned here, each because its failure mode is silent
 * rather than loud:
 *
 *  1. **An unknown code is refused.** The `settings` table is generic and could
 *     hold anything; the registry is the only thing that stops it becoming the
 *     arbitrary key/value store Rules 8 and 9 forbid. If this check ever passes
 *     an unknown code, nothing else in the system would notice.
 *  2. **A floating-point money value is rejected, not truncated.** Scenario 8.
 *     Truncation is the dangerous outcome: "1000.50" silently becoming 1000 is a
 *     limit set at a hundredth of its intended value, with no error anywhere.
 *  3. **The EOD window cannot end before it starts.** Scenario 20. A reversed
 *     window would never open, and nothing would report why.
 *  4. **Scope is enforced per definition.** An ORG-only setting written at
 *     branch scope would create a row the resolver never looks at.
 *  5. **`requiresApproval` is expressible only in the registry.** No form schema
 *     accepts it, so a submitter cannot turn maker-checker off (Rule 43).
 */

describe("setting registry", () => {
  it("refuses a code that is not defined", () => {
    expect(settingCodeSchema.safeParse("ARBITRARY_KEY").success).toBe(false);
    expect(getSettingDefinition("ARBITRARY_KEY")).toBeUndefined();

    const result = validateSettingValue("ARBITRARY_KEY", "anything");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not supported/i);
    }
  });

  it("accepts every code it defines", () => {
    for (const code of SETTING_CODES) {
      expect(settingCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(SETTING_CODES).size).toBe(SETTING_CODES.length);
  });

  it("gives every definition a usable schema and a description", () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.schema).toBeDefined();
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.name.length).toBeGreaterThan(0);
    }
  });
});

describe("money values (Rules 14, 15; Scenario 8)", () => {
  const PAISE_CODE = "BRANCH_CASH_LIMIT_PAISE";

  it("accepts a whole number of paise as a digit string", () => {
    const result = validateSettingValue(PAISE_CODE, "5000000");
    expect(result.ok).toBe(true);
  });

  it("rejects a floating-point amount rather than truncating it", () => {
    const result = validateSettingValue(PAISE_CODE, "1000.50");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/whole number of paise/i);
    }
  });

  it("rejects a negative amount and a non-numeric one", () => {
    expect(validateSettingValue(PAISE_CODE, "-1").ok).toBe(false);
    expect(validateSettingValue(PAISE_CODE, "abc").ok).toBe(false);
    expect(validateSettingValue(PAISE_CODE, "").ok).toBe(false);
  });

  it("declares PAISE as its value type, so the UI formats it as money", () => {
    expect(getSettingDefinition(PAISE_CODE)?.valueType).toBe("PAISE");
  });

  it("validates every PAISE definition as a digit string, never as a number", () => {
    // A JS number cannot hold a large rupee amount in paise without losing the
    // last digits. Any PAISE setting that accepted `1000.5` as a number would
    // reintroduce exactly the precision loss the string convention prevents.
    for (const definition of SETTING_DEFINITIONS) {
      if (definition.valueType !== "PAISE") continue;
      expect(definition.schema.safeParse(1000.5).success).toBe(false);
      expect(definition.schema.safeParse("1000.50").success).toBe(false);
    }
  });
});

describe("value validation per definition", () => {
  it("rejects an out-of-range integer", () => {
    expect(validateSettingValue("AUDIT_EXPORT_MAX_DAYS", "0").ok).toBe(false);
    expect(validateSettingValue("AUDIT_EXPORT_MAX_DAYS", "400").ok).toBe(false);
    expect(validateSettingValue("AUDIT_EXPORT_MAX_DAYS", "90").ok).toBe(true);
  });

  it("rejects a financial year start that is not MM-DD", () => {
    expect(validateSettingValue("ORG_FINANCIAL_YEAR_START", "2026-04-01").ok).toBe(
      false,
    );
    expect(validateSettingValue("ORG_FINANCIAL_YEAR_START", "13-01").ok).toBe(false);
    expect(validateSettingValue("ORG_FINANCIAL_YEAR_START", "04-01").ok).toBe(true);
  });

  it("rejects an empty display name", () => {
    expect(validateSettingValue("ORG_DISPLAY_NAME", "   ").ok).toBe(false);
  });

  it("reads an unchecked HTML checkbox as false rather than failing", () => {
    // An unchecked box sends nothing at all. Treating that as invalid would make
    // "off" unsettable through the form.
    expect(validateSettingValue("EOD_AUTO_RUN_ENABLED", undefined)).toMatchObject({
      ok: true,
      value: false,
    });
    expect(validateSettingValue("EOD_AUTO_RUN_ENABLED", "on")).toMatchObject({
      ok: true,
      value: true,
    });
  });
});

describe("scope (Rules 1, 2; Scenario 44)", () => {
  it("confines an ORG setting to organization scope", () => {
    const definition = getSettingDefinition("ORG_DISPLAY_NAME")!;
    expect(isScopeAllowed(definition, null)).toBe(true);
    expect(isScopeAllowed(definition, "a-branch-id")).toBe(false);
  });

  it("confines a BRANCH setting to branch scope", () => {
    const definition = getSettingDefinition("BRANCH_CASH_LIMIT_PAISE")!;
    expect(isScopeAllowed(definition, "a-branch-id")).toBe(true);
    expect(isScopeAllowed(definition, null)).toBe(false);
  });

  it("allows either for an ORG_OR_BRANCH setting", () => {
    const definition = getSettingDefinition("EOD_AUTO_RUN_ENABLED")!;
    expect(isScopeAllowed(definition, null)).toBe(true);
    expect(isScopeAllowed(definition, "a-branch-id")).toBe(true);
  });
});

describe("maker-checker is unrepresentable in a form (Rule 43)", () => {
  it("exposes requiresApproval only through the registry", () => {
    const approvalCodes = SETTING_DEFINITIONS.filter(
      (definition) => definition.requiresApproval,
    ).map((definition) => definition.code);
    expect(approvalCodes.length).toBeGreaterThan(0);

    // The submitter cannot influence it: no mutating schema has a slot for it,
    // so there is nothing to tamper with rather than a check that might be
    // forgotten.
    const parsed = updateSettingSchema.safeParse({
      value: "x",
      changeReason: "r",
      expectedVersion: 1,
      requiresApproval: false,
      isProtected: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("requiresApproval" in parsed.data).toBe(false);
      expect("isProtected" in parsed.data).toBe(false);
    }
  });

  it("marks the protected setting as both protected and approval-gated", () => {
    const definition = getSettingDefinition("AUDIT_EXPORT_MAX_DAYS")!;
    expect(definition.isProtected).toBe(true);
    expect(definition.requiresApproval).toBe(true);
  });
});

describe("optimistic locking", () => {
  it("requires a version on update", () => {
    expect(
      updateSettingSchema.safeParse({ value: "x", changeReason: "r" }).success,
    ).toBe(false);
  });

  it("rejects a non-numeric or zero version", () => {
    const base = { value: "x", changeReason: "r" };
    expect(updateSettingSchema.safeParse({ ...base, expectedVersion: 0 }).success).toBe(
      false,
    );
    expect(
      updateSettingSchema.safeParse({ ...base, expectedVersion: "abc" }).success,
    ).toBe(false);
    expect(
      updateSettingSchema.safeParse({ ...base, expectedVersion: "3" }).success,
    ).toBe(true);
  });
});

describe("mandatory fields", () => {
  it("requires a change reason", () => {
    const parsed = updateSettingSchema.safeParse({
      value: "x",
      changeReason: "  ",
      expectedVersion: 1,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Change Reason is required");
    }
  });

  it("requires a rejection reason (Scenario 12)", () => {
    const parsed = rejectChangeSchema.safeParse({ rejectionReason: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Rejection Reason is required");
    }
  });

  it("requires a reason to enable maintenance mode (Rule 77)", () => {
    const parsed = maintenanceModeSchema.safeParse({ enabled: "on", reason: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("Reason is required");
    }
  });
});

describe("business calendar (Rule 16; Scenarios 19, 20)", () => {
  const valid = {
    name: "Head office",
    timezone: "Asia/Kolkata" as const,
    workingDays: [1, 2, 3, 4, 5],
  };

  it("accepts a valid calendar", () => {
    expect(businessCalendarSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses any timezone but Asia/Kolkata", () => {
    const parsed = businessCalendarSchema.safeParse({
      ...valid,
      timezone: "UTC",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/Asia\/Kolkata/);
    }
  });

  it("rejects an EOD window that ends before it starts", () => {
    const parsed = businessCalendarSchema.safeParse({
      ...valid,
      eodWindowStart: "22:00",
      eodWindowEnd: "18:00",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/end after it starts/i);
    }
  });

  it("rejects an EOD window that ends exactly when it starts", () => {
    expect(
      businessCalendarSchema.safeParse({
        ...valid,
        eodWindowStart: "18:00",
        eodWindowEnd: "18:00",
      }).success,
    ).toBe(false);
  });

  it("rejects half an EOD window", () => {
    expect(
      businessCalendarSchema.safeParse({ ...valid, eodWindowStart: "18:00" }).success,
    ).toBe(false);
    expect(
      businessCalendarSchema.safeParse({ ...valid, eodWindowEnd: "22:00" }).success,
    ).toBe(false);
  });

  it("accepts a well-ordered window", () => {
    expect(
      businessCalendarSchema.safeParse({
        ...valid,
        eodWindowStart: "18:00",
        eodWindowEnd: "22:00",
      }).success,
    ).toBe(true);
  });

  it("rejects a malformed clock time and a duplicated working day", () => {
    expect(
      businessCalendarSchema.safeParse({
        ...valid,
        eodWindowStart: "25:00",
        eodWindowEnd: "26:00",
      }).success,
    ).toBe(false);
    expect(
      businessCalendarSchema.safeParse({ ...valid, workingDays: [1, 1, 2] }).success,
    ).toBe(false);
    expect(
      businessCalendarSchema.safeParse({ ...valid, workingDays: [] }).success,
    ).toBe(false);
    expect(
      businessCalendarSchema.safeParse({ ...valid, workingDays: [0] }).success,
    ).toBe(false);
  });
});
