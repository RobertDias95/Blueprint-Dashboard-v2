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
    // ⚠️ RULED 2026-09-11, REVERSING THE 09-10 RULE ON EVIDENCE. 11 of 17
    //    originals hold unit dimensions their redesign does not, so hiding them
    //    removes the only copy from the matrix the Library exists to be.
    library: 'hatched',
    drawSchedule: 'hatched',
  },
};

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
