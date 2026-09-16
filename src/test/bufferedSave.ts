import { expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

// ===========================================================================
// ★★★ fix-575 §A (P-227) — READING A BUFFERED FIELD'S WRITE, IN ONE PLACE
// ===========================================================================
//
// Before this ticket, a project scalar was written on blur, so a test could
// assert the value straight off `useUpdateProject`'s mock. The 23 scalars
// buffer now and reach the database through the modal's Save, as ONE
// multi-column patch on `useUpdateProjectWithPermits`.
//
// ★★★ WHAT THOSE TESTS WERE ACTUALLY PINNING IS UNCHANGED, and that is why
//     this is a helper rather than a rewrite: every one of them is about the
//     VALUE a control produces for a column — `100.47` rounds to `100`, a
//     cleared box writes `null` and never `0`, a date arrives as an ISO
//     string, `false` is not `null`. Those rulings outlive the plumbing.
//     Only the place you read the answer moved.
//
// ★★ SO THE HELPER TAKES THE SAME SHAPE THE OLD ASSERTION DID — "what patch
//    did this column get?" — and each repaired test keeps its own expectation
//    verbatim. A helper that also asserted would have let the rulings drift
//    into one shared opinion.

/** Click the modal's Save and wait for the atomic write to fire. */
export async function saveModal(
  permitsMutateAsync: { mock: { calls: unknown[][] } },
): Promise<void> {
  fireEvent.click(screen.getByTestId('project-data-done'));
  await waitFor(() => expect(permitsMutateAsync.mock.calls.length).toBeGreaterThan(0));
}

/**
 * The project patch the modal's Save sent.
 *
 * ★ `projectPatch` is the draft, spread whole — so a field nobody touched is
 *   absent rather than restated, which is fix-520 §A's rule surviving into the
 *   buffered model.
 */
export function savedPatch(
  permitsMutateAsync: { mock: { calls: unknown[][] } },
): Record<string, unknown> {
  // ★ THE LATEST call, not the first: a suite that forgets to clear the mock
  //   between tests would otherwise assert the previous test's patch and pass
  //   or fail for the wrong reason.
  const calls = permitsMutateAsync.mock.calls;
  const call = calls[calls.length - 1]?.[0] as
    | { projectPatch?: Record<string, unknown> }
    | undefined;
  return call?.projectPatch ?? {};
}

/** Edit a control, press Save, and hand back the patch that reached the RPC. */
export async function commitViaSave(
  permitsMutateAsync: { mock: { calls: unknown[][] } },
  edit: () => void,
): Promise<Record<string, unknown>> {
  edit();
  // ★ The Save button only exists while dirty — which is itself the ticket, so
  //   a buffered edit that failed to register fails here with a clear message
  //   rather than as a mysterious empty patch.
  await waitFor(() =>
    expect(screen.getByTestId('project-data-done').textContent).toBe('Save'),
  );
  await saveModal(permitsMutateAsync);
  return savedPatch(permitsMutateAsync);
}
