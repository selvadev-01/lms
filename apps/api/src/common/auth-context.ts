/**
 * The authenticated principal attached to a request by JwtAuthGuard.
 *
 * Carries the tenant and branch scope resolved at sign-in, so downstream
 * handlers never have to re-derive it from user input — which is what keeps a
 * Branch Admin from reaching another branch's records (Scenarios 9, 18, 19).
 */
export interface AuthContext {
  userId: string;
  orgId: string;
  orgCode: string;
  sessionId: string;
  branchId: string | null;
  roles: string[];
  permissions: string[];
}

/**
 * Shape of the signed access-token payload.
 *
 * # Why permissions are not in here
 *
 * They used to be, and it was never load-bearing: `JwtAuthGuard` resolves both
 * roles and permissions from the database on every request and ignores whatever
 * the token claims — which is what makes a revoked permission take effect
 * immediately rather than at the next sign-in.
 *
 * Carrying them anyway had a cost that only showed up at scale. A Super Admin
 * holds every permission in the catalog, and serialising that list pushed the
 * `Set-Cookie` header past 4,096 bytes — the per-cookie limit browsers enforce.
 * Over that line Chromium discards the cookie silently: no error, no warning,
 * just a browser that appears signed in and is not. The catalog crossed the
 * limit as it grew, so the failure arrived with a module that had nothing to do
 * with authentication.
 *
 * `roles` stays. It is three short strings rather than a hundred and thirty
 * long ones, and `narrowerBranch` reads it during scope resolution.
 */
export interface AccessTokenPayload {
  sub: string;
  orgId: string;
  orgCode: string;
  sid: string;
  branchId: string | null;
  roles: string[];
}
