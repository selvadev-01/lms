"use client";

import React from "react";

import { useLanguage } from "@/context/LanguageContext";

/**
 * Switches instruction copy between English and Tamil.
 *
 * Sized to match ThemeToggleButton exactly (h-11 w-11, same border and hover
 * treatment) so the header cluster stays even.
 */
export const LanguageToggleButton: React.FC = () => {
  const { locale, toggleLanguage } = useLanguage();
  const nextLanguage = locale === "en" ? "Tamil" : "English";

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      /* Chrome, not instruction copy, so it stays English in both modes —
         a reader who has the app in English must still be able to find this
         control by its accessible name. */
      aria-label={`Show instructions in ${nextLanguage}`}
      title={`Show instructions in ${nextLanguage}`}
      className="hover:text-dark-900 relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
    >
      {/* Shows the language you would switch *to*, matching the theme toggle,
          which shows the icon of the mode it will put you in. */}
      <span aria-hidden="true">{locale === "en" ? "த" : "EN"}</span>
    </button>
  );
};
