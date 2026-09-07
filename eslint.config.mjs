import tseslint from "typescript-eslint";
import a11y from "eslint-plugin-jsx-a11y";
import next from "@next/eslint-plugin-next";

// TypeScript handles type errors separately. ESLint checks render safety and
// accessible control semantics across the complete frontend.
export default [
  {
    ignores: [".next/**", "node_modules/**", "output/**"],
  },
  {
    files: [
      "components/**/*.{ts,tsx}",
      "app/*.{ts,tsx}",
      "lib/client/**/*.ts",
      "eslint.config.mjs",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "jsx-a11y": a11y, "@next/next": next },
    rules: {
      "@next/next/no-async-client-component": "error",
      "@next/next/no-head-element": "error",
      "@next/next/no-duplicate-head": "error",
      "no-debugger": "error",
      "no-unreachable": "error",
      "no-duplicate-case": "error",
      "no-unsafe-finally": "error",
      "no-constant-binary-expression": "error",
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/heading-has-content": "error",
    },
  },
];
