/**
 * Instruction language (Module: bilingual help text).
 *
 * Deliberately narrow: this switches *instruction* copy only — hints,
 * explanatory paragraphs, blocked-action messages, validation reasons. Buttons,
 * field labels, navigation, table headers and status badges stay English, so a
 * screen reads as English chrome with guidance in the reader's language.
 *
 * Widening this to the whole UI is a much larger change (~1,500+ strings, and
 * Tamil runs longer than English so button and table layouts need re-testing).
 * Keep that decision explicit rather than letting it happen one key at a time.
 */
export type Locale = "en" | "ta";

export const DEFAULT_LOCALE: Locale = "en";

/**
 * Shared by the provider and the pre-hydration script in the root layout. The
 * script cannot import this module — it is inlined as a string — so the literal
 * is duplicated there. Change both together.
 */
export const LANG_STORAGE_KEY = "lang";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ta";
}
