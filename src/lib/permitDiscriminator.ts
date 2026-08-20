// ===========================================================================
// ★★ fix-364 §2 — four identical rows on one address
// ===========================================================================
//
// A bot task reads:
//
//     Enter permit number — was this submitted? — Building Permit @ 11231 NE 67th St
//
// ★★★ AND THAT ADDRESS HAS FOUR BUILDING PERMITS. They produce four identical
// rows on somebody's board and nothing on screen tells them apart. The text
// carries the permit TYPE and the ADDRESS but not the PERMIT — and for a
// `number_entry` task the permit has no number yet, which is the whole point of
// the task.
//
// ★ THIS IS A LABELLING FIX, NOT A DUPLICATE BUG. Verified before touching
// anything: 4 duplicate groups portfolio-wide, 6 excess rows, none of them
// open. There is no de-duplication problem to go hunting for.
//
// ---------------------------------------------------------------------------
// ★★★ THE DISCRIMINATOR, AND WHY IT IS STABLE
// ---------------------------------------------------------------------------
//
// MEASURED on prod 2026-08-20 over the population that actually has the
// problem — permits sharing a project AND a type with at least one sibling:
//
//     permits with a same-type sibling            58
//     …carrying struct_address                    54   ← "Cottage 1".."Cottage 4"
//     …carrying a permit number                   51
//     …carrying a nickname                         0   ← empty on ALL 542 permits
//     …carrying none of the three                  1
//
// ★★ `struct_address` IS THE ANSWER AND IT IS ALREADY THERE. The four permits
// at 11231 NE 67th St are "Cottage 1" … "Cottage 4" — a human wrote those to
// tell the structures apart, which is exactly the job. 93% of the population
// that needs a discriminator already has one.
//
// ★★★ EVERY CANDIDATE BELOW IS A STORED FIELD OR AN IMMUTABLE ID. Nothing is
// derived from position, ordering or count — "the 2nd of 4" renumbers the
// moment a sibling is deleted, and a label that changes between renders is
// worse than a duplicate, because it destroys the one thing a label is for.
//
//   1. nickname        a person chose it for precisely this purpose. Unused
//                      today (0 of 542) but it outranks everything if set,
//                      because somebody meant it.
//   2. struct_address  the structure on the lot. The working answer.
//   3. num             the permit number. Absent on a `number_entry` task by
//                      definition, but the best label for every other kind.
//   4. the permit id   immutable, unique, and never renumbers. Ugly, and it is
//                      the honest last resort — ★ it is also the id in the
//                      URL fix-362 made a real destination (`?permit=10255`),
//                      so a person can match the label to the address bar.

import type { Permit } from './database.types';

/** The minimum needed to label a permit. Structural rather than requiring the
 *  full `Permit`, so a board row holding only these four fields can call it. */
export interface DiscriminatorInput {
  id?: number | null;
  num?: string | null;
  nickname?: string | null;
  struct_address?: string | null;
}

function clean(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * ★ The label that tells this permit from its siblings, or null when the
 * permit has nothing stable to say.
 *
 * ★★ Null is a real answer, not a failure. `permitLabelSuffix` below uses it to
 * add nothing at all rather than to print an empty separator — a trailing " · "
 * on every single-permit project would be noise on hundreds of rows to serve
 * the 58 that need it.
 */
export function permitDiscriminator(
  permit: DiscriminatorInput | null | undefined,
): string | null {
  if (!permit) return null;
  return (
    clean(permit.nickname) ??
    clean(permit.struct_address) ??
    clean(permit.num) ??
    (typeof permit.id === 'number' ? `Permit #${permit.id}` : null)
  );
}

/**
 * ★★ THE SAME PERMIT, TOLD APART ONLY WHEN IT NEEDS TO BE.
 *
 * A discriminator on every row would be clutter: 484 of 542 permits are the
 * only one of their type on their project, and for those the address and type
 * already identify the thing completely. So the suffix appears only when the
 * permit HAS a same-type sibling — which is the exact condition under which two
 * rows would otherwise read identically.
 *
 * ★ `siblings` is passed in rather than looked up, because the caller already
 * holds the permit list and a lookup here would mean either a second source of
 * truth or a hook in a pure module.
 */
export function permitLabelSuffix(
  permit: DiscriminatorInput | null | undefined,
  siblingCount: number,
): string {
  if (siblingCount < 2) return '';
  const d = permitDiscriminator(permit);
  return d ? ` · ${d}` : '';
}

/**
 * ★ How many permits share this one's project AND type — including itself.
 *
 * ★★ Type is part of the key on purpose. A Demolition and a Building Permit on
 * one address are already told apart by the type the row prints; four Building
 * Permits are not. Counting all permits on the project instead would put a
 * discriminator on the Demolition too, for no reason.
 */
export function siblingCountOf(
  permit: { project_id?: string | null; type?: string | null } | null | undefined,
  permits: ReadonlyArray<Pick<Permit, 'project_id' | 'type'>>,
): number {
  if (!permit?.project_id) return 0;
  const type = (permit.type ?? '').trim().toLowerCase();
  return permits.filter(
    (p) =>
      p.project_id === permit.project_id &&
      (p.type ?? '').trim().toLowerCase() === type,
  ).length;
}

/**
 * ★ The one call a surface makes: "how should this task's permit be named,
 * given everything I know about the portfolio".
 *
 * Returns the suffix to append to an existing "address · type" line, or '' —
 * so a caller that already builds that string needs one concatenation and no
 * conditional of its own.
 */
export function taskPermitSuffix(
  permitId: number | null | undefined,
  permits: ReadonlyArray<
    Pick<Permit, 'id' | 'project_id' | 'type' | 'num' | 'nickname' | 'struct_address'>
  >,
): string {
  if (permitId == null) return '';
  const permit = permits.find((p) => p.id === permitId);
  if (!permit) return '';
  return permitLabelSuffix(permit, siblingCountOf(permit, permits));
}
