/**
 * Trims a string property during class-transformer's plainToInstance pass.
 *
 * Shared by every auth DTO so the whitespace rule is applied identically:
 * Forgot Password rule 4 requires the recovery identifier to normalize exactly
 * as sign-in's does, and a second copy of this function is a second place for
 * that to drift.
 */
export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
