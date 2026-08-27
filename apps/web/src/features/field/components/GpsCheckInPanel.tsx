"use client";

import type { GpsCheckInSummary } from "@lms/types";
import { Alert, Button } from "@lms/ui";
import { useRouter } from "next/navigation";
import React, {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { reportCheckInFailureAction } from "../actions/report-check-in-failure.action";
import {
  submitCheckInAction,
  type CheckInState,
} from "../actions/submit-check-in.action";
import { useGeolocation } from "../hooks/use-geolocation";
import { useNetworkStatus } from "../hooks/use-network-status";
import { OfflineModeNotice } from "./OfflineModeNotice";

interface GpsCheckInPanelProps {
  /** Already-verified check-in, if the caller holds one. */
  verifiedCheckIn: GpsCheckInSummary | null;
  /** Acquisition timeout in seconds, from server config. */
  timeoutSeconds: number;
  validityHours: number;
  /** True when the status could not be loaded — distinct from "not verified". */
  loadError?: boolean;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The GPS Check-in screen.
 *
 * This is the one place in the app where a browser API has to run before a
 * Server Action can, so it departs from the usual uncontrolled-form pattern:
 * the position is captured client-side, written into hidden inputs, and the
 * form is submitted programmatically. Everything after that is the ordinary
 * `useActionState` flow, and the server re-validates what the hidden inputs
 * contain — they are a transport, not a trust boundary.
 *
 * Two forms rather than one, because the two outcomes carry genuinely
 * different payloads: a captured position goes to the check-in endpoint, while
 * a device-side failure has no position at all and goes to the failure
 * endpoint so that it is still recorded and audited.
 */
export function GpsCheckInPanel({
  verifiedCheckIn,
  timeoutSeconds,
  validityHours,
  loadError = false,
}: GpsCheckInPanelProps) {
  const router = useRouter();
  const online = useNetworkStatus();
  const { acquire, acquiring } = useGeolocation({
    timeoutMs: timeoutSeconds * 1000,
  });

  const [submitState, submitAction] = useActionState<CheckInState, FormData>(
    submitCheckInAction,
    {},
  );
  const [failureState, failureAction] = useActionState<CheckInState, FormData>(
    reportCheckInFailureAction,
    {},
  );

  const submitFormRef = useRef<HTMLFormElement>(null);
  const failureFormRef = useRef<HTMLFormElement>(null);

  /**
   * The captured attempt, waiting to be submitted.
   *
   * Held in state rather than written straight to the DOM so React owns the
   * hidden inputs. The submit happens in an effect below, once React has
   * actually committed them — calling `requestSubmit()` inline (or in a
   * microtask) would serialize a form whose inputs do not exist yet, and the
   * server would reject the empty payload.
   */
  const [pending, setPending] = useState<Record<string, string> | null>(null);
  const [failurePending, setFailurePending] = useState<Record<
    string,
    string
  > | null>(null);

  useEffect(() => {
    if (pending) submitFormRef.current?.requestSubmit();
  }, [pending]);

  useEffect(() => {
    if (failurePending) failureFormRef.current?.requestSubmit();
  }, [failurePending]);

  /**
   * Which of the two actions produced the outcome now on screen.
   *
   * The panel drives two independent `useActionState` hooks, and neither
   * clears the other. Without tracking this, a failure message would outlive
   * the successful retry that followed it — the user would fix their
   * permissions, verify, and still be told the permission was blocked.
   */
  const [lastAttempt, setLastAttempt] = useState<"submit" | "failure" | null>(
    null,
  );

  const verified =
    (lastAttempt === "submit" && submitState.verified === true) ||
    (lastAttempt === null && verifiedCheckIn !== null);

  const message =
    lastAttempt === "submit"
      ? submitState.message
      : lastAttempt === "failure"
        ? failureState.message
        : undefined;

  const busy = acquiring;

  const startCheckIn = useCallback(async () => {
    // A fresh id per attempt, so a retry is a new authoritative record while a
    // double submit of the *same* attempt is deduplicated server-side.
    const clientAttemptId = crypto.randomUUID();
    const result = await acquire();

    if (result.kind === "success") {
      setLastAttempt("submit");
      setPending({
        clientAttemptId,
        latitude: String(result.latitude),
        longitude: String(result.longitude),
        accuracyMeters:
          result.accuracyMeters === null ? "" : String(result.accuracyMeters),
        locationTimestamp: result.locationTimestamp,
        permissionStatus: "GRANTED",
        // Read at submit time rather than reusing the render-time value: the
        // connection can drop during acquisition, and the server must be told
        // what was true when the position was sent.
        networkStatus: navigator.onLine ? "ONLINE" : "OFFLINE",
      });
      return;
    }

    setLastAttempt("failure");
    setFailurePending({
      clientAttemptId,
      permissionStatus: result.permissionStatus,
      networkStatus: navigator.onLine ? "ONLINE" : "OFFLINE",
      failureReason: result.failureReason,
    });
  }, [acquire]);

  if (!online) {
    return <OfflineModeNotice />;
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
        GPS Check-in
      </h3>
      <p className="mt-1 mb-6 text-sm text-gray-500 dark:text-gray-400">
        Verify your current location to begin field operations. A verified
        check-in lasts {validityHours} hours or until you sign out.
      </p>

      {/* Alert has no built-in live region, so announcements are wrapped. */}
      <div role="alert" aria-live="assertive">
        {loadError && !message && (
          <div className="mb-4">
            <Alert
              variant="warning"
              title="Check-in status unavailable"
              message="We could not confirm whether you are checked in. Try verifying your location again."
            />
          </div>
        )}

        {message && (
          <div className="mb-4">
            <Alert
              variant="error"
              title="Location not verified"
              message={message}
            />
          </div>
        )}

        {verified && !message && (
          <div className="mb-4">
            <Alert
              variant="success"
              title="Location verified"
              message={
                lastAttempt === null && verifiedCheckIn
                  ? `Verified at ${formatTimestamp(verifiedCheckIn.verifiedAt ?? verifiedCheckIn.createdAt)}.`
                  : "Your location has been verified. You can continue to field operations."
              }
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={startCheckIn} disabled={busy}>
          {busy
            ? "Finding your location…"
            : verified || message
              ? "Check location again"
              : "Verify my location"}
        </Button>

        {verified && (
          <Button variant="outline" onClick={() => router.push("/field")}>
            Continue to field operations
          </Button>
        )}
      </div>

      {busy && (
        <p
          className="mt-3 text-sm text-gray-500 dark:text-gray-400"
          role="status"
          aria-live="polite"
        >
          Waiting for your device to report a position. This can take up to{" "}
          {timeoutSeconds} seconds.
        </p>
      )}

      {/*
        Both forms are submitted programmatically once the browser has answered.
        They carry no visible controls, so there is nothing for a user to submit
        by hand and nothing to tab into.
      */}
      <form ref={submitFormRef} action={submitAction} className="hidden">
        {Object.entries(pending ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} readOnly />
        ))}
      </form>

      <form ref={failureFormRef} action={failureAction} className="hidden">
        {Object.entries(failurePending ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} readOnly />
        ))}
      </form>
    </div>
  );
}
