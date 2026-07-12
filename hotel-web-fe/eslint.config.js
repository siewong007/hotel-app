import reactCompiler from "eslint-plugin-react-compiler";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    // TanStack Router auto-generated route tree — do not hand-edit, and don't
    // lint it (it ships its own `/* eslint-disable */` + `// @ts-nocheck`,
    // which trips "unused eslint-disable directive" under --max-warnings=0).
    // Same story for build/coverage output: vendored reporter assets (e.g.
    // coverage/block-navigation.js) ship their own eslint-disable directives.
    ignores: ["src/routeTree.gen.ts", "coverage/**", "dist/**"]
  },
  {
    files: ["src/**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      "react-compiler": reactCompiler,
      "react-hooks": reactHooks
    },
    rules: {
      "react-compiler/react-compiler": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Ban deriving a YYYY-MM-DD string from Date.toISOString(): toISOString()
      // returns UTC, so .split('T')[0] / .slice(0, 10) yields the previous day
      // during early-morning hours in east-of-UTC timezones. Use the local-date
      // helpers in src/utils/date.ts (formatLocalDate / parseLocalDate / addLocalDays).
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='split'][callee.object.callee.property.name='toISOString']",
          message:
            "Don't extract a date from toISOString() (it's UTC and shifts a day overnight). Use formatLocalDate() from src/utils/date.ts."
        },
        {
          selector:
            "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
          message:
            "Don't extract a date from toISOString() (it's UTC and shifts a day overnight). Use formatLocalDate() from src/utils/date.ts."
        }
      ]
    }
  }
];
