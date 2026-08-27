import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Baseline ESLint config for framework-agnostic packages.
 * apps/web extends eslint-config-next separately — Next brings its own rules.
 */
export default tseslint.config(
  {
    ignores: ["dist/**", ".turbo/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
);
