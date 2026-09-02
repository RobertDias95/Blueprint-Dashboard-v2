import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // ★★ fix-479 §F: the measurement harness is an ENTRY POINT, like src/main.tsx
  //    — it mounts a root and exports nothing, so `react-refresh/only-export-
  //    components` fires on every component in it. It is not app code, it is
  //    never bundled (nothing in index.html imports it) and fast refresh is
  //    irrelevant to a page you load once to read a number off.
  //
  // ★ It lives under src/ ONLY because tailwind.config.js scans `./src/**` and
  //   nothing else; a harness outside src renders with no utilities and every
  //   measurement is silently wrong. See docs/FIX_479_OVERVIEW_HEIGHT_MEASUREMENT.md.
  {
    files: ['src/harness/**/*.{ts,tsx}'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
