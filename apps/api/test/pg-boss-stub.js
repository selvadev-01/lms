/**
 * A CommonJS stand-in for pg-boss, used only by Jest.
 *
 * pg-boss 12 is a pure ESM package (`"type": "module"`, ESM-only `dist/`).
 * Node's own `require` loads it through CJS-ESM interop, which is why the
 * compiled application works; Jest's CommonJS runtime has no such interop and
 * throws "Cannot use import statement outside a module" the moment any spec
 * transitively imports `QueueService`.
 *
 * `transformIgnorePatterns` is not a way out: transforming pg-boss's entry
 * point only moves the failure one level down into its ESM dependency tree.
 *
 * Mapped in `package.json#jest.moduleNameMapper`, following the same convention
 * the repository already uses for `@lms/validation`. Doing it there rather than
 * with a `jest.mock` call in each spec means a service can acquire a queue
 * dependency without every spec that constructs it needing to know.
 *
 * This is safe because nothing in the unit suite exercises pg-boss itself. The
 * queue's own spec covers the absent/disabled/failing paths — the ones that
 * protect a committed business transaction — and the real round trip is
 * verified against a live Postgres, where it belongs.
 */
class PgBoss {
  constructor() {
    throw new Error(
      'pg-boss is stubbed under Jest. A unit test must not start a real ' +
        'queue; stub QueueService instead, or verify against a live database.',
    );
  }
}

module.exports = { PgBoss, default: PgBoss };
