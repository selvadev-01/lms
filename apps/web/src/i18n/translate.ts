import type { Locale } from "./locale";
import { en, type MessageKey } from "./messages/en";
import { ta } from "./messages/ta";

const CATALOGUES = { en, ta } as const;

export type TParams = Record<string, string | number>;

/**
 * Fills `{name}` placeholders.
 *
 * Named rather than positional because Tamil reorders arguments relative to
 * English — `{count} {frequency} periods` becomes `{count} {frequency}
 * காலங்கள்` in one sentence and can move entirely in another. An unmatched
 * placeholder is left as written rather than blanked, so a typo in a key is
 * visible in the UI instead of silently producing a hole in a sentence.
 */
function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export type TranslateFn = (key: MessageKey, params?: TParams) => string;

export function makeT(locale: Locale): TranslateFn {
  return function t(key, params) {
    /**
     * The English fallback cannot fire for a statically-typed key — `Messages`
     * already guarantees every locale has every key. It exists for keys built
     * at runtime (`loans.completeness.label.${check.key}`), where the API may
     * name a reason this build has never seen. Callers of that shape must also
     * guard with `key in en`; this is the second line of defence, so a new
     * enum value degrades to English rather than rendering a raw key.
     */
    const template = CATALOGUES[locale][key] ?? en[key];

    if (template === undefined) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[i18n] missing message: ${key}`);
      }
      return key;
    }

    return interpolate(template, params);
  };
}

/** Whether a runtime-built key actually exists, before casting it. */
export function isMessageKey(key: string): key is MessageKey {
  return key in en;
}
