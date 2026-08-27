import { z } from "zod";

/**
 * The primitives every other schema file builds on.
 *
 * This file exists to break an import cycle rather than to organize code. When
 * these lived in `index.ts` and `rbac.ts` imported them from there, the cycle was
 * a runtime failure, not just a type-level one: `index.ts` re-exports `rbac.ts`
 * from its last line, so loading `index` began evaluating `rbac`, which called
 * `optionalText` while the `const` holding it was still uninitialized. Module
 * *declarations* hoist; `const` initializers do not.
 *
 * Nothing here may import from `index.ts` or from any schema file. Everything
 * here is re-exported by `index.ts`, so both apps still import from `@lms/validation`
 * and never reach for this path directly.
 */

export const idSchema = z.string().min(1);

export const emailSchema = z.string().email();

/** Indian mobile: 10 digits, first digit 6–9. */
export const phoneSchema = z
  .string()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number");

/**
 * The login identifier field, as forms submit it.
 *
 * Separate from `phoneSchema` because a form needs "you left this blank" and
 * "this is not a mobile number" to be different messages, and because the trim
 * has to happen before the pattern check — `" 9876543210"` is a valid number
 * typed with a stray space, not an invalid one.
 */
export const mobileField = z
  .string()
  .trim()
  .min(1, "Mobile Number is required")
  .pipe(phoneSchema);

/**
 * The optional-text idiom used across every form in the app.
 *
 * Absent has two spellings on the way in and both must be accepted. An untouched
 * input submits `""`, while a field the form does not render at all makes
 * `formData.get()` return `null` — as the branch list's status form does, and as
 * every "reason" field does. Both normalize to `undefined`, so a service sees one
 * shape rather than three, and a `null` that reached the database as a literal
 * would be a value where it means absence.
 */
export const optionalText = (max: number) =>
  z
    .preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.string().trim().max(max).optional(),
    )
    .optional();

/**
 * Organization and branch lifecycle. Both enums are ACTIVE | INACTIVE — there is
 * deliberately no third state: "deleted" is either a physical delete or a
 * refusal, never a status a query has to remember to exclude.
 */
export const statusSchema = z.enum(["ACTIVE", "INACTIVE"]);

/**
 * A calendar date, `YYYY-MM-DD`, in Asia/Kolkata.
 *
 * The regex alone would accept `2026-02-31`, so the round-trip through `Date`
 * is what rejects it: constructing `2026-02-31` yields March 3rd, and comparing
 * the formatted result against the input catches every such rollover. Parsed as
 * UTC noon rather than midnight so a timezone shift cannot move the date across
 * a day boundary while checking it.
 *
 * Lives here rather than in one module's file because two money surfaces need
 * it — disbursal's transfer dates and collection's collection date — and a
 * second copy of a date validator on a money surface is exactly the drift these
 * files are organized to prevent.
 */
export const isoDateSchema = (label: string) =>
  z
    .string({
      required_error: `${label} is required`,
      invalid_type_error: `${label} is required`,
    })
    .trim()
    .min(1, `${label} is required`)
    .superRefine((value, ctx) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a valid date`,
        });
        return;
      }

      const parsed = new Date(`${value}T12:00:00Z`);
      if (Number.isNaN(parsed.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a valid date`,
        });
        return;
      }

      // Catches a well-formed but non-existent date, e.g. 2026-02-31.
      if (parsed.toISOString().slice(0, 10) !== value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must be a valid date`,
        });
      }
    });
