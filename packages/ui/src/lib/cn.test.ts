import { describe, expect, it } from "vitest";

import { cx } from "./cn";

/**
 * These tests exist because every failure mode of a mis-configured
 * `tailwind-merge` is silent: nothing throws, the component still renders, and
 * the wrong style only shows up if a human happens to look at the right
 * element in the right state. The assertions below are the only thing standing
 * between a custom scale and stylesheet-order roulette.
 */
describe("cx", () => {
  it("lets a caller override a component default", () => {
    // The whole reason the helper exists.
    expect(cx("px-4", "px-8")).toBe("px-8");
  });

  it("keeps non-conflicting classes", () => {
    expect(cx("flex items-center", "gap-2")).toBe("flex items-center gap-2");
  });

  it("drops falsy values so conditionals read cleanly", () => {
    // Mirrors the real call shape `cx("flex", isHidden && "hidden", ...)`.
    const isHidden = false as boolean;
    expect(cx("flex", isHidden && "hidden", undefined, null, "gap-2")).toBe(
      "flex gap-2",
    );
  });

  describe("custom scales (would silently break without extendTailwindMerge)", () => {
    it("treats the custom type scale as one group", () => {
      expect(cx("text-theme-sm", "text-theme-xs")).toBe("text-theme-xs");
      expect(cx("text-title-md", "text-title-sm")).toBe("text-title-sm");
    });

    it("does not confuse a semantic text colour with a font size", () => {
      // The dangerous case: if `text-ink` were filed as a font-size, the later
      // size class would evict the colour and the text would render in the
      // inherited colour instead.
      expect(cx("text-ink", "text-theme-sm")).toBe("text-ink text-theme-sm");
      expect(cx("text-theme-sm", "text-ink")).toBe("text-theme-sm text-ink");
    });

    it("still resolves two semantic text colours against each other", () => {
      expect(cx("text-ink", "text-ink-muted")).toBe("text-ink-muted");
      expect(cx("text-critical", "text-ink")).toBe("text-ink");
    });

    it("treats the custom shadow scale as one group", () => {
      expect(cx("shadow-theme-xs", "shadow-panel")).toBe("shadow-panel");
      expect(cx("shadow-panel", "shadow-raised")).toBe("shadow-raised");
    });

    it("treats the custom radii as part of the rounded group", () => {
      expect(cx("rounded-panel", "rounded-control")).toBe("rounded-control");
      // Custom radius vs a stock one must also resolve.
      expect(cx("rounded-lg", "rounded-panel")).toBe("rounded-panel");
    });

    it("resolves semantic background colours against stock ones", () => {
      expect(cx("bg-white", "bg-surface")).toBe("bg-surface");
      expect(cx("bg-surface", "bg-accent")).toBe("bg-accent");
    });
  });
});
