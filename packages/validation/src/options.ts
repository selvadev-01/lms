/**
 * The one option shape every dropdown in the app speaks.
 *
 * Before this file, option lists came from three unrelated places — inline
 * literal arrays in components, locally-declared label maps, and API-fetched
 * entity lists — in four mutually incompatible shapes (`{value,label}`,
 * `{value,text,selected}`, `{code,label}`). Standardising on one shape is what
 * lets a code-defined enum and an admin-managed master-data list feed the same
 * `<SelectField>` without the component knowing which it got.
 *
 * Nothing here may import from `index.ts` or from any schema file — see the
 * header of `primitives.ts` for why that cycle is a runtime failure and not
 * merely a type-level one. This file imports nothing at all.
 */

export type SelectOption = {
  value: string;
  label: string;
  /** Render, but block selection — e.g. a withdrawn product kept visible for context. */
  disabled?: boolean;
  /** Optional secondary line, used by radio-card layouts that show explanatory copy. */
  hint?: string;
};

/**
 * Build an option list from a value set and its labels.
 *
 * The `Record<T, string>` label parameter is the point of this helper, not a
 * convenience: it makes "added an enum value, forgot its label" a compile error.
 * That failure used to be silent and shipped — `LoanApplicationList` derived
 * labels mechanically with `status.replace(/_/g," ").toLowerCase()` while the
 * badge beside it used a hand-written map, so the same status rendered as
 * "more info required" in one place and "More info needed" in the other.
 *
 * Pass `zodEnum.options` as `values` so the option list and the validator that
 * guards the same field cannot drift apart.
 */
export function optionsFrom<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  extras?: Partial<Record<T, Omit<SelectOption, "value" | "label">>>,
): SelectOption[] {
  return values.map((value) => ({
    value,
    label: labels[value],
    ...extras?.[value],
  }));
}

/**
 * The display label for a stored value.
 *
 * Falls back to the raw value rather than to an empty string: a row whose stored
 * value has since been removed from the option list should still render as
 * something a human can recognise in a list or an audit trail, not as a blank
 * cell that reads as missing data.
 */
export function labelFor(
  options: readonly SelectOption[],
  value: string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "";
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * A deliberate subset of an option list, in the order given.
 *
 * Some dropdowns offer fewer values than their enum on purpose — user creation
 * offers only PENDING and INACTIVE of the five `UserStatus` values, because the
 * other three are reached by acting on an account rather than by choosing them.
 * Spelling that out at the call site keeps the intent visible; narrowing the
 * shared registry instead would hide it from every other consumer.
 *
 * Unknown values are skipped rather than throwing — but since callers pass
 * literals typed against the registry, a typo is caught at compile time.
 */
export function pick(
  options: readonly SelectOption[],
  values: readonly string[],
): SelectOption[] {
  return values
    .map((value) => options.find((option) => option.value === value))
    .filter((option): option is SelectOption => option !== undefined);
}

/**
 * An option list that is guaranteed to contain the value a record already holds.
 *
 * Editing an existing record with a `<select>` has a failure mode that is easy
 * to miss: if the stored value is not among the options — because it predates
 * the list, or was retired since — the control falls back to its placeholder.
 * The user then saves an unrelated field and silently blanks this one, with no
 * error and nothing on screen suggesting anything was lost.
 *
 * Appending the orphan keeps the record intact and visible. It is marked
 * `disabled` so it reads as "this is what is stored" rather than as a choice
 * still on offer — the user can move off it, but cannot move back to it.
 *
 * Pass the value straight from the record; `null`, `undefined` and `""` all
 * return the list unchanged.
 */
export function withStoredValue(
  options: readonly SelectOption[],
  stored: string | null | undefined,
): SelectOption[] {
  if (stored === null || stored === undefined || stored === "") {
    return [...options];
  }
  if (options.some((option) => option.value === stored)) {
    return [...options];
  }
  return [
    ...options,
    { value: stored, label: `${stored} (retired)`, disabled: true },
  ];
}

/**
 * Lists whose values a business admin maintains, rather than a deploy.
 *
 * Kept as a plain string union rather than a Prisma enum: adding a category
 * should not require a migration, which is the entire reason the master-data
 * table is generic instead of one table per list.
 *
 * These four are the fields that are unconstrained `VarChar` columns today —
 * `gender`, guarantor `relationship`, loan `purpose`, and the `documentType`
 * that appears in three separate models with its allowed set hardcoded into
 * DTOs and components.
 */
export const MASTER_DATA_CATEGORIES = [
  "GENDER",
  "RELATIONSHIP",
  "LOAN_PURPOSE",
  "DOCUMENT_TYPE",
] as const;

export type MasterDataCategory = (typeof MASTER_DATA_CATEGORIES)[number];

/**
 * Module 17 setting categories — how the settings screen groups its rows.
 *
 * Presentation only. What a setting *means*, what type it holds and who may
 * change it all come from its definition in `settings.ts`, never from its
 * category. Two settings sharing a category have nothing else in common.
 */
export const SETTING_CATEGORIES = [
  "GENERAL",
  "OPERATIONS",
  "FINANCIAL",
  "SECURITY",
] as const;

export type SettingCategory = (typeof SETTING_CATEGORIES)[number];

/**
 * How a setting's stored value is interpreted. Mirrors the `setting_value_type`
 * enum in the Prisma schema.
 *
 * PAISE is distinct from INTEGER even though both are whole numbers, because it
 * carries Rules 14 and 15: money is integer paise and never a floating-point
 * value. It is validated as a digit string by `paiseString`, the same helper the
 * loan and accounting schemas use — a JS number cannot hold a large rupee amount
 * in paise without losing precision, which is the entire reason that convention
 * exists.
 */
export const SETTING_VALUE_TYPES = [
  "STRING",
  "INTEGER",
  "PAISE",
  "BOOLEAN",
  "DATE",
  "TIME",
  "ENUM",
  "JSON",
] as const;

export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

/**
 * Where a setting may be configured.
 *
 * ORG_OR_BRANCH means a branch row overrides the organization default; the
 * service resolves the narrower one. It does NOT mean the two are independent.
 */
export const SETTING_SCOPES = ["ORG", "BRANCH", "ORG_OR_BRANCH"] as const;

export type SettingScope = (typeof SETTING_SCOPES)[number];
