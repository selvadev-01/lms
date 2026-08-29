import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@lms/constants";

import { matchPages, pageIndex } from "./pages";

/**
 * The page half of the header search.
 *
 * Worth pinning because it is the half that runs on every keystroke with no
 * network involved: a ranking regression here is invisible in an API test and
 * shows up only as "the search feels wrong".
 */

/** A caller holding everything, so the index is the full menu. */
const ALL = Object.values(PERMISSIONS);

describe("pageIndex", () => {
  it("includes leaf entries with the group that owns them", () => {
    const customers = pageIndex(ALL).find((p) => p.path === "/customers");
    expect(customers).toEqual({
      name: "Customers",
      context: "Operations › Customer Management",
      path: "/customers",
    });
  });

  it("includes a top-level leaf with only its section as context", () => {
    const dashboard = pageIndex(ALL).find((p) => p.path === "/");
    expect(dashboard?.name).toBe("Dashboard");
    expect(dashboard?.context).toBe("Operations");
  });

  /**
   * The index is the menu, so it inherits the sidebar's permission filtering
   * rather than repeating it. A user is never offered a page their own menu
   * would not show them.
   */
  it("omits pages the caller's menu would hide", () => {
    const paths = pageIndex([]).map((p) => p.path);
    expect(paths).toContain("/profile");
    expect(paths).not.toContain("/customers");
    expect(paths).not.toContain("/finance/reconciliation");
  });

  it("offers every menu destination to a fully permissioned caller", () => {
    // Guards the rest: a broken index would make the ranking tests vacuous.
    expect(pageIndex(ALL).length).toBeGreaterThan(40);
  });
});

describe("matchPages", () => {
  const pages = pageIndex(ALL);

  it("returns nothing for an empty term", () => {
    expect(matchPages(pages, "")).toEqual([]);
    expect(matchPages(pages, "   ")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    expect(matchPages(pages, "CUSTOMERS")[0]?.title).toBe("Customers");
  });

  /**
   * The reason ranking exists at all: a plain substring test ranks in
   * declaration order, so "trial" would return whichever page was listed first
   * over the one actually called Trial Balance.
   */
  it("prefers a name-prefix match over a mid-string one", () => {
    expect(matchPages(pages, "trial")[0]?.title).toBe("Trial Balance");
    expect(matchPages(pages, "chart")[0]?.title).toBe("Chart of Accounts");
  });

  /**
   * Typing the start of a word a reader can see should find it. "coll" is
   * mid-string in "EMI Collection" but begins a word, which ranks above a
   * match landing inside one.
   */
  it("prefers a word-start match over one inside a word", () => {
    const hits = matchPages(pages, "coll").map((h) => h.title);
    expect(hits).toContain("EMI Collection");
    expect(hits.indexOf("EMI Collection")).toBeLessThan(
      hits.indexOf("Repayment & Collections"),
    );
  });

  it("prefers an exact name over a longer one containing it", () => {
    expect(matchPages(pages, "customers")[0]?.title).toBe("Customers");
    expect(matchPages(pages, "guarantors")[0]?.title).toBe("Guarantors");
  });

  /** Ties break on the shorter name, so the most specific label wins. */
  it("breaks ties on name length", () => {
    const hits = matchPages(pages, "loan");
    const titles = hits.map((h) => h.title);
    expect(titles.indexOf("Loan Schemes")).toBeLessThan(
      titles.indexOf("Loan Applications"),
    );
  });

  /**
   * Falls back to the group path, so a term naming a group finds the pages
   * under it even when no leaf carries that word.
   */
  it("matches on the owning group when no name matches", () => {
    const hits = matchPages(pages, "guarantor");
    expect(hits.map((h) => h.title)).toContain("Guarantors");

    // "Field Operations" is a group; its leaves do not all say "Field".
    const field = matchPages(pages, "field operations");
    expect(field.length).toBeGreaterThan(0);
  });

  it("returns hits pointing at the page's real path", () => {
    const hit = matchPages(pages, "trial balance")[0];
    expect(hit?.href).toBe("/finance/trial-balance");
    expect(hit?.subtitle).toContain("Finance");
  });

  it("respects the limit", () => {
    expect(matchPages(pages, "a", 3).length).toBeLessThanOrEqual(3);
  });

  it("returns nothing when the term matches no page", () => {
    expect(matchPages(pages, "zzzznotathing")).toEqual([]);
  });
});
