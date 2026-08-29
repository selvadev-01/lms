import { navSections, visibleSections } from "@/layout/nav-items";

import type { SearchHit } from "./types";

/**
 * The navigable screens, searched entirely in the browser.
 *
 * Derived from `navSections` rather than listed again here: the sidebar is
 * already the authoritative index of every screen a user can reach, and a
 * second copy would start drifting from it the first time a menu entry was
 * renamed. It also inherits the permission filtering for free, so a user is
 * never offered a page the menu would not show them.
 *
 * No request is made for any of this. That is what makes typing cheap: the
 * common "jump to Customers" case costs nothing against the 60-per-minute
 * budget, and only a record lookup reaches the network.
 */

export interface PageEntry {
  /** "Customers", the leaf's own name. */
  name: string;
  /** "Operations › Customer Management", so two same-named leaves are */
  /** distinguishable — Reports has both "Applications" and "Overdue & */
  /** Recovery", which are also group names elsewhere. */
  context: string;
  path: string;
}

/** Flattens the visible menu into leaves. */
export function pageIndex(permissions: string[]): PageEntry[] {
  const entries: PageEntry[] = [];

  for (const section of visibleSections(navSections, permissions)) {
    for (const item of section.items) {
      if (item.subItems) {
        for (const sub of item.subItems) {
          entries.push({
            name: sub.name,
            context: `${section.title} › ${item.name}`,
            path: sub.path,
          });
        }
      } else if (item.path) {
        entries.push({
          name: item.name,
          context: section.title,
          path: item.path,
        });
      }
    }
  }

  return entries;
}

/**
 * Ranks pages against a typed term.
 *
 * Tiered rather than a plain substring test, because a substring match alone
 * ranks in declaration order: for "trial" it would offer whichever page
 * happened to be listed first over "Trial Balance". The tiers, best first:
 *
 * 0. the whole name — "customers" means the Customers screen, not a screen
 *    whose title merely contains it
 * 1. the name starts with the term — "loan app" → "Loan Applications"
 * 2. a *word* in the name starts with it — "coll" → "EMI Collection", which is
 *    what a reader means by typing the start of a word they can see
 * 3. anywhere in the name
 * 4. the owning group, so "settings" finds the pages under Company Settings
 *    even though none of them is called "Settings"
 *
 * Ties break on name length, so the most specific label wins rather than
 * whichever happened to be declared first.
 */
export function matchPages(
  entries: PageEntry[],
  term: string,
  limit = 6,
): SearchHit[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];

  const scored: { entry: PageEntry; score: number }[] = [];

  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const index = name.indexOf(needle);

    let score: number;
    if (name === needle) score = 0;
    else if (index === 0) score = 1;
    else if (index > 0 && /[\s&]/.test(name[index - 1] ?? "")) score = 2;
    else if (index > 0) score = 3;
    else if (entry.context.toLowerCase().includes(needle)) score = 4;
    else continue;

    scored.push({ entry, score });
  }

  return scored
    .sort(
      (a, b) => a.score - b.score || a.entry.name.length - b.entry.name.length,
    )
    .slice(0, limit)
    .map(({ entry }) => ({
      id: entry.path,
      title: entry.name,
      subtitle: entry.context,
      href: entry.path,
    }));
}
