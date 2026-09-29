import type { Project } from './database.types';

// ===========================================================================
// ★★★ fix-524 §A (P-023 + P-220) — ONE HATCH, TWO RETIRED STATES
// ===========================================================================
//
// Bobby: *"similar to how cancelled gets all those hash lines with a line
// through it, but instead of grey on grey, maybe it's like a purple on
// purple."* — and he ruled P-023 and P-220 **one ticket**, so the shared
// pattern gets designed while both uses are on the table rather than the second
// one being retrofitted onto the first.
//
// ★★★ SO THE HATCH IS WRITTEN ONCE AND TAKES ITS COLOURS AS ARGUMENTS. If it
//     were written twice — a `--hatch-cancelled` literal and a
//     `--hatch-redesigned` literal beside it — the ticket would have failed on
//     its own terms, and the second copy would be where the stripe width drifts.
//
// ★★★ AND THE RETIRED PREDICATE IS ALSO WRITTEN ONCE. A project is retired if
//     it has a live `project_holds` row with `kind='cancelled'`, **or** if
//     another non-archived project names it in `redesign_of_project_id`. Two
//     writers of one rule is the defect this Brain has removed three times
//     (fix-264's `isCancelledProject`, fix-519's unit columns, fix-522's three
//     readers), and this file is the one writer.
//
// ★★ MEASURED ON PROD 2026-09-11, re-derived rather than carried:
//
//       cancelled (open `kind='cancelled'` row)                    5
//       redesign originals (named by a live redesign)             17
//       in BOTH                                                    0
//       ───────────────────────────────────────────────────────────
//       distinct retired projects                                 22
//
//     `projects.archived` is false on all 220 and is NOT the retired flag.
//     `draw_schedule.status` holds seven PHASE values and no retired state at
//     all — which is why this is derived at render time and never stored.

// ---------------------------------------------------------------------------
// The two causes
// ---------------------------------------------------------------------------

/** Why a project is retired. ★ Two causes, one treatment — that is the whole
 *  point of the shared hatch. They are mutually exclusive on prod today (0 in
 *  both) but nothing enforces that, so {@link retiredCause} picks one. */
export type RetiredCause = 'cancelled' | 'redesigned';

/** The id sets a caller resolves once and passes everywhere.
 *
 *  ★ Both are OPTIONAL and an omitted set means "nothing retired for that
 *    cause" — so a surface that has not loaded holds yet renders pre-fix-524
 *    behaviour rather than flickering 22 rows away and back. That is fix-264's
 *    rule for `cancelledIds`, kept. */
export interface RetiredSets {
  /** From `cancelledProjectIds(holds)` — OPEN cancel rows only. Holds are
   *  deliberately never in it: a held project is still active work. */
  cancelledIds?: ReadonlySet<string>;
  /** From {@link redesignedAwayProjectIds}. */
  redesignedIds?: ReadonlySet<string>;
}

/**
 * The projects that have been redesigned AWAY — i.e. superseded by a live
 * redesign of themselves.
 *
 * ★★★ THE DIRECTION MATTERS AND IS EASY TO GET BACKWARDS. This returns the
 *     **originals**, read off the CHILDREN's `redesign_of_project_id`. The
 *     redesign itself is current work and is never in this set — §B: *"the
 *     redesign itself: normal. No hatch, no badge, no 'this is a redesign'
 *     treatment."*
 *
 * ★ An ARCHIVED redesign does not retire its original: if the successor has
 *   been filed away, the original is the live one again. Archived is false on
 *   all 220 today, so this is defensive — but the alternative is a project
 *   retired by a row nobody can see.
 */
export function redesignedAwayProjectIds(
  projects: readonly Pick<Project, 'id' | 'archived' | 'redesign_of_project_id'>[]
    | undefined,
): Set<string> {
  const s = new Set<string>();
  for (const p of projects ?? []) {
    if (p.archived) continue;
    const original = p.redesign_of_project_id;
    // ★ A row naming ITSELF would retire itself forever. Nothing writes that,
    //   and the guard costs one comparison.
    if (original && original !== p.id) s.add(original);
  }
  return s;
}

/**
 * Why this project is retired, or `null`.
 *
 * ★ **Cancelled wins** when a project is somehow both. It is the stronger
 *   statement — a cancelled project is not coming back, a redesigned one has a
 *   successor doing its work — and a reader seeing grey learns the more
 *   important fact. 0 projects are in both on prod; the tie-break is written
 *   down so it cannot be decided differently by two surfaces later.
 */
export function retiredCause(
  projectId: string | null | undefined,
  sets: RetiredSets | undefined,
): RetiredCause | null {
  if (!projectId || !sets) return null;
  if (sets.cancelledIds?.has(projectId)) return 'cancelled';
  if (sets.redesignedIds?.has(projectId)) return 'redesigned';
  return null;
}

/** Is this project retired, for either cause? */
export function isRetiredProject(
  projectId: string | null | undefined,
  sets: RetiredSets | undefined,
): boolean {
  return retiredCause(projectId, sets) !== null;
}

/**
 * Drop retired projects from a list of anything project-keyed.
 *
 * ★ Works on `Project[]` (keyed by `id`) and on permit / task / row shapes
 *   (keyed by `project_id`), exactly as fix-264's `excludeCancelled` does —
 *   and returns the SAME array reference when nothing is retired, so the
 *   common case adds no re-render.
 */
export function excludeRetired<T extends { id: string } | { project_id: string }>(
  rows: T[],
  sets: RetiredSets | undefined,
): T[] {
  const n = (sets?.cancelledIds?.size ?? 0) + (sets?.redesignedIds?.size ?? 0);
  if (n === 0) return rows;
  return rows.filter(
    (r) => !isRetiredProject('project_id' in r ? r.project_id : r.id, sets),
  );
}

// ---------------------------------------------------------------------------
// ★★★ THE HATCH — ONE RECIPE, TWO COLOUR PAIRS
// ---------------------------------------------------------------------------
//
// fix-263 put `--hatch-cancelled` in index.css as a literal, and its reasoning
// was right: *"the same paint has to reach the shared HoldBadge, which cannot
// import draw-schedule tokens. One definition in index.css, three consumers."*
//
// ★★★ WHAT CHANGED IS THAT THERE ARE NOW TWO OF THEM. A CSS custom property
//     cannot be parameterised without being written out again, so a second
//     literal would have appeared beside the first — and §A says in as many
//     words that writing the hatch twice is the ticket failing. The recipe
//     moves here, where it takes arguments; the COLOURS stay in index.css,
//     where colours belong and where fix-263's three consumers can still reach
//     them by name.
//
// ★★ THE STRIPE WIDTH IS THE PART THAT MUST NOT DRIFT. Five pixels at 45° is
//    what fix-263 measured as surviving the smallest row height the grid
//    produces. It is now one number read by both causes rather than two numbers
//    that happen to agree.

/** Stripe width in px. ★ fix-263's number, now stated once. */
export const HATCH_STRIPE_PX = 5;

/**
 * A 45° two-tone hatch. **The only place this repo builds one.**
 *
 * ★ Takes CSS values, not colour names, so a caller can pass `var(--…)` and
 *   keep fix-263's "the legend swatch is literally the same paint as the thing
 *   it explains" property.
 */
export function hatch(a: string, b: string): string {
  const w = HATCH_STRIPE_PX;
  return (
    `repeating-linear-gradient(45deg, ${a} 0, ${a} ${w}px, ` +
    `${b} ${w}px, ${b} ${w * 2}px)`
  );
}

export interface RetiredPalette {
  /** The two stripe colours, as CSS values. */
  a: string;
  b: string;
  border: string;
  text: string;
  /** What the legend and the badge call this state. */
  label: string;
}

/**
 * ★★★ GREY = CANCELLED, PURPLE = REDESIGNED AWAY. The only difference between
 *     the two treatments is these four colours — a test asserts the two hatch
 *     strings differ in nothing but them.
 *
 * ★★ WHY NOT A FLAT PURPLE: the same reason cancelled is not a flat grey.
 *    fix-263 measured that flat grey is already spoken for by the Vacation / NP
 *    overlay, so cancelled needed a texture. A flat purple would be a second
 *    colour key on the same rectangle as the phase fill — and the two retired
 *    states have to read as *the same kind of thing* at a glance, which is what
 *    a shared texture says and a different fill does not.
 */
export const RETIRED_PALETTE: Record<RetiredCause, RetiredPalette> = {
  cancelled: {
    a: 'var(--color-cancelled-a)',
    b: 'var(--color-cancelled-b)',
    border: 'var(--color-cancelled-border)',
    text: 'var(--color-cancelled-text)',
    label: 'Cancelled',
  },
  redesigned: {
    a: 'var(--color-redesigned-a)',
    b: 'var(--color-redesigned-b)',
    border: 'var(--color-redesigned-border)',
    text: 'var(--color-redesigned-text)',
    // ★ "Redesigned" and not "Superseded": it names what somebody DID, which is
    //   what a person scanning a board is trying to recall. §D's copy on the
    //   project itself is where the word "superseded" earns its place, because
    //   there the reader is being told the consequence rather than the event.
    label: 'Redesigned',
  },
};

// ---------------------------------------------------------------------------
// ★★★ fix-525 §B — WHERE EACH CAUSE GOES, STATED ONCE
// ---------------------------------------------------------------------------
//
// fix-524 treated the two causes identically on every surface. Bobby reversed
// his own 09-10 Library rule on evidence — fix-524 measured that hiding the
// redesigned original would empty **11 of the 17 pairs** out of the unit
// matrix, because 11 originals hold the only `unit_types` their pair has — and
// ruled: **keep it, hatched.**
//
// ★★★ SO THE TWO STATES NOW DIVERGE ON EXACTLY ONE SURFACE, AND IT IS WRITTEN
//     DOWN HERE RATHER THAN AS AN `if` AT A CALL SITE. §B: *"The Library asks
//     the cause and treats them differently; it does not ask a second question
//     of its own."* A surface that grew its own second predicate is how the
//     divergence becomes two divergences.
//
// ★ THE PRINCIPLE, so this does not read as a whim: **a retired project
//   disappears where current work is CHOSEN and stays where its data is still
//   THE ONLY COPY.** Cancelled has a successor nowhere; a redesign has one
//   everywhere except the units.

/** What a surface does with a retired project. */
export type RetiredTreatment = 'hidden' | 'hatched';

export interface RetiredVisibility {
  /** "What should I work on." */
  pipeline: RetiredTreatment;
  /** "What do we have." ★ The one that diverges. */
  library: RetiredTreatment;
  /** "Where did the time go." ★ Never hidden: a retired block still consumed a
   *  designer's weeks, and a board that hid it would lie about capacity. */
  drawSchedule: RetiredTreatment;
}

export const RETIRED_VISIBILITY: Record<RetiredCause, RetiredVisibility> = {
  cancelled: {
    pipeline: 'hidden',
    // ★ A cancelled project's data is not the only copy of anything — there is
    //   no successor carrying it forward, and it is not inventory either.
    library: 'hidden',
    drawSchedule: 'hatched',
  },
  redesigned: {
    pipeline: 'hidden',
    // ═══════════════════════════════════════════════════════════════════════
    // ★★★ fix-593 (D-2026-09-28) — RULED A THIRD TIME, AND THE EVIDENCE MOVED
    // ═══════════════════════════════════════════════════════════════════════
    //
    // **Dave, via Bobby:** *"On the library, only show the current unit option,
    // not the original… we are using the current unit dimensions, not the
    // original, so we should not visibly show the original in the library
    // matrix."*
    //
    // ⚠️ THIS FLAG HAS NOW BEEN SET THREE TIMES, AND THE HISTORY IS THE POINT:
    //
    //      09-10  fix-524 briefed  hidden   (Bobby's first ruling)
    //      09-11  fix-525 shipped  hatched  ← reversed ON EVIDENCE
    //      09-28  fix-593 ships    hidden   (Dave's ask)
    //
    //    fix-525 did not overrule Bobby on taste; it measured that **11 of 17
    //    pairs held their only `unit_types` on the ORIGINAL**, so hiding it
    //    emptied 65% of the redesign pairs out of the matrix the Library exists
    //    to be. That was the right call on 09-11.
    //
    // ★★★ AND IT HAS DECAYED. Re-measured on prod 2026-09-28: **21 pairs, and
    //     the original is the only copy on just 3 of them (14%)** — 16 of the 21
    //     redesigns now carry their own unit data, which they did not in
    //     September. fix-525's objection has largely resolved itself because the
    //     team filled the redesigns in. **The reversal is safe now in a way it
    //     was not seventeen days ago**, and that is why this is a one-line change
    //     rather than an argument.
    //
    // ⏸ THE 3 THAT STILL LOSE THEIR DATA ARE NAMED IN THE PR AND NOT PATCHED.
    //    12238 4th Ave NW · 12836 N 60th St · 137 13th Ave. Falling back to the
    //    original when the redesign is blank is a DIFFERENT rule with a
    //    different meaning, and it is Bobby's to make. See fix-593 §2.
    //
    // ★ `pipeline` and `drawSchedule` are untouched. This record is per-surface
    //   precisely so a Library ruling cannot reach the board that plans work or
    //   the one that accounts for time — fix-593 §3's *"the Library matrix only"*
    //   is satisfied by construction here rather than by a call-site `if`.
    library: 'hidden',
    drawSchedule: 'hatched',
  },
};

/**
 * How many projects each cause hides from `surface`.
 *
 * ★★★ fix-593 §3 — BECAUSE THE COUNT LINE HAS TO STOP SAYING "CANCELLED".
 *     fix-524 §B's header reads *"N cancelled hidden"*, which was true while
 *     `cancelled` was the only cause hidden from the Library. It is not any
 *     more, and a label that calls 21 redesign originals "cancelled" is exactly
 *     the totals-disagree-with-rows class the brief's ★ warns about — Bobby has
 *     caught it twice (50-vs-48, 332-vs-65).
 *
 * ★ Returned per cause rather than as a total, so the label can enumerate and a
 *   test can assert the enumeration sums to what actually vanished. A future
 *   third cause that nobody adds to the copy then fails a test instead of
 *   quietly hiding rows under somebody else's word.
 */
export function retiredHiddenCounts(
  surface: keyof RetiredVisibility,
  projectIds: readonly string[],
  sets: RetiredSets | undefined,
): Map<RetiredCause, number> {
  const out = new Map<RetiredCause, number>();
  for (const id of projectIds) {
    const cause = retiredCause(id, sets);
    if (cause !== null && RETIRED_VISIBILITY[cause][surface] === 'hidden') {
      out.set(cause, (out.get(cause) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * The header's phrase for what the hide removed — *"5 cancelled, 21 redesigned
 * hidden"* — or `null` when nothing was hidden.
 *
 * ★★ THE WORDS COME FROM {@link RETIRED_PALETTE}, not from a literal here. The
 *    Library header used to say *"superseded"* while every other surface said
 *    *"Redesigned"*; one vocabulary means a reader who learned the purple on the
 *    Draw Schedule reads this line without being taught a second word.
 * ★ Cause order is fixed rather than Map-insertion order, so the sentence does
 *   not reshuffle itself depending on which project sorts first.
 */
const CAUSE_ORDER: readonly RetiredCause[] = ['cancelled', 'redesigned'];

export function retiredHiddenLabel(
  counts: ReadonlyMap<RetiredCause, number>,
): string | null {
  const parts: string[] = [];
  for (const cause of CAUSE_ORDER) {
    const n = counts.get(cause) ?? 0;
    if (n > 0) parts.push(`${n} ${RETIRED_PALETTE[cause].label.toLowerCase()}`);
  }
  return parts.length === 0 ? null : `${parts.join(', ')} hidden`;
}

/** Is this project hidden from `surface`? ★ Asking the CAUSE, which is §B's
 *  requirement — not a second predicate beside `retiredCause`. */
export function retiredHiddenFrom(
  surface: keyof RetiredVisibility,
  projectId: string | null | undefined,
  sets: RetiredSets | undefined,
): boolean {
  const cause = retiredCause(projectId, sets);
  return cause !== null && RETIRED_VISIBILITY[cause][surface] === 'hidden';
}

/** The hatch for one retired cause. ★ One call site for each of the two; the
 *  gradient itself is built in exactly one place. */
export function retiredHatch(cause: RetiredCause): string {
  const p = RETIRED_PALETTE[cause];
  return hatch(p.a, p.b);
}
