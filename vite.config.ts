import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// ===========================================================================
// ★★★ fix-587 §1b — THE BUILD A BROWSER IS ACTUALLY RUNNING
// ===========================================================================
//
// P-287's report was two people on one screen with the same filters seeing 332
// and 65. Every filter stage proved correct under Everyone; what differed was
// the BUNDLE — Brittani's toolbar was missing three controls that shipped
// 2026-08-29 and 2026-08-30, so her client was roughly three weeks old.
//
// ★★★ AND NOTHING IN THE APP COULD SAY SO. `package.json` reads `0.0.0`, there
//     was no `define`, no About panel, no commit in any error report. **A stale
//     client was undetectable — by the person, by support, and by the error
//     table** — which is why the first hypothesis was a data bug and the second
//     was an RLS bug, and both cost a day.
//
// ★ Resolved at BUILD time, not read at runtime: the whole point is to identify
//   the bundle, and a bundle cannot look up its own provenance afterwards.
// ★ `try/catch` because a build without git (a fresh clone, a container) must
//   still build — it reports `unknown`, which is honest and still distinguishes
//   "I could not tell" from "3 weeks old".
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Q1: Vite + Vitest config in one file. Importing `defineConfig` from
// `vitest/config` (rather than `vite`) extends the type to include `test`,
// per Vitest v4's recommended pattern.
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_SHA__: JSON.stringify(gitSha()),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
