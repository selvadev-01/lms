import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@lms/constants";

import {
  type NavItem,
  type NavSection,
  navSections,
  resolveActivePath,
  visibleItems,
  visibleSections,
} from "./nav-items";

/** Every leaf destination in the real tree, with the group that owns it. */
function allEntries(): {
  group: string;
  name: string;
  path: string;
  permission?: string;
}[] {
  const out: {
    group: string;
    name: string;
    path: string;
    permission?: string;
  }[] = [];
  for (const section of navSections) {
    for (const item of section.items) {
      if (item.subItems) {
        for (const sub of item.subItems) {
          out.push({
            group: item.name,
            name: sub.name,
            path: sub.path,
            permission: sub.permission,
          });
        }
      } else if (item.path) {
        out.push({
          group: section.title,
          name: item.name,
          path: item.path,
          permission: item.permission,
        });
      }
    }
  }
  return out;
}

describe("visibleItems", () => {
  const gated: NavItem[] = [
    { name: "Ungated", icon: null, path: "/a" },
    { name: "Gated", icon: null, path: "/b", permission: "x.view" },
    {
      name: "Group",
      icon: null,
      subItems: [
        { name: "Open", path: "/c" },
        { name: "Closed", path: "/d", permission: "y.view" },
      ],
    },
    {
      name: "All gated",
      icon: null,
      subItems: [{ name: "Closed", path: "/e", permission: "z.view" }],
    },
  ];

  it("keeps ungated entries when the caller holds nothing", () => {
    const result = visibleItems(gated, []);
    expect(result.map((i) => i.name)).toEqual(["Ungated", "Group"]);
  });

  it("drops a gated entry the caller cannot use", () => {
    expect(visibleItems(gated, []).some((i) => i.name === "Gated")).toBe(false);
    expect(
      visibleItems(gated, ["x.view"]).some((i) => i.name === "Gated"),
    ).toBe(true);
  });

  it("drops a parent left with no children", () => {
    // "All gated" has one child, gated on a permission the caller lacks.
    expect(visibleItems(gated, []).some((i) => i.name === "All gated")).toBe(
      false,
    );
    expect(
      visibleItems(gated, ["z.view"]).some((i) => i.name === "All gated"),
    ).toBe(true);
  });

  it("keeps a parent with one surviving child", () => {
    const group = visibleItems(gated, []).find((i) => i.name === "Group");
    expect(group?.subItems?.map((s) => s.name)).toEqual(["Open"]);
  });

  it("does not mutate the source array", () => {
    const before = JSON.stringify(gated.map((i) => i.subItems?.length ?? null));
    visibleItems(gated, []);
    expect(JSON.stringify(gated.map((i) => i.subItems?.length ?? null))).toBe(
      before,
    );
  });
});

describe("visibleSections", () => {
  const sections: NavSection[] = [
    { id: "a", title: "A", items: [{ name: "Open", icon: null, path: "/a" }] },
    {
      id: "b",
      title: "B",
      items: [{ name: "Shut", icon: null, path: "/b", permission: "b.view" }],
    },
  ];

  it("drops a section whose groups all filtered away", () => {
    expect(visibleSections(sections, []).map((s) => s.id)).toEqual(["a"]);
  });

  it("keeps a section once the caller holds its permission", () => {
    expect(visibleSections(sections, ["b.view"]).map((s) => s.id)).toEqual([
      "a",
      "b",
    ]);
  });

  /**
   * A Field Employee holds few permissions and must still land somewhere with a
   * usable menu: Operations (the ungated field entries) and Account (the
   * notification entries Rule 53 makes mandatory) survive an empty set.
   */
  it("leaves an unpermissioned caller with Operations and Account", () => {
    expect(visibleSections(navSections, []).map((s) => s.id)).toEqual([
      "operations",
      "account",
    ]);
  });
});

describe("resolveActivePath", () => {
  it("matches a list route exactly", () => {
    expect(resolveActivePath(navSections, "/customers")).toBe("/customers");
  });

  it("matches a detail route to its list entry", () => {
    expect(resolveActivePath(navSections, "/customers/abc123")).toBe(
      "/customers",
    );
    expect(resolveActivePath(navSections, "/loans/applications/new")).toBe(
      "/loans/applications",
    );
    expect(resolveActivePath(navSections, "/finance/journals/j1/edit")).toBe(
      "/finance/journals",
    );
  });

  /**
   * The root would otherwise prefix-match every route in the application and
   * leave Dashboard permanently highlighted.
   */
  it("never prefix-matches the root", () => {
    expect(resolveActivePath(navSections, "/")).toBe("/");
    expect(resolveActivePath(navSections, "/customers")).not.toBe("/");
    expect(resolveActivePath(navSections, "/nothing-in-the-menu")).toBeNull();
  });

  /**
   * Segment boundary, not a bare string prefix: `/loans/collections` must not
   * claim a sibling route whose name merely starts with it.
   */
  it("respects segment boundaries", () => {
    expect(
      resolveActivePath(navSections, "/loans/collections-archive"),
    ).toBeNull();
  });

  /**
   * Two entries can both match one pathname. The longer claim wins, so the
   * specific screen is highlighted rather than its parent.
   */
  it("prefers the longest match when two entries both apply", () => {
    expect(resolveActivePath(navSections, "/notifications/preferences")).toBe(
      "/notifications/preferences",
    );
    expect(resolveActivePath(navSections, "/notifications")).toBe(
      "/notifications",
    );
  });

  /** `/notifications` is exact, so a detail route does not steal Preferences. */
  it("does not match an exact entry against its subtree", () => {
    expect(resolveActivePath(navSections, "/notifications/n1")).toBeNull();
  });

  /** `/field` is exact so it does not claim the six screens beneath it. */
  it("keeps Field Dashboard from claiming the field subtree", () => {
    expect(resolveActivePath(navSections, "/field")).toBe("/field");
    expect(resolveActivePath(navSections, "/field/cash-handovers/h1")).toBe(
      "/field/cash-handovers",
    );
  });

  /** `/recovery-actions/{id}` has no list route; it belongs to Recovery Cases. */
  it("routes a recovery action to Recovery Cases", () => {
    expect(resolveActivePath(navSections, "/recovery-actions/a1")).toBe(
      "/recovery-cases",
    );
    expect(resolveActivePath(navSections, "/recovery-cases/c1")).toBe(
      "/recovery-cases",
    );
  });
});

/**
 * Every menu path resolves to a real page.
 *
 * A link added to the nav without its page is invisible in a render test of the
 * pages themselves — the sidebar entry for Branch Settings pointed at a 404 and
 * only following the link caught it. This catches the next one without a
 * browser.
 */
describe("route coverage", () => {
  const appDir = path.resolve(__dirname, "../app");

  /** URL pathnames served by a `page.tsx`, with route groups stripped. */
  function routes(dir: string, prefix = ""): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        // `(admin)` and friends are organizational only; they are not segments.
        const segment = /^\(.*\)$/.test(entry) ? prefix : `${prefix}/${entry}`;
        found.push(...routes(full, segment));
      } else if (entry === "page.tsx") {
        found.push(prefix === "" ? "/" : prefix);
      }
    }
    return found;
  }

  const served = routes(appDir);

  /** Whether a concrete pathname is served, allowing for `[param]` segments. */
  function isServed(pathname: string): boolean {
    const wanted = pathname.split("/");
    return served.some((route) => {
      const parts = route.split("/");
      if (parts.length !== wanted.length) return false;
      return parts.every(
        (part, i) => part === wanted[i] || /^\[.*\]$/.test(part),
      );
    });
  }

  it("finds the app directory", () => {
    // Guards the rest: a wrong path would make every assertion below vacuous.
    expect(served.length).toBeGreaterThan(50);
    expect(served).toContain("/");
  });

  for (const entry of allEntries()) {
    it(`"${entry.group} → ${entry.name}" (${entry.path}) has a page`, () => {
      expect(isServed(entry.path)).toBe(true);
    });
  }

  /**
   * A query string in a nav path is always a bug: `usePathname()` excludes it,
   * so the entry can never be highlighted. The Unread entry was exactly this.
   */
  it("has no path carrying a query string or fragment", () => {
    for (const entry of allEntries()) {
      expect(entry.path).not.toMatch(/[?#]/);
    }
  });

  it("has no duplicate destinations", () => {
    const paths = allEntries().map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("permissions", () => {
  const known = new Set<string>(Object.values(PERMISSIONS));

  it("references only codes in the permission catalog", () => {
    for (const entry of allEntries()) {
      if (entry.permission) expect(known).toContain(entry.permission);
    }
  });

  /**
   * Rules 47 and 53 make some notifications mandatory for users who hold no
   * notification permission, so the screen where they are read must not be
   * gated. Pinned because it looks like an omission.
   */
  it("leaves the notification reading surfaces ungated", () => {
    const ungated = allEntries()
      .filter((e) => !e.permission)
      .map((e) => e.path);
    expect(ungated).toContain("/notifications");
    expect(ungated).toContain("/notifications/preferences");
  });
});
