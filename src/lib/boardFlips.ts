import type { BoardTask } from './myBoard';

// fix-304 §17/§18 — the status flip, and its merge with the bot's task.
//
// Register #17: "The scraper changed this from city target to corrections.
// That's a big thing." Designed in mockups v2–v7 and never carried into a
// brief's scope, so the bell shipped with NO status-flip content at all.
//
// Register #18: the flip and the task the bot creates from it are ONE event and
// must be ONE row. Measured on prod 2026-08-14: all 86 bot `corr_issued` tasks
// match a cycle flip on the same permit, and the p95 gap between them is
// 0.22 SECONDS — the scraper writes both in the same run. Un-merged, that is
// 86 duplicated pairs, and the duplicate is the less informative half.

/** The flips a person should hear about. Everything else is machine noise. */
export type FlipKind =
  | 'corrections_required'
  | 'approved'
  | 'issued'
  | 'intake_accepted'
  | 'cycle_opened'
  | 'cycle_closed';

export interface ActivityRowLike {
  id: number;
  created_at: string;
  action: string;
  row_id: string | null;
  permit_num: string | null;
  permit_type: string | null;
  address: string | null;
  ent_lead: string | null;
  project_id: string | null;
  changes: Record<string, unknown> | null;
}

export interface BoardFlip {
  key: string;
  /** fix-307: the audit_log row this came from. append-only and never reused,
   *  so it is the stable half of the item key — see boardReads.keyForFlip. */
  auditId: number;
  kind: FlipKind;
  permitId: number | null;
  projectId: string | null;
  permitNum: string | null;
  permitType: string | null;
  address: string | null;
  entLead: string | null;
  /** When the scraper applied it. */
  at: string;
  /** The value it applied — a date, or the new status string. */
  applied: string | null;
  /** ★★ fix-360: WHICH COLUMN MOVED, not just what it meant.
   *
   *  Two flips can share a `kind` and be different facts — a permit going to
   *  "Conceptually Approved" and its `approval_date` being filled in are both
   *  `approved`, and the grouped item has to be able to say both without
   *  saying the word twice. `kind` is the meaning; this is the evidence. */
  field: FlipField;
  /** ★★★ fix-360: the scraper's own stamp for the fetch this came from —
   *  `changes.scraper_run_at`. It is what groups a permit's simultaneous
   *  changes into ONE item without guessing at a time window. Null on rows
   *  written before the scraper started stamping it. */
  runAt: string | null;
}

/** The applied keys that become flips. ★ The NAME of the column, which is a
 *  fact about the write, as opposed to `FlipKind`, which is our reading of it. */
export type FlipField =
  | 'status'
  | 'corr_issued'
  | 'approval_date'
  | 'actual_issue'
  | 'intake_accepted'
  | 'submitted'
  | 'resubmitted';

// ★ NEVER reach a person. scrape_workflow_fetch_recovered runs ~50.8/day and
// the manual-edit guards ~14.5/day — the two largest categories in the system,
// both meaning "working as intended". The bell keeps showing their COUNTS
// (fix-298), it just never shows them as events.
const SUPPRESSED_ACTIONS = new Set([
  'scrape_workflow_fetch_recovered',
  'scrape_workflow_fetch_failed',
  'scrape_skipped_recent_manual_edit',
  'scrape_cycle_skipped_recent_manual_edit',
  'scrape_reviewer_skipped_recent_manual_edit',
  'scrape_skipped',
  'scrape_skipped_concurrent_edit',
  'scrape_cycle_skipped_concurrent_edit',
]);

const FLIP_ACTIONS = new Set([
  'scrape_change_applied',
  'scrape_cycle_change_applied',
]);

/** Status strings that mean each kind. Matched case-insensitively on a
 *  substring so a jurisdiction's wording variant still lands. */
function statusKind(status: string): FlipKind | null {
  const s = status.toLowerCase();
  if (s.includes('correction')) return 'corrections_required';
  if (s.includes('issued') || s.includes('ready for issuance')) return 'issued';
  if (s.includes('approved')) return 'approved';
  return null;
}

/** ★ Is this applied value a live event, or the scraper backfilling history?
 *
 *  MEASURED, and it is not a small effect: of 271 corr_issued flips, 88 (32%)
 *  applied a date more than 30 days old, the worst by 300 days. Those are the
 *  scraper filling in a permit's past, not corrections arriving today. Treating
 *  them as flips would announce 300-day-old news in the bell — a third of the
 *  feed would be history dressed as events. */
function isLiveDate(applied: string, at: string, maxAgeDays: number): boolean {
  const a = Date.parse(`${applied}T12:00:00Z`);
  const t = Date.parse(at);
  if (Number.isNaN(a) || Number.isNaN(t)) return false;
  return (t - a) / 86_400_000 <= maxAgeDays;
}

const LIVE_WINDOW_DAYS = 7;

/** Permit id out of an audit row_id. Permit rows carry the bare id; cycle rows
 *  carry "<permit_id>:cycle:<n>". */
function permitIdOf(rowId: string | null): number | null {
  if (!rowId) return null;
  const head = rowId.split(':')[0];
  const n = Number(head);
  return Number.isFinite(n) ? n : null;
}

/** Turn the scraper feed into the flips worth telling somebody about. */
export function parseFlips(
  rows: ReadonlyArray<ActivityRowLike>,
  maxAgeDays: number = LIVE_WINDOW_DAYS,
): BoardFlip[] {
  const out: BoardFlip[] = [];
  for (const r of rows) {
    if (SUPPRESSED_ACTIONS.has(r.action)) continue;
    if (!FLIP_ACTIONS.has(r.action)) continue;
    const applied = (r.changes?.applied ?? null) as Record<string, string> | null;
    if (!applied) continue;

    const base = {
      auditId: r.id,
      permitId: permitIdOf(r.row_id),
      projectId: r.project_id,
      permitNum: r.permit_num,
      permitType: r.permit_type,
      address: r.address,
      entLead: r.ent_lead,
      at: r.created_at,
      // ★ fix-360. Read straight off the audit row — the scraper writes it, so
      // nothing here derives, rounds or guesses it.
      runAt:
        typeof r.changes?.scraper_run_at === 'string'
          ? (r.changes.scraper_run_at as string)
          : null,
    };

    // ★ `extras` is the LARGEST applied key in the system (241 in 30 days) and
    // is pure churn — reviewer names, descriptions, portal ids. It is not a
    // flip and must never reach a person. Same for city_target, which moves
    // constantly without anything happening.
    // fix-307: the key matches boardReads.keyForFlip so an acknowledged flip
    // stays acknowledged, however many times this is re-derived.
    const push = (kind: FlipKind, field: FlipField, value: string | null) =>
      out.push({ key: `flip:${r.id}:${kind}`, kind, field, applied: value, ...base });

    if (typeof applied.status === 'string') {
      const kind = statusKind(applied.status);
      // A status flip carries no date of its own, so the feed window bounds it.
      if (kind) push(kind, 'status', applied.status);
    }
    if (typeof applied.corr_issued === 'string') {
      if (isLiveDate(applied.corr_issued, r.created_at, maxAgeDays))
        push('corrections_required', 'corr_issued', applied.corr_issued);
    }
    if (typeof applied.approval_date === 'string') {
      if (isLiveDate(applied.approval_date, r.created_at, maxAgeDays))
        push('approved', 'approval_date', applied.approval_date);
    }
    if (typeof applied.actual_issue === 'string') {
      if (isLiveDate(applied.actual_issue, r.created_at, maxAgeDays))
        push('issued', 'actual_issue', applied.actual_issue);
    }
    if (typeof applied.intake_accepted === 'string') {
      if (isLiveDate(applied.intake_accepted, r.created_at, maxAgeDays))
        push('intake_accepted', 'intake_accepted', applied.intake_accepted);
    }
    if (typeof applied.submitted === 'string') {
      if (isLiveDate(applied.submitted, r.created_at, maxAgeDays))
        push('cycle_opened', 'submitted', applied.submitted);
    }
    if (typeof applied.resubmitted === 'string') {
      if (isLiveDate(applied.resubmitted, r.created_at, maxAgeDays))
        push('cycle_closed', 'resubmitted', applied.resubmitted);
    }
  }
  return out;
}

export const FLIP_LABEL: Record<FlipKind, string> = {
  corrections_required: 'Corrections Required',
  approved: 'Approved',
  issued: 'Issued',
  intake_accepted: 'Intake accepted',
  cycle_opened: 'New review cycle opened',
  cycle_closed: 'Resubmitted — cycle closed',
};

// ===========================================================================
// FIX-360 §1 — ONE EVENT, ONE ITEM
// ===========================================================================
//
// Bobby, reading his own notification centre: "Seems like a lot of redundant
// notifications for the same thing, no?"
//
// MEASURED, and the example in the brief is exact. SDOTTRLA0002500
// (233 31st Ave E, SDOT Tree), audit row 20192, ONE write at 2026-08-19
// 21:03:53, whose `applied` was:
//
//     { status: "Conceptually Approved",
//       approval_date: "2026-08-19",
//       actual_issue:  "2026-08-19" }
//
// `parseFlips` fans that into THREE flips — approved, approved, issued — and so
// into three board items, two of which say the same word. What happened is "the
// tree permit came through". The feed described the columns that moved.
//
// This is the rule fix-354 already established, applied to the source that
// predates it: one notification per permit per EVENT, never one per field.
//
// ---------------------------------------------------------------------------
// WHAT `scraper_run_at` ACTUALLY IS — and the brief was half right
// ---------------------------------------------------------------------------
//
// The brief says to key off the scrape RUN because "the run identity is a fact,
// and [a time window] is a guess". The fact is real and it is used here. But
// measured on prod, `scraper_run_at` is NOT one value per run — it is the
// instant one particular FETCH was made, and a single pass writes many:
//
//     pass of 2026-08-19 21:04     run_at stamped on its rows
//     permit 10409                 20:44:49
//     permit 10078                 20:50:47
//     permit 10509                 20:54:09
//     permit 316   (permit row)    21:03:44
//     permit 316   (cycle row)     21:04:07   <- same permit, same pass
//     permits 10456 + 10521        21:04:06   <- two permits, one stamp
//
// So it identifies a WRITE, not a sweep. Two consequences, both deliberate:
//
//   * A permit whose permit-level and cycle-level rows were fetched at
//     different moments still produces two items. That is UNDER-merging, and it
//     is the direction to fail in: the brief calls the over-merge guard "the one
//     most likely to be got wrong", and merging two genuine events on a busy
//     permit deletes news. Over 30 days this leaves 268 items where 322 stood.
//
//   * No time window appears anywhere below. The alternative to an imperfect
//     fact is not a better fact; it is a guess.

/** The identity of the WRITE a flip came from: one permit, one scrape stamp.
 *
 *  STABLE ACROSS RE-DERIVATION, which is the key scheme's one rule. Both halves
 *  are immutable: a permit id never changes under a row, and `scraper_run_at`
 *  is a stamp the scraper made once and never revisits. The rule's reason — "a
 *  key built from a date, a name or a status would silently re-notify the
 *  moment that value changed" — is about values that MOVE under a row. This one
 *  cannot: it is not "the permit's date", it is "the moment this write was
 *  fetched", and that is history.
 *
 *  The audit row id is the fallback, not the primary. Rows written before the
 *  scraper stamped `scraper_run_at` carry none, and one item per audit row is
 *  exactly the pre-fix-360 behaviour minus the per-field fan-out — a graceful
 *  degradation rather than a wrong answer.
 *
 *  Keeps the `flip:` prefix: the key's first segment is how read rows are
 *  grouped in analytics (`split_part(item_key,':',1)`), and a new prefix would
 *  make fix-307's own history unreadable for no gain. Collision with the old
 *  `flip:{auditId}:{kind}` form is impossible — the third segment here is an
 *  ISO instant or an id, never a kind name. */
export function flipEventKey(f: BoardFlip): string {
  const permit = f.permitId ?? 'audit' + String(f.auditId);
  const run = f.runAt ?? 'audit' + String(f.auditId);
  return 'flip:' + String(permit) + ':' + run;
}

/** The short form of each kind, for a headline that names more than one.
 *
 *  FLIP_LABEL is a heading and reads like one ("New review cycle opened"); two
 *  of those joined with "and" read like a ransom note. These are the words a
 *  person would use in the middle of a sentence, which is where they end up. */
const FLIP_WORD: Record<FlipKind, string> = {
  corrections_required: 'corrections required',
  approved: 'approved',
  issued: 'issued',
  intake_accepted: 'intake accepted',
  cycle_opened: 'a new cycle opened',
  cycle_closed: 'resubmitted',
};

/** What each moved COLUMN is called, for the body.
 *
 *  `status` is null on purpose: its value is already a sentence in the city's
 *  own words ("Conceptually Approved"), and labelling it would print the word
 *  approved twice in one line — the exact complaint, moved down a row rather
 *  than fixed. Every other field carries a date, and a bare date with no name
 *  is information lost. */
const FIELD_LABEL: Record<FlipField, string | null> = {
  status: null,
  corr_issued: 'Corrections issued',
  approval_date: 'Approval date',
  actual_issue: 'Issue date',
  intake_accepted: 'Intake accepted',
  submitted: 'Submitted',
  resubmitted: 'Resubmitted',
};

/** The order kinds are named in, so one event always reads the same way: the
 *  shape of a permit's life, not the order the columns happened to be written
 *  in. */
const KIND_ORDER: FlipKind[] = [
  'cycle_opened',
  'intake_accepted',
  'corrections_required',
  'cycle_closed',
  'approved',
  'issued',
];

/** The headline for a set of flips that arrived together.
 *
 *  One kind keeps FLIP_LABEL EXACTLY, so every single-flip item in the bell
 *  reads today as it read before fix-360 — which is most of them. Only a
 *  genuinely multi-kind event gets the composed sentence, and it names each
 *  kind ONCE: the SDOTTRLA case, three flips of two kinds, becomes
 *  "Approved and issued". */
export function flipEventTitle(flips: ReadonlyArray<BoardFlip>): string {
  const kinds = KIND_ORDER.filter((k) => flips.some((f) => f.kind === k));
  if (kinds.length === 0) return 'Permit updated';
  if (kinds.length === 1) return FLIP_LABEL[kinds[0]];
  const words = kinds.map((k) => FLIP_WORD[k]);
  const last = words.pop() as string;
  const joined = words.join(', ') + ' and ' + last;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** What moved, so nothing is lost.
 *
 *  The brief is explicit: "Do not lose information. 'Approved and issued' must
 *  remain discoverable — collapse the NOTIFICATIONS, not the facts." So the
 *  headline collapses and the body enumerates: one entry per column that moved,
 *  named and valued, in the field order above.
 *
 *  Deduped by the rendered TEXT, because one write can only say a thing once —
 *  and not by kind, which would drop the status behind the date or the date
 *  behind the status depending on iteration order. */
export function flipEventDetail(flips: ReadonlyArray<BoardFlip>): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  const order = Object.keys(FIELD_LABEL) as FlipField[];
  for (const field of order) {
    for (const f of flips) {
      if (f.field !== field || !f.applied) continue;
      const label = FIELD_LABEL[field];
      const text = label ? label + ' ' + f.applied : f.applied;
      if (seen.has(text)) continue;
      seen.add(text);
      parts.push(text);
    }
  }
  return parts.length ? parts.join(' · ') : null;
}

/** One row in the bell: either a bot task carrying its flip as a subtitle, or a
 *  flip on its own when no task was created. */
export interface BellItem {
  key: string;
  /** The headline. */
  title: string;
  /** The reason under it — the flip, when there is one. */
  subtitle: string | null;
  /** "3626 164th Pl SE · Building Permit" */
  where: string;
  permitId: number | null;
  projectId: string | null;
  /** True when a bot task and its flip were folded into this single row. */
  merged: boolean;
  at: string;
}

/** Bot auto_events that correspond to a flip kind, for the merge. */
const AUTO_EVENT_FOR_KIND: Partial<Record<FlipKind, string>> = {
  corrections_required: 'corr_issued',
  intake_accepted: 'intake_accepted',
  cycle_closed: 'resubmitted',
};

const MERGE_WINDOW_MS = 15 * 60 * 1000;

/** ★ THE MERGE (register #18). Same permit + bot-authored task + created within
 *  ~15 minutes of the flip → ONE row. The task is the row; the flip is its
 *  subtitle.
 *
 *  15 minutes is generous on purpose. Measured: the p95 gap is 0.22 seconds
 *  because the scraper writes both in one run — the window only has to survive
 *  a slow run, not bridge a real delay. */
export function buildBellItems(
  flips: ReadonlyArray<BoardFlip>,
  tasks: ReadonlyArray<BoardTask>,
): BellItem[] {
  const botTasks = tasks.filter((t) => t.is_auto_generated);
  const used = new Set<string>();
  const items: BellItem[] = [];

  for (const f of flips) {
    const wantEvent = AUTO_EVENT_FOR_KIND[f.kind];
    const flipAt = Date.parse(f.at);
    const match = wantEvent
      ? botTasks.find(
          (t) =>
            !used.has(t.id) &&
            t.permit_id === f.permitId &&
            t.auto_event === wantEvent &&
            Math.abs(Date.parse(t.created_at ?? f.at) - flipAt) <= MERGE_WINDOW_MS,
        )
      : undefined;

    const where = `${f.address ?? 'Unknown address'} · ${f.permitType ?? 'Permit'}`;

    if (match) {
      used.add(match.id);
      items.push({
        key: `b-${match.id}`,
        // The TASK is the row…
        title: match.text,
        // …and the flip is its reason.
        subtitle: `${FLIP_LABEL[f.kind]}${
          match.due_date ? ` · task due ${match.due_date}` : ' · task created'
        }`,
        where,
        permitId: f.permitId,
        projectId: f.projectId,
        merged: true,
        at: f.at,
      });
      continue;
    }

    items.push({
      key: f.key,
      title: FLIP_LABEL[f.kind],
      subtitle: f.applied && f.applied !== FLIP_LABEL[f.kind] ? f.applied : null,
      where,
      permitId: f.permitId,
      projectId: f.projectId,
      merged: false,
      at: f.at,
    });
  }

  return items.sort((a, z) => z.at.localeCompare(a.at));
}
