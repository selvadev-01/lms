import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The package is `"type": "module"`, which would make Node treat the emitted
 * `dist/*.js` as ESM even though tsc compiled them to CommonJS. Dropping a
 * scoped `package.json` into `dist/` overrides that for the built output only,
 * leaving `src/` — which the web app imports directly — as ESM.
 */
// Resolved via node:path rather than `new URL(...)`: the shared ESLint config
// declares no environment globals, so `URL` is undefined there even though Node
// provides it at runtime.
writeFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);
