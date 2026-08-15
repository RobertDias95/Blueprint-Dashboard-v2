/**
 * fix-320 #1: the read-only rows on the Milestones card stopped printing ISO.
 *
 * They now render the same short date a native `<input type="date">` renders —
 * `09/11/2026` in a US browser — because the input follows the BROWSER's locale
 * and cannot be told otherwise, so the read-only side is the side that moved.
 *
 * ★ WHY THIS LIVES IN `src/test/` RATHER THAN IN FOUR TEST FILES. Four suites
 * assert what a derived date renders as (the SD window, the consultant date,
 * intake accepted). Each would otherwise carry its own copy of the expectation,
 * and four copies of a date expectation is how three of them quietly stop
 * matching the fourth. `settle.ts` set the precedent for shared test helpers.
 *
 * ★ AND WHY IT DOES NOT PIN A LOCALE. Vitest inherits the machine's locale; a
 * literal `'09/11/2026'` would pass in Seattle and fail in Berlin for a reason
 * that has nothing to do with the code. This asks the same question the
 * component asks and compares the answers.
 *
 * ★ WHAT IT CANNOT PROVE, said out loud: it mirrors the implementation, so it
 * cannot catch "both are wrong in the same way". The assertions that DO pin the
 * behaviour independently live in `DisplayPolishFix320.test.tsx` — that the
 * output is no longer ISO, that it is fixed-width, and, on an en-US runner, that
 * it is literally `09/11/2026`.
 */
export function shownDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
