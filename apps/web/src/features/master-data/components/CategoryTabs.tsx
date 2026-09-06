"use client";

import type { MasterDataCategory } from "@lms/validation";
import Link from "next/link";
import React from "react";

/**
 * Which option list is being managed.
 *
 * Links rather than local state, so the selected list lives in the URL: an admin
 * who deep-links to the document types, or refreshes after an edit, lands back
 * on the list they were working in. Local state would reset to the first tab
 * after every server action revalidates the page.
 */
export const CATEGORY_LABELS: Record<MasterDataCategory, string> = {
  GENDER: "Gender",
  RELATIONSHIP: "Guarantor relationship",
  LOAN_PURPOSE: "Loan purpose",
  DOCUMENT_TYPE: "Document type",
  LOAN_TYPE: "Loan type",
};

export default function CategoryTabs({
  categories,
  active,
}: {
  categories: readonly MasterDataCategory[];
  active: MasterDataCategory;
}) {
  return (
    <nav
      aria-label="Option lists"
      className="flex flex-wrap gap-2 border-b border-gray-200 pb-3 dark:border-gray-800"
    >
      {categories.map((category) => {
        const selected = category === active;

        return (
          <Link
            key={category}
            href={`/settings/master-data?category=${category}`}
            aria-current={selected ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              selected
                ? "bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 font-medium"
                : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.03]"
            }`}
          >
            {CATEGORY_LABELS[category]}
          </Link>
        );
      })}
    </nav>
  );
}
