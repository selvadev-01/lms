/**
 * Sign-in validation.
 *
 * Re-exported from `@lms/validation` rather than redefined, so the browser and
 * the API enforce exactly the same rule (features/README.md: extend the shared
 * schemas, never duplicate them).
 */
export { signInSchema, type SignInInput } from "@lms/validation";
