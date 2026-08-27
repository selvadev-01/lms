import { z } from "zod";

import { MASTER_DATA_CATEGORIES } from "./options";

/**
 * Master data form schemas — the admin-maintained option lists.
 *
 * Separate from `options.ts` because that file deliberately imports nothing at
 * all (it is reached from `index.ts` before the schema files, and from those
 * schema files directly). This one may import, so long as it reaches for
 * `./options` and `./primitives` rather than `./index` — the same cycle rule the
 * header of `primitives.ts` explains.
 *
 * These mirror the API's DTOs field for field, so the web form reports the same
 * refusal the server would rather than letting a submission round-trip to
 * discover it.
 */

export const masterDataCategorySchema = z.enum(MASTER_DATA_CATEGORIES, {
  errorMap: () => ({ message: "Unknown option list" }),
});

/**
 * The stored value.
 *
 * Same character class as the branch, role and customer codes: it is written
 * into business columns and compared against literals in code, where a value
 * carrying a space or a lowercase letter is a bug waiting to happen.
 */
export const masterDataCodeSchema = z
  .string({ required_error: "Code is required" })
  .trim()
  .min(1, "Code is required")
  .max(50, "Code must be 50 characters or fewer")
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    "Code must be uppercase letters, digits and underscores",
  );

export const masterDataLabelSchema = z
  .string({ required_error: "Label is required" })
  .trim()
  .min(1, "Label is required")
  .max(200, "Label must be 200 characters or fewer");

/**
 * Bounded so ordering stays a small hand-set number rather than an arbitrary
 * int. Coerced because it arrives from a form as a string.
 */
export const displayOrderSchema = z.coerce
  .number({ invalid_type_error: "Display order must be a number" })
  .int("Display order must be a whole number")
  .min(0, "Display order cannot be negative")
  .max(9999, "Display order must be 9999 or less");

export const createMasterDataValueSchema = z.object({
  category: masterDataCategorySchema,
  code: masterDataCodeSchema,
  label: masterDataLabelSchema,
  displayOrder: displayOrderSchema.optional(),
});

/**
 * Edit a value's presentation or lifecycle.
 *
 * **`code` and `category` are deliberately absent**, matching the API's DTO.
 * Business rows store the code as a loose string, so renaming it would not
 * migrate them — it would orphan every record already carrying the old value
 * while appearing to succeed. Retiring a value means setting it INACTIVE and
 * adding a replacement, which leaves historical records still resolvable.
 */
export const updateMasterDataValueSchema = z.object({
  label: masterDataLabelSchema.optional(),
  displayOrder: displayOrderSchema.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export type CreateMasterDataValueInput = z.infer<
  typeof createMasterDataValueSchema
>;
export type UpdateMasterDataValueInput = z.infer<
  typeof updateMasterDataValueSchema
>;
