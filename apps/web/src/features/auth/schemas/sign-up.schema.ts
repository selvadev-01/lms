/**
 * Organization signup validation.
 *
 * Re-exported from `@lms/validation` rather than redefined, so the browser and
 * the API enforce exactly the same rule (features/README.md: extend the shared
 * schemas, never duplicate them).
 */
export { signUpSchema, type SignUpInput } from "@lms/validation";
