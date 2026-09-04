import type {
  DrawScheduleRow,
  Permit,
  Project,
  ProjectHold,
  WaitingOnTaskRow,
} from './database.types';
import { asExternalTeamBlob, resolveExternalFirm } from './externalTeam';
import { isTaskLive } from './taskStatus';
import { isCancelledProject, isPermitDone } from './projectViewHelpers';
import type { ConsultantCurrent } from './consultants';

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

// ===========================================================================
// ★★★ fix-499 (P-034) — THE DISCIPLINE IS A PARAMETER, AND THE ROUNDS DECIDE
// ===========================================================================
//
// Bobby, 2026-08-31: *"This vendor schedule forecast could then be applied to
// all of the other vendors we're using based on the same concept."* and
// *"we would be using that consultant tab to then check off when it was
// received, and then it should fall off."*
//
// ★★★ WHAT CHANGED: MEMBERSHIP MOVED FROM TASKS TO ROUNDS. fix-268/269 built
//     this report's liveness signal out of `permit_tasks.waiting_on` — a
//     "Structural - Transmitted" task whose start_date meant sent and whose
//     resolution meant received. The consultant model (fix-474/475/479) now
//     records exactly that, properly, per discipline and per round, with a
//     status ladder and four date slots. The task was a stand-in for a record
//     that did not exist yet; it exists now.
//
//     Consequence, and it is the whole point: a project is on this report
//     because somebody put a CONSULTANT on it, not because somebody remembered
//     to make a task. Measured on prod 2026-09-04 there were 43 live Structural
//     rounds and 8 open Structural waiting_on tasks — the rounds see five times
//     as much of the pipeline as the tasks ever did.
//
// ★★ SECTION 5 (Corrections) STILL READS TASKS, deliberately. A correction is
//    post-submittal permitting work sitting with the firm; it is not a design
//    round, has no round to belong to, and `buildVendorCorrectionRows` is left
//    alone. Design and permitting never blur — that is fix-271's rule and it
//    survives this change intact.
//
// ★★★ ROUND DATE WINS, THE SCHEDULE FILLS THE GAP (Bobby, 2026-09-04). The
//     rounds carry status and sent/received dates but almost no target dates:
//     on prod, `est_send` is set on exactly ONE of 165 consultant records. So
//     the target send is `est_send ?? vendorTargetSend(block)` — the round's own
//     date when somebody has stated one, the draw schedule's derived date when
//     nobody has. `est_recd` is shown as-is; blank is honest, and inventing an
//     expected-back date from a lead time would be the fallback borrowing a
//     confident voice.

/** The seven disciplines in `external_team_directory`, in the spelling the
 *  directory and `project_consultants.discipline` both use. The URL parameter
 *  is matched against these; nothing else is a discipline. */
export const FORECAST_DISCIPLINES = [
  'Structural',
  'Civil',
  'Surveyor',
  'Arborist',
  'Geotech',
  'Energy',
  'Landscape',
] as const;

export type ForecastDiscipline = (typeof FORECAST_DISCIPLINES)[number];

/** ★★★ ABSENT MEANS STRUCTURAL, so every link, bookmark and Weekly Update card
 *  that predates fix-499 lands exactly where it always did. */
export const DEFAULT_FORECAST_DISCIPLINE: ForecastDiscipline = 'Structural';

/** The `?discipline=` value resolved against the seven. Unknown → null, which
 *  the page renders as an empty state listing the seven; it never throws.
 *  Absent/blank → the default. Case-insensitive: a bookmark reading
 *  `?discipline=civil` is somebody typing, not an error. */
export function resolveForecastDiscipline(
  raw: string | null | undefined,
): ForecastDiscipline | null {
  const t = (raw ?? '').trim();
  if (t === '') return DEFAULT_FORECAST_DISCIPLINE;
  const hit = FORECAST_DISCIPLINES.find(
    (d) => d.toLowerCase() === t.toLowerCase(),
  );
  return hit ?? null;
}

/** ★★ THE LEDGER KEY. Lower-cased discipline, so `Structural` → `structural`
 *  and the six existing `vendor_report_state` rows keep their history — the
 *  ledger schema and its rows are untouched by this ticket. */
export function vendorKeyForDiscipline(discipline: string): string {
  return discipline.trim().toLowerCase();
}

/** The consultant fields this module needs. Structurally typed against
 *  {@link ConsultantCurrent} so a fixture does not have to spell out a whole
 *  view row, and so the report cannot quietly start depending on more of it. */
export interface ConsultantRoundFacts {
  project_id: string;
  discipline: string;
  firm_name: string | null;
  firm_active?: boolean | null;
  status: string | null;
  est_send: string | null;
  sent: string | null;
  est_recd: string | null;
}

/** ★ One consultant row per project for this discipline. `project_consultants`
 *  is unique on (project, discipline), so this cannot collapse two real rows —
 *  the map is a lookup, not a reduction. */
export function consultantByProject(
  rows: ReadonlyArray<ConsultantRoundFacts | ConsultantCurrent>,
  discipline: string,
): Map<string, ConsultantRoundFacts> {
  const out = new Map<string, ConsultantRoundFacts>();
  for (const r of rows) {
    if (norm(r.discipline) !== discipline) continue;
    out.set(r.project_id, r as ConsultantRoundFacts);
  }
  return out;
}

/** ★★★ WHICH FIRMS THIS DISCIPLINE'S WORK BELONGS TO — the replacement for the
 *  deleted `VENDOR_FIRM = { structural: 'SSS' }` constant.
 *
 *  ★★ IT EXISTS TO PRESERVE A RULE, NOT TO ADD ONE. `buildVendorCorrectionRows`
 *  has always refused to show a task whose project records a DIFFERENT firm for
 *  the discipline — that guarantee is listed as must-not-change, and deleting
 *  the constant without replacing it would have quietly dropped it. The firm
 *  identity now comes from the consultant records themselves (fix-499 §B: "the
 *  firm now comes from `firm_name` on the consultant row"), which generalises
 *  to all seven disciplines instead of naming one firm in code.
 *
 *  ★ INACTIVE FIRMS COUNT. `firm_active` is a flag, not a delete (fix-474 call
 *  #2): a firm that stopped taking new work still owns the corrections it is
 *  sitting on. */
export function firmsForDiscipline(
  consultants: ReadonlyMap<string, ConsultantRoundFacts> | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const r of consultants?.values() ?? []) {
    const name = norm(r.firm_name);
    if (name !== null) out.add(name);
  }
  return out;
}

/** ★★★ THE TARGET SEND, WITH THE RULING IN ONE PLACE. The round's own date when
 *  it has one, the schedule-derived date when it does not, and null when
 *  neither exists — a project with no date at all is not listed rather than
 *  listed with a blank commitment. */
export function forecastTargetSend(
  round: Pick<ConsultantRoundFacts, 'est_send'> | undefined,
  block: Pick<DrawScheduleRow, 'dd_end' | 'end_week'> | undefined,
): string | null {
  const stated = norm(round?.est_send ?? null);
  if (stated !== null) return stated;
  return block ? vendorTargetSend(block) : null;
}

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
  /** ★★ fix-499 §C: when the consultant is expected to hand it back — the
   *  round's `est_recd`. BLANK IS THE HONEST ANSWER and it stays blank: on prod
   *  only 5 of 165 consultant records carry one. Deriving it from a lead time
   *  would put a date in front of an outside engineer that nobody committed to.
   *
   *  ★ fix-499 removed `reuseFromAddress` and `reuseNotes` from this row. Bobby:
   *  *"There's not going to be any notes. It's like, here's your dates, here's
   *  your address, here's your unit, here's your unit type."* They were the only
   *  readers of `useVendorReportExtras`, which went with them. */
  expectedBack: string | null;
  /** The firm named on the consultant record, for the heading and the email —
   *  `external_team_directory.name`, which replaced the hard-coded VENDOR_FIRM
   *  constant. An INACTIVE firm still names itself (fix-474 call #2). */
  firmName: string | null;
  /** fix-167/262: the open HOLD on this project, if any. Held projects are
   *  reported (Bobby: "if they are on the list with them, then yes") and
   *  labelled, so the vendor knows the project is parked rather than watching it
   *  go quiet. Cancelled projects are excluded entirely (fix-264 rule). */
  holdReason: string | null;
  /** ★★ fix-367 §2 — THE SCOPE, so SSS can plan against it.
   *
   *  Bobby: *"it would be useful if we add the units — how many units are on
   *  that site — and then the type, SFR, duplex, whatever the boxes are
   *  checked. This way SSS can see a comprehensive list of what the pipeline
   *  looks like… so they can understand the scope of what's coming towards
   *  them, so they can plan for that."*
   *
   *  ★ Well populated already: of 160 active projects, 159 have units and 154
   *  have at least one product type. This is a display change, not a data
   *  project.
   *
   *  ★ NULL, NEVER ZERO, when the number is missing. Zero units is a real
   *  value that means something different from "nobody has said yet", and the
   *  renderer has to be able to tell them apart to show a blank for one and a
   *  0 for the other. One project has no units today. */
  units: number | null;
  /** ★ `projects.product_types` is an ARRAY — a project can be SFR *and* ADU
   *  *and* DADU, and 44 of the 160 are multi-type. Carried as the array so the
   *  renderers decide the separator; six projects have none. */
  productTypes: string[];
}

/** ★★★ fix-367 §2 — ONE FORMATTER, RENDERED IN TWO PLACES.
 *
 *  The on-screen report and the EMAIL must agree: `vendorReportEmail.ts` builds
 *  the message SSS actually receives, and a column that exists on screen and
 *  not in the email is worse than neither — it makes the two disagree about
 *  what was sent, and fix-269's ledger already tracks what the consultant is
 *  treated as knowing.
 *
 *  ★ So the SEPARATOR and the ORDER live here, once, and both surfaces call it.
 *  Comma-space rather than the middot the reuse column uses: the middot already
 *  means "two different facts joined" in this table (address · notes), and a
 *  list of types is one fact with several values.
 *
 *  ★ Kept SHORT deliberately — "this is a planning list, not a spec sheet". The
 *  types are stored the way they are shown (Detached, ADU, DADU), so there is
 *  no expansion to do and nothing to truncate: the widest real row on prod is
 *  three of them.
 *
 *  ★ fix-486 (P-143) re-worded the example onto the five-type vocabulary. This
 *  function is agnostic — it joins whatever strings it is given — so the remap
 *  changed nothing about it but the words in this note. */
export function formatProductTypes(types: ReadonlyArray<string>): string {
  return types.map((t) => t.trim()).filter(Boolean).join(', ');
}

/** ★ Units as a string, or '' when nobody has said.
 *
 *  ★★ BLANK, NOT "Unknown" — fix-269 settled this for `reuseFromAddress`: "the
 *  visible gap is what prompts someone to fill it in". A word in the cell reads
 *  as an answer and stops anybody looking. */
export function formatUnits(units: number | null): string {
  return units == null ? '' : String(units);
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
 *  ★★★ fix-499: THE ROUND IS THE LIVENESS SIGNAL; the date decides
 *  presentation. The table fix-269 wrote here read `transmit state`; it now
 *  reads the consultant status, and one row of it changed answer:
 *
 *    round status  | target send | result
 *    --------------|-------------|-------------------------------------------
 *    no record     | any         | NOT ON THE REPORT — no consultant, no row
 *    Scheduled     | future      | UPCOMING
 *    Scheduled     | past        | UPCOMING, flagged OVERDUE   ← was DROP
 *    Pending       | any         | TRANSMITTED (not here)
 *    Received      | any         | DROP — the round is the record
 *
 *  ★ The changed row is the improvement: a project whose send date has passed
 *  used to disappear unless somebody had made a transmit task, which is the
 *  silent drop the catalog's own note warned readers about.
 *
 *  all-permits-done still OVERRIDES all of this (applied by the caller): an
 *  issued project drops even with a live round, because a record nobody closed
 *  is not evidence the work is live.
 *
 *  ★ `todayIso` LEFT THIS SIGNATURE with the passed-target-send clause. Nothing
 *  here is time-dependent any more — the date questions are all asked by
 *  buildVendorScheduleRows, which is the only place holding the round.
 */
export function drawBlockIsVendorVisible(
  block: Pick<DrawScheduleRow, 'status' | 'dd_end' | 'end_week'> & {
    exclude_from_vendor_reports?: boolean | null;
  },
  project: Pick<Project, 'id' | 'address'> | undefined,
  cancelledIds: ReadonlySet<string> | undefined,
): boolean {
  if (!project) return false;
  if (!norm(project.address)) return false;
  if (isCancelledProject(project.id, cancelledIds)) return false;
  if (block.exclude_from_vendor_reports === true) return false;
  // fix-266: pre-submittal phases only. A blank status is kept (see the doc
  // above); anything named that is not on the allow-list is out.
  const status = norm(block.status);
  if (status !== null && !VENDOR_PIPELINE_STATUSES.has(status)) return false;
  // ★★★ fix-499: THE THREE TASK-DRIVEN CLAUSES THAT USED TO SIT HERE ARE GONE.
  //     They read a `transmitState` derived from permit_tasks:
  //       - 'started'  → drop, it is in TRANSMITTED
  //       - 'resolved' → drop, the package came back
  //       - a passed target send with NO task at all → drop, nothing says the
  //         work is live
  //     All three are now the ROUND's job and are applied by
  //     buildVendorScheduleRows, which is the only place that has the round:
  //     Pending → Transmitted, Received → gone, Scheduled → here (overdue when
  //     its target send has passed). ★ THE THIRD ONE IS THE ONE THAT CHANGED
  //     BEHAVIOUR: a Scheduled round whose date has passed is now KEPT and
  //     marked overdue, where before a project with no transmit task fell
  //     silently off the list on the day it most needed saying. That silent
  //     drop is exactly what the catalog's own note warned about.
  return true;
}

/** ★ fix-309 #48: how many days BEFORE the end of DD we send the backgrounds.
 *
 *  "We don't send our backgrounds out at the end of the DD phase, we send them
 *  out roughly a week before the end of the DD phase." The email was therefore
 *  a week late on every project. */
export const VENDOR_SEND_LEAD_DAYS = 7;

/** fix-269: the TARGET SEND date. The date we are committing to hand documents
 *  over, not a date we observed.
 *
 *  ★ fix-309 #48: it is now dd_end MINUS one week, not dd_end.
 *
 *  The lead is applied to the RESOLVED anchor, so the end_week fallback shifts
 *  too — 84 of 139 blocks have no dd_end and would otherwise keep the old,
 *  late date under a different name. One rule, both sources.
 *
 *  Note for the first run after this ships: the ledger stores the derived
 *  value, so the 6 already-sent projects will read as "changed" with their
 *  previous date shown. That is correct rather than noise — the date we are
 *  quoting genuinely did move a week earlier, and telling the consultant so is
 *  the point of the changed bucket. */
export function vendorTargetSend(
  block: Pick<DrawScheduleRow, 'dd_end' | 'end_week'>,
): string | null {
  const anchor = norm(block.dd_end) ?? norm(block.end_week);
  if (anchor === null) return null;
  return shiftDays(anchor, -VENDOR_SEND_LEAD_DAYS);
}

/** Add (or subtract) whole days to an ISO date, staying in ISO. Noon UTC so a
 *  DST boundary can never roll the date. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Is this row late — target send passed with nothing sent?
 *
 *  ★★★ fix-499 REPLACED THE TEST. It was "the project has an OPEN, UNSTARTED
 *  TRANSMIT TASK and its target send has passed" (fix-269). It is now "the
 *  round is still SCHEDULED and its target send has passed" — the same
 *  question asked of the record that actually tracks it. `Scheduled` means
 *  nothing has gone out; `Pending` means it has, and a sent package cannot be
 *  late to be sent.
 *
 *  ★ An open waiting_on task alone no longer makes a row overdue, and that
 *  ruling is pinned as superseded in the tests. */
export function vendorRowIsOverdue(
  targetSend: string | null,
  status: string | null,
  todayIso: string,
): boolean {
  if (norm(status) !== 'Scheduled') return false;
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
  /** ★★★ fix-499: THE MEMBERSHIP SIGNAL — one consultant record per project
   *  for this discipline, from {@link consultantByProject}. A project without
   *  one is not on this report at all; a project whose round is `Received` has
   *  fallen off; `Pending` belongs to TRANSMITTED. This replaced
   *  `transmitState`, which read permit_tasks. */
  consultants: ReadonlyMap<string, ConsultantRoundFacts>;
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
    consultants,
    todayIso,
  } = input;

  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);

  const ledgerByProject = new Map<string, VendorLedgerRow>();
  for (const l of ledger) ledgerByProject.set(l.project_id, l);

  // ★★★ fix-499: THE LOOP IS OVER CONSULTANT RECORDS, NOT DRAW BLOCKS. The
  //     consultant record is the membership signal now, so a project this
  //     discipline is not on can no longer reach the report through a draw
  //     block, and a project with a round but no visible block is still
  //     considered (it is listed only if the round states a date — see below).
  const blockByProject = new Map<
    string,
    DrawScheduleRow & { exclude_from_vendor_reports?: boolean | null }
  >();
  for (const block of draw) {
    // First block wins, matching the pre-fix-499 behaviour for the handful of
    // projects that carry more than one (fix-384: draw_schedule's PK is the
    // project, so a second design window has no home — there is at most one).
    if (!blockByProject.has(block.project_id)) {
      blockByProject.set(block.project_id, block);
    }
  }

  const rows: VendorScheduleRow[] = [];
  for (const [projectId, round] of consultants) {
    // ★★★ Received → FALLS OFF. No ledger write, no tombstone: the round is the
    //     record. Bobby: "once it's completed, it would fall off this list."
    const roundStatus = norm(round.status);
    if (roundStatus === 'Received') continue;
    // ★★ Pending → TRANSMITTED (sent, awaiting return), built separately by
    //    buildVendorTransmitRows. Not here.
    if (roundStatus === 'Pending') continue;

    const project = projectById.get(projectId);
    const block = blockByProject.get(projectId);
    // fix-268: the permits already issued — the design work finished long ago.
    // This OVERRIDES everything else and is checked before anything else.
    if (allPermitsDoneIds?.has(projectId)) continue;
    if (!project) continue;
    if (!norm(project.address)) continue;
    if (isCancelledProject(projectId, cancelledIds)) continue;
    // ★★ The block's own exclusions still apply WHEN THERE IS A BLOCK. A
    //    project with no visible block is not excluded BY that absence — it is
    //    excluded by having no date, one clause down.
    if (block && !drawBlockIsVendorVisible(block, project, cancelledIds)) {
      continue;
    }
    const targetSend = forecastTargetSend(round, block);
    // ★★★ NO DATE, NO ROW. The brief is explicit: a project with a round but no
    //     visible block gets the round's est_send or nothing, and is listed only
    //     if it has a date. An undated row in a "coming to you" list is an
    //     invented commitment, which fix-271 already ruled is the worse error.
    if (targetSend === null) continue;

    // drawBlockIsVendorVisible already proved project is defined + addressed.
    const p = project;

    const facts: VendorScheduleFacts = {
      startWeek: norm(block?.start_week ?? null),
      targetSend,
      status: norm(block?.status ?? null),
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

    rows.push({
      projectId: p.id,
      address: (p.address ?? '').trim(),
      juris: norm(p.juris),
      ...facts,
      bucket,
      previous,
      expectedBack: norm(round.est_recd),
      firmName: norm(round.firm_name),
      holdReason: norm(holdsByProject?.get(p.id)?.reason ?? null),
      overdue: vendorRowIsOverdue(targetSend, roundStatus, todayIso),
      // ★ fix-367 §2. `units` is read as a NUMBER and only a number: an empty
      // string or a non-numeric value is "not stated", not 0.
      units:
        typeof p.units === 'number' && Number.isFinite(p.units) ? p.units : null,
      // ★ Blank entries are dropped rather than rendered as gaps inside the
      // list — a trailing " · " reads as a missing type rather than as none.
      productTypes: Array.isArray(p.product_types)
        ? p.product_types
            .map((t) => (t ?? '').trim())
            .filter((t) => t.length > 0)
        : [],
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
// fix-271: TOLD APART BY THE PROJECT'S PHASE, not the task's name.
//
// fix-268 matched task TEXT against a list. Four naming variants exist in the
// wild and the list misfiled two projects: 7336 132nd Ave NE and 7708 131st Ave
// NE both sit at pre-submittal with tasks named plainly "Structural", so they
// landed in CORRECTIONS — permitting work on projects that have never been
// submitted, neither of which even has a permit number.
//
// Bobby: "corrections are for projects within permitting phase, not the design
// phase/cycle." So the draw block decides:
//
//   PRE-SUBMITTAL (Scheduled / Schematic / DD / Permit Set / Pending
//   Consultants)                → a structural task is the DESIGN HANDOFF
//                                 → Upcoming or Transmitted
//   ANYTHING ELSE (Under Review / Corrections / Approved)
//                                → a structural task is a CORRECTION
//
// A DA can now name the task whatever they like; the report does not care. That
// naming dependence was the whole fragility, so the text list is GONE — do not
// reintroduce one.

/** fix-271: projects whose draw block is in a PRE-SUBMITTAL phase, i.e. still in
 *  the design cycle. Reuses {@link VENDOR_PIPELINE_STATUSES} so "what counts as
 *  pre-submittal" has exactly one definition shared with the pipeline gate.
 *
 *  A project with NO DRAW BLOCK is deliberately absent from this set, so its
 *  structural tasks read as CORRECTIONS. There is no design phase we can see,
 *  and putting an unknown into a vendor-facing "coming to you" list is the worse
 *  error: an over-listed correction is noise, an invented commitment is not.
 *
 *  A block with a BLANK status IS treated as design, matching fix-266's rule
 *  that a blank status cannot prove a project is past submittal. Zero prod rows
 *  are blank today, so this is a decision about future data. */
export function designPhaseProjectIds(
  draw: ReadonlyArray<Pick<DrawScheduleRow, 'project_id' | 'status'>>,
): Set<string> {
  const out = new Set<string>();
  for (const block of draw) {
    const status = norm(block.status);
    if (status === null || VENDOR_PIPELINE_STATUSES.has(status)) {
      out.add(block.project_id);
    }
  }
  return out;
}

export interface VendorTransmitRow {
  projectId: string;
  address: string;
  juris: string | null;
  /** ★ fix-499: the round's `sent`, stamped by bp_set_consultant_status when
   *  somebody moved it to Pending — not permit_tasks.start_date. */
  sent: string | null;
  /** ★ fix-499: the round's `est_recd`. BLANK STAYS BLANK — 5 of 165 records
   *  carry one, and a lead-time guess in a vendor-facing email is a commitment
   *  nobody made. */
  expectedBack: string | null;
  /** ★★ fix-499 §C: the same two scope columns the schedule rows carry, from
   *  the same two formatters. A column that exists in one section and not the
   *  next makes one email disagree with itself. */
  units: number | null;
  productTypes: string[];
}

/** Packages SENT and awaiting return — section 4.
 *
 *  ★★★ fix-499: A ROUND AT `Pending` IS WHAT "WITH THEM" MEANS NOW. It was
 *  "a structural task on a pre-submittal project whose start_date is set"
 *  (fix-268/271) — a stand-in built from permit_tasks because no consultant
 *  record existed. The ladder says it directly: Scheduled → nothing sent,
 *  Pending → sent and awaiting return, Received → done.
 *
 *  ★ NO `designPhaseIds` GATE. That existed to tell a design-handoff task from
 *  a correction task, because both were tasks and only the project's phase
 *  could separate them. A consultant round is a design round by construction;
 *  there is nothing to disambiguate. Corrections still read tasks and still use
 *  the gate — see buildVendorCorrectionRows.
 *
 *  ★ NO all-permits-done gate either, and deliberately: fix-268's rule exists
 *  because a task nobody closed is not evidence work is live. A round somebody
 *  moved to Pending IS that evidence, and a package genuinely out with a firm
 *  should not vanish because the permits issued in the meantime. */
export function buildVendorTransmitRows(
  consultants: ReadonlyMap<string, ConsultantRoundFacts>,
  projects: ReadonlyArray<Project>,
  cancelledIds?: ReadonlySet<string>,
): VendorTransmitRow[] {
  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);

  const rows: VendorTransmitRow[] = [];
  for (const [projectId, round] of consultants) {
    if (norm(round.status) !== 'Pending') continue;
    if (isCancelledProject(projectId, cancelledIds)) continue;
    const project = projectById.get(projectId);
    if (!project) continue;
    const address = (project.address ?? '').trim();
    if (address === '') continue;

    rows.push({
      projectId,
      address,
      juris: norm(project.juris),
      sent: norm(round.sent),
      expectedBack: norm(round.est_recd),
      units:
        typeof project.units === 'number' && Number.isFinite(project.units)
          ? project.units
          : null,
      productTypes: Array.isArray(project.product_types)
        ? project.product_types
            .map((t) => (t ?? '').trim())
            .filter((t) => t.length > 0)
        : [],
    });
  }
  rows.sort(
    (a, b) =>
      (a.sent ?? '').localeCompare(b.sent ?? '') ||
      a.address.localeCompare(b.address),
  );
  return rows;
}

// ===========================================================================
// ★★★ fix-499 — `TransmitState` AND `transmitStateByProject` ARE GONE
// ===========================================================================
//
// They were fix-269's answer to "where does this project stand on the design
// handoff", derived from permit_tasks: none / open / started / resolved, with a
// precedence rule (started > open > resolved) for a project carrying several
// tasks. Every one of those four states now has a home on the round —
// no record / Scheduled / Pending / Received — recorded once, per discipline,
// by the person doing the work rather than inferred from a task's start_date.
//
// ★ The precedence rule went with it and is not missed: `project_consultants`
//   is unique on (project, discipline), so there is exactly one current round
//   and nothing to rank.
//
// ★★ THE RULING THAT INVERTED, and it is pinned as superseded in the tests: an
//    open waiting_on task alone no longer makes a row OVERDUE, and the absence
//    of one no longer drops a project whose target send has passed. fix-269's
//    reading — "without a task there is no evidence the work is still live" —
//    was true of tasks and is not true of rounds: a Scheduled round IS that
//    evidence, and it is the state 37 of 43 live Structural rounds are in.

/** fix-265/268: does this vendor own the task's project for this discipline?
 *
 *  Firm-when-known, discipline-when-not — see buildVendorCorrectionRows for the
 *  measurement behind the fallback.
 *
 *  ★★ fix-499: THE FIRM COMES FROM THE CONSULTANT RECORD NOW, not from the
 *  hard-coded `VENDOR_FIRM = { structural: 'SSS' }` map that this ticket
 *  deleted. Same rule, better source: the task matches when the project's
 *  external_team names no firm for the discipline (unrecorded — the bounded
 *  fallback), when the consultant record names none, or when the two agree. It
 *  still NEVER matches a project whose firm is recorded as somebody else.
 *
 *  ★ Only section 5 (corrections) calls this now. Section 4 reads rounds. */
function vendorOwnsTask(
  task: Pick<WaitingOnTaskRow, 'waiting_on'>,
  project: Project | undefined,
  discipline: string,
  knownFirms: ReadonlySet<string>,
): boolean {
  if (!discipline) return false;
  if (norm(task.waiting_on) !== discipline) return false;
  const firm = resolveExternalFirm(
    asExternalTeamBlob(project?.external_team),
    discipline,
  );
  // Unrecorded on the project → the bounded fallback, unchanged since fix-265.
  if (firm === null) return true;
  // ★ No consultant record anywhere for this discipline → nothing to compare
  //   against, so the discipline alone decides. Bounded the same way the other
  //   fallback is: it can only fire when we know of no firm at all.
  if (knownFirms.size === 0) return true;
  return knownFirms.has(firm);
}

// ---------------------------------------------------------------------------
// Section 5 — corrections currently sitting with the vendor
// ---------------------------------------------------------------------------

export interface VendorCorrectionRow {
  taskId: string;
  projectId: string;
  address: string;
  juris: string | null;
  /** fix-271: the permit type. Corrections are permit-scoped, so this is already
   *  to hand, and it is what distinguishes a PPR or a Demolition from the
   *  Building Permit most rows will be. Replaced the task text, which was the
   *  very string fix-271 stopped trusting and which read as noise to a vendor. */
  permit: string | null;
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
 *  fix-271: PHASE decides, not the task's name. A structural task on a project
 *  whose draw block is PAST SUBMITTAL is a correction; the same task on a
 *  pre-submittal project is the design handoff and belongs to section 4. Design
 *  and permitting never blur. A project with no draw block at all lands here —
 *  see {@link designPhaseProjectIds} for why that is the safer default. */
export function buildVendorCorrectionRows(
  tasks: ReadonlyArray<WaitingOnTaskRow>,
  projects: ReadonlyArray<Project>,
  discipline: string,
  /** fix-271: from {@link designPhaseProjectIds}. Tasks on these projects are
   *  design-phase and are handled by sections 3 and 4 instead. */
  designPhaseIds: ReadonlySet<string>,
  cancelledIds?: ReadonlySet<string>,
  /** ★ fix-499: the consultant record per project for this discipline, so the
   *  firm match reads a real record instead of a constant. Optional: with no
   *  map every task falls back to the discipline-only rule, which is what the
   *  pre-fix-499 code did for every project with no firm recorded. */
  consultants?: ReadonlyMap<string, ConsultantRoundFacts>,
): VendorCorrectionRow[] {
  if (!discipline) return [];

  const projectById = new Map<string, Project>();
  for (const p of projects) projectById.set(p.id, p);
  const knownFirms = firmsForDiscipline(consultants);

  const rows: VendorCorrectionRow[] = [];
  for (const t of tasks) {
    if (!isTaskLive(t.completion_status)) continue;
    if (designPhaseIds.has(t.project_id)) continue; // design → sections 3 / 4
    if (isCancelledProject(t.project_id, cancelledIds)) continue;

    const project = projectById.get(t.project_id);
    if (!vendorOwnsTask(t, project, discipline, knownFirms)) continue;
    const firm = resolveExternalFirm(
      asExternalTeamBlob(project?.external_team),
      discipline,
    );

    rows.push({
      taskId: t.task_id,
      projectId: t.project_id,
      address: (project?.address ?? t.project_address ?? '').trim(),
      juris: norm(project?.juris ?? t.project_juris ?? null),
      permit: norm(t.permit_type),
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
