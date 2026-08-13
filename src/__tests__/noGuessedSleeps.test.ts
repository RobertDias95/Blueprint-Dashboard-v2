import { describe, it, expect } from 'vitest';

// fix-300b: no test may wait by guessing a duration.
//
// fix-300 removed five `await new Promise((r) => setTimeout(r, 25))` sleeps
// from Step3Permits and added settle(). fix-300b removed the remaining 27
// across 12 files. This is the ratchet that keeps them gone.
//
// WHY THE PATTERN IS BANNED, precisely: a guessed duration is not a wait, it is
// a bet on how long someone else's async work takes. It holds on an idle
// machine and can lose in a parallel vitest worker. The two shapes it takes:
//
//   * guarding a POSITIVE assertion — the value arrives after the sleep
//     expires and the test FAILS. This is what fix-300 reproduced in
//     Step3Permits.
//   * guarding an INVARIANT ("never called", "count stays 1") — the work
//     has not started when the sleep expires, so the assertion PASSES
//     without testing anything. Strictly worse, because it is silent. All
//     27 sites in fix-300b were this shape.
//
// The two sanctioned tools, neither of which guesses:
//   * settle()  — act()-wrapped microtask drain, for invariants and for
//                 draining a mocked promise's .then/.catch before the test ends.
//   * waitFor() — for something that genuinely BECOMES true, on the observable
//                 result itself (not on a condition that was already true).
//
// Vite `?raw` rather than node:fs: the app tsconfig has no @types/node, and
// Render runs a stricter `tsc -b` than vitest does (see phaseDurationsReadOnly).
const SOURCES = import.meta.glob('./*.test.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Strip line comments so prose describing the banned pattern (including this
 *  file's own header) is not mistaken for the pattern itself. */
function executable(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

// `await new Promise(... setTimeout ...)` — a bare sleep. Deliberately narrow:
// vi.useFakeTimers()/advanceTimersByTime is a different thing and stays legal.
const SLEEP = /await\s+new\s+Promise\([\s\S]{0,80}?setTimeout/;

describe('fix-300b: no guessed-duration sleeps in the test suite', () => {
  it('scans a non-trivial number of test files (the glob actually resolved)', () => {
    // Guards against the ratchet silently passing because the glob broke.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(200);
  });

  it('no test file sleeps on a guessed duration', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => !path.endsWith('noGuessedSleeps.test.ts'))
      .filter(([, src]) => SLEEP.test(executable(src)))
      .map(([path]) => path);
    expect(
      offenders,
      `use settle() for invariants or waitFor() for something that becomes true:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the 12 files fix-300b cleaned import settle or waitFor instead', () => {
    // Named explicitly so a future edit that deletes the wait entirely (rather
    // than replacing it) is visible in this list rather than silent.
    const cleaned = [
      'PermitDetailV2Fix97',
      'PermitDetailV2Fix26a',
      'ProjectDetailHeaderFix98',
      'useBuilderSearch',
      'queryClientErrorLog',
      'ProjectOverviewBuilderCell',
      'CustomReportBuiltinGuard',
      'multitenancy',
      'QuickEditPermitModal',
      'ProjectDetailHeaderFix141',
      'ProjectDetailHeaderFix122',
      'CorrectionsPanel',
    ];
    for (const name of cleaned) {
      const entry = Object.entries(SOURCES).find(([p]) =>
        p.endsWith(`/${name}.test.tsx`),
      );
      expect(entry, `${name}.test.tsx not found`).toBeTruthy();
      const src = entry![1];
      expect(
        /settle\(\)|waitFor\(/.test(src),
        `${name} waits on nothing at all now`,
      ).toBe(true);
    }
  });
});
