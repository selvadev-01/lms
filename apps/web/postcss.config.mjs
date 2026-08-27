/**
 * ESM rather than CJS, and `.mjs` rather than `.js`.
 *
 * Next 16 loads this through Turbopack, which evaluates it as an ES module. With
 * `module.exports` — and no `"type": "module"` in package.json to reinterpret a
 * bare `.js` — the CJS wrapper is not in scope and the build dies with
 * `TypeError: __turbopack_context__.a is not a function`, reported against
 * whichever CSS file happened to be imported first.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
