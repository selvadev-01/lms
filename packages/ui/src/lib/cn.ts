import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes so a caller's `className` reliably wins over a
 * component's defaults.
 *
 * Why this is not just `clsx`: Tailwind emits both `px-4` and `px-8` as real
 * rules, so `class="px-4 px-8"` is decided by *stylesheet order*, not by which
 * one the caller passed last. `twMerge` drops the earlier conflicting class so
 * the later one actually applies.
 *
 * WHY THE CONFIG BELOW MATTERS
 * `tailwind-merge` ships knowing Tailwind's stock scales only. This design
 * system adds custom ones (`text-theme-sm`, `shadow-theme-xs`, the semantic
 * colours). Left unconfigured, twMerge would:
 *   - not know `text-theme-sm` and `text-theme-xs` conflict, so both survive
 *     and stylesheet order silently decides; and
 *   - misfile `text-ink` as a font-size (it cannot tell colour from size for
 *     an unknown suffix), so `text-ink text-theme-sm` could drop the colour.
 * Neither failure throws, renders an obvious defect, or shows up in a test —
 * it just produces the wrong style occasionally. Hence the explicit groups.
 */

const TEXT_SIZES = [
  "title-2xl",
  "title-xl",
  "title-lg",
  "title-md",
  "title-sm",
  "theme-xl",
  "theme-sm",
  "theme-xs",
] as const;

/** Semantic text colours from packages/design-tokens/src/semantic.css. */
const TEXT_COLORS = [
  "ink",
  "ink-muted",
  "ink-subtle",
  "ink-inverted",
  "accent",
  "accent-ink",
  "positive",
  "positive-ink",
  "caution",
  "caution-ink",
  "critical",
  "critical-ink",
  "info",
  "info-ink",
] as const;

const SHADOWS = [
  "theme-xs",
  "theme-sm",
  "theme-md",
  "theme-lg",
  "theme-xl",
  "panel",
  "raised",
  "focus-ring",
  "tooltip",
  "datepicker",
  "slider-navigation",
] as const;

const RADII = ["panel", "control"] as const;

export const cn = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TEXT_SIZES] }],
      "text-color": [{ text: [...TEXT_COLORS] }],
      shadow: [{ shadow: [...SHADOWS] }],
      rounded: [{ rounded: [...RADII] }],
    },
  },
});

/**
 * The call signature every component uses: variadic, conditional-friendly,
 * conflict-aware. `cx(...)` composes the class list; `cn` resolves conflicts.
 */
export function cx(...inputs: ClassValue[]): string {
  return cn(clsx(inputs));
}
