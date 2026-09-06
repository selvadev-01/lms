import Link from "next/link";
import React from "react";

export interface Crumb {
  label: string;
  /** Omit on the final crumb — the page you are already on is not a link. */
  href?: string;
}

/**
 * Real breadcrumbs.
 *
 * Replaces the fake two-level "Home › {title}" in `common/PageBreadCrumb.tsx`,
 * which claimed a hierarchy the app does not have: a customer's KYC tab sat one
 * level below Home regardless of how deep it actually was.
 *
 * `PageBreadCrumb` stays where it is — ~90 unconverted pages import it.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb">
      <ol className="text-ink-muted flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, index) => {
          const last = index === items.length - 1;

          return (
            <li
              key={`${item.label}-${index}`}
              className="flex items-center gap-1.5"
            >
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="hover:text-ink focus-visible:ring-focus rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  {item.label}
                </Link>
              ) : (
                // The current page is announced as such rather than being a
                // link that goes nowhere.
                <span
                  className={last ? "text-ink" : undefined}
                  aria-current={last ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last ? (
                <span aria-hidden="true" className="text-ink-subtle">
                  /
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
