import type { BoardTask, PermitMilestoneAck } from './myBoard';
import type { BoardFlip } from './boardFlips';
import { FLIP_LABEL } from './boardFlips';
import type { PermitWithCycles } from './database.types';

// fix-307 (register #36–#41) — the badge counts what is UNSEEN, not what is
// undone.
//
// ★ THE MODEL THAT CHANGED. BoardBell said it plainly: "the badge counts what
// is ASKED OF YOU — past due + today + blocked". A badge counting outstanding
// work never reaches zero, so it stops being a signal and becomes decoration —
// the same failure as a red CI check nobody reads.
//
// Zero now means "I have seen everything new", never "I have nothing to do".
// Bobby: "even though your notifications are at zero, you still have a bunch of
// outstanding things … but at least you've acknowledged those new items."
//
// ★★ READ IS NOT DONE, and it is the rule most likely to be got wrong.
// Acknowledging removes an item from the badge and clears its highlight. It
// STAYS on the board — still past due, still in today, still needing doing.
// Nothing in this file touches a task, an ack, or a permit.

/** ★ The backfill, done with zero rows.
 *
 *  On the day this ships, every existing flip and assignment would become
 *  "new" at once and everybody would open the tool to a three-figure badge.
 *  Nothing older than this instant can ever be new, for anyone — which is
 *  exactly "treat everything older than the deploy as already read". It needs
 *  no rows, cannot drift out of sync with a user list, and still works for a
 *  user created next month. */
export const BOARD_NOTIFICATIONS_EPOCH = '2026-08-14T00:00:00Z';

export type NewItemSource = 'flip' | 'task' | 'handoff' | 'permit';

export interface NewItem {
  /** ★ Stable across re-derivation — see keyFor* below. */
  key: string;
  source: NewItemSource;
  title: string;
  subtitle: string | null;
  /** "3626 164th Pl SE · Building Permit" */
  where: string;
  /** ISO instant the thing happened. */
  at: string;
  permitId: number | null;
  projectId: string | null;
}

// ---------------------------------------------------------------------------
// ★ The key scheme. Every root is an immutable DATABASE IDENTITY, never a
// re-derived value — a key built from a date, a name or a status would
// silently re-notify the moment that value changed under the row.
// ---------------------------------------------------------------------------

/** audit_log is append-only and never reuses ids, so the same flip yields the
 *  same key however many times parseFlips runs. `kind` is appended because ONE
 *  audit row can carry several applied keys (a cycle row can apply submitted +
 *  city_target + corr_issued at once) and each is separately acknowledgeable. */
export function keyForFlip(auditId: number, kind: string): string {
  return `flip:${auditId}:${kind}`;
}
export function keyForTask(taskId: string): string {
  return `task:${taskId}`;
}
export function keyForHandoff(ackId: string): string {
  return `handoff:${ackId}`;
}
export function keyForPermit(permitId: number): string {
  return `permit:${permitId}`;
}

function isAfterEpoch(at: string | null | undefined): boolean {
  if (!at) return false;
  return Date.parse(at) > Date.parse(BOARD_NOTIFICATIONS_EPOCH);
}

export interface NewItemsInput {
  /** Already suppression- and backfill-filtered by boardFlips.parseFlips. */
  flips: ReadonlyArray<BoardFlip>;
  tasks: ReadonlyArray<BoardTask>;
  acks: ReadonlyArray<PermitMilestoneAck>;
  permits: ReadonlyArray<PermitWithCycles>;
  /** The viewer's roster name. */
  viewerName: string | null;
}

/** Everything that could be new to this person, before read state is applied.
 *
 *  ★ ALWAYS PERSONAL. This takes the viewer's name and nothing about the queue
 *  scope — switching to My team shows somebody else's queue, it does not change
 *  what YOU have not seen. */
export function buildNewItems(input: NewItemsInput): NewItem[] {
  const me = (input.viewerName ?? '').trim().toLowerCase();
  if (!me) return [];
  const out: NewItem[] = [];
  const addressOf = (permitId: number | null) =>
    input.permits.find((p) => p.id === permitId);

  // 1. Status flips the scraper detected. parseFlips has already dropped the
  // retry-recovered and manual-edit-guard actions (50.8 and 14.5 a day) and
  // the fix-304 backfill filter, so a 300-day-old applied date cannot arrive
  // here as news. This deliberately REUSES that rule rather than restating it.
  for (const f of input.flips) {
    if (!isAfterEpoch(f.at)) continue;
    const permit = addressOf(f.permitId);
    const mine =
      (f.entLead ?? '').trim().toLowerCase() === me ||
      (permit?.da ?? '').trim().toLowerCase() === me;
    if (!mine) continue;
    out.push({
      key: keyForFlip(f.auditId, f.kind),
      source: 'flip',
      title: FLIP_LABEL[f.kind],
      subtitle: f.applied,
      where: `${f.address ?? 'Unknown address'} · ${f.permitType ?? 'Permit'}`,
      at: f.at,
      permitId: f.permitId,
      projectId: f.projectId,
    });
  }

  // 2. A task newly assigned to me, or where I was added as a co-assignee.
  for (const t of input.tasks) {
    if (!isAfterEpoch(t.created_at)) continue;
    const assigned = (t.assigned_to ?? '').trim().toLowerCase() === me;
    const co = (t.co_assignees ?? []).some(
      (n) => (n ?? '').trim().toLowerCase() === me,
    );
    if (!assigned && !co) continue;
    out.push({
      key: keyForTask(t.id),
      source: 'task',
      title: t.text,
      subtitle: co && !assigned ? 'Added as co-assignee' : 'Assigned to you',
      where: `${t.project_address ?? 'Unknown address'} · ${t.permit_type ?? 'Permit'}`,
      at: t.created_at ?? '',
      permitId: t.permit_id,
      projectId: t.project_id ?? null,
    });
  }

  // 3. A handoff arriving — the design leg completed and it is now mine.
  for (const a of input.acks) {
    if (a.milestone !== 'design_complete') continue;
    if (!isAfterEpoch(a.acked_at)) continue;
    const permit = addressOf(a.permit_id);
    if (!permit) continue;
    if ((permit.ent_lead ?? '').trim().toLowerCase() !== me) continue;
    out.push({
      key: keyForHandoff(a.id),
      source: 'handoff',
      title: 'Ready to file',
      subtitle: a.acked_by_name ? `${a.acked_by_name} finished the design` : null,
      where: `${permit.type ?? 'Permit'}`,
      at: a.acked_at,
      permitId: a.permit_id,
      projectId: permit.project_id,
    });
  }

  // 4. A permit newly naming me — the project arriving in my queue.
  for (const p of input.permits) {
    const at = p.created_at ?? null;
    if (!isAfterEpoch(at)) continue;
    const mine =
      (p.ent_lead ?? '').trim().toLowerCase() === me ||
      (p.da ?? '').trim().toLowerCase() === me;
    if (!mine) continue;
    out.push({
      key: keyForPermit(p.id),
      source: 'permit',
      title: 'New in your queue',
      subtitle: p.type ?? null,
      where: `${p.num ?? 'No permit number'} · ${p.type ?? 'Permit'}`,
      at: at!,
      permitId: p.id,
      projectId: p.project_id,
    });
  }

  return out.sort((a, z) => z.at.localeCompare(a.at));
}

/** The items this person has NOT acknowledged. */
export function unseenItems(
  items: ReadonlyArray<NewItem>,
  readKeys: ReadonlySet<string>,
): NewItem[] {
  return items.filter((i) => !readKeys.has(i.key));
}

/** ★ The badge. Unseen, not undone — and never affected by the queue scope. */
export function unseenCount(
  items: ReadonlyArray<NewItem>,
  readKeys: ReadonlySet<string>,
): number {
  return unseenItems(items, readKeys).length;
}
