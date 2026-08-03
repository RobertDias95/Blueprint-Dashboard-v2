import type {
  DrawScheduleRow,
  Project,
  ProjectHold,
  WaitingOnTaskRow,
} from './database.types';
import { asExternalTeamBlob, resolveExternalFirm } from './externalTeam';
import { isTaskLive } from './taskStatus';
import { isCancelledProject } from './projectViewHelpers';

// fix-265: the Vendor Schedule Forecast — the weekly note Blueprint owes its
// external engineers, computed instead of hand-written.
//
// WHY IT LOOKS LIKE THIS. The email exists today as a manual task off old
// feasibility docs; roughly half the sends are late or an apology for being
// late, and they only ever carried NEW projects. Meanwhile draw_schedule_audit
// holds 57 start-week and 91 end-week moves since 2026-06-25 that the vendor was
// never told about. So the feature's job is RELIABILITY and CHANGE VISIBILITY —
// which is why this module is built around a LEDGER of what the vendor already
// knows (vendor_report_state) rather than around a date window.
//
// THE ONE RULE THAT MUST NOT BE "OPTIMISED" AWAY: the ledger drives the NEW and
// CHANGED sections ONLY. The UPCOMING PIPELINE section always shows everything
// currently scheduled, whether or not the vendor has already been told about it.
// Bobby: "we want to keep the list a running list, that way nothing is missed."
// A row never falls off the pipeline because it was sent once. See
// `splitVendorSections` and its regression test.

/** The vendor this report is for. 'structural' is the only live key; the ledger
 *  PK is keyed so civil / survey / architect need no migration. */
export const VENDOR_KEY_STRUCTURAL = 'structural';

/** Discipline (permit_tasks.waiting_on / external_team key) per vendor key. */
export const VENDOR_DISCIPLINE: Record<string, string> = {
  [VENDOR_KEY_STRUCTURAL]: 'Structural',
};

/** Firm name as it appears in projects.external_team, per vendor key. */
export const VENDOR_FIRM: Record<string, string> = {
  [VENDOR_KEY_STRUCTURAL]: 'SSS',
};

/** A row of the send ledger — what this vendor was LAST told about a project. */
export interface VendorLedgerRow {
  project_id: string;
  sent_start_week: string | null;
  sent_dd_end: string | null;
  sent_status: string | null;
  sent_at: string;
}

/** Which section a scheduled block belongs in. */
export type VendorBucket = 'new' | 'changed' | 'unchanged';

/** The three fields the vendor is told about a project. Comparing this triple
 *  against the ledger is the whole of change detection. */
export interface VendorScheduleFacts {
  startWeek: string | null;
  ddEnd: string | null;
  status: string | null;
}

export interface VendorScheduleRow extends VendorScheduleFacts {
  projectId: string;
  address: string;
  juris: string | null;
  bucket: VendorBucket;
  /** What the vendor was previously told — null for a 'new' row. Rendered as
   *  OLD → NEW in the Changes section: Tawny needs the delta to re-plan, which
   *  is the entire justification for that section existing. */
  previous: VendorScheduleFacts | null;
  /** Address of the project this one reuses, when reused_from_project_id is set
   *  and resolvable. Blank (not omitted) when unknown — the visible gap is what
   *  prompts someone to fill it in. */
  reuseFromAddress: string | null;
  /** projects.reuse_notes — the hand-written qualifier ("W/O GAR"). */
  reuseNotes: string | null;
  /** fix-167/262: the open HOLD on this project, if any. Held projects are
   *  reported (Bobby: "if they are on the list with them, then yes") and
   *  labelled, so the vendor knows the project is parked rather than watching it
   *  go quiet. Cancelled projects are excluded entirely (fix-264 rule). */
  holdReason: string | null;
}

/** Normalize a stored value for comparison. NULL and '' both mean "blank", and
 *  a blank must compare equal to a blank or every untouched row reads changed. */
function norm(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** fix-265: is this draw block visible to a vendor at all?
 *
 *  IN  — any block linked to a project with an address. Redesigns count.
 *  OUT — status 'Corrections' (design-phase corrections are already visible on
 *        the schedule, so repeating them here is noise — Bobby was explicit);
 *        blocks opted out via exclude_from_vendor_reports; CANCELLED projects
 *        (fix-264); anything whose DD end is already past.
 *
 *  Non-project blocks (Vacation / PTO / training / the out-of-office floater)
 *  need no clause: they live in a SEPARATE table, da_time_blocks, and never
 *  appear in draw_schedule at all. Verified against prod — all 124 draw rows
 *  resolve to a project.
 *
 *  Note on the DD-end test: dd_end is NULL on 84 of 124 prod rows, so this
 *  excludes only blocks KNOWN to be past. A missing dd_end keeps the row in,
 *  deliberately — dropping rows for absent data would hide work from the vendor,
 *  and the blank cell in the email is what prompts the data entry. (Falling back
 *  to end_week here was measured and would collapse the list from 66 rows to 5.)
 */
export function drawBlockIsVendorVisible(
  block: Pick<DrawScheduleRow, 'status' | 'dd_end'> & {
    exclude_from_vendor_reports?: boolean | null;
  },
  project: Pick<Project, 'id' | 'address'> | undefined,
  cancelledIds: ReadonlySet<string> | undefined,
  todayIso: string,
): boolean {
  if (!project) return false;
  if (!norm(project.address)) return false;
  if (isCancelledProject(project.id, cancelledIds)) return false;
  if (block.exclude_from_vendor_reports === true) return false;
  if (norm(block.status) === 'Corrections') return false;
  const ddEnd = norm(block.dd_end);
  if (ddEnd !== null && ddEnd < todayIso) return false;
  return true;
}

export interface BuildVendorScheduleInput {
  draw: ReadonlyArray<
    DrawScheduleRow & { exclude_from_vendor_reports?: boolean | null }
  >;
  projects: ReadonlyArray<Project>;
  ledger: ReadonlyArray<VendorLedgerRow>;
  /** Open CANCEL rows (cancelledProjectIds) — fix-264. */
  cancelledIds?: ReadonlySet<string>;
  /** Open HOLD rows by project (activeHoldByProjectId) — labelled, not hidden. */
  holdsByProject?: ReadonlyMap<string, ProjectHold>;
  todayIso: string;
}

/** fix-265: every vendor-visible scheduled block, bucketed against the ledger.
 *  Sorted by start week (soonest first), address as a stable tiebreak. */
export function buildVendorScheduleRows(
  input: BuildVendorScheduleInput,
): VendorScheduleRow[] {
  const { draw, projects, ledger, cancelledIds, holdsByProject, todayIso } = input;

  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);

  const ledgerByProject = new Map<string, VendorLedgerRow>();
  for (const l of ledger) ledgerByProject.set(l.project_id, l);

  const rows: VendorScheduleRow[] = [];
  for (const block of draw) {
    const project = projectById.get(block.project_id);
    if (!drawBlockIsVendorVisible(block, project, cancelledIds, todayIso)) continue;
    // drawBlockIsVendorVisible already proved project is defined + addressed.
    const p = project as Project;

    const facts: VendorScheduleFacts = {
      startWeek: norm(block.start_week),
      ddEnd: norm(block.dd_end),
      status: norm(block.status),
    };

    const sent = ledgerByProject.get(p.id);
    let bucket: VendorBucket;
    let previous: VendorScheduleFacts | null = null;
    if (!sent) {
      bucket = 'new';
    } else {
      const prior: VendorScheduleFacts = {
        startWeek: norm(sent.sent_start_week),
        ddEnd: norm(sent.sent_dd_end),
        status: norm(sent.sent_status),
      };
      const differs =
        prior.startWeek !== facts.startWeek ||
        prior.ddEnd !== facts.ddEnd ||
        prior.status !== facts.status;
      bucket = differs ? 'changed' : 'unchanged';
      if (differs) previous = prior;
    }

    const reuseSourceId =
      (p as unknown as { reused_from_project_id?: string | null })
        .reused_from_project_id ?? null;
    const reuseSource = reuseSourceId ? projectById.get(reuseSourceId) : undefined;

    rows.push({
      projectId: p.id,
      address: (p.address ?? '').trim(),
      juris: norm(p.juris),
      ...facts,
      bucket,
      previous,
      reuseFromAddress: reuseSource ? (reuseSource.address ?? '').trim() : null,
      reuseNotes:
        norm(
          (p as unknown as { reuse_notes?: string | null }).reuse_notes ?? null,
        ) ?? null,
      holdReason: norm(holdsByProject?.get(p.id)?.reason ?? null),
    });
  }

  rows.sort((a, b) => {
    const sa = a.startWeek ?? '9999-99-99';
    const sb = b.startWeek ?? '9999-99-99';
    if (sa !== sb) return sa < sb ? -1 : 1;
    return a.address.localeCompare(b.address);
  });
  return rows;
}

export interface VendorSections {
  /** Section 1 — in the pipeline, no ledger row. */
  newRows: VendorScheduleRow[];
  /** Section 2 — has a ledger row, but a fact moved. Carries `previous`. */
  changedRows: VendorScheduleRow[];
  /** Section 3 — the RUNNING LIST. Everything currently scheduled, always. */
  pipelineRows: VendorScheduleRow[];
}

/** fix-265: split the built rows into the three schedule sections.
 *
 *  REGRESSION-LOCKED: `pipelineRows` is EVERY row, including ones already sent
 *  and unchanged. The ledger decides what is new or changed; it must never
 *  decide what is visible. Bobby: "we want to keep the list a running list, that
 *  way nothing is missed." Filtering this by bucket would look like a tidy-up
 *  and would silently reintroduce the exact failure the feature exists to fix. */
export function splitVendorSections(
  rows: ReadonlyArray<VendorScheduleRow>,
): VendorSections {
  return {
    newRows: rows.filter((r) => r.bucket === 'new'),
    changedRows: rows.filter((r) => r.bucket === 'changed'),
    pipelineRows: [...rows],
  };
}

/** The payload bp_mark_vendor_report_sent records — the exact facts shown. */
export interface VendorSentRow {
  project_id: string;
  start_week: string | null;
  dd_end: string | null;
  status: string | null;
}

/** fix-265: the ledger payload for a send. Built from the PIPELINE rows, which
 *  are a superset of new + changed — after a send the vendor knows the current
 *  state of everything on the list, not just the rows that were called out. */
export function vendorSentPayload(
  rows: ReadonlyArray<VendorScheduleRow>,
): VendorSentRow[] {
  return rows.map((r) => ({
    project_id: r.projectId,
    start_week: r.startWeek,
    dd_end: r.ddEnd,
    status: r.status,
  }));
}

// ---------------------------------------------------------------------------
// Section 4 — corrections currently sitting with the vendor
// ---------------------------------------------------------------------------

export interface VendorCorrectionRow {
  taskId: string;
  projectId: string;
  address: string;
  permit: string | null;
  /** What the vendor needs to do — the task text. */
  need: string;
  /** When it went to them (permit_tasks.start_date). Blank when unset. */
  sent: string | null;
  /** When it is expected back (permit_tasks.target_date). Blank when unset. */
  expectedBack: string | null;
  /** The firm resolved from projects.external_team, or null when the project has
   *  no firm recorded for this discipline. Rendered as a visible gap. */
  firm: string | null;
}

/** fix-265: live corrections sitting with this vendor.
 *
 *  MATCHING RULE — firm when known, discipline when not. A task counts as "with
 *  this vendor" when its waiting_on discipline matches AND either the project's
 *  external_team names this vendor's firm, OR the project has NO firm recorded
 *  for that discipline. It NEVER matches a project whose firm is recorded as
 *  someone else.
 *
 *  Why the fallback: measured on prod, 4 live Structural tasks exist and only 23
 *  of 124 projects have a Structural firm recorded. A strict firm match shows 2
 *  of the 4 and silently drops two whose task text literally reads "Pending SSS"
 *  and "Pending SSS Backgrounds". Zero live tasks belong to a different
 *  structural firm, so the fallback cannot currently mis-attribute anything, and
 *  it is bounded: it only ever fires when the firm is UNRECORDED. The report
 *  shows the unresolved firm as a visible gap so the external-team data gets
 *  filled in — after which the strict match takes over on its own.
 *
 *  Resolved and fix-262 'Cancelled' tasks are both excluded via isTaskLive.
 *  Rows with missing dates are KEPT with a blank cell, never dropped. */
export function buildVendorCorrectionRows(
  tasks: ReadonlyArray<WaitingOnTaskRow>,
  projects: ReadonlyArray<Project>,
  vendorKey: string,
  cancelledIds?: ReadonlySet<string>,
): VendorCorrectionRow[] {
  const discipline = VENDOR_DISCIPLINE[vendorKey];
  const firmName = VENDOR_FIRM[vendorKey];
  if (!discipline) return [];

  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);

  const rows: VendorCorrectionRow[] = [];
  for (const t of tasks) {
    if (!isTaskLive(t.completion_status)) continue;
    if (norm(t.waiting_on) !== discipline) continue;
    if (isCancelledProject(t.project_id, cancelledIds)) continue;

    const project = projectById.get(t.project_id);
    const firm = resolveExternalFirm(
      asExternalTeamBlob(project?.external_team),
      discipline,
    );
    // Firm recorded as someone else → not ours. Unrecorded → ours by fallback.
    if (firm !== null && firm !== firmName) continue;

    rows.push({
      taskId: t.task_id,
      projectId: t.project_id,
      address: (project?.address ?? t.project_address ?? '').trim(),
      permit: norm(t.permit_type),
      need: (t.task_text ?? '').trim(),
      sent: norm(t.start_date),
      // target_date is the canonical "expected back". due_date is deliberately
      // ignored: it is unset on every single waiting-on task on prod, and a
      // second date concept here would only confuse the vendor.
      expectedBack: norm(t.target_date),
      firm,
    });
  }

  rows.sort((a, b) => a.address.localeCompare(b.address));
  return rows;
}

/** The most recent send for this vendor, or null when never sent. */
export function lastSentAt(
  ledger: ReadonlyArray<VendorLedgerRow>,
): string | null {
  let max: string | null = null;
  for (const l of ledger) {
    if (!l.sent_at) continue;
    if (max === null || l.sent_at > max) max = l.sent_at;
  }
  return max;
}
