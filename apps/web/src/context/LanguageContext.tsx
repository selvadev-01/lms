"use client";

import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  DEFAULT_LOCALE,
  LANG_STORAGE_KEY,
  isLocale,
  type Locale,
} from "@/i18n/locale";
import { makeT, type TranslateFn } from "@/i18n/translate";

type LanguageContextType = {
  locale: Locale;
  toggleLanguage: () => void;
  t: TranslateFn;
};

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

/**
 * The stored language, or null if there is none to read.
 *
 * Wrapped because the access itself throws rather than returning empty: a
 * browser set to block site data raises on `localStorage`, and the app has to
 * render regardless of whether it can remember anything.
 *
 * Returns a primitive, which is what makes it safe as a `useSyncExternalStore`
 * snapshot — a fresh object each call would re-render forever.
 */
function readStoredLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Notifies React when the choice changes.
 *
 * `storage` fires only for *other* tabs, which is the useful half: switching to
 * Tamil in one tab settles the others. The local write re-renders through
 * `setOverride`, since `storage` does not fire in the tab that wrote it.
 */
function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  /**
   * Read through `useSyncExternalStore` rather than restored in an effect, so
   * there is no second render and no visible flash of English.
   *
   * Hydration is why this is not a plain `useState` initializer. ThemeContext
   * gets to seed itself from the DOM because a theme only changes CSS classes,
   * which `suppressHydrationWarning` on <html> covers. Language changes text
   * *content*, which React never suppresses: returning the stored locale on the
   * client's first pass would make its markup differ from the server's, and
   * React responds by throwing the tree away. This hook returns the server
   * snapshot until hydration finishes and the stored one after, so React never
   * compares mismatched trees.
   */
  const stored = useSyncExternalStore(
    subscribeToStorage,
    readStoredLocale,
    () => null, // The server has no preference to report.
  );
  const [override, setOverride] = useState<Locale | null>(null);

  // This session's choice wins over the stored one, which wins over English.
  const locale = override ?? stored ?? DEFAULT_LOCALE;

  /**
   * Mirrors the locale onto <html lang>, which the pre-hydration script has
   * already set for the first paint. Keeping it in sync afterwards is what
   * drives the Tamil font stack and the lang-scoped line-height, and it is what
   * a screen reader reads to pick a voice.
   */
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const toggleLanguage = useCallback(() => {
    const next: Locale = locale === "en" ? "ta" : "en";
    setOverride(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Storage blocked (private mode, or the browser refuses site data). The
      // toggle still works for this session; it just will not persist, which is
      // not worth interrupting the user over.
    }
  }, [locale]);

  /**
   * `makeT` closes over the locale, so it allocates a new function every
   * render. Without the memo, every consumer re-renders whenever the provider
   * does, not only when the language actually changes.
   */
  const value = useMemo(
    () => ({ locale, toggleLanguage, t: makeT(locale) }),
    [locale, toggleLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
};

/** The common case: a component needs to translate, not to switch. */
export const useT = (): TranslateFn => useLanguage().t;
