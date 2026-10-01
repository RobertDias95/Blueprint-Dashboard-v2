import type { TaskTemplate } from './database.types';

// ===========================================================================
// fix-609 (P-306) — WHICH TEMPLATES A PERMIT GETS, said once
// ===========================================================================
//
// Two places offer a permit its template tasks: the new-project wizard (Step 4)
// and, since fix-609, a permit added to a project that already exists. Both
// read this module so the add-later path cannot drift from the wizard's.
//
// The SERVER makes the same decision independently — `bp_add_template_tasks_to_permit`
// refuses a template that does not apply — so this is what the person is
// SHOWN, and the database is what is ENFORCED.

/** True when a template applies to a (permit_type, juris) pair: same type, and
 *  a jurisdiction that is NULL ("Base") or this project's.
 *  ★ Base rows apply ALONGSIDE the jurisdiction's own rows, always — they are
 *  not a fallback that a jurisdiction row overrides. */
export function templateApplies(
  t: Pick<TaskTemplate, 'permit_type' | 'jurisdiction'>,
  permitType: string,
  juris: string,
): boolean {
  if (t.permit_type !== permitType) return false;
  if (t.jurisdiction === null) return true;
  return t.jurisdiction === juris;
}

/** The wizard's display order: sort_order ascending, then text. */
export function compareTemplates(
  a: Pick<TaskTemplate, 'sort_order' | 'text'>,
  b: Pick<TaskTemplate, 'sort_order' | 'text'>,
): number {
  return (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.text.localeCompare(b.text);
}

/** The templates that apply, in display order. */
export function applicableTemplates<T extends TaskTemplate>(
  templates: readonly T[],
  permitType: string,
  juris: string,
): T[] {
  return templates.filter((t) => templateApplies(t, permitType, juris)).sort(compareTemplates);
}

/** ★ What is still worth OFFERING: applicable templates whose text is not
 *  already a task on this permit. The client twin of the RPC's idempotency
 *  rule — `permit_tasks` records no template id, so "already applied" is the
 *  same text on the same permit. */
export function templatesToOffer<T extends TaskTemplate>(
  templates: readonly T[],
  permitType: string,
  juris: string,
  existingTaskTexts: Iterable<string>,
): T[] {
  const have = new Set(existingTaskTexts);
  return applicableTemplates(templates, permitType, juris).filter((t) => !have.has(t.text));
}

/** The wizard's default: everything ticked — or nothing, on a backfill
 *  project, whose history is already done (fix-386). */
export function defaultTickedIds(
  templates: readonly Pick<TaskTemplate, 'id'>[],
  isBackfill: boolean,
): Set<string> {
  return isBackfill ? new Set() : new Set(templates.map((t) => t.id));
}
