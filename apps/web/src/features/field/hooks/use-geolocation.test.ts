import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGeolocation } from "./use-geolocation";

/**
 * The browser-facing half of GPS check-in.
 *
 * The critical property under test is that this NEVER rejects. A denied
 * permission and a timeout are ordinary outcomes of a check-in attempt, not
 * exceptions — returning them as values is what lets the caller record every
 * one as an audited failure instead of losing some to an unhandled rejection
 * (Scenarios 6, 7, 8, 11, 12).
 */

const OPTIONS = { timeoutMs: 30_000 };

function stubGeolocation(
  impl: (
    success: PositionCallback,
    error: PositionErrorCallback,
    options?: PositionOptions,
  ) => void,
) {
  vi.stubGlobal("navigator", {
    onLine: true,
    geolocation: { getCurrentPosition: impl },
  });
}

/** Removes geolocation entirely — an old browser or an insecure origin. */
function stubNoGeolocation() {
  vi.stubGlobal("navigator", { onLine: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useGeolocation", () => {
  it("normalizes a successful position", async () => {
    const timestamp = Date.UTC(2026, 7, 18, 10, 0, 0);
    stubGeolocation((success) =>
      success({
        coords: { latitude: 13.0827, longitude: 80.2707, accuracy: 12.5 },
        timestamp,
      } as GeolocationPosition),
    );

    const { result } = renderHook(() => useGeolocation(OPTIONS));

    const outcome = await act(() => result.current.acquire());

    expect(outcome).toEqual({
      kind: "success",
      latitude: 13.0827,
      longitude: 80.2707,
      accuracyMeters: 12.5,
      locationTimestamp: new Date(timestamp).toISOString(),
    });
  });

  it("nulls a non-finite accuracy rather than passing it on", async () => {
    // The server rejects a missing accuracy; sending NaN would fail its parse
    // instead, turning a recordable failure into a 400 with no audit trail.
    stubGeolocation((success) =>
      success({
        coords: { latitude: 1, longitude: 2, accuracy: Number.NaN },
        timestamp: Date.now(),
      } as GeolocationPosition),
    );

    const { result } = renderHook(() => useGeolocation(OPTIONS));
    const outcome = await act(() => result.current.acquire());

    expect(outcome).toMatchObject({ kind: "success", accuracyMeters: null });
  });

  it.each([
    [1, "DENIED", "PERMISSION_DENIED"],
    [2, "GRANTED", "POSITION_UNAVAILABLE"],
    [3, "GRANTED", "TIMEOUT"],
  ])(
    "maps GeolocationPositionError code %s to %s / %s",
    async (code, permissionStatus, failureReason) => {
      stubGeolocation((_success, error) =>
        error({ code, message: "" } as GeolocationPositionError),
      );

      const { result } = renderHook(() => useGeolocation(OPTIONS));
      const outcome = await act(() => result.current.acquire());

      expect(outcome).toEqual({
        kind: "failure",
        permissionStatus,
        failureReason,
      });
    },
  );

  it("treats an unrecognized error code as a provider error, never a success", async () => {
    stubGeolocation((_success, error) =>
      error({ code: 99, message: "" } as unknown as GeolocationPositionError),
    );

    const { result } = renderHook(() => useGeolocation(OPTIONS));
    const outcome = await act(() => result.current.acquire());

    expect(outcome).toEqual({
      kind: "failure",
      permissionStatus: "UNKNOWN",
      failureReason: "PROVIDER_ERROR",
    });
  });

  it("reports UNAVAILABLE when the API is absent", async () => {
    stubNoGeolocation();

    const { result } = renderHook(() => useGeolocation(OPTIONS));
    const outcome = await act(() => result.current.acquire());

    expect(outcome).toEqual({
      kind: "failure",
      permissionStatus: "UNAVAILABLE",
      failureReason: "POSITION_UNAVAILABLE",
    });
  });

  it("passes maximumAge 0 so a cached position is never reused", async () => {
    // Defence in depth for Scenario 21: the server also rejects a stale
    // timestamp, but the browser should not offer one in the first place.
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({
        coords: { latitude: 1, longitude: 2, accuracy: 5 },
        timestamp: Date.now(),
      } as GeolocationPosition),
    );
    stubGeolocation(getCurrentPosition);

    const { result } = renderHook(() => useGeolocation(OPTIONS));
    await act(() => result.current.acquire());

    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({
        maximumAge: 0,
        enableHighAccuracy: true,
        timeout: 30_000,
      }),
    );
  });

  it("refuses a second acquisition while one is in flight", async () => {
    // Two overlapping acquisitions from one double click would produce two
    // attempt records for a single user action.
    let release: (() => void) | undefined;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      release = () =>
        success({
          coords: { latitude: 1, longitude: 2, accuracy: 5 },
          timestamp: Date.now(),
        } as GeolocationPosition);
    });
    stubGeolocation(getCurrentPosition);

    const { result } = renderHook(() => useGeolocation(OPTIONS));

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.acquire();
    });

    const second = await act(() => result.current.acquire());

    expect(second).toMatchObject({ failureReason: "PROVIDER_ERROR" });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await first;
    });
  });
});
