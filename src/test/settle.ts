import { act } from '@testing-library/react';

/**
 * fix-300: drain pending promises and let React apply whatever they caused.
 *
 * ★ USE THIS INSTEAD OF `await new Promise((r) => setTimeout(r, 25))`.
 *
 * That sleep pattern appears in 13 test files. It is normally written to guard
 * an INVARIANT — "the ENT stays Alex", "the lookup never fired" — where
 * `waitFor` is the wrong tool, because the condition is already true and
 * waitFor returns on its first successful poll having waited for nothing. The
 * sleep is an attempt to say "let the async work finish, THEN check it changed
 * nothing", and it does that by guessing a duration.
 *
 * A guessed duration is a race. It holds on an idle machine and can lose under
 * the full suite, where vitest runs files in parallel workers — which is
 * exactly where Step3Permits' two observed failures happened (fix-295 in CI,
 * fix-297 locally) and never in isolation.
 *
 * This waits for the actual thing instead: a mocked promise resolves on a
 * microtask, so draining the microtask queue inside `act` settles it and
 * flushes the React state update it caused. No clock, no guess.
 *
 * ★ WHAT IT DOES NOT DO: drain macrotasks. If the code under test genuinely
 * waits on a real timer or a network round trip, this will not settle it — and
 * a `waitFor` on the observable result is the right tool there, not a longer
 * sleep.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    // Two turns: one for the mocked promise, one for any `.then` the component
    // chained onto it.
    await Promise.resolve();
    await Promise.resolve();
  });
}
