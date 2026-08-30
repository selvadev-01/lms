import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';

import { CsrfGuard } from './csrf.guard';

/**
 * CSRF guard.
 *
 * Every mutating endpoint authenticates from an httpOnly cookie, which a
 * browser attaches to a cross-site form post unasked. These tests pin both
 * halves of the defence OWASP asks for — an origin check, and a custom header a
 * cross-origin request cannot set — and, just as importantly, pin what is
 * deliberately *not* guarded, so a later edit cannot quietly widen either.
 */

const WEB_ORIGIN = 'https://lms.example';

function contextFor(
  request: Partial<{
    method: string;
    headers: Record<string, string | undefined>;
  }>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: request.method ?? 'POST',
        headers: request.headers ?? {},
      }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardWith(isPublic = false): CsrfGuard {
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
  const config = { get: () => WEB_ORIGIN } as unknown as ConfigService;
  return new CsrfGuard(reflector, config);
}

/** The header the web tier sets; its value is never read. */
const VALID = {
  origin: WEB_ORIGIN,
  [CsrfGuard.HEADER]: '1',
};

describe('CsrfGuard', () => {
  describe('what it allows', () => {
    it('allows a mutation carrying a matching Origin and the header', () => {
      expect(guardWith().canActivate(contextFor({ headers: VALID }))).toBe(
        true,
      );
    });

    /**
     * A GET must not change state. If one ever does, that is the bug to fix —
     * reporting it as a CSRF failure would describe the wrong problem.
     */
    it.each(['GET', 'HEAD', 'OPTIONS'])(
      'allows %s unconditionally',
      (method) => {
        expect(
          guardWith().canActivate(contextFor({ method, headers: {} })),
        ).toBe(true);
      },
    );

    /**
     * Sign-in, sign-up and recovery carry no session to abuse, so there is
     * nothing for a forgery to ride. Requiring a header here would break the
     * first request a client ever makes.
     */
    it('allows a public route with no origin and no header', () => {
      expect(guardWith(true).canActivate(contextFor({ headers: {} }))).toBe(
        true,
      );
    });

    /** Some clients omit Origin on same-origin requests; Referer still binds. */
    it('accepts Referer when Origin is absent', () => {
      const context = contextFor({
        headers: {
          referer: `${WEB_ORIGIN}/customers/new`,
          [CsrfGuard.HEADER]: '1',
        },
      });

      expect(guardWith().canActivate(context)).toBe(true);
    });
  });

  describe('what it blocks', () => {
    it('blocks a cross-site origin', () => {
      const context = contextFor({
        headers: { origin: 'https://evil.example', [CsrfGuard.HEADER]: '1' },
      });

      expect(() => guardWith().canActivate(context)).toThrow(
        ForbiddenException,
      );
    });

    /**
     * The subdomain case is the one SameSite=Lax cannot cover: it is scoped to
     * the registrable domain, so a compromised sibling host is "same-site" to
     * the browser. An exact origin comparison is what closes it.
     */
    it('blocks a sibling subdomain of the web origin', () => {
      const context = contextFor({
        headers: {
          origin: 'https://evil.lms.example',
          [CsrfGuard.HEADER]: '1',
        },
      });

      expect(() => guardWith().canActivate(context)).toThrow(
        ForbiddenException,
      );
    });

    /** OWASP: block rather than accept when neither header is present. */
    it('blocks a mutation with neither Origin nor Referer', () => {
      const context = contextFor({ headers: { [CsrfGuard.HEADER]: '1' } });

      expect(() => guardWith().canActivate(context)).toThrow(
        ForbiddenException,
      );
    });

    /**
     * The defence-in-depth half. A browser cannot set a custom header on a
     * cross-origin request without a preflight this API answers only for
     * WEB_ORIGIN, so a forged request cannot carry it — even if it somehow
     * presented a convincing Origin.
     */
    it('blocks a mutation with a valid origin but no custom header', () => {
      const context = contextFor({ headers: { origin: WEB_ORIGIN } });

      expect(() => guardWith().canActivate(context)).toThrow(
        ForbiddenException,
      );
    });

    it('blocks an unparseable Referer', () => {
      const context = contextFor({
        headers: { referer: 'not-a-url', [CsrfGuard.HEADER]: '1' },
      });

      expect(() => guardWith().canActivate(context)).toThrow(
        ForbiddenException,
      );
    });

    /** A scheme downgrade is a different origin, and must not be accepted. */
    it('blocks the same host over http when the origin is https', () => {
      const context = contextFor({
        headers: { origin: 'http://lms.example', [CsrfGuard.HEADER]: '1' },
      });

      expect(() => guardWith().canActivate(context)).toThrow(
        ForbiddenException,
      );
    });

    it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
      'guards %s, not only POST',
      (method) => {
        const context = contextFor({ method, headers: {} });

        expect(() => guardWith().canActivate(context)).toThrow(
          ForbiddenException,
        );
      },
    );
  });
});
