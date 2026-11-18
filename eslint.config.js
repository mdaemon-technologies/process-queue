// ESLint flat config; src/lint.test.ts checks which files it covers. typescript-eslint parses
// with the TypeScript 6 API (the `typescript` alias), while tsc type-checks with TypeScript 7.
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  // Built output, and the release notes the maintainer writes locally
  globalIgnores(['dist/', 'release/']),
  // A stale eslint-disable comment fails the lint instead of warning
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    extends: [tseslint.configs.recommended],
  },
  {
    // Tests pass values the types forbid, to check the runtime validation, and load the built bundles untyped
    files: ['src/**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // The smoke tests and the config files run on plain Node. ESLint already reads .cjs files as CommonJS.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: globals.node },
  },
])
