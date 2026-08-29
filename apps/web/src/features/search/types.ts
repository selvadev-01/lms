/**
 * Shapes shared between the search BFF route and the palette that renders it.
 *
 * Plain types rather than zod schemas: both ends of this contract are in this
 * repository and the route is the only producer, so a runtime re-validation in
 * the browser would guard against nothing a type error would not already catch.
 */

/** One result row. Deliberately flat — the palette renders every resource the */
/** same way, so nothing here is resource-specific. */
export interface SearchHit {
  id: string;
  /** The primary line: a person's name, an application number. */
  title: string;
  /** Disambiguates two hits with the same title (code, masked mobile, owner). */
  subtitle?: string;
  /** A status, shown as a chip. */
  badge?: string;
  href: string;
}

export interface SearchGroup {
  key: string;
  label: string;
  hits: SearchHit[];
}

export interface SearchResponse {
  groups: SearchGroup[];
  /**
   * Resources that could not be reached, by label.
   *
   * Reported rather than dropped: a search that silently omits customers
   * because that lookup failed reads as "no such customer", which is a
   * different statement from "we could not look".
   */
  failed: string[];
}
