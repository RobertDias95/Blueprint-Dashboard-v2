import type { TaskOwnership } from '../hooks/useTaskOwnership';

// ===========================================================================
// ★★★ fix-459 §A (P-107) — ONE TEST DOUBLE FOR useTaskOwnership
// ===========================================================================
//
// THE DEFECT THIS ENDS: ten suites mocked this hook with a bare object literal,
// and **not one of them declared all four members**. Every one was partial. So
// adding a member to the hook broke whichever suites happened to call the
// missing one — fix-458 added `isUnclaimed` and broke FIVE at once
// (BoardOwnershipRenderedFix308b, BoardPrimaryFix326, BoardTabsFix385,
// HeldWorkSharedToggleFix409, PersonalBoardFix318), none of which has anything
// to do with unclaimed work.
//
// ★★★ IT IS AT LEAST THE THIRD OCCURRENCE. fix-407 hit it, fix-449 documented
// it, fix-458 paid it again — and each left a COMMENT rather than a fix. This
// file is the fix; those comments are deleted with it.
//
// ---------------------------------------------------------------------------
// ★★★ STEP 0c: TYPESCRIPT CANNOT CATCH THE RAW LITERAL. MEASURED, NOT ASSUMED.
// ---------------------------------------------------------------------------
//
// A probe factory returning `{ totallyBogusMember: 123 }` from
// `vi.mock('../hooks/useTaskOwnership', ...)` typechecks CLEAN — vitest does not
// constrain a mock factory's return against the real module, so a missing member
// is never a compile error. It is a runtime failure, in a stranger's suite.
//
// ★★ WHICH IS WHY THE FACTORY IS TYPED AND THE OVERRIDE IS `Partial`. Two things
// follow, and they are the whole safety net:
//
//   1. ADD A FIFTH MEMBER TO `TaskOwnership` AND **THIS FILE** STOPS COMPILING,
//      because `base` is annotated `TaskOwnership` and must be complete. The
//      failure lands here — beside the fix — instead of in five unrelated
//      suites. That is the entire point: the defect was never the missing
//      member, it was WHERE the alarm went off.
//
//   2. A typo in an override is a compile error at the call site, because
//      `Partial<TaskOwnership>` has no index signature.
//
// ★ And because (1) is a compile-time claim that a reader cannot verify by
//   looking, `useTaskOwnership.test.tsx` also asserts at RUNTIME that this
//   double's key set equals the real hook's. Add a member to the hook, forget
//   this file, and that test fails by name.

/**
 * ★★ THE DEFAULTS ARE THE INERT ANSWER FOR EACH MEMBER — with one deliberate
 * exception, and it is not arbitrary.
 *
 * `matches: () => true` is what every one of the ten existing mocks set, so it
 * is what this must default to: §A2's rule is that migrating a suite must not
 * change what it asserts. A suite that mocked `{ matches: () => true }` and now
 * calls `makeTaskOwnership()` gets byte-identical behaviour.
 *
 * The other three default to `false` — "nobody owns this in particular", which
 * is the answer that adds no rows to any list. A suite that cares passes its
 * own.
 */
export function makeTaskOwnership(
  over: Partial<TaskOwnership> = {},
): TaskOwnership {
  // ★ ANNOTATED, NOT INFERRED. The annotation is the compile-time guard from
  //   the header — remove it and adding a member to the interface becomes
  //   silent again.
  const base: TaskOwnership = {
    // ★ `true` deliberately — see the doc block. This preserves the ten
    //   suites' existing behaviour exactly.
    matches: () => true,
    ownsDirectly: () => false,
    isCoAssigned: () => false,
    isUnclaimed: () => false,
  };
  return { ...base, ...over };
}

/**
 * The `vi.mock` factory itself, so a suite's mock is one line and cannot drift:
 *
 *   vi.mock('../hooks/useTaskOwnership', () => mockTaskOwnership());
 *   vi.mock('../hooks/useTaskOwnership', () => mockTaskOwnership({ matches: () => false }));
 *
 * ★ `over` is captured, not read per call, because a `vi.mock` factory is
 *   hoisted above the file's other statements — anything it closes over must
 *   already exist. A suite needing per-test control passes a function that
 *   reads a `vi.hoisted` ref, exactly as several already do.
 */
export function mockTaskOwnership(over: Partial<TaskOwnership> = {}): {
  useTaskOwnership: () => TaskOwnership;
} {
  const value = makeTaskOwnership(over);
  return { useTaskOwnership: () => value };
}

/**
 * ★★ The member names, for the runtime guard in `useTaskOwnership.test.tsx`.
 *
 * A TypeScript interface does not exist at runtime, so the guard compares the
 * REAL hook's keys against the double's keys — and this list is the third
 * witness, so a member added to both the hook and the double but forgotten here
 * still fails. Deliberately spelled out rather than derived from
 * `makeTaskOwnership()`, which would make the assertion circular.
 */
export const TASK_OWNERSHIP_MEMBERS = [
  'isCoAssigned',
  'isUnclaimed',
  'matches',
  'ownsDirectly',
] as const;
