// ---------------------------------------------------------------------
// Reference config file from moodle course adapted for this project
// ---------------------------------------------------------------------
// Modifications:
// - Added `eslint.config.js` to `ignores` to avoid type-service errors on the config file
// - Included `.tsx` files (`**/*.{ts,tsx}`) for React components
// - Added a `server/**/*.js` block with Node globals
// - Disabled type-checked rules on server/**/*.js
// ---------------------------------------------------------------------

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "eslint.config.js"] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // -----------------------------------------------------------------
      // FIXABLE: where lint:fix actually fixes something
      // -----------------------------------------------------------------

      // BEFORE:  var count = 0;
      // AFTER:   let count = 0;
      "no-var": "error",
      // BEFORE:  let name = "Nova Byte";  // never reassigned anywhere
      // AFTER:   const name = "Nova Byte";
      "prefer-const": "error",
      // BEFORE:  if (status == "open")
      // AFTER:   if (status === "open")
      eqeqeq: ["error", "smart"],
      // BEFORE:  list.indexOf(x) !== -1
      // AFTER:   list.includes(x)
      "@typescript-eslint/prefer-includes": "error",
      // BEFORE:  (value as Evidence[]).find(...)   // value is ALREADY Evidence[]
      // AFTER:   value.find(...)
      "@typescript-eslint/no-unnecessary-type-assertion": "error",

      // -----------------------------------------------------------------
      // NOT FIXABLE: the "correct" rewrite depends on semantics that only dev can decide.
      // -----------------------------------------------------------------

      // The variable might be unused because of a typo two
      // lines away (the REAL fix is using it, not deleting it), or it
      // might be genuinely dead code. ESLint can't tell those apart, so
      // it reports and stops.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // example: function handle(payload: any) { ... }
      // There is no "correct" type ESLint could substitute for `any` -
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    files: ["server/**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Must be last: turns off every ESLint *stylistic* rule that would
  // otherwise disagree with Prettier's formatting. Prettier owns
  // formatting; ESLint owns correctness/quality. Two tools, one job each.
  prettier,
);
