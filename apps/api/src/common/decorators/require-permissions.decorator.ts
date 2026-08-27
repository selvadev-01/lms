import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permission codes a route requires.
 *
 * Authentication alone never satisfies these — that separation is Scenario 17:
 * "valid credentials do not bypass role permissions".
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
