import "server-only";

import type {
  BusinessCalendarDetail,
  ConfigurationExport,
  RetentionPolicyDetail,
  SettingCatalogEntry,
  SettingChangeDetail,
  SettingSummary,
} from "@lms/types";

import { apiGet, type FetchFailure } from "@/lib/api-fetch";

/**
 * Module 17 — settings, configuration governance and the business calendar.
 *
 * Nothing here filters for security. Organization and branch confinement are
 * applied server-side regardless of what is sent, and a protected value arrives
 * already masked when the caller lacks `settings.protected.manage` — the
 * `isValueMasked` flag on each row says which happened.
 *
 * Failures are never collapsed to an empty array. "This organization has
 * configured nothing" and "we could not load the settings" must stay
 * distinguishable, or a screen presents a load failure as an empty
 * configuration and an admin starts creating duplicates.
 */

export type SettingsListResult =
  | { status: "ok"; settings: SettingSummary[] }
  | FetchFailure;

export type SettingCatalogResult =
  | { status: "ok"; catalog: SettingCatalogEntry[] }
  | FetchFailure;

export type ChangeRequestsResult =
  | { status: "ok"; changes: SettingChangeDetail[] }
  | FetchFailure;

export type BusinessCalendarsResult =
  | { status: "ok"; calendars: BusinessCalendarDetail[] }
  | FetchFailure;

export async function fetchSettings(
  options: {
    category?: string;
    includeInactive?: boolean;
    /**
     * Branch scope. Omitted entirely for the organization view — the API reads
     * an absent `branchId` as "organization scope", which is NOT the same as a
     * branch filter that happens to match nothing.
     */
    branchId?: string;
  } = {},
): Promise<SettingsListResult> {
  const params = new URLSearchParams();
  if (options.category) params.set("category", options.category);
  if (options.includeInactive) params.set("includeInactive", "true");
  if (options.branchId) params.set("branchId", options.branchId);

  const query = params.toString();
  const result = await apiGet<{ items: SettingSummary[] }>(
    `/settings${query ? `?${query}` : ""}`,
  );

  return result.status === "ok"
    ? { status: "ok", settings: result.data.items }
    : result;
}

/**
 * The setting registry.
 *
 * The screen offers only these codes rather than a free-text box — the UI half
 * of Rule 9. The server refuses an unknown code regardless, so this is
 * convenience rather than enforcement.
 */
export async function fetchSettingCatalog(): Promise<SettingCatalogResult> {
  const result = await apiGet<SettingCatalogEntry[]>("/settings/catalog");

  return result.status === "ok"
    ? { status: "ok", catalog: result.data }
    : result;
}

export async function fetchChangeRequests(
  options: { status?: string } = {},
): Promise<ChangeRequestsResult> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);

  const query = params.toString();
  const result = await apiGet<{ items: SettingChangeDetail[] }>(
    `/settings/changes${query ? `?${query}` : ""}`,
  );

  return result.status === "ok"
    ? { status: "ok", changes: result.data.items }
    : result;
}

export async function fetchBusinessCalendars(): Promise<BusinessCalendarsResult> {
  const result = await apiGet<{ items: BusinessCalendarDetail[] }>(
    "/settings/business-calendar",
  );

  return result.status === "ok"
    ? { status: "ok", calendars: result.data.items }
    : result;
}

export type RetentionPoliciesResult =
  | { status: "ok"; policies: RetentionPolicyDetail[] }
  | FetchFailure;

/**
 * Retention policies (Scenarios 55-57).
 *
 * `includeInactive` is what the administrative screen passes: a retired policy
 * is part of the deactivate-then-replace history, and hiding it would make that
 * history unreadable. Retention PROCESSING never sees an inactive policy — that
 * is enforced server-side and is not this screen's job.
 */
export async function fetchRetentionPolicies(
  options: { recordCategory?: string; includeInactive?: boolean } = {},
): Promise<RetentionPoliciesResult> {
  const params = new URLSearchParams();
  if (options.recordCategory) params.set("recordCategory", options.recordCategory);
  if (options.includeInactive) params.set("includeInactive", "true");

  const query = params.toString();
  const result = await apiGet<{ items: RetentionPolicyDetail[] }>(
    `/retention/policies${query ? `?${query}` : ""}`,
  );

  return result.status === "ok"
    ? { status: "ok", policies: result.data.items }
    : result;
}

export type ConfigurationExportResult =
  | { status: "ok"; document: ConfigurationExport }
  | FetchFailure;

/**
 * The organization configuration as a portable document (Rule 56).
 *
 * A protected value the caller may not read arrives masked, with
 * `isValueMasked` set — the same masking the settings screen applies. The
 * export is not a way around it.
 */
export async function fetchConfigurationExport(): Promise<ConfigurationExportResult> {
  const result = await apiGet<ConfigurationExport>("/settings/export");

  return result.status === "ok"
    ? { status: "ok", document: result.data }
    : result;
}
