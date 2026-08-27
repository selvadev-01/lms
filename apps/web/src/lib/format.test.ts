import { describe, expect, it } from "vitest";

import { formatBps, formatDate, formatPaise } from "./format";

/**
 * These pin the exact output strings the Playwright specs assert on. They exist
 * because the functions were moved out of `features/loans/components/LoanBadges`
 * — a move is only safe if the output is provably byte-identical, and an e2e run
 * is too slow and too coarse to prove that per-case.
 */

describe("formatPaise", () => {
  it("renders whole rupees with two decimal places", () => {
    expect(formatPaise("100")).toBe("₹1.00");
    expect(formatPaise("0")).toBe("₹0.00");
  });

  it("keeps the paise remainder", () => {
    expect(formatPaise("12345")).toBe("₹123.45");
    expect(formatPaise("101")).toBe("₹1.01");
    // A single trailing unit must pad, not truncate.
    expect(formatPaise("110")).toBe("₹1.10");
  });

  it("groups digits the Indian way, not in thousands", () => {
    expect(formatPaise("100000")).toBe("₹1,000.00");
    // 1 lakh: the break is after three digits, then in pairs.
    expect(formatPaise("10000000")).toBe("₹1,00,000.00");
    // 1 crore.
    expect(formatPaise("1000000000")).toBe("₹1,00,00,000.00");
  });

  /**
   * The reason this function uses BigInt at all. 9007199254740993 paise is
   * Number.MAX_SAFE_INTEGER + 2; parsed as a Number it silently becomes
   * ...992, so the last digit of the rupee value would be wrong.
   */
  it("survives values beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatPaise("9007199254740993")).toBe("₹9,00,71,99,25,47,409.93");
    // Same value one paisa lower differs only in the final digit — a Number
    // parse collapses the two, which is exactly the bug BigInt avoids here.
    expect(formatPaise("9007199254740992")).toBe("₹9,00,71,99,25,47,409.92");
  });

  it("carries the sign outside the rupee symbol", () => {
    expect(formatPaise("-12345")).toBe("-₹123.45");
  });

  it("returns a malformed value unchanged rather than a plausible zero", () => {
    expect(formatPaise("abc")).toBe("abc");
    // A decimal string is not valid BigInt input — these values cross the wire
    // as integer paise precisely so that no decimal point is ever involved.
    expect(formatPaise("12.34")).toBe("12.34");
  });

  /**
   * Documented, not endorsed. `BigInt("")` and `BigInt(" ")` return 0 rather
   * than throwing, so blank input renders ₹0.00 instead of falling through to
   * the pass-unchanged branch. Callers pass API-supplied amount strings, which
   * are never blank, so this has no live consequence — but it is the one input
   * where "shown as-is" does not hold, and a future guard would change it.
   */
  it("renders blank input as zero (BigInt quirk, not a design choice)", () => {
    expect(formatPaise("")).toBe("₹0.00");
    expect(formatPaise(" ")).toBe("₹0.00");
  });
});

describe("formatBps", () => {
  it("renders whole percentages without decimals", () => {
    expect(formatBps("1200")).toBe("12%");
    expect(formatBps("0")).toBe("0%");
  });

  it("trims the trailing zero", () => {
    expect(formatBps("1250")).toBe("12.5%");
  });

  it("keeps both decimals when they are significant", () => {
    expect(formatBps("1234")).toBe("12.34%");
  });

  it("returns a malformed value unchanged", () => {
    expect(formatBps("abc")).toBe("abc");
  });
});

describe("formatDate", () => {
  it("renders a DATE-only value", () => {
    expect(formatDate("2026-08-22")).toBe("22 Aug 2026");
  });

  it("renders the date half of an ISO timestamp", () => {
    expect(formatDate("2026-01-05T18:30:00.000Z")).toBe("05 Jan 2026");
  });

  /**
   * The reason this parses the string instead of using `new Date`. A DATE-only
   * value goes through `Date` as UTC midnight, so any viewer west of Greenwich
   * would see the previous day. This must hold regardless of the runner's TZ.
   */
  it("never shifts the day", () => {
    expect(formatDate("2026-01-01")).toBe("01 Jan 2026");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("shows an em dash for a missing value", () => {
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("returns an unrecognised value unchanged", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});
