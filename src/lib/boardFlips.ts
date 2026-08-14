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
}

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
    };

    // ★ `extras` is the LARGEST applied key in the system (241 in 30 days) and
    // is pure churn — reviewer names, descriptions, portal ids. It is not a
    // flip and must never reach a person. Same for city_target, which moves
    // constantly without anything happening.
    // fix-307: the key matches boardReads.keyForFlip so an acknowledged flip
    // stays acknowledged, however many times this is re-derived.
    const push = (kind: FlipKind, value: string | null) =>
      out.push({ key: `flip:${r.id}:${kind}`, kind, applied: value, ...base });

    if (typeof applied.status === 'string') {
      const kind = statusKind(applied.status);
      // A status flip carries no date of its own, so the feed window bounds it.
      if (kind) push(kind, applied.status);
    }
    if (typeof applied.corr_issued === 'string') {
      if (isLiveDate(applied.corr_issued, r.created_at, maxAgeDays))
        push('corrections_required', applied.corr_issued);
    }
    if (typeof applied.approval_date === 'string') {
      if (isLiveDate(applied.approval_date, r.created_at, maxAgeDays))
        push('approved', applied.approval_date);
    }
    if (typeof applied.actual_issue === 'string') {
      if (isLiveDate(applied.actual_issue, r.created_at, maxAgeDays))
        push('issued', applied.actual_issue);
    }
    if (typeof applied.intake_accepted === 'string') {
      if (isLiveDate(applied.intake_accepted, r.created_at, maxAgeDays))
        push('intake_accepted', applied.intake_accepted);
    }
    if (typeof applied.submitted === 'string') {
      if (isLiveDate(applied.submitted, r.created_at, maxAgeDays))
        push('cycle_opened', applied.submitted);
    }
    if (typeof applied.resubmitted === 'string') {
      if (isLiveDate(applied.resubmitted, r.created_at, maxAgeDays))
        push('cycle_closed', applied.resubmitted);
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
