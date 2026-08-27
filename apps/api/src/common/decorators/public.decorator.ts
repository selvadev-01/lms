import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable without authentication.
 *
 * The guard is global and denies by default, so forgetting this decorator fails
 * closed (a route becomes unreachable) rather than open.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
