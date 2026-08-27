"use client";

import type { NotificationSummary } from "@lms/types";
import { Dropdown, DropdownItem } from "@lms/ui";
import Link from "next/link";
import { useEffect, useState } from "react";

/** How many recent notifications the dropdown shows. */
const PREVIEW_COUNT = 5;

/**
 * How often the badge refreshes, in milliseconds.
 *
 * Sixty seconds because `/notifications/unread-count` is throttled at 120 a
 * minute and the list below it at 60. A tighter poll would rate-limit a user
 * out of their own application — the bell renders on every admin page, so this
 * timer runs for as long as someone is signed in.
 */
const POLL_MS = 60_000;

/**
 * The header notification bell.
 *
 * # It polls the count, not the list
 *
 * The badge needs one number; fetching the full list every minute to derive it
 * would cost far more and hit the tighter of the two rate limits. The list is
 * fetched once when the dropdown is opened, which is also when it is worth
 * being current.
 *
 * # It marks nothing read
 *
 * Opening the dropdown does not clear the badge — the stub this replaced did,
 * and it was wrong. Rule 47 makes some notifications mandatory operational
 * alerts, and Scenario 59 makes acknowledgement auditable evidence. Glancing at
 * a bell is not acknowledgement; marking read is an explicit act, taken in the
 * notification centre.
 */
export default function NotificationDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // `cancelled` rather than an AbortController: the fetch itself is cheap and
    // harmless to complete, and what must not happen is a state update after
    // unmount — which is what a navigation mid-poll would otherwise cause.
    let cancelled = false;

    async function refreshCount() {
      try {
        const response = await fetch("/api/notifications/unread-count", {
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { unreadCount?: number };
        if (!cancelled) setUnreadCount(body.unreadCount ?? 0);
      } catch {
        // A failed poll leaves the last known count. The bell is an affordance,
        // not a source of truth, and a transient network error should not make
        // it announce zero.
      }
    }

    // Deferred to a macrotask rather than called synchronously here: a
    // `setState` during the effect pass triggers a cascading render, and this
    // component mounts on every admin page.
    const first = setTimeout(() => void refreshCount(), 0);
    const timer = setInterval(() => void refreshCount(), POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  async function openDropdown() {
    setIsOpen(true);
    setLoading(true);
    try {
      const response = await fetch(
        `/api/notifications?pageSize=${PREVIEW_COUNT}`,
        { cache: "no-store" },
      );
      if (response.ok) {
        const body = (await response.json()) as {
          items?: NotificationSummary[];
          unreadCount?: number;
        };
        setItems(body.items ?? []);
        setUnreadCount(body.unreadCount ?? 0);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        className="dropdown-toggle relative flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        onClick={() => (isOpen ? setIsOpen(false) : void openDropdown())}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={isOpen}
      >
        <span
          className={`absolute top-0.5 right-0 z-10 h-2 w-2 rounded-full bg-orange-400 ${
            unreadCount === 0 ? "hidden" : "flex"
          }`}
          aria-hidden="true"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
        </span>

        <svg
          className="fill-current"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M10.75 2.29248C10.75 1.87827 10.4143 1.54248 10 1.54248C9.58583 1.54248 9.25004 1.87827 9.25004 2.29248V2.83613C6.08266 3.20733 3.62504 5.9004 3.62504 9.16748V14.4591H3.33337C2.91916 14.4591 2.58337 14.7949 2.58337 15.2091C2.58337 15.6234 2.91916 15.9591 3.33337 15.9591H16.6667C17.0809 15.9591 17.4167 15.6234 17.4167 15.2091C17.4167 14.7949 17.0809 14.4591 16.6667 14.4591H16.375V9.16748C16.375 5.9004 13.9174 3.20733 10.75 2.83613V2.29248ZM14.875 14.4591V9.16748C14.875 6.47509 12.6924 4.29248 10 4.29248C7.30765 4.29248 5.12504 6.47509 5.12504 9.16748V14.4591H14.875ZM8.00004 17.7085C8.00004 18.1228 8.33583 18.4585 8.75004 18.4585H11.25C11.6643 18.4585 12 18.1228 12 17.7085C12 17.2943 11.6643 16.9585 11.25 16.9585H8.75004C8.33583 16.9585 8.00004 17.2943 8.00004 17.7085Z"
            fill="currentColor"
          />
        </svg>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        className="shadow-theme-lg dark:bg-gray-dark absolute -right-[240px] mt-[17px] flex max-h-[480px] w-[350px] flex-col rounded-2xl border border-gray-200 bg-white p-3 sm:w-[361px] lg:right-0 dark:border-gray-800"
      >
        <div className="mb-3 flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-700">
          <h5 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
            Notifications
          </h5>
          <button
            onClick={() => setIsOpen(false)}
            className="dropdown-toggle text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            aria-label="Close notifications"
          >
            <svg
              className="fill-current"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>

        <ul className="custom-scrollbar flex h-auto flex-col overflow-y-auto">
          {loading ? (
            <li className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              Loading…
            </li>
          ) : items.length === 0 ? (
            <li className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              Nothing new.
            </li>
          ) : (
            items.map((item) => (
              <li key={item.notificationId}>
                <DropdownItem
                  onItemClick={() => setIsOpen(false)}
                  className="flex gap-3 rounded-lg border-b border-gray-100 px-4.5 py-3 hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-white/5"
                  href={`/notifications/${item.notificationId}`}
                >
                  <span className="block">
                    <span
                      className={`text-theme-sm mb-1.5 block ${
                        item.readStatus
                          ? "text-gray-500 dark:text-gray-400"
                          : "font-medium text-gray-800 dark:text-white/90"
                      }`}
                    >
                      {item.title}
                    </span>
                    <span className="text-theme-xs line-clamp-2 block text-gray-500 dark:text-gray-400">
                      {item.message}
                    </span>
                  </span>
                </DropdownItem>
              </li>
            ))
          )}
        </ul>

        <Link
          href="/notifications"
          onClick={() => setIsOpen(false)}
          className="mt-3 block rounded-lg border border-gray-300 bg-white px-4 py-2 text-center text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          View all notifications
        </Link>
      </Dropdown>
    </div>
  );
}
