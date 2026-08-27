/**
 * Post-processes the generated Prisma client for CommonJS consumption.
 *
 * The Prisma 7 generator emits `import.meta.url` in client.ts purely to
 * polyfill `__dirname`. TypeScript passes that token through verbatim, and its
 * presence makes Node treat the compiled output as ESM — which then crashes on
 * the surrounding CommonJS `exports` (`ReferenceError: exports is not defined
 * in ES module scope`).
 *
 * This app compiles to CommonJS via `nest build`, where `__dirname` already
 * exists, so the polyfill is replaced with a no-op guard. Runs automatically
 * after `prisma generate`, because the generated directory is overwritten on
 * every regeneration.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const clientPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'generated',
  'prisma',
  'client.ts',
);

const ESM_LINE =
  "globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))";
const CJS_REPLACEMENT =
  '// [patched] CommonJS already provides __dirname; the ESM polyfill removed here\n' +
  '// forced Node to load this file as ESM. See scripts/patch-prisma-client.mjs.';

const source = await readFile(clientPath, 'utf8');

if (!source.includes(ESM_LINE)) {
  if (source.includes('[patched]')) {
    console.log('prisma client already patched for CommonJS');
    process.exit(0);
  }
  console.error(
    'patch-prisma-client: expected import.meta.url polyfill not found.\n' +
      'The Prisma generator output has changed — re-check this patch.',
  );
  process.exit(1);
}

await writeFile(clientPath, source.replace(ESM_LINE, CJS_REPLACEMENT), 'utf8');
console.log('patched prisma client for CommonJS');
