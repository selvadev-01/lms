"use client";

import type { SessionSummary } from "@lms/types";
import { Alert, Badge, Button } from "@lms/ui";
import React, { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  revokeSessionAction,
  type RevokeSessionState,
} from "../actions/revoke-session.action";
import { revokeAllSessionsAction } from "../actions/revoke-all-sessions.action";

/**
 * Formats a timestamp for display.
 *
 * Asia/Kolkata is pinned rather than left to the browser: an LMS operator
 * reading a security screen needs the branch's local time, not the time zone of
 * whatever device they happen to be on.
 */
function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Condenses a user agent into something a person can recognise.
 *
 * Deliberately coarse. The point is to help someone answer "is that me?", and a
 * full UA string is both unreadable and more fingerprinting detail than the
 * screen needs.
 */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";

  const platform = /Android/i.test(userAgent)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? "iOS"
      : /Windows/i.test(userAgent)
        ? "Windows"
        : /Macintosh|Mac OS/i.test(userAgent)
          ? "macOS"
          : /Linux/i.test(userAgent)
            ? "Linux"
            : "Unknown platform";

  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /Chrome\//i.test(userAgent)
      ? "Chrome"
      : /Safari\//i.test(userAgent)
        ? "Safari"
        : /Firefox\//i.test(userAgent)
          ? "Firefox"
          : "Unknown browser";

  return `${browser} on ${platform}`;
}

function RevokeButton({ isCurrent }: { isCurrent: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant="outline" disabled={pending}>
      {pending ? "Ending…" : isCurrent ? "Sign out" : "End session"}
    </Button>
  );
}

function RevokeAllButton() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant="outline" disabled={pending}>
      {pending ? "Signing out…" : "Sign out everywhere else"}
    </Button>
  );
}

export interface ActiveSessionsListProps {
  sessions: SessionSummary[];
  /** Set when the session list could not be loaded, rather than being empty. */
  loadError?: boolean;
}

/**
 * Active Sessions — the sessions currently able to act as this user.
 *
 * Every session shown is one that can reach protected data right now, so the
 * screen's job is to make an unfamiliar one easy to spot and easy to end.
 *
 * Revocation is enforced entirely server-side; this list is presentation. A
 * session hidden here would still work, which is why the API checks the session
 * row on every request rather than trusting anything this component does.
 */
export default function ActiveSessionsList({
  sessions,
  loadError = false,
}: ActiveSessionsListProps) {
  const [revokeState, revokeAction] = useActionState<
    RevokeSessionState,
    FormData
  >(revokeSessionAction, {});
  const [revokeAllState, revokeAllAction] = useActionState<
    RevokeSessionState,
    FormData
  >(revokeAllSessionsAction, {});

  const message = revokeState.message ?? revokeAllState.message;
  const success = revokeState.success ?? revokeAllState.success;
  const otherSessionCount = sessions.filter((s) => !s.isCurrent).length;

  if (loadError) {
    return (
      <div role="alert" aria-live="assertive">
        <Alert
          variant="error"
          title="Sessions unavailable"
          message="We could not load your active sessions. Please try again shortly."
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mb-5 sm:mb-8">
        <h3 className="text-title-sm mb-2 font-semibold text-gray-800 dark:text-white/90">
          Active Sessions
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          These are the devices currently signed in to your account. If you do
          not recognise one, end it — that device will be signed out
          immediately.
        </p>
      </div>

      {/* Alert has no built-in live region, so outcomes are announced here. */}
      <div role="alert" aria-live="assertive">
        {message && (
          <div className="mb-5">
            <Alert
              variant="error"
              title="Could not end session"
              message={message}
            />
          </div>
        )}
        {success && (
          <div className="mb-5">
            <Alert variant="success" title="Session ended" message={success} />
          </div>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No active sessions to show.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">
              Your active sessions, newest first
            </caption>
            <thead className="border-b border-gray-200 dark:border-gray-800">
              <tr className="text-gray-500 dark:text-gray-400">
                <th scope="col" className="px-3 py-3 font-medium">
                  Device
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Signed in
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  Last activity
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  IP address
                </th>
                <th scope="col" className="px-3 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.sessionId}
                  className="border-b border-gray-100 dark:border-gray-800"
                >
                  <td className="px-3 py-3 text-gray-700 dark:text-gray-300">
                    <span className="flex items-center gap-2">
                      {describeDevice(session.userAgent)}
                      {session.isCurrent && (
                        <Badge color="success" size="sm">
                          This device
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-500 dark:text-gray-400">
                    {formatTimestamp(session.issuedAt)}
                  </td>
                  <td className="px-3 py-3 text-gray-500 dark:text-gray-400">
                    {formatTimestamp(session.lastSeenAt)}
                  </td>
                  <td className="px-3 py-3 text-gray-500 dark:text-gray-400">
                    {session.ipAddress ?? "Unknown"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <form action={revokeAction}>
                      <input
                        type="hidden"
                        name="sessionId"
                        value={session.sessionId}
                      />
                      <RevokeButton isCurrent={session.isCurrent} />
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {otherSessionCount > 0 && (
        <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
          <form action={revokeAllAction}>
            <RevokeAllButton />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Ends every session except this one. You will stay signed in here.
            </p>
          </form>
        </div>
      )}
    </div>
  );
}
