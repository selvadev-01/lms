import "server-only";

import type { CheckInStatusResponse } from "@lms/types";
import { redirect } from "next/navigation";

import { fetchCheckInStatus } from "../api/check-in";

/**
 * The field-operations authorization boundary.
 *
 * `requireSession()` proves who someone is; this proves where they are. Both
 * are enforced in the data layer at the top of a page rather than in a
 * component, per `features/README.md`, so a rendering change can never
 * accidentally expose a screen.
 *
 * Fails closed in every direction. An unverified check-in, an expired one, a
 * missing permission and an unreachable API all end at the check-in screen
 * rather than at field operations — none of them is evidence that the caller
 * is where they claim to be (Scenario 5).
 */
export async function requireVerifiedCheckIn(): Promise<CheckInStatusResponse> {
  const result = await fetchCheckInStatus();

  if (result.status === "unauthenticated") redirect("/signin");

  // A caller without `field.checkin` is not a field employee at all. Sending
  // them to the check-in screen would only loop them through another 403, so
  // they go to the dashboard they do have access to.
  if (result.status === "forbidden") redirect("/");

  if (result.status !== "ok" || !result.data.verified) {
    redirect("/field/check-in");
  }

  return result.data;
}
