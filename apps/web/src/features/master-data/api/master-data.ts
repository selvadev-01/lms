import "server-only";

import type { MasterDataCategory, SelectOption } from "@lms/validation";

import { apiGet, type FetchFailure } from "@/lib/api-fetch";

/**
 * Master data — the admin-maintained option lists behind dropdown fields.
 *
 * The read returns `SelectOption[]`, the same shape the compiled-in enum
 * registries in `@lms/validation` carry, so a page hands either to
 * `<SelectField>` without the component knowing which it got.
 *
 * Nothing here filters for security. Tenant confinement is applied server-side
 * regardless of what is sent; `activeOnly` is a convenience for forms, which
 * must not offer a retired value.
 */

export interface MasterDataValueDetail extends SelectOption {
  valueId: string;
  category: string;
  code: string;
  displayOrder: number;
  status: "ACTIVE" | "INACTIVE";
  isSystem: boolean;
  /**
   * LOAN_TYPE only; null for every other category.
   *
   * Whether an application of this loan type must carry a COLLATERAL document
   * before it can be submitted. Null is "the question does not apply here",
   * which is why it is not collapsed to false.
   */
  requiresCollateral: boolean | null;
  version: string;
}

export type MasterDataListResult =
  { status: "ok"; values: SelectOption[] } | FetchFailure;

export type MasterDataManageResult =
  { status: "ok"; values: MasterDataValueDetail[] } | FetchFailure;

/**
 * The values a form should offer.
 *
 * Callers pass `activeOnly: true` for anything a user is choosing *now*. The
 * failure case is deliberately not collapsed to an empty array — "this list has
 * no values" and "we could not load the list" must stay distinguishable, or a
 * form renders an empty dropdown as though the org had configured nothing.
 */
export async function fetchMasterData(
  category: MasterDataCategory,
  options: { activeOnly?: boolean } = {},
): Promise<MasterDataListResult> {
  const params = new URLSearchParams({ category });
  if (options.activeOnly) params.set("activeOnly", "true");

  const result = await apiGet<{ values: SelectOption[] }>(
    `/master-data?${params.toString()}`,
  );

  return result.status === "ok"
    ? { status: "ok", values: result.data.values }
    : result;
}

/** The management view — every column the admin screen edits. */
export async function fetchMasterDataForManagement(
  category: MasterDataCategory,
): Promise<MasterDataManageResult> {
  const params = new URLSearchParams({ category });

  const result = await apiGet<{ values: MasterDataValueDetail[] }>(
    `/master-data/manage?${params.toString()}`,
  );

  return result.status === "ok"
    ? { status: "ok", values: result.data.values }
    : result;
}

/**
 * Options for a form, or an empty list if the lookup failed.
 *
 * The one place collapsing a failure to `[]` is right: a *secondary* field on a
 * form that is otherwise usable should not take the whole page down. The caller
 * still renders, the field is simply empty, and the field is optional in every
 * current use. Never use this for a required field — there, failing to load the
 * options must be visible.
 */
export async function fetchMasterDataOptions(
  category: MasterDataCategory,
): Promise<SelectOption[]> {
  const result = await fetchMasterData(category, { activeOnly: true });
  return result.status === "ok" ? result.values : [];
}
