import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  APPLICATION_STATUS_OPTIONS,
  CONSENT_STATUS_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  INTEREST_TYPE_OPTIONS,
  LOAN_TYPE_OPTIONS,
  USER_STATUS_OPTIONS,
  applicationStatusSchema,
  interestTypeSchema,
  labelFor,
  optionsFrom,
  pick,
} from "./index";

/**
 * What these tests pin, beyond "the helper returns an array":
 *
 * 1. **Registries stay in step with their schemas.** The whole reason values come
 *    from `schema.options` is so a dropdown cannot offer a value the validator
 *    rejects, or omit one it accepts. That round trip is asserted directly.
 * 2. **The label-drift bug stays fixed.** The specific wording that used to
 *    disagree between the application list and its badge is pinned, so a future
 *    edit to either side has to change this test on purpose.
 * 3. **`labelFor` degrades to the raw value**, never to a blank cell — a stored
 *    value dropped from the list must still render as something recognisable.
 */

describe("optionsFrom", () => {
  it("pairs each value with its label, in the order given", () => {
    expect(optionsFrom(["A", "B"] as const, { A: "Ay", B: "Bee" })).toEqual([
      { value: "A", label: "Ay" },
      { value: "B", label: "Bee" },
    ]);
  });

  it("merges per-value extras such as hint and disabled", () => {
    const options = optionsFrom(
      ["A", "B"] as const,
      { A: "Ay", B: "Bee" },
      { B: { disabled: true, hint: "withdrawn" } },
    );

    expect(options[0]).toEqual({ value: "A", label: "Ay" });
    expect(options[1]).toEqual({
      value: "B",
      label: "Bee",
      disabled: true,
      hint: "withdrawn",
    });
  });
});

describe("registries match the schemas they are built from", () => {
  it.each([
    ["interest type", INTEREST_TYPE_OPTIONS, interestTypeSchema],
    ["application status", APPLICATION_STATUS_OPTIONS, applicationStatusSchema],
  ])(
    "every %s option is accepted by its validator",
    (_name, options, schema) => {
      for (const option of options) {
        expect(schema.safeParse(option.value).success).toBe(true);
      }
      // ...and nothing the validator accepts is missing from the dropdown.
      expect(options.map((o) => o.value).sort()).toEqual(
        [...schema.options].sort(),
      );
    },
  );

  it("gives every option a non-empty label", () => {
    const all = [
      ...LOAN_TYPE_OPTIONS,
      ...INTEREST_TYPE_OPTIONS,
      ...APPLICATION_STATUS_OPTIONS,
      ...CUSTOMER_TYPE_OPTIONS,
      ...USER_STATUS_OPTIONS,
      ...CONSENT_STATUS_OPTIONS,
    ];
    for (const option of all) {
      expect(option.label.trim().length).toBeGreaterThan(0);
      // A label that is just the raw value means somebody forgot to write one.
      expect(option.label).not.toBe(option.value);
    }
  });

  it("labels MORE_INFO_REQUIRED once, as the badge always did", () => {
    // The regression this registry exists to prevent: the list rendered
    // "more info required" while the badge beside it said "More info needed".
    expect(labelFor(APPLICATION_STATUS_OPTIONS, "MORE_INFO_REQUIRED")).toBe(
      "More info needed",
    );
  });

  it("carries the radio-card copy for customer type", () => {
    const kyc = CUSTOMER_TYPE_OPTIONS.find((o) => o.value === "KYC");
    expect(kyc?.label).toBe("KYC Customer");
    expect(kyc?.hint).toContain("ID, address and photo");
  });
});

describe("labelFor", () => {
  it("returns the label for a known value", () => {
    expect(labelFor(INTEREST_TYPE_OPTIONS, "REDUCING")).toBe(
      "Reducing balance",
    );
  });

  it("falls back to the raw value rather than a blank cell", () => {
    // A value retired from the list must still be recognisable in an old record.
    expect(labelFor(INTEREST_TYPE_OPTIONS, "LEGACY_SCHEME")).toBe(
      "LEGACY_SCHEME",
    );
  });

  it("renders empty for absent values", () => {
    expect(labelFor(INTEREST_TYPE_OPTIONS, null)).toBe("");
    expect(labelFor(INTEREST_TYPE_OPTIONS, undefined)).toBe("");
    expect(labelFor(INTEREST_TYPE_OPTIONS, "")).toBe("");
  });
});

describe("pick", () => {
  it("narrows to the values given, in that order", () => {
    // User creation offers only these two of the five UserStatus values.
    expect(pick(USER_STATUS_OPTIONS, ["PENDING", "INACTIVE"])).toEqual([
      { value: "PENDING", label: "Pending" },
      { value: "INACTIVE", label: "Inactive" },
    ]);
  });

  it("skips values the registry does not carry", () => {
    expect(pick(USER_STATUS_OPTIONS, ["PENDING", "NOPE"])).toEqual([
      { value: "PENDING", label: "Pending" },
    ]);
  });
});

describe("the compile-time guarantee", () => {
  it("is what a missing label costs, so it cannot be forgotten at runtime", () => {
    // `optionsFrom` takes `Record<T, string>`, so omitting a label for a value
    // in the enum is a type error rather than an `undefined` label rendered as
    // a blank <option>. This asserts the runtime consequence of getting it
    // wrong, which is what the type prevents.
    const schema = z.enum(["A", "B"]);
    const missing = { A: "Ay" } as Record<"A" | "B", string>;

    expect(optionsFrom(schema.options, missing)[1]?.label).toBeUndefined();
  });
});
