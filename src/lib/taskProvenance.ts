// ===========================================================================
// ★★★ fix-363 — who gave me this, and who closed it
// ===========================================================================
//
// Bobby: "In the task, who created it, assigned it… you should be able to open
// up the task and see who created it and who assigned it to you, because you
// want to be able to reach out to that person if for some reason someone
// created something… And then who marked it complete, kind of like a
// timestamp."
//
// ---------------------------------------------------------------------------
// ★★★ THE RULE THE WHOLE TICKET TURNS ON
// ---------------------------------------------------------------------------
//
// MEASURED on prod 2026-08-20, before anything was written:
//
//     tasks                                      1,361
//     …with ANY audit row                          737   capture began 2026-08-04
//     …with none, and never will have              636
//     completions with done_at                     884
//     …audited                                     455
//     …audited WITH an actor                       295
//     bot-created (is_auto_generated)              597
//     machine-closed (auto_closed_reason)          173
//
// So for 636 tasks there is no history and never will be. **What you DON'T
// KNOW must look different from what DIDN'T HAPPEN**, and it must look
// different from both a name and a blank:
//
//     known         "Completed by Cam · Aug 19, 2026"
//     the machine   "Closed automatically when the permit issued"
//     not recorded  "Completed Aug 19, 2026 · who is not recorded"
//
// ★★★ NEVER a blank, never "Unknown" styled like a name, never the current
// assignee. And NEVER infer the creator from the assignee — they are different
// people constantly, and a plausible wrong name is worse than an honest gap,
// because nobody checks a name that looks right.
//
// ★ fix-358 shipped exactly this discipline for the plan-of-record card
// (chosen / nothing qualified / not indexed yet) and it is why that card is
// trustworthy. Same rule, same reason.

import { formatModified } from './planOfRecord';

/** One row of `bp_task_provenance`. RAW FACTS — the RPC returns no verdict. */
export interface TaskProvenanceRow {
  kind: 'created' | 'assigned' | 'completed' | 'coassigned';
  at: string | null;
  actor_uid: string | null;
  actor_name: string | null;
  /** The task text, the assignee, or the completion status — per kind. */
  detail: string | null;
  /** ★ The MACHINE'S OWN MARK, and the reason this is a fact rather than an
   *  inference: `is_auto_generated`/`auto_event` for a creation,
   *  `auto_closed_reason` for a completion, `permit_task_assignees.source` for
   *  a co-assignment. A trigger wrote each of them at the time. */
  auto_mark: string | null;
}

/** ★★★ The three states. Structural, not merely wording — the component gives
 *  each its own testid and its own treatment, so "they must not look alike" is
 *  something a test can hold rather than a thing a reader has to notice. */
export type ProvenanceState = 'person' | 'machine' | 'unrecorded';

export interface ProvenanceLine {
  kind: TaskProvenanceRow['kind'];
  state: ProvenanceState;
  /** The sentence a person reads. */
  text: string;
  /** The person to go and talk to — null unless `state` is 'person'. */
  actor: string | null;
  at: string | null;
}

// ---------------------------------------------------------------------------
// The machine's words
// ---------------------------------------------------------------------------

/** ★ fix-354 and fix-355 already chose these words for the notification that
 *  announces a closure; reusing them keeps one vocabulary for one event rather
 *  than two descriptions of it that drift. */
function closedAutomatically(reason: string): string {
  if (reason === 'permit_issued') return 'Closed automatically when the permit issued';
  if (reason.startsWith('superseded'))
    return 'Closed automatically when the permit moved past it';
  return 'Closed automatically';
}

/** ★ The bot's creations. `auto_event` names the city event that raised it
 *  (corr_issued, intake_accepted, results_ready…); when it is missing the
 *  honest statement is still "the bot", not a person. */
function createdAutomatically(mark: string): string {
  return mark && mark !== 'bot'
    ? `Created automatically by the task bot (${mark})`
    : 'Created automatically by the task bot';
}

/** ★★ fix-346 adds a design manager to a DA's task by trigger. "Who put my
 *  manager on this" has the same answer-shape as "who assigned it to me", and
 *  the same failure mode: a blank where a name goes sends somebody to ask a
 *  person who never touched it. */
function coassignedAutomatically(): string {
  return 'Added automatically as the design manager';
}

/** ★ The date half, shared by all three states so they differ in WHO and never
 *  in when. Empty string when there is no timestamp — which for `created` and
 *  `completed` cannot happen (both are columns on the task), and for the other
 *  two would mean the row itself is malformed. */
function on(at: string | null): string {
  const d = formatModified(at);
  return d ? ` · ${d}` : '';
}

/** ★ …and the same date with no separator, for the gap sentences.
 *
 *  "Completed Aug 19, 2026 · who is not recorded" — the brief's own wording,
 *  and the middot is spent on the part that matters: separating the fact from
 *  the admission. "Completed · Aug 19 · who is not recorded" reads as three
 *  equal fragments and buries the admission among them. */
function bare(at: string | null): string {
  const d = formatModified(at);
  return d ? ` ${d}` : '';
}

// ---------------------------------------------------------------------------
// ★★★ The resolver
// ---------------------------------------------------------------------------

/**
 * One row → one line, in one of three states.
 *
 * ★ THE ORDER OF THE TESTS IS THE RULE. A recorded actor wins, because a
 * person did it and can be asked. The machine's mark comes second, because a
 * trigger did it and nobody can be asked. "Not recorded" is what is left, and
 * it is a STATEMENT rather than a fallback: it says the event happened and the
 * actor is unknown, which is the true thing.
 */
export function provenanceLine(row: TaskProvenanceRow): ProvenanceLine {
  const actor = (row.actor_name ?? '').trim() || null;
  const auto = (row.auto_mark ?? '').trim() || null;
  const when = on(row.at);
  const bareWhen = bare(row.at);

  switch (row.kind) {
    case 'created':
      if (actor)
        return { kind: 'created', state: 'person', actor, at: row.at, text: `Created by ${actor}${when}` };
      if (auto)
        return {
          kind: 'created',
          state: 'machine',
          actor: null,
          at: row.at,
          text: `${createdAutomatically(auto)}${when}`,
        };
      return {
        kind: 'created',
        state: 'unrecorded',
        actor: null,
        at: row.at,
        // ★ The event is asserted; only the actor is missing. "Created" plus a
        // real date plus an explicit gap — never a blank and never a guess.
        text: `Created${bareWhen} · who is not recorded`,
      };

    case 'assigned': {
      // ★ `detail` is WHO IT WENT TO, which is the half that is never missing:
      // it is read off the audit row's `assigned_to_to`.
      const to = (row.detail ?? '').trim();
      const target = to ? `Assigned to ${to}` : 'Assigned';
      if (actor)
        return { kind: 'assigned', state: 'person', actor, at: row.at, text: `${target} by ${actor}${when}` };
      // ★★ A machine assignment has no mark of its own today — nothing writes
      // `assigned_to` but a person and the seeding path — so an actorless row
      // is UNRECORDED, not automatic. Claiming "automatically" here would be
      // the same invention this ticket exists to prevent, pointed the other
      // way.
      return {
        kind: 'assigned',
        state: 'unrecorded',
        actor: null,
        at: row.at,
        text: `${target}${bareWhen} · who is not recorded`,
      };
    }

    case 'completed':
      if (actor)
        return { kind: 'completed', state: 'person', actor, at: row.at, text: `Completed by ${actor}${when}` };
      if (auto)
        return {
          kind: 'completed',
          state: 'machine',
          actor: null,
          at: row.at,
          text: `${closedAutomatically(auto)}${when}`,
        };
      return {
        kind: 'completed',
        state: 'unrecorded',
        actor: null,
        at: row.at,
        text: `Completed${bareWhen} · who is not recorded`,
      };

    case 'coassigned': {
      const who = (row.detail ?? '').trim() || 'Someone';
      // ★ 'manual' is a person's choice, not a machine mark — the join table
      // records BOTH values, and treating 'manual' as automatic would attribute
      // somebody's decision to a trigger.
      if (auto && auto !== 'manual')
        return {
          kind: 'coassigned',
          state: 'machine',
          actor: null,
          at: row.at,
          text: `${who} — ${coassignedAutomatically()}${when}`,
        };
      if (actor)
        return {
          kind: 'coassigned',
          state: 'person',
          actor,
          at: row.at,
          text: `${who} added by ${actor}${when}`,
        };
      return {
        kind: 'coassigned',
        state: 'unrecorded',
        actor: null,
        at: row.at,
        text: `${who} added${bareWhen} · who is not recorded`,
      };
    }
  }
}

/** The whole panel, in reading order: how it began, who owns it, how it ended.
 *
 *  ★ Co-assignees come last and there may be several; everything above them is
 *  at most one line, because the RPC returns at most one of each. */
const KIND_ORDER: TaskProvenanceRow['kind'][] = [
  'created',
  'assigned',
  'coassigned',
  'completed',
];

export function buildProvenance(
  rows: ReadonlyArray<TaskProvenanceRow>,
): ProvenanceLine[] {
  const out: ProvenanceLine[] = [];
  for (const kind of KIND_ORDER) {
    for (const row of rows) {
      if (row.kind !== kind) continue;
      out.push(provenanceLine(row));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ★★ The notification's sentence
// ---------------------------------------------------------------------------

/**
 * *"Briana assigned you a task"* — Bobby's own words, and the point of the
 * feature: a name you can go and talk to.
 *
 * ★ DEGRADES TO TODAY'S WORDING, never to a guess. `bp_task_assigners` returns
 * only rows that carry an actor, so an absent entry means "not recorded" and
 * this returns the subtitle the board has shown since fix-307. Inventing
 * "Someone assigned you a task" would be worse: it implies the tool knows a
 * person was involved when it does not.
 */
export function assignedSubtitle(
  assignerName: string | null | undefined,
  isCoAssignee: boolean,
): string {
  const who = (assignerName ?? '').trim();
  if (!who) return isCoAssignee ? 'Added as co-assignee' : 'Assigned to you';
  return isCoAssignee
    ? `${who} added you as a co-assignee`
    : `${who} assigned you a task`;
}
