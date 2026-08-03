import type {
  DrawScheduleRow,
  Permit,
  Project,
  ProjectHold,
  WaitingOnTaskRow,
} from './database.types';
import { asExternalTeamBlob, resolveExternalFirm } from './externalTeam';
import { isTaskCancelled, isTaskLive } from './taskStatus';
import { isCancelledProject, isPermitDone } from './projectViewHelpers';

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
 *  against the ledger is the whole of change detection.
 *
 *  fix-269: `targetSend` was `ddEnd`. Renamed because Bobby's semantic makes the
 *  old name a lie — "The end of the DD phase is when we are targeting to provide
 *  documents to the external consultant." It is a commitment we are making, not
 *  a date we observed, and it is `dd_end` falling back to `end_week`.
 *
 *  The LEDGER tracks this same value (vendor_report_state.sent_dd_end), so what
 *  the vendor is shown and what CHANGES compares are always the same number. If
 *  the ledger tracked raw dd_end while the email showed the fallback, a project
 *  whose end_week moved would show a new target send that was never flagged as a
 *  change — and the Changes section exists precisely to catch that movement.
 *  Zero migration risk: the prod ledger is empty (never sent). */
export interface VendorScheduleFacts {
  startWeek: string | null;
  /** dd_end, falling back to end_week when dd_end is NULL. */
  targetSend: string | null;
  status: string | null;
}

export interface VendorScheduleRow extends VendorScheduleFacts {
  projectId: string;
  address: string;
  juris: string | null;
  bucket: VendorBucket;
  /** fix-269: the target send date has passed and nothing has gone out. The row
   *  stays in UPCOMING — it is still upcoming work — but sorts first and carries
   *  a visible marker. This is the single most useful thing the vendor can be
   *  told: "you were told this was coming on the 27th; it has not gone out." */
  overdue: boolean;
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

/** fix-266: the draw statuses a vendor's PIPELINE covers — the PRE-SUBMITTAL
 *  phases.
 *
 *  The forecast tells the structural engineer what is coming toward them. Their
 *  involvement ends when the drawings go to the city: once a project is
 *  Submitted / Under Review / Corrections / Approved, there is nothing for them
 *  to schedule against. So membership here is a PHASE question, and this
 *  allow-list is the answer — deliberately an allow-list rather than a deny-list
 *  so a new status added to the draw schedule later is OUT until someone decides
 *  it is pre-submittal, rather than silently appearing in a vendor-facing email.
 *
 *  This replaced a date-based attempt. fix-265 filtered only on "DD end already
 *  past", which could not fire on the 84-of-124 blocks where dd_end is NULL — so
 *  the pipeline rendered 66 rows of which 39 were finished Approved work, the
 *  oldest starting 2025-02-10. The date was the wrong instrument for a phase
 *  question; the dd_end test is kept below as an additional gate because it is
 *  still correct wherever dd_end exists.
 *
 *  'Corrections' is absent for two reasons that agree: it is post-submittal, and
 *  design-phase corrections are already visible on the schedule, so repeating
 *  them here is noise (Bobby was explicit). Excluding 'Under Review' costs the
 *  vendor nothing either — a live structural correction on an Under Review
 *  project still reaches them through section 4, which this gate does not touch.
 */
export const VENDOR_PIPELINE_STATUSES: ReadonlySet<string> = new Set([
  'Scheduled',
  'Schematic',
  'DD / Permit Set',
  'Pending Consultants',
]);

/** fix-265: is this draw block visible to a vendor at all?
 *
 *  IN  — any block linked to a project with an address, at a pre-submittal
 *        status ({@link VENDOR_PIPELINE_STATUSES}). Redesigns count.
 *  OUT — post-submittal statuses (Submitted / Under Review / Corrections /
 *        Approved); blocks opted out via exclude_from_vendor_reports; CANCELLED
 *        projects (fix-264); anything whose DD end is already past.
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
 *
 *  A block with NO status is likewise KEPT, on the same principle: we cannot
 *  prove it is past submittal, and silently dropping a project the vendor needs
 *  to hear about is worse than one extra row they can ignore. Zero prod rows are
 *  affected today — all 124 carry one of the seven known statuses.
 *
 *  fix-268 adds the end_week FALLBACK. Draw status goes stale — a block sits at
 *  "Pending Consultants" long after the project has moved on — and with dd_end
 *  NULL on most rows nothing caught it. So when dd_end is absent we fall back to
 *  end_week. dd_end stays PRIMARY: where it exists, end_week is never consulted.
 *  (fix-265 measured end_week as a REPLACEMENT and rejected it — 66 rows to 5.
 *  As a fallback under the fix-266 status gate it only speaks where dd_end is.)
 *
 *  fix-269 REVERSES WHAT THE DATE DECIDES. Bobby: "The end of the DD phase is
 *  when we are targeting to provide documents to the external consultant." So a
 *  passed target send date does NOT mean finished — with nothing sent, IT MEANS
 *  LATE, and that is the most useful thing the vendor can be told.
 *
 *  THE TRANSMIT TASK IS THE LIVENESS SIGNAL; the date decides presentation:
 *
 *    transmit state       | target send | result
 *    ---------------------|-------------|---------------------------------
 *    none                 | future      | UPCOMING
 *    none                 | past        | DROP — no liveness signal at all
 *    open, not started    | future      | UPCOMING
 *    open, not started    | past        | UPCOMING, flagged OVERDUE
 *    started, unresolved  | any         | TRANSMITTED (not here)
 *    resolved             | any         | DROP — received; design phase done
 *
 *  all-permits-done still OVERRIDES all of this (applied by the caller): an
 *  issued project drops even with an open transmit task, because a task nobody
 *  closed is not evidence the work is live.
 */
export function drawBlockIsVendorVisible(
  block: Pick<DrawScheduleRow, 'status' | 'dd_end' | 'end_week'> & {
    exclude_from_vendor_reports?: boolean | null;
  },
  project: Pick<Project, 'id' | 'address'> | undefined,
  cancelledIds: ReadonlySet<string> | undefined,
  todayIso: string,
  /** fix-269: this project's transmit-task state. Defaults to 'none', which is
   *  the pre-fix-269 behaviour for the ~all of the pipeline that has no transmit
   *  task yet. */
  transmitState: TransmitState = 'none',
): boolean {
  if (!project) return false;
  if (!norm(project.address)) return false;
  if (isCancelledProject(project.id, cancelledIds)) return false;
  if (block.exclude_from_vendor_reports === true) return false;
  // fix-266: pre-submittal phases only. A blank status is kept (see the doc
  // above); anything named that is not on the allow-list is out.
  const status = norm(block.status);
  if (status !== null && !VENDOR_PIPELINE_STATUSES.has(status)) return false;
  // fix-269: sent and awaiting return → it is in TRANSMITTED, not here.
  if (transmitState === 'started') return false;
  // fix-269: received → structural is finished with the design phase.
  if (transmitState === 'resolved') return false;
  // fix-268/269: a passed target send only drops the row when there is NO
  // transmit task to say the work is still live. With one open, it is overdue.
  const targetSend = vendorTargetSend(block);
  if (targetSend !== null && targetSend < todayIso && transmitState === 'none') {
    return false;
  }
  return true;
}

/** fix-269: the TARGET SEND date — dd_end, falling back to end_week. The date we
 *  are committing to hand documents over, not a date we observed. */
export function vendorTargetSend(
  block: Pick<DrawScheduleRow, 'dd_end' | 'end_week'>,
): string | null {
  return norm(block.dd_end) ?? norm(block.end_week);
}

/** fix-269: is this row late — target send passed with nothing sent? Only
 *  meaningful when the project has an open, unstarted transmit task; without one
 *  there is no evidence the work is still live and the row is dropped instead. */
export function vendorRowIsOverdue(
  block: Pick<DrawScheduleRow, 'dd_end' | 'end_week'>,
  transmitState: TransmitState,
  todayIso: string,
): boolean {
  if (transmitState !== 'open') return false;
  const targetSend = vendorTargetSend(block);
  return targetSend !== null && targetSend < todayIso;
}

/** fix-268: projects where every non-sub permit is DONE.
 *
 *  If a project's permits have all issued (or reached a terminal status), the
 *  structural work finished long ago whatever the draw block still says — the
 *  strong signal, same principle as the scraper's fix-scraper-252 actual_issue
 *  rule. Reuses {@link isPermitDone} / PROJECT_DONE_STATUSES (fix-245) rather
 *  than inventing a second definition of "finished".
 *
 *  ALL non-sub permits, deliberately — not "the Building Permit issued", and not
 *  "any permit issued". Measured against the four stale rows Bobby reported:
 *    - "BP issued" catches ZERO of them, and cannot fire at all on
 *      7603 8th Ave NW [Redesign 1], which has no Building Permit — a rule that
 *      is structurally unable to fire on a whole class of project is not a rule.
 *    - "ANY permit issued" would drop 4040 E Via Estrella and 5811 Greenwood on
 *      the strength of a DEMOLITION permit while their Building Permits are
 *      still open (Pre-Submittal / Reviews In Process). A demo issuing says
 *      nothing about structural being done.
 *    - "ALL done" is the conservative reading: it can only fire when there is
 *      nothing open left at all, so it can never hide live work.
 *
 *  A project with NO permits is NOT done — a permit-less shell is a project that
 *  has not started, not one that has finished (vacuous-truth trap).
 */
export function allPermitsDoneProjectIds(
  permits: ReadonlyArray<
    Pick<Permit, 'project_id' | 'actual_issue' | 'status'> & {
      parent_permit_id?: number | null;
    }
  >,
): Set<string> {
  const total = new Map<string, number>();
  const done = new Map<string, number>();
  for (const p of permits) {
    // Sub-permits are reviewed under their parent (fix-194) — not their own
    // signal, and counting them would let an open sub keep a finished project in.
    if (p.parent_permit_id != null) continue;
    total.set(p.project_id, (total.get(p.project_id) ?? 0) + 1);
    if (isPermitDone(p)) done.set(p.project_id, (done.get(p.project_id) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [projectId, n] of total) {
    if (n > 0 && (done.get(projectId) ?? 0) === n) out.add(projectId);
  }
  return out;
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
  /** fix-268: projects whose permits have ALL issued — finished, whatever the
   *  draw block still says. From {@link allPermitsDoneProjectIds}. */
  allPermitsDoneIds?: ReadonlySet<string>;
  /** fix-269: each project's design-phase handoff state, from
   *  {@link transmitStateByProject}. THE liveness signal — it decides membership
   *  and the target-send date only decides presentation. Replaces fix-268's
   *  started-ids set, which could only say "sent", not "late" or "received". */
  transmitState?: ReadonlyMap<string, TransmitState>;
  todayIso: string;
}

/** fix-265: every vendor-visible scheduled block, bucketed against the ledger.
 *  Sorted by start week (soonest first), address as a stable tiebreak. */
export function buildVendorScheduleRows(
  input: BuildVendorScheduleInput,
): VendorScheduleRow[] {
  const {
    draw,
    projects,
    ledger,
    cancelledIds,
    holdsByProject,
    allPermitsDoneIds,
    transmitState,
    todayIso,
  } = input;

  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);

  const ledgerByProject = new Map<string, VendorLedgerRow>();
  for (const l of ledger) ledgerByProject.set(l.project_id, l);

  const rows: VendorScheduleRow[] = [];
  for (const block of draw) {
    const project = projectById.get(block.project_id);
    // fix-268: the permits already issued — structural finished long ago. This
    // OVERRIDES the transmit signal: a task nobody bothered to close is not
    // evidence the work is live, so it is checked before anything else.
    if (allPermitsDoneIds?.has(block.project_id)) continue;
    const state = transmitState?.get(block.project_id) ?? 'none';
    if (!drawBlockIsVendorVisible(block, project, cancelledIds, todayIso, state)) {
      continue;
    }
    // drawBlockIsVendorVisible already proved project is defined + addressed.
    const p = project as Project;

    const facts: VendorScheduleFacts = {
      startWeek: norm(block.start_week),
      targetSend: vendorTargetSend(block),
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
        targetSend: norm(sent.sent_dd_end),
        status: norm(sent.sent_status),
      };
      const differs =
        prior.startWeek !== facts.startWeek ||
        prior.targetSend !== facts.targetSend ||
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
      overdue: vendorRowIsOverdue(block, state, todayIso),
    });
  }

  // fix-269: OVERDUE first — a package that should already have gone out is the
  // thing the vendor most needs to see, and burying it mid-list by start week
  // would waste the signal. Within each group, soonest start week first with
  // address as a stable tiebreak (unchanged).
  rows.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
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
    // fix-269: the TARGET SEND date, which is what the row actually showed.
    // The ledger column is still named sent_dd_end; what it stores is whatever
    // the vendor was told, so change detection and the email never diverge.
    dd_end: r.targetSend,
    status: r.status,
  }));
}

// ---------------------------------------------------------------------------
// fix-268: the DESIGN-phase handoff — the transmit task
// ---------------------------------------------------------------------------
//
// Bobby: "the DD end phase is really around 9/18, and that's when we're planning
// on sending backgrounds out. How do we know when they are sent? That way they
// can be tracked from sent to received."
//
// Every project carries a base task "Structural - Transmitted" (team = Design
// Associate). THAT TASK IS THE HANDOFF:
//    start_date  = when the package was sent
//    target_date = when we expect it back
//    Resolved    = received; the project leaves design-phase tracking entirely
//
// DESIGN phase is the transmit task. PERMITTING phase is corrections. They never
// blur — the DA owns the transmit task, and a correction is a different animal
// at a different point in the project's life.
//
// TOLD APART BY TEXT, because permit_tasks has NO template_id — there is no FK
// back to task_templates at all (verified on prod: only a sparse v1-era
// `legacy_id` on 4 rows). So this matches strings, and the strings have drifted.
// Everything not matching falls through to CORRECTIONS, which is the safe
// default: a misfiled task is cosmetic, nothing is lost or double-counted.

/** fix-268: task texts that mean "the package went out to this vendor".
 *
 *  The FIRST entry is the live template text, verified on prod 2026-08-03
 *  (task_templates.text = 'Structural - Transmitted', bucket 'de', default_team
 *  'Design Associate'). The rest are legacy variants observed on real tasks.
 *  Matched case-insensitively and trimmed.
 *
 *  Deliberately NOT matched, and why:
 *    'Structural'      — too generic; it is used for correction work too
 *                        (7336 132nd Ave NE carries one In Progress right now).
 *    'Structural CR1'  — CR = correction round. Permitting phase by definition.
 *  Both land in CORRECTIONS, which is the honest place for an ambiguous task. */
export const VENDOR_TRANSMIT_TASK_TEXTS: Record<string, readonly string[]> = {
  [VENDOR_KEY_STRUCTURAL]: [
    'structural - transmitted', // the live template
    'sent to structural', // legacy variant, 2 rows on prod
  ],
};

/** fix-268: is this task the vendor's design-phase transmit task? */
export function isTransmitTask(
  text: string | null | undefined,
  vendorKey: string,
): boolean {
  const t = norm(text)?.toLowerCase();
  if (!t) return false;
  return (VENDOR_TRANSMIT_TASK_TEXTS[vendorKey] ?? []).includes(t);
}

export interface VendorTransmitRow {
  taskId: string;
  projectId: string;
  address: string;
  juris: string | null;
  /** permit_tasks.start_date — when it went out. */
  sent: string | null;
  /** permit_tasks.target_date — when we expect it back. */
  expectedBack: string | null;
}

/** fix-268: packages SENT and awaiting return — section 4.
 *
 *  STARTED means start_date is set. A transmit task that exists but has not
 *  started is not "with them": nothing was sent, so its project stays in the
 *  UPCOMING pipeline. Resolved means received, and the project leaves both
 *  sections.
 *
 *  Expect this to be EMPTY until the DAs work through a cycle — both live
 *  'Structural - Transmitted' tasks on prod have start_date NULL today. That is
 *  the section doing its job, not a bug, and empty sections are omitted. */
export function buildVendorTransmitRows(
  tasks: ReadonlyArray<WaitingOnTaskRow>,
  projects: ReadonlyArray<Project>,
  vendorKey: string,
  cancelledIds?: ReadonlySet<string>,
): VendorTransmitRow[] {
  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);

  const rows: VendorTransmitRow[] = [];
  for (const t of tasks) {
    if (!isTransmitTask(t.task_text, vendorKey)) continue;
    if (!isTaskLive(t.completion_status)) continue; // Resolved = received
    if (norm(t.start_date) === null) continue; // not sent yet
    if (isCancelledProject(t.project_id, cancelledIds)) continue;
    if (!vendorOwnsTask(t, projectById.get(t.project_id), vendorKey)) continue;

    const project = projectById.get(t.project_id);
    rows.push({
      taskId: t.task_id,
      projectId: t.project_id,
      address: (project?.address ?? t.project_address ?? '').trim(),
      juris: norm(project?.juris ?? t.project_juris ?? null),
      sent: norm(t.start_date),
      expectedBack: norm(t.target_date),
    });
  }
  rows.sort((a, b) => (a.sent ?? '').localeCompare(b.sent ?? '') || a.address.localeCompare(b.address));
  return rows;
}

/** fix-268: projects whose transmit task has STARTED and not come back. These
 *  drop out of the UPCOMING pipeline — they are in TRANSMITTED instead. */
export function transmitStartedProjectIds(
  rows: ReadonlyArray<VendorTransmitRow>,
): Set<string> {
  return new Set(rows.map((r) => r.projectId));
}

/** fix-269: where a project stands on the design-phase handoff.
 *
 *  'none'     — no transmit task at all. Most of the pipeline today; the DAs are
 *               still adopting the task.
 *  'open'     — a transmit task exists but has not started. Nothing sent yet.
 *  'started'  — sent, not yet back. The project is in TRANSMITTED.
 *  'resolved' — received. Structural is done with the design phase. */
export type TransmitState = 'none' | 'open' | 'started' | 'resolved';

/** fix-269: each project's transmit state, for the vendor whose report this is.
 *
 *  PRECEDENCE when a project carries several transmit tasks: started > open >
 *  resolved. Live work outranks finished work — a project with one package out
 *  and another not yet sent is 'started' (something IS with them), and one with
 *  an old resolved task plus a fresh open one is 'open' (a new package is due),
 *  never 'resolved'. Only a project whose transmit tasks are ALL resolved reads
 *  as resolved and drops.
 *
 *  Ownership is the same firm-when-known / discipline-when-not rule the other
 *  sections use, so a task belonging to a different structural firm cannot make
 *  a project look live to this vendor. */
export function transmitStateByProject(
  tasks: ReadonlyArray<WaitingOnTaskRow>,
  projects: ReadonlyArray<Project>,
  vendorKey: string,
  cancelledIds?: ReadonlySet<string>,
): Map<string, TransmitState> {
  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);

  const rank: Record<Exclude<TransmitState, 'none'>, number> = {
    resolved: 1,
    open: 2,
    started: 3,
  };
  const out = new Map<string, TransmitState>();
  for (const t of tasks) {
    if (!isTransmitTask(t.task_text, vendorKey)) continue;
    if (isCancelledProject(t.project_id, cancelledIds)) continue;
    if (!vendorOwnsTask(t, projectById.get(t.project_id), vendorKey)) continue;

    // fix-262 'Cancelled' tasks are inert — they say nothing about liveness.
    let state: Exclude<TransmitState, 'none'>;
    if (isTaskCancelled(t.completion_status)) continue;
    else if (!isTaskLive(t.completion_status)) state = 'resolved';
    else if (norm(t.start_date) !== null) state = 'started';
    else state = 'open';

    const prev = out.get(t.project_id);
    if (prev === undefined || rank[state] > rank[prev as Exclude<TransmitState, 'none'>]) {
      out.set(t.project_id, state);
    }
  }
  return out;
}

/** fix-265/268: does this vendor own the task's project for this discipline?
 *
 *  Firm-when-known, discipline-when-not — see buildVendorCorrectionRows for the
 *  measurement behind the fallback. Shared so sections 4 and 5 can never drift
 *  apart on who a task belongs to. */
function vendorOwnsTask(
  task: Pick<WaitingOnTaskRow, 'waiting_on'>,
  project: Project | undefined,
  vendorKey: string,
): boolean {
  const discipline = VENDOR_DISCIPLINE[vendorKey];
  if (!discipline) return false;
  if (norm(task.waiting_on) !== discipline) return false;
  const firm = resolveExternalFirm(
    asExternalTeamBlob(project?.external_team),
    discipline,
  );
  return firm === null || firm === VENDOR_FIRM[vendorKey];
}

// ---------------------------------------------------------------------------
// Section 5 — corrections currently sitting with the vendor
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
 *  Rows with missing dates are KEPT with a blank cell, never dropped.
 *
 *  fix-268: TRANSMIT tasks are excluded — they are the DESIGN-phase handoff and
 *  belong to section 4. Design and permitting never blur. Everything else that
 *  is waiting on this vendor still lands here, which is the safe default for a
 *  text match against strings that have already drifted. */
export function buildVendorCorrectionRows(
  tasks: ReadonlyArray<WaitingOnTaskRow>,
  projects: ReadonlyArray<Project>,
  vendorKey: string,
  cancelledIds?: ReadonlySet<string>,
): VendorCorrectionRow[] {
  const discipline = VENDOR_DISCIPLINE[vendorKey];
  if (!discipline) return [];

  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);

  const rows: VendorCorrectionRow[] = [];
  for (const t of tasks) {
    if (!isTaskLive(t.completion_status)) continue;
    // fix-268: the design-phase handoff is section 4's, in every state — a
    // transmit task must never also appear as a permitting correction.
    if (isTransmitTask(t.task_text, vendorKey)) continue;
    if (isCancelledProject(t.project_id, cancelledIds)) continue;

    const project = projectById.get(t.project_id);
    if (!vendorOwnsTask(t, project, vendorKey)) continue;
    const firm = resolveExternalFirm(
      asExternalTeamBlob(project?.external_team),
      discipline,
    );

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
