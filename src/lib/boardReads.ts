import type { BoardTask, PermitMilestoneAck } from './myBoard';
import type { BoardFlip } from './boardFlips';
import { flipEventKey, flipEventTitle, flipEventDetail } from './boardFlips';
import {
  buildReactionDigests,
  keyForReactions,
  reactionDetail,
  reactionTitle,
  type PostReactionRow,
} from './postReactions';
import { keyForMention } from './projectChat';
import type { NewItemTarget } from './notificationTargets';
import { assignedSubtitle } from './taskProvenance';
import { taskPermitSuffix } from './permitDiscriminator';
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
  | 'auto_closed'
  // fix-360 adds the NINTH, and like fix-339's it is a new shape rather than a
  // new row type: one item per POST whose CONTENT changes as more reactions
  // arrive. See lib/postReactions for the watermark key that makes a mutating
  // item expressible in an append-only read model.
  | 'reaction';

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
  /** fix-360: keys this item USED to be delivered under, before its source
   *  learned to group. See unseenItems for the one rule that reads them. */
  legacyKeys?: string[];
  /** ★★ fix-362: WHAT this is about, as opposed to where it lives.
   *
   *  ★ `permitId` and `projectId` above answer "where"; this answers "what",
   *  and `lib/notificationTargets.targetHref` turns it into the URL. Optional
   *  because a source may genuinely have no finer target than the page — and
   *  where that is true it is said out loud at the source rather than left to
   *  look like an omission. */
  target?: NewItemTarget;
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
  /** fix-360: reactions to the viewer's OWN posts, one row per reaction, with
   *  the viewer's own already excluded server-side. Optional so every existing
   *  caller and fixture keeps working unchanged. */
  reactions?: ReadonlyArray<PostReactionRow>;
  /** ★★ fix-363: who assigned each recently-assigned task, so the notification
   *  can say "Briana assigned you a task" rather than "Assigned to you".
   *
   *  ★ Only tasks whose assignment carries a recorded actor appear here —
   *  `bp_task_assigners` filters `actor_uid IS NOT NULL`. An absent task means
   *  NOT RECORDED, and the title degrades to the wording it has had since
   *  fix-307 rather than inventing a person. Optional, so every existing caller
   *  and fixture keeps working unchanged. */
  taskAssigners?: ReadonlyArray<{ task_id: string; actor_name: string | null }>;
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
  /** ★ fix-362: WHICH tasks this closure covered, recorded by the closing
   *  transaction itself. Null on every row written before fix-362 — those
   *  degrade to the permit, which is where they landed before. */
  task_ids?: string[] | null;
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
  /** ★ fix-363: the recorded assigner, or null. Never a guess — see the input's
   *  own note for why an absent entry is "not recorded" rather than "nobody". */
  const assignerOf = (taskId: string): string | null =>
    (input.taskAssigners ?? []).find((a) => a.task_id === taskId)?.actor_name ??
    null;

  // 1. Status flips the scraper detected. parseFlips has already dropped the
  // retry-recovered and manual-edit-guard actions (50.8 and 14.5 a day) and
  // the fix-304 backfill filter, so a 300-day-old applied date cannot arrive
  // here as news. This deliberately REUSES that rule rather than restating it.
  //
  // ★★★ fix-360 §1 — AND THEY ARRIVE GROUPED. One scrape write that moved
  // three columns was three items, two of them saying "Approved". It is now
  // one, titled the way a person would say it, with every moved column listed
  // beneath. See boardFlips.flipEventKey for the identity that groups them and
  // for what `scraper_run_at` turned out to actually be.
  const flipGroups = new Map<string, BoardFlip[]>();
  for (const f of input.flips) {
    if (!isAfterEpoch(f.at)) continue;
    const permit = addressOf(f.permitId);
    const mine =
      (f.entLead ?? '').trim().toLowerCase() === me ||
      (permit?.da ?? '').trim().toLowerCase() === me;
    if (!mine) continue;
    const key = flipEventKey(f);
    const bucket = flipGroups.get(key);
    if (bucket) bucket.push(f);
    else flipGroups.set(key, [f]);
  }
  for (const [key, group] of flipGroups) {
    // The event happened when its earliest write landed; a group's members
    // differ by milliseconds, and picking the oldest keeps the feed's ordering
    // stable as a group grows.
    const at = group.reduce((a, f) => (f.at < a ? f.at : a), group[0].at);
    const head = group[0];
    out.push({
      key,
      source: 'flip',
      title: flipEventTitle(group),
      subtitle: flipEventDetail(group),
      where: `${head.address ?? 'Unknown address'} · ${head.permitType ?? 'Permit'}`,
      at,
      permitId: head.permitId,
      projectId: head.projectId,
      // ★★ fix-362: THE PERMIT IS THE THING. A status flip is not an event
      // that happened somewhere on a permit; it IS the permit changing, and
      // there is no finer surface to land on. Declared rather than defaulted,
      // so "no finer target" is a decision on the record.
      target: head.permitId
        ? { kind: 'permit', projectId: head.projectId, permitId: head.permitId }
        : undefined,
      // ★★ THE READ STATE SURVIVES THE REGROUPING. 54 flip read rows across 5
      // people exist on prod under the OLD per-field keys, and a new key scheme
      // would re-open every one of them on deploy day — the same three-figure
      // badge fix-307's epoch was built to prevent, arriving by a different
      // door. So a grouped item also answers to the keys its members used to
      // have, and is read when all of them are.
      // ★ Deduped: one write can produce two flips of the SAME kind (a status
      //   string and a date both meaning `approved`), and they shared one key
      //   before this ticket too — so the set of old keys is smaller than the
      //   set of flips, and listing a key twice would say nothing extra.
      legacyKeys: [...new Set(group.map((f) => keyForFlip(f.auditId, f.kind)))],
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
      // ★★ fix-363: THE NAME, when it is recorded. Bobby's own sentence —
      // "Brianna assigned you a task" — and the point of the feature is that it
      // is a name you can go and talk to. `assignedSubtitle` falls back to the
      // pre-fix-363 wording when nothing was recorded, which is every task
      // assigned before 2026-08-20.
      subtitle: assignedSubtitle(
        assignerOf(t.id),
        co && !assigned,
      ),
      // ★★ fix-364 §2: …and WHICH of the four. 11231 NE 67th St has four
      // Building Permits, so "address · Building Permit" named all of them
      // equally and none of them. The suffix appears only when the permit
      // actually has a same-type sibling — see lib/permitDiscriminator.
      where: `${t.project_address ?? 'Unknown address'} · ${
        t.permit_type ?? 'Permit'
      }${taskPermitSuffix(t.permit_id, input.permits)}`,
      at: t.created_at ?? '',
      permitId: t.permit_id,
      projectId: t.project_id ?? null,
      // ★★ fix-362: the TASK, opened — not the permit that contains it. The
      // board's detail pane is where a task is read and edited, and landing on
      // the permit would mean finding it in a bar of them.
      target: { kind: 'task', taskId: t.id },
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
      // ★★ fix-362, and this one was a judgement call. A handoff is a
      // MILESTONE ACK, and a milestone ack has no page of its own — it is a
      // mark on the permit's milestone strip, beside the task bar holding the
      // filing work it has just unblocked. So the permit is not a fallback
      // here, it is the answer: everything "ready to file" means is on it.
      target: { kind: 'permit', projectId: permit.project_id, permitId: a.permit_id },
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
      // ★ fix-362: the permit IS the thing, like a flip.
      target: { kind: 'permit', projectId: p.project_id, permitId: p.id },
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
        // ★★★ fix-362: THE MESSAGE THAT MENTIONS YOU — post or reply. This is
        // the case Bobby named first, and the one where landing on the project
        // was worst: a reply forty messages up in a thread you have to pick out
        // of a list of threads.
        target: { kind: 'message', projectId: m.project_id, messageId: m.id },
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
        // ★★ fix-362 — CHAT-ONLY, and this is one of the two places where a
        // source genuinely has no finer target than the page.
        //
        // A post request is an ask for a post that DOES NOT EXIST YET; that is
        // the whole of what it is. There is nothing to focus, so the honest
        // destination is the conversation it is an ask about — where the
        // request panel is, and where answering it happens.
        target: { kind: 'chat', projectId: p.project_id },
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
        // ★★ fix-362: THE POST THAT SATISFIED IT, when there is one.
        //
        // fix-339 already records `created_post_id` in the same transaction
        // that resolves the request, precisely so "the requester is taken to
        // the thread rather than told it is somewhere" — this is that sentence
        // finally being true from the notification as well as from the modal.
        //
        // ★ Declined and acknowledged produce no post, so they land on the
        // chat: there is no thing, and inventing one would be worse than
        // saying where the conversation is.
        target: p.created_post_id
          ? {
              kind: 'message',
              projectId: p.project_id,
              messageId: p.created_post_id,
            }
          : { kind: 'chat', projectId: p.project_id },
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
      // ★★★ fix-362 — ONE closure, ONE destination, and the count decides it.
      //
      // This row's grain is (permit, closure, recipient) covering N tasks, so
      // it is a GROUPED item and §4's rule applies: one destination, never
      // re-fanned into a link per task. MEASURED on prod: 48 of 55 closures
      // covered exactly one task, 7 covered two to four.
      //
      //   one task   → THE TASK. fix-362 added `task_ids` to the ledger so the
      //                id is a fact recorded at closing time, not a guess made
      //                later from a permit and a count.
      //   several    → THE PERMIT, whose task bar holds all of them. The item's
      //                own subtitle says "Reopen any of THEM", plural; picking
      //                one of four to land on would be answering a question
      //                nobody asked.
      //   no ids     → THE PERMIT. Every row written before fix-362 is here,
      //                and it degrades to exactly the pre-fix-362 behaviour
      //                rather than to a broken link.
      target:
        (c.task_ids ?? []).length === 1
          ? { kind: 'task', taskId: (c.task_ids as string[])[0] }
          : { kind: 'permit', projectId: c.project_id, permitId: c.permit_id },
    });
  }

  // ★★★ fix-360 §2 — ONE ROW PER POST, AND IT KEEPS COUNTING.
  //
  // ★ NO EPOCH FILTER, for fix-339's reason: reactions did not exist before
  // fix-347 and there were 1 of them in the database when this shipped, so
  // every one is genuinely new and an epoch check could only lose one.
  //
  // ★ NO viewerName MATCH EITHER. The audience is the post's AUTHOR, which is
  // an auth id; bp_my_post_reactions already returns only the caller's own
  // posts, and re-deriving that from a roster name here would be a second
  // answer to a question the database has answered — and a worse one, since
  // profiles.name is NULL for all 29 logins (fix-330).
  for (const d of buildReactionDigests(input.reactions ?? [])) {
    const project = (input.projects ?? []).find((p) => p.id === d.projectId);
    out.push({
      // ★★ The watermark is in the key, which is what makes ONE row mutate
      // rather than fifteen rows accumulate. lib/postReactions explains why
      // that is the whole of the read model this needed.
      key: keyForReactions(d.messageId, d.newestAt),
      source: 'reaction',
      title: reactionTitle(d.total),
      subtitle: reactionDetail(d),
      where: project?.address ?? 'Project chat',
      // ★ The NEWEST reaction, not the first — the item is about the state of
      // the applause, so it sorts by when that state last changed.
      at: d.newestAt,
      permitId: null,
      projectId: d.projectId,
      // ★★★ fix-362 §4: YOUR OWN POST — the thing being reacted to, never any
      // one reactor. A digest is fix-360's grouped shape, and re-fanning it
      // into a link per reaction would undo that ticket one ticket later.
      target: { kind: 'message', projectId: d.projectId, messageId: d.messageId },
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
  return items.filter((i) => (i.audience === 'shared' ? true : !hasBeenRead(i, readKeys)));
}

/** ★ fix-360: has this person seen this item, under ANY key it has ever had?
 *
 *  ★★ The straight answer is the first line, and it is the only one that will
 *  matter in a month. The second exists because fix-360 regrouped a source that
 *  had already been delivering items: 54 read rows on prod carry the old
 *  per-field flip keys, and without this every one of them would re-open on
 *  deploy day. A grouped item is read when every key it used to be delivered
 *  under is read — anything less would be claiming somebody saw news they
 *  never got.
 *
 *  ★ It decays on its own. Nothing writes a legacy key any more, so the branch
 *  stops mattering as the old rows age past the feed's window — which is why it
 *  is a predicate here rather than a backfill of rows that would live forever.
 *
 *  ★ EXPORTED so the notification centre can ask the same question. It carries
 *  its own copy of the unread test (it renders both states per row rather than
 *  a filtered list), and two spellings of "read" would let the bell and the
 *  centre disagree — the failure fix-329 exists to prevent. */
export function hasBeenRead(
  item: NewItem,
  readKeys: ReadonlySet<string>,
): boolean {
  if (readKeys.has(item.key)) return true;
  const legacy = item.legacyKeys;
  if (!legacy || legacy.length === 0) return false;
  return legacy.every((k) => readKeys.has(k));
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
