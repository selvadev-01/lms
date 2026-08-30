import type { ExecutionContext } from '@nestjs/common';

import { isPath } from './app.module';

/**
 * Route matching for the throttler's `skipIf`.
 *
 * `@nestjs/throttler` applies every configured bucket to every route unless
 * that route opts out, so each named bucket is confined to its own path by this
 * function. Getting it wrong is silent and severe in both directions: too loose
 * and the signup limit of 3/min throttles the whole application (which is what
 * it did), too tight and a limit protects nothing.
 */
function requestFor(url: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ url }) }),
  } as unknown as ExecutionContext;
}

describe('isPath', () => {
  it('matches a route under the global api/v1 prefix', () => {
    expect(isPath(requestFor('/api/v1/auth/sign-in'), '/auth/sign-in')).toBe(
      true,
    );
  });

  it('ignores a query string', () => {
    expect(
      isPath(requestFor('/api/v1/auth/sign-in?next=/loans'), '/auth/sign-in'),
    ).toBe(true);
  });

  /**
   * Exact, not prefix. A bucket for `/auth/sign-in` must not also catch a
   * future `/auth/sign-in-with-otp` and impose a limit chosen for something
   * else.
   */
  it('does not match a longer path that merely starts with the route', () => {
    expect(
      isPath(requestFor('/api/v1/auth/sign-in-with-otp'), '/auth/sign-in'),
    ).toBe(false);
  });

  /** The case that mattered: an unrelated route must skip the bucket. */
  it.each([
    '/api/v1/organizations/me',
    '/api/v1/dashboard/layout',
    '/api/v1/customers',
  ])('does not match the unrelated route %s', (url) => {
    expect(isPath(requestFor(url), '/auth/sign-up')).toBe(false);
  });

  it('tolerates a request with no url rather than throwing', () => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;

    expect(isPath(context, '/auth/sign-in')).toBe(false);
  });
});
