import type { BoardTask, PermitMilestoneAck } from './myBoard';
import type { BoardFlip } from './boardFlips';
import { FLIP_LABEL } from './boardFlips';
import { keyForMention } from './projectChat';
import type { Project, PermitWithCycles } from './database.types';

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

// ★ fix-329 adds the fifth source. A mention is news in exactly the sense this
// file means: something happened that names you, you have not seen it, and
// seeing it is not doing it.
// ★ fix-339 adds the sixth and seventh sources — and the sixth is a new SHAPE,
// not just a new row type. See NewItemAudience.
// ★★★ fix-354 adds the EIGHTH, and the doc block below named it in advance:
// "#102 (bot tasks that close and announce themselves)". This is its sibling —
// the machine closing tasks because a permit ISSUED, which fix-337 shipped
// without any way of telling anyone. 103 tasks, 58 permits, zero people told.
export type NewItemSource =
  | 'flip'
  | 'task'
  | 'handoff'
  | 'permit'
  | 'mention'
  | 'post_request'
  | 'post_request_outcome'
  | 'auto_closed';

/**
 * ★★★ fix-339 — THE TWO SHAPES OF A BOARD ITEM, and the rule for picking one.
 *
 * Everything before fix-339 was PERSONAL. fix-307's model is `board_item_reads`:
 * one row per user per key, and a thing is unread FOR YOU. That is right when
 * "seen" is not a fact any domain row carries — nothing about a status flip
 * records that Miles looked at it, so a read row has to.
 *
 * A post request is not that shape. Bobby: *"it pings the oversight people + the
 * ent lead for that project, then once it is created/read/satisfied, as a
 * notification, IT GETS REMOVED FROM ALL QUEUES."* Five people each dismissing
 * the same request is exactly the busywork he is deleting, and a per-user read
 * row makes "satisfied" unrepresentable, because there is no shared state to
 * satisfy.
 *
 * ★★ SO A SHARED ITEM HAS NO READ MODEL AT ALL. Its EXISTENCE IS ITS UNREAD
 * STATE: it is derived from a domain row only while that row is unresolved, so
 * the moment anybody acts it stops being derived and leaves every queue at once
 * — not because N read rows were written, but because the one fact everybody
 * was reading changed.
 *
 * ★ THE RULE, for #102 (bot tasks that close and announce themselves) and #105
 * (milestones that clear when acknowledged), both of which are this shape:
 *
 *     personal → the domain row cannot record "seen", so use board_item_reads
 *     shared   → the domain row already records RESOLUTION, so derive the item
 *                from it and get first-responder-wins for free
 *
 * Both of those already have a domain row (permit_tasks, permit_milestone_acks),
 * so neither needs a shared read table — each needs its item derived from its
 * own row's state, exactly as post_requests is. The reusable part is this rule
 * and this field, not a table.
 *
 * ★ AND THE TWO COEXIST IN ONE LIST. `unseenItems` applies read keys to personal
 * items and skips them for shared ones, so the bell's badge and My Board — which
 * both call it — cannot disagree about either kind. That was fix-329's rule and
 * fix-331 §3 held to it.
 */
export type NewItemAudience = 'personal' | 'shared';

export interface NewItem {
  /** ★ Stable across re-derivation — see keyFor* below. */
  key: string;
  source: NewItemSource;
  /** ★ fix-339. Defaults to 'personal' everywhere it is omitted, so every
   *  pre-fix-339 item keeps fix-307's behaviour unchanged. */
  audience?: NewItemAudience;
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
// ★ fix-329: `mention:{message_id}`. project_messages.id is a uuid primary key
// and the table is append-only, so the key is as immutable as the four above.
// Re-exported from projectChat so the chat surfaces and the bell cannot end up
// with two spellings of the same key.
export { keyForMention };
/** ★ fix-339: the SHARED item. Keyed on the request's uuid like everything else
 *  — but nothing ever writes a read row against it, because resolving the
 *  request is what removes it. See NewItemAudience. */
/** ★★ fix-354: the FYI that the machine closed some of your work.
 *
 *  ★ KEYED ON THE LEDGER ROW'S OWN uuid — permit_task_auto_closures.id. The key
 *  scheme's rule is that a key must be a stable database identity, and its
 *  reason applies here exactly: a key built from the permit plus a TASK COUNT
 *  would re-notify the moment another task closed on the same permit, and one
 *  built from a task list would change shape as that list grew. A primary key
 *  cannot do either.
 *
 *  ★ One row is one (permit, closure, recipient) — never one per task. */
export function keyForAutoClosed(closureId: string): string {
  return `auto_closed:${closureId}`;
}

export function keyForPostRequest(requestId: string): string {
  return `post_request:${requestId}`;
}
/** ★ And the PERSONAL notice that follows it, for the requester alone. The two
 *  keys are deliberately different: one is the shared ask, the other is one
 *  person's news about how it ended, and that one IS acknowledgeable. */
export function keyForPostRequestOutcome(requestId: string): string {
  return `post_request_outcome:${requestId}`;
}

/** ★ fix-329: the minimum a mention needs to become a bell item. Deliberately
 *  NOT the full ProjectMessage — the bell's tenant-wide query selects these
 *  columns straight off the table and never needs the author-name join. */
export interface MentionItemInput {
  id: string;
  project_id: string;
  body: string;
  created_at: string;
  mentions: string[];
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
  /** fix-329: chat messages that mention the viewer. Optional so every existing
   *  caller keeps working unchanged. */
  mentions?: ReadonlyArray<MentionItemInput>;
  /** ★ fix-329: the viewer's AUTH USER ID, not their roster name. The other four
   *  sources match on a name because that is what permits and tasks carry;
   *  mentions are stored as user ids, which cannot change under a row. */
  viewerUserId?: string | null;
  /** Projects, for resolving a mention's address. Optional for the same
   *  backwards-compatible reason. */
  projects?: ReadonlyArray<Pick<Project, 'id' | 'address'>>;
  /** ★★ fix-354: closures the machine made — one row per (permit, closure,
   *  recipient), already routed by the database. Optional so every existing
   *  caller and test fixture keeps working unchanged. */
  autoClosures?: ReadonlyArray<AutoClosureItemInput>;
  /** ★ fix-339: post requests addressed to the viewer (shared, still open) and
   *  requests the viewer RAISED that have been resolved (personal outcome).
   *  One query feeds both — see bp_my_post_requests. */
  postRequests?: ReadonlyArray<PostRequestItemInput>;
}

/** ★ fix-339: the minimum a post request needs to become a board item. */
/** ★ fix-354: a row of permit_task_auto_closures, joined to enough of the
 *  permit to say WHERE. `recipient` is resolved server-side by
 *  bp_auto_close_recipient — the client never re-derives it, because a second
 *  opinion about who owns the work is exactly what fix-238 exists to prevent. */
export interface AutoClosureItemInput {
  id: string;
  permit_id: number;
  project_id: string | null;
  address: string | null;
  permit_label: string | null;
  reason: string;
  /** ★★ fix-355: the sentence that lets a reader CHECK the judgement — which
   *  rule fired and what the city did, with its date. Null on fix-354's
   *  `permit_issued` rows, which report a FACT rather than a judgement: the
   *  permit issued, and there is nothing to argue with. */
  detail: string | null;
  recipient: string;
  task_count: number;
  closed_at: string;
}

export interface PostRequestItemInput {
  id: string;
  project_id: string;
  project_address: string | null;
  title: string;
  reason: string;
  status: 'open' | 'created' | 'acknowledged' | 'declined';
  requester_name: string | null;
  resolver_name: string | null;
  created_post_id: string | null;
  created_at: string;
  resolved_at: string | null;
  /** True when the viewer is a recipient (the shared ask); false when the
   *  viewer is the requester seeing how it ended. */
  is_recipient: boolean;
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

  // 5. ★ fix-329: someone mentioned me in a project's chat.
  //
  // Matched on USER ID, and only for the viewer — the query that feeds this is
  // already narrowed to "mentions me", and this second check is what makes
  // "increments for the mentioned person and NOBODY else" a property of the
  // builder rather than a property of one caller's query.
  const meId = input.viewerUserId ?? null;
  if (meId) {
    for (const m of input.mentions ?? []) {
      if (!isAfterEpoch(m.created_at)) continue;
      if (!(m.mentions ?? []).includes(meId)) continue;
      const project = (input.projects ?? []).find((p) => p.id === m.project_id);
      out.push({
        key: keyForMention(m.id),
        source: 'mention',
        title: 'Mentioned you in chat',
        subtitle: m.body.length > 120 ? `${m.body.slice(0, 117)}…` : m.body,
        where: project?.address ?? 'Project chat',
        at: m.created_at,
        permitId: null,
        projectId: m.project_id,
      });
    }
  }

  // 6. ★★ fix-339: a post request addressed to me — the first SHARED item.
  //
  // ★ NO EPOCH FILTER, and that is deliberate. fix-307's epoch exists so a
  // 300-day-old status flip cannot arrive as news on deploy day; there were no
  // post requests before fix-339, so every one of them is genuinely new, and an
  // epoch check here would only be a way to lose one.
  //
  // ★ ALSO NO viewerName MATCH. The other sources ask "does this name me?"; the
  // recipient list was resolved server-side at request time, and
  // bp_my_post_requests already returns only the rows addressed to this login.
  // Re-deriving it from a roster name here would be a second answer to a
  // question the database has already answered — and it would drop Miles, whose
  // ent_lead match is a name but whose delivery is by id.
  for (const p of input.postRequests ?? []) {
    if (p.is_recipient && p.status === 'open') {
      out.push({
        key: keyForPostRequest(p.id),
        // ★★ The one thing that makes this different from every item above it.
        audience: 'shared',
        source: 'post_request',
        title: `Post requested: ${p.title}`,
        subtitle: `${p.requester_name ?? 'Someone'} — ${
          p.reason.length > 100 ? `${p.reason.slice(0, 97)}…` : p.reason
        }`,
        where: p.project_address ?? 'Project chat',
        at: p.created_at,
        permitId: null,
        projectId: p.project_id,
      });
      continue;
    }
    // 7. ★ …and the PERSONAL notice back to whoever asked. A request that
    // vanishes silently teaches people not to bother asking again, so the
    // outcome is news for exactly one person — and, being one person's news, it
    // is acknowledgeable in the ordinary fix-307 way.
    if (!p.is_recipient && p.status !== 'open') {
      out.push({
        key: keyForPostRequestOutcome(p.id),
        audience: 'personal',
        source: 'post_request_outcome',
        title:
          p.status === 'created'
            ? `Your post was created: ${p.title}`
            : p.status === 'declined'
              ? `Post request declined: ${p.title}`
              : `Post request acknowledged: ${p.title}`,
        subtitle: p.resolver_name ? `by ${p.resolver_name}` : null,
        where: p.project_address ?? 'Project chat',
        at: p.resolved_at ?? p.created_at,
        permitId: null,
        projectId: p.project_id,
      });
    }
  }

  // ★★★ fix-354 — WHAT THE MACHINE CLOSED, AND WHO IT BELONGED TO.
  //
  // Register #100: *"maybe it checks off that milestone but then gives a
  // notification back to that entitlement lead that says, hey, as an FYI,
  // milestone was marked complete because the permit has progressed."*
  //
  // ★★ PERSONAL, NOT SHARED — and it is the distinction fix-339 drew. A post
  // request is SHARED because one person acting SATISFIES it. Nothing here is
  // satisfied: it is an FYI to the person whose work changed, and one person
  // reading it must not clear it for another. So it takes fix-307's per-user
  // read rows, and `audience` is left at its 'personal' default.
  //
  // ★ ROUTED SERVER-SIDE. `recipient` was resolved by bp_auto_close_recipient
  // in the same transaction as the close — the assignee when it names a person,
  // the role's holder when it names a role, then the permit's ENT lead, then the
  // project's. The client only asks "is that me". Re-deriving it here would be a
  // second opinion about who owns the work, which is what fix-238 exists to
  // stop, and it would be a DIFFERENT opinion the moment somebody is reassigned.
  //
  // ★ GROUPED ALREADY: one input row is one (permit, closure, recipient), so
  // "6 tasks on 7112264-DM" is one line, not six.
  for (const c of input.autoClosures ?? []) {
    if ((c.recipient ?? '').trim().toLowerCase() !== me) continue;
    if (!isAfterEpoch(c.closed_at)) continue;
    out.push({
      key: keyForAutoClosed(c.id),
      source: 'auto_closed',
      // ★ The words a person actually meets. "Closed for you" rather than
      // "auto_closed_reason = permit_issued", and the COUNT is the fact that
      // makes it worth reading — it is the difference between a shrug and
      // "six things I thought I still had to do".
      // ★★ fix-355 gave this a SECOND reason, so the headline follows the
      // reason rather than assuming issuance. The two are different kinds of
      // statement and the words say which:
      //
      //   permit_issued  a FACT — the city issued it, and nothing about that
      //                  is arguable.
      //   superseded     a JUDGEMENT — the machine decided the permit had moved
      //                  past this work. §2's rule is that a judgement the
      //                  reader cannot check is one they cannot overturn, so
      //                  `detail` carries the evidence and its date.
      title: `${c.task_count === 1 ? '1 task' : `${c.task_count} tasks`} closed — ${
        c.reason === 'permit_issued'
          ? 'the permit issued'
          : 'the permit moved past them'
      }`,
      subtitle:
        c.detail
          ? `${c.detail} Reopen any of them if it still applies.`
          : 'Marked done automatically because the work no longer applies. Reopen any of them if it still does.',
      where: `${c.address ?? 'Unknown address'} · ${c.permit_label ?? 'Permit'}`,
      at: c.closed_at,
      permitId: c.permit_id,
      projectId: c.project_id,
    });
  }

  return out.sort((a, z) => z.at.localeCompare(a.at));
}

/**
 * The items this person has NOT acknowledged.
 *
 * ★★ fix-339 — TWO RULES, ONE FUNCTION, and that is how the bell and My Board
 * stay in agreement. A PERSONAL item disappears when the viewer has a read row
 * for it. A SHARED item has no read rows at all: it is only ever derived while
 * its request is open, so if it is here it is unseen, and when anybody resolves
 * it, it stops being derived for everyone at once.
 *
 * ★ Putting both rules HERE rather than at the call sites is the point — the
 * badge and the board both call this, so neither can grow its own opinion about
 * what is waiting on you. That was fix-329's rule and the defect fix-298 Phase 2
 * spent a ticket collapsing.
 */
export function unseenItems(
  items: ReadonlyArray<NewItem>,
  readKeys: ReadonlySet<string>,
): NewItem[] {
  return items.filter((i) =>
    i.audience === 'shared' ? true : !readKeys.has(i.key),
  );
}

/** ★ fix-339: the items a "mark all read" may legitimately touch.
 *
 *  A shared item must be EXCLUDED: marking it read would write a row nothing
 *  reads and leave the item on screen, which is a control that lies. Resolving
 *  it is a different act with a different button. */
export function acknowledgeableItems(
  items: ReadonlyArray<NewItem>,
): NewItem[] {
  return items.filter((i) => i.audience !== 'shared');
}

/** ★ The badge. Unseen, not undone — and never affected by the queue scope. */
export function unseenCount(
  items: ReadonlyArray<NewItem>,
  readKeys: ReadonlySet<string>,
): number {
  return unseenItems(items, readKeys).length;
}
