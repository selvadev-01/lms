import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Cross-site request forgery defence.
 *
 * # Why anything is needed
 *
 * Every mutating endpoint here authenticates from an httpOnly cookie, and a
 * browser attaches cookies to a cross-site form POST without being asked. So
 * `evil.example` can submit a form at this API and the request arrives fully
 * authenticated as whoever is signed in.
 *
 * `SameSite=Lax` on the session cookies blunts that, but OWASP is explicit that
 * it "does not replace a proper CSRF defense in most deployments": it is scoped
 * to the registrable domain, so it permits a compromised *subdomain* — which is
 * exactly the exposure `AUTH_COOKIE_DOMAIN` opens when set to a parent domain —
 * and it is a browser behaviour rather than something this server enforces.
 *
 * # The two checks, and why both
 *
 * OWASP asks for an origin check plus at least one defence-in-depth mitigation.
 * This implements both halves:
 *
 *  1. **Origin/Referer must match the configured web origin.** Blocks the plain
 *     cross-site form post.
 *  2. **A custom header must be present.** A browser cannot set a custom header
 *     on a cross-origin request without a CORS preflight, and the preflight is
 *     answered only for `WEB_ORIGIN`. A forged request therefore cannot carry
 *     it — and, unlike a synchroniser token, this needs no server-side state
 *     and no round trip to mint.
 *
 * The second check is what makes this robust for this application in
 * particular: the browser never calls this API directly. Every request arrives
 * from the Next.js server, which sets the header deliberately, so requiring it
 * costs legitimate traffic nothing.
 *
 * # What is deliberately not guarded
 *
 * Safe methods pass. GET/HEAD/OPTIONS must not change state — if one ever does,
 * that is the bug, and hiding it behind a CSRF failure would be the wrong
 * report.
 *
 * Sign-in, sign-up and the recovery endpoints pass too, via `@Public()`. They
 * carry no session to abuse, so there is nothing for a forgery to ride; making
 * them fail without a header would break the very first request a client makes,
 * before it has any reason to know about one.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  /**
   * Set by the web tier on every mutating call. The value is irrelevant —
   * only a browser's inability to set the header cross-origin matters.
   */
  static readonly HEADER = 'x-lms-request';

  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (CsrfGuard.SAFE_METHODS.has(request.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const expected = this.config.get<string>('auth.webOrigin');

    /**
     * Origin first, Referer as the fallback: some clients omit Origin on
     * same-origin requests, and Referer carries a full URL whose origin is
     * still authoritative.
     *
     * A request with neither is blocked, which is OWASP's recommendation over
     * accepting it. Nothing legitimate reaches a mutating endpoint here without
     * one — the callers are all server-side and set both.
     */
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    const claimed = origin ?? (referer ? originOf(referer) : undefined);

    if (!claimed || claimed !== expected) {
      throw new ForbiddenException('Request blocked');
    }

    if (!request.headers[CsrfGuard.HEADER]) {
      throw new ForbiddenException('Request blocked');
    }

    return true;
  }
}

/** The scheme+host+port of a URL, or undefined if it cannot be parsed. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
