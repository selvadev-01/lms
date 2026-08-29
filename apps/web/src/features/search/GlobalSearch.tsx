"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { matchPages, pageIndex } from "./pages";
import type { SearchGroup, SearchHit, SearchResponse } from "./types";

/**
 * The header's global search.
 *
 * It replaced an input that was decorative: it had a ⌘K binding that focused
 * it, but no change handler, no submit handler and no results, sitting inside a
 * bare `<form>` — so pressing Enter reloaded the page.
 *
 * # Pages are matched locally, records are fetched
 *
 * Screen navigation is the common case and is answered from `navSections`
 * without a request, so typing costs nothing until a record lookup is actually
 * warranted. Only the record half reaches `/api/search`, debounced, and only
 * once the term is long enough to be selective.
 *
 * # Why the debounce is 400ms and not the wizard's 250ms
 *
 * That one queries a single resource; this fans out to several, and every
 * customer and guarantor list call writes an audit row containing the search
 * term. A shorter interval turns one search into several audit rows per word
 * and spends more of the shared 60-per-minute budget.
 */

/** Long enough to be selective; matches the guard in the route handler. */
const MIN_RECORD_TERM = 2;
const DEBOUNCE_MS = 400;

export default function GlobalSearch({
  permissions,
}: {
  permissions: string[];
}) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);

  const pages = useMemo(() => pageIndex(permissions), [permissions]);
  const pageHits = useMemo(() => matchPages(pages, term), [pages, term]);

  /**
   * Pages first, then records.
   *
   * One flat list so the keyboard can walk everything with one index — the
   * groups below are a rendering concern, not a navigation one.
   */
  const sections: SearchGroup[] = useMemo(
    () => [
      ...(pageHits.length
        ? [{ key: "pages", label: "Pages", hits: pageHits }]
        : []),
      ...groups,
    ],
    [pageHits, groups],
  );

  const flat: SearchHit[] = useMemo(
    () => sections.flatMap((s) => s.hits),
    [sections],
  );

  /**
   * The highlighted row, clamped to the current results.
   *
   * Clamped during render rather than reset by an effect: the result set
   * changes on every keystroke, and an effect that called `setCursor(0)` on
   * each change would render twice per keystroke and flag as a cascading
   * render. Reading `cursor` through this guard means a stored index that has
   * fallen past the end of a now-shorter list simply reads as the first row,
   * with no second pass.
   */
  const active = cursor < flat.length ? cursor : 0;

  /** Debounced record lookup. Pages are already matched synchronously above. */
  useEffect(() => {
    const needle = term.trim();
    const controller = new AbortController();

    const timer = setTimeout(() => {
      if (needle.length < MIN_RECORD_TERM) {
        setGroups([]);
        setFailed([]);
        setError(null);
        return;
      }

      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(needle)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("search failed");
          const body = (await response.json()) as SearchResponse;
          setGroups(body.groups ?? []);
          setFailed(body.failed ?? []);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") {
            return;
          }
          // Explicit, rather than an empty list: "we could not look" is a
          // different statement from "there is no such record".
          setGroups([]);
          setError("Could not search records. Try again.");
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  // ⌘K / Ctrl-K focuses the box from anywhere, as the decorative input did.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // A click outside closes the results but keeps the term, so returning to the
  // box does not mean typing it again.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keeps the highlighted row in view when walking a list taller than the panel.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (href: string) => {
    setOpen(false);
    setTerm("");
    router.push(href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // First Escape closes the panel, a second clears the box — so dismissing
      // the results never costs the term.
      if (open) setOpen(false);
      else setTerm("");
      return;
    }

    if (!flat.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setCursor((active + 1) % flat.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setCursor((active - 1 + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      // The input is not in a form, so this cannot fall through to a submit.
      event.preventDefault();
      const hit = flat[active];
      if (hit) go(hit.href);
    }
  };

  const showPanel = open && term.trim().length > 0;
  const nothing =
    !loading && !error && flat.length === 0 && term.trim().length > 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2">
          <svg
            className="fill-gray-500 dark:fill-gray-400"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M3.04175 9.37363C3.04175 5.87693 5.87711 3.04199 9.37508 3.04199C12.8731 3.04199 15.7084 5.87693 15.7084 9.37363C15.7084 12.8703 12.8731 15.7053 9.37508 15.7053C5.87711 15.7053 3.04175 12.8703 3.04175 9.37363ZM9.37508 1.54199C5.04902 1.54199 1.54175 5.04817 1.54175 9.37363C1.54175 13.6991 5.04902 17.2053 9.37508 17.2053C11.2674 17.2053 13.003 16.5344 14.357 15.4176L17.177 18.238C17.4699 18.5309 17.9448 18.5309 18.2377 18.238C18.5306 17.9451 18.5306 17.4703 18.2377 17.1774L15.418 14.3573C16.5365 13.0033 17.2084 11.2669 17.2084 9.37363C17.2084 5.04817 13.7011 1.54199 9.37508 1.54199Z"
              fill=""
            />
          </svg>
        </span>

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          aria-activedescendant={
            showPanel && flat[active] ? `search-hit-${active}` : undefined
          }
          aria-label="Search pages and records"
          autoComplete="off"
          placeholder="Search pages, customers, applications..."
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="dark:bg-dark-900 shadow-theme-xs focus:border-brand-300 focus:ring-brand-500/10 dark:focus:border-brand-800 h-11 w-full rounded-lg border border-gray-200 bg-transparent py-2.5 pr-14 pl-12 text-sm text-gray-800 placeholder:text-gray-400 focus:ring-3 focus:outline-hidden xl:w-[430px] dark:border-gray-800 dark:bg-gray-900 dark:bg-white/[0.03] dark:text-white/90 dark:placeholder:text-white/30"
        />

        <span className="pointer-events-none absolute top-1/2 right-2.5 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-[7px] py-[4.5px] text-xs -tracking-[0.2px] text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
          <span> ⌘ </span>
          <span> K </span>
        </span>
      </div>

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="shadow-theme-lg absolute right-0 left-0 z-50 mt-2 max-h-[420px] overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 xl:w-[430px] dark:border-gray-800 dark:bg-gray-900"
        >
          {sections.map((section) => (
            <div key={section.key} className="mb-1 last:mb-0">
              <p className="px-2 py-1.5 text-xs font-medium tracking-wide text-gray-400 uppercase dark:text-gray-500">
                {section.label}
              </p>
              <ul>
                {section.hits.map((hit) => {
                  const index = flat.indexOf(hit);
                  const isActive = index === active;
                  return (
                    <li key={`${section.key}-${hit.id}`}>
                      <a
                        ref={isActive ? activeRef : undefined}
                        id={`search-hit-${index}`}
                        role="option"
                        aria-selected={isActive}
                        href={hit.href}
                        onMouseEnter={() => setCursor(index)}
                        onClick={(event) => {
                          // Left-click navigates through the router; modified
                          // clicks are left to the browser so "open in new tab"
                          // still works.
                          if (
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.button !== 0
                          ) {
                            return;
                          }
                          event.preventDefault();
                          go(hit.href);
                        }}
                        className={`flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm ${
                          isActive
                            ? "bg-brand-50 text-brand-600 dark:bg-brand-500/[0.12] dark:text-brand-400"
                            : "text-gray-700 dark:text-gray-300"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {hit.title}
                          </span>
                          {hit.subtitle && (
                            <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                              {hit.subtitle}
                            </span>
                          )}
                        </span>
                        {hit.badge && (
                          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/5 dark:text-gray-400">
                            {hit.badge}
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {/* Announced politely so a screen reader hears the outcome without
              the panel stealing focus mid-typing. */}
          <div aria-live="polite">
            {loading && flat.length === 0 && (
              <p className="px-2 py-3 text-sm text-gray-500 dark:text-gray-400">
                Searching…
              </p>
            )}

            {nothing && (
              <p className="px-2 py-3 text-sm text-gray-500 dark:text-gray-400">
                {term.trim().length < MIN_RECORD_TERM
                  ? "Keep typing to search records."
                  : "No matches."}
              </p>
            )}

            {error && (
              <p className="text-error-500 px-2 py-3 text-sm">{error}</p>
            )}

            {failed.length > 0 && (
              <p className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400">
                Could not search: {failed.join(", ")}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
