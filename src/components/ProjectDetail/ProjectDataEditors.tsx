import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { OverviewSection } from './OverviewCard';
import { schematicWindow } from '../../lib/schematicWindow';
import ZoneSelect from '../shared/ZoneSelect';
import {
  LOT_SIZE_SF_MAX,
  lotSizeView,
  parseLotSizeSf,
  roundLotForStorage,
} from '../../lib/lotDimensions';
import { VENDOR_SEND_LEAD_DAYS, vendorTargetSend } from '../../lib/vendorReport';
import {
  UNIT_MATRIX_GRID,
  UNIT_ROW_COLUMNS,
  unitFieldTooltip,
  type UnitRowColumn,
} from '../../lib/unitRowLayout';
import {
  ParkingKindSelect,
  RoofDeckSelect,
  StallsInput,
} from '../shared/UnitParkingInputs';
import { parseStalls, NOT_RECORDED } from '../../lib/unitParking';
import { unitLabelNeedsType } from '../../lib/unitTypeVocabulary';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import {
  nextUnitTypeLabel,
  parseUnitTypes,
  OTHER_UNIT_LABEL,
  isOffListUnitLabel,
  productTypeRegistry,
  resolveUnitLabel,
  unitLabelOptions,
  resolveUnitTypesForSave,
} from '../../lib/unitTypeNaming';
import { snapToMonday, addDays } from '../../lib/dateUtils';
import LinkedTimeBlocksSection from './LinkedTimeBlocksSection';
import {
  useSetBpDdDates,
  type ProjectOverlapConflict,
  type NpOverlapConflict,
} from '../../hooks/useSetBpDdDates';
import { useResolveDaOverlap } from '../../hooks/useResolveDaOverlap';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { useDrawSchedule } from '../../hooks/useDrawSchedule';
import { useUpdateProjectWithPermits } from '../../hooks/useUpdateProjectWithPermits';
import { useAppConfig } from '../../hooks/useAppConfig';
import { pushToast } from '../../stores/toastStore';
import OverlapPrompt from '../OverlapPrompt';
import NpWarningPrompt from '../NpWarningPrompt';
import type { PermitWithCycles, Project, UnitType } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-506 §G (P-140) — THE EDITORS THE OVERVIEW NO LONGER OWNS
// ===========================================================================
//
// Bobby's ruling: *"Overview is read-only; every project field is edited in
// Project Data."* Everything in this file was inline on the overview until
// 2026-09-08 and is now the Project Data modal's content.
//
// ★★★ IT IS A MOVE, NOT A REWRITE, AND THAT IS DELIBERATE. Every component
//     below keeps its own hook, its own OCC token, its own toast and its own
//     per-field commit — the brief is explicit: *"Every write goes through the
//     SAME hooks the overview uses today — no new RPC, same OCC tokens, same
//     toasts."* A modal that re-implemented these would be a second write path
//     for eighteen fields, which is the fix-415 defect class (three write paths
//     for one site field, one of them bypassing every server-side rule) applied
//     to the whole card at once.
//
// ★★ SO THE DIFF IS BORING ON PURPOSE. What changed is where these render and
//    that they are `export`ed; the bodies are byte-for-byte what shipped on
//    `origin/main` at 6506c7a, including every fix-73/98 dirty-flag, every
//    fix-311 box class and fix-320's date format. The read-only faces that
//    replace them on the overview live in `ProjectOverviewBoxes`.
//
// ★ `DDPhaseCell` — the Milestones CARD — did not come with them. §A retires it
//   as a card, and its three no-BP branches were card chrome; what the modal
//   needs is `DDPhaseEditor`, `KeyDatesSection` and `TargetSubmitRow`, which do
//   the work.

// ★ fix-311 #56 — ONE date row for the whole Milestones card.
//
// The card had grown three presentations for one kind of fact: a dashed
// underline (GO Date), a bare text line (the SD window), and boxed inputs (DD
// start / DD end / Target Submit). Bobby: "we want the SD start and the SD end
// to also match the same kind of format as DD start, DD end. Same thing with the
// go date … that way it all kind of looks uniform … make sure that all of them
// have the same horizontal width as well."
//
// THE SHAPE THAT MAKES THAT TRUE, rather than true-for-now:
//
//     [ label ][            the box            ]   ← one element, one class
//                ^ an editable row nests a borderless input INSIDE the box
//
// The grey box is the SAME element with the SAME class string and the SAME
// inline style on every row, editable or not — so the label column, the value
// width and the box treatment cannot drift between rows without moving all of
// them together. That is the whole point of the ticket: not three components
// that look alike today, one component that cannot stop looking alike.
//
// ★ THE BOX IS THE DISPLAY FORMAT; EDITABILITY IS A SEPARATE PROPERTY. A
// read-only row wears the same box with no focus ring and no text cursor, so it
// does not invite a click it cannot honour.
// ============================================================

/** The label column. One width for every row — the thing that makes the boxes
 *  line up at all. Wide enough for the longest label on the card,
 *  "Intake Accepted". */
const MILESTONE_LABEL_CLASS =
  'text-[9px] text-dim w-20 flex-shrink-0 whitespace-nowrap';

/** The box. Identical on every row; `flex-1` (basis 0) is what gives every value
 *  the same horizontal width whatever it contains. */
const MILESTONE_BOX_CLASS =
  'text-[11px] font-semibold px-1.5 py-0.5 border rounded flex-1 min-w-0';

const MILESTONE_BOX_STYLE: CSSProperties = {
  borderColor: 'var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
};

/** The input that sits inside the box on an editable row. It draws nothing of
 *  its own — the box already drew it — so the two kinds of row have one
 *  appearance between them. */
const MILESTONE_INPUT_CLASS =
  'w-full bg-transparent border-0 outline-none p-0 text-[11px] font-semibold ' +
  'text-text disabled:opacity-50';

/** ★ fix-320 #1: THE read-only date format for this card, and the only date
 *  formatter in this file.
 *
 *  fix-311 gave every row the same box but not the same TEXT: read-only rows
 *  printed ISO (`2026-09-11`) while the editable rows printed whatever the
 *  browser renders inside `<input type="date">` (`09/11/2026` in a US locale).
 *  ★ A native date input cannot be told to render differently, so the read-only
 *  side is the side that moves.
 *
 *  ★ NO LOCALE IS PINNED. The input follows the BROWSER's locale, so matching it
 *  means following the same locale rather than hard-coding en-US — an en-GB
 *  browser renders the input `11/09/2026` and this returns `11/09/2026` with it.
 *  A pinned locale would re-open the very mismatch this fixes, one timezone
 *  over. 2-digit day and month keep the value column fixed-width, which is what
 *  ISO was giving us and what must survive.
 *
 *  ★ PRESENTATION ONLY. ISO goes in, ISO stays stored: nothing here touches an
 *  input's `value` or a mutation payload. Empty in ⇒ empty out, so the caller
 *  still renders the em-dash rather than an epoch date. */
function formatMilestoneDate(iso: string): string {
  const trimmed = iso.trim();
  if (!trimmed) return '';
  // Noon UTC + a UTC-pinned formatter: the date the string names is the date
  // shown, whatever side of midnight the reader's timezone sits on.
  const d = new Date(`${trimmed}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return trimmed;
  return d.toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface MilestoneDateRowProps {
  label: string;
  /** ISO date (or a draft mid-edit). Empty renders the em-dash placeholder on a
   *  read-only row — never a date computed from nothing. */
  value: string;
  /** Present ⇒ editable: the box nests a date input. Absent ⇒ read-only. */
  onChange?: (next: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  /** Goes on the input when editable, on the box when read-only — whichever
   *  element a caller's existing test already reaches for. */
  testId?: string;
  /** Tooltip on the box. Read-only rows use it to say where the value comes
   *  from, since there is nothing to click. */
  title?: string;
  ariaLabel?: string;
}

export function MilestoneDateRow({
  label,
  value,
  onChange,
  onBlur,
  onKeyDown,
  disabled,
  testId,
  title,
  ariaLabel,
}: MilestoneDateRowProps) {
  const editable = typeof onChange === 'function';
  return (
    <div className="flex items-center gap-1.5" data-milestone-row="">
      <span className={MILESTONE_LABEL_CLASS}>{label}</span>
      <div
        className={`${MILESTONE_BOX_CLASS}${editable ? '' : ' cursor-default'}`}
        style={MILESTONE_BOX_STYLE}
        title={title}
        data-milestone-value=""
        data-milestone-editable={editable ? 'true' : 'false'}
        data-testid={editable ? undefined : testId}
      >
        {editable ? (
          <input
            type="date"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            disabled={disabled}
            className={MILESTONE_INPUT_CLASS}
            aria-label={ariaLabel}
            data-testid={testId}
          />
        ) : (
          // ★ fix-320: formatted to match what the date inputs above and below
          // render, so the card reads as one format and not two.
          //
          // The em-dash is the ABSENCE of a date, said out loud. An empty box
          // would collapse and read as a rendering bug; a fabricated date would
          // be worse than either.
          formatMilestoneDate(value) || '—'
        )}
      </div>
    </div>
  );
}

/** ★ fix-311 §2: the divider that groups rows INSIDE a section — SD from DD,
 *  planned from happened. Reuses the dashed rule the GO Date row used to wear
 *  (and no longer does) so the card keeps one visual language rather than
 *  growing a second. */
function MilestoneDivider({ testId }: { testId: string }) {
  return (
    <div
      role="separator"
      className="border-b border-dashed"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid={testId}
    />
  );
}

/** fix-148: project-level Closing date, inline-editable. Moved out of the
 *  overcrowded Project Site cell into DD Phase (closing kicks off the design
 *  phase, and DD Phase has the room). Renders at the top of all three DD Phase
 *  states. Writes projects.closing_date via useUpdateProject (OCC). */
function ClosingRow({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;
  const [draft, setDraft] = useState<string>(project.closing_date ?? '');
  async function commit(next: string | null) {
    if (!project.updated_at) return;
    if (next === (project.closing_date ?? null)) return;
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { closing_date: next } as Partial<Project>,
      fieldLabel: 'Closing Date',
    });
  }
  return (
    <MilestoneDateRow
      label="Closing"
      value={draft}
      onChange={setDraft}
      onBlur={() => {
        const t = draft.trim();
        void commit(t === '' ? null : t);
      }}
      disabled={occMissing}
      testId="project-overview-closing"
      ariaLabel="Closing"
    />
  );
}

/** ★ fix-309 #51: KEY DATES = GO Date, then Closing date. Those two, nothing
 *  else.
 *
 *  "The GO date at the top, because all projects start with the GO date, and
 *  then it goes closing date, and I think that's it for the key dates."
 *
 *  Shared by all three branches of the card so the order cannot drift between
 *  a BP project, a reuse-redesign and a permit-less shell — which is how the
 *  fix-148 comment and the shipped order came to disagree in the first place.
 *  Target Submit moved OUT of here and under the DD window, where its anchor
 *  (dd_end) lives; it is still editable, just no longer a "key date". */
export function KeyDatesSection({ project }: { project: Project }) {
  return (
    <OverviewSection title="Key dates">
      <div className="flex flex-col gap-1.5">
        {/* ★ fix-311: GO Date wears the box like everything else and has LOST
            its dashed underline — "I would remove that little dotted line
            there." It is still read-only, and the box says where to change
            it. */}
        <MilestoneDateRow
          label="GO Date"
          value={project.go_date ?? ''}
          title="GO date is set on the Project Settings page"
          testId="pd-go-date"
        />
        <ClosingRow project={project} />
      </div>
    </OverviewSection>
  );
}

/** ★ fix-309 #53 / fix-311: the schematic window, derived from DD start and
 *  display-only — SPLIT into two rows so SD start and SD end sit parallel with
 *  DD start and DD end instead of being one squeezed `start → end` string.
 *
 *  Null in, null out: no DD start ⇒ no SD rows and no divider, rather than a
 *  window printed from nothing. */
function SchematicRows({ ddStart }: { ddStart: string | null }) {
  const win = schematicWindow(ddStart);
  if (!win) return null;
  return (
    <>
      <MilestoneDateRow
        label="SD start"
        value={win.start}
        title="Schematic design start — derived from DD start, not stored"
        testId="pd-sd-start"
      />
      <MilestoneDateRow
        label="SD end"
        value={win.end}
        title="Schematic design ends where DD begins — derived from DD start"
        testId="pd-sd-end"
      />
      {/* Schematic ends where design development begins — "that way you can
          differentiate that." */}
      <MilestoneDivider testId="pd-sd-dd-divider" />
    </>
  );
}

/** ★ fix-311: the CONSULTANT date — the external target send, one week before DD
 *  end.
 *
 *  ★★ It is the SAME value fix-309 gave the consultant forecast email, through
 *  the SAME function: `vendorTargetSend`, `dd_end − VENDOR_SEND_LEAD_DAYS`. A
 *  second literal `- 7` here is exactly how the row on this card and the date in
 *  the email would silently diverge the day the lead changes. One concept, one
 *  function.
 *
 *  Derived and display-only, like SD. No dd_end ⇒ no row. `end_week` is passed
 *  as null deliberately: the report falls back to the draw block's end week when
 *  a permit has no dd_end, but this card is showing THIS permit's DD window, and
 *  a date derived from a different anchor under the same label would be a lie. */
function ConsultantDateRow({ ddEnd }: { ddEnd: string | null }) {
  const target = vendorTargetSend({ dd_end: ddEnd, end_week: null });
  if (!target) return null;
  return (
    <MilestoneDateRow
      label="Consultant"
      value={target}
      title={`Target external send — ${VENDOR_SEND_LEAD_DAYS} days before DD end. Same date the consultant forecast quotes.`}
      testId="pd-consultant-date"
    />
  );
}

/** ★ fix-311: Intake Accepted — CYCLE 0 of the primary building permit.
 *
 *  ★ Cycle 0 specifically. It is the design/initial submittal and the only cycle
 *  that ever carries `intake_accepted` — 147 permits have one and there are ZERO
 *  on cycle 1 and above. Reading "the current cycle" would render blank on
 *  nearly every permit that has moved past its first review.
 *
 *  ★ DISPLAY ONLY. There is no write path for this, deliberately: fix-311 is a
 *  layout ticket, and a new editable cycle field is scope nobody asked for. */
function IntakeAcceptedRow({ bp }: { bp: PermitWithCycles | null }) {
  const cycle0 = (bp?.permit_cycles ?? []).find((c) => c.cycle_index === 0);
  return (
    <MilestoneDateRow
      label="Intake Accepted"
      value={cycle0?.intake_accepted ?? ''}
      title="Intake accepted on the initial submittal (cycle 0) — scraped from the portal"
      testId="pd-intake-accepted"
    />
  );
}

// ★★★ fix-506 §A — `DDPhaseCell` IS DELETED, not left unused.
//
// It was the Milestones CARD: a `<OverviewCard title="Milestones">` with three
// branches for a project that has no Building Permit (a reuse-redesign gets the
// inline lane editor; anything else got two "No building permit" lines). §A
// retires the card, so all three branches were chrome around a shell that no
// longer exists.
//
// ★★ WHAT ITS NO-BP BRANCHES SAID IS NOT LOST — it is stronger. The v14 Dates
//    card prints `—` for every date whose source is null, which is the brief's
//    own rule for the three Building Permit rows applied to all eleven, so a
//    permit-less project renders the same shape with empty values instead of a
//    differently-shaped card. The reuse-redesign lane editor
//    (`ReuseRedesignDdEditor`) moves into the modal's Dates tab below.

/** fix-25h: a conflict response from bp_set_bp_dd_dates carries enough
 *  context to drive either the OverlapPrompt (project overlap → Push Down
 *  via bp_resolve_da_overlap) or the NpWarningPrompt (NP overlap → retry
 *  setBpDdDates with forceNp=true). We snapshot everything we need at
 *  the moment the conflict comes back so the prompt's confirm callback
 *  can fire without re-reading state that may have changed. */
interface PendingDdOverlap {
  kind: 'project';
  proposedStartWeek: string;
  proposedEndWeek: string;
  conflicts: ProjectOverlapConflict[];
  drawScheduleUpdatedAt: string;
  daAssigned: string;
  scheduleStatus: string | null;
  anchorAddress: string;
}
interface PendingDdNpWarning {
  kind: 'np';
  ddStart: string;
  ddEnd: string;
  bpUpdatedAt: string;
  conflicts: NpOverlapConflict[];
  daAssigned: string;
  anchorAddress: string;
}

export function DDPhaseEditor({
  project,
  bp,
  permits,
}: {
  project: Project;
  bp: PermitWithCycles;
  permits: PermitWithCycles[];
}) {
  // Local-controlled inputs to avoid one-save-per-keystroke. Fires
  // update on blur if the value changed.
  //
  // fix-23a: dd_start/dd_end commits route through useSetBpDdDates so the
  // RPC can cascade target_submit (+14d) across sibling permits AND
  // mirror the dates onto draw_schedule.start_week/end_week.
  //
  // fix-25h: the RPC now overlap-checks the proposed weeks against other
  // projects + NP blocks on the same DA before writing. Project conflicts
  // open OverlapPrompt → Push Down via bp_resolve_da_overlap; NP conflicts
  // open NpWarningPrompt → "Save anyway" retries with forceNp=true.
  const setBpDdDates = useSetBpDdDates();
  const resolveOverlap = useResolveDaOverlap();
  const drawScheduleQ = useDrawSchedule();
  // fix-220: DD dates mirror onto the draw_schedule lane (bp_set_bp_dd_dates),
  // an admin-only mutation. Non-admins see the DD fields read-only.
  const canEdit = useIsTenantAdmin();
  const occMissing = !bp.updated_at;
  const [startDraft, setStartDraft] = useState(bp.dd_start ?? '');
  const [endDraft, setEndDraft] = useState(bp.dd_end ?? '');
  const [pendingOverlap, setPendingOverlap] = useState<PendingDdOverlap | null>(
    null,
  );
  const [pendingNp, setPendingNp] = useState<PendingDdNpWarning | null>(null);
  // fix-22 Mig 3: GO date is project-level now.

  // fix-66: Target Submit anchor. Strictly the project's Building Permit
  // (lowest id when there are several), NOT the page-level `bp` fallback —
  // that one degrades to permits[0] when no BP exists, but Target Submit
  // must render "—"/disabled in that case per spec. Independent of the DD
  // start/end anchor above.
  const targetSubmitBp = useMemo(() => {
    const bps = permits.filter((p) => p.type === 'Building Permit');
    if (bps.length === 0) return null;
    return bps.reduce((lo, p) => (p.id < lo.id ? p : lo));
  }, [permits]);

  /** Look up this project's draw_schedule row from the query cache. Used
   *  to capture da_assigned + status when opening the OverlapPrompt — the
   *  RPC returns the OCC token + proposed weeks, but Push Down also needs
   *  da_assigned + status to write the anchor's new schedule row. */
  const drawRow = useMemo(
    () =>
      drawScheduleQ.data?.find((r) => r.project_id === bp.project_id) ?? null,
    [drawScheduleQ.data, bp.project_id],
  );

  /** Commit DD dates. The RPC accepts (a) both filled, (b) both null
   *  (clear), but rejects partial-null. */
  async function commitDd(opts: { forceNp?: boolean } = {}) {
    if (!canEdit) return; // fix-220: admin-only draw_schedule write
    if (!bp.updated_at) return;
    const rawStart = startDraft.trim() || null;
    const rawEnd = endDraft.trim() || null;
    // Mid-state: one filled, one empty. Hold off until the user finishes.
    if ((rawStart === null) !== (rawEnd === null)) return;
    // fix-141: Monday-align before sending (the picker stays unrestricted; the
    // snap is silent). dd_start forward-snaps to the next Monday — Bobby's
    // locked direction, and the field the Draw Schedule grid keys lanes off, so
    // a non-Monday here is what made 6605's lane invisible. dd_end becomes the
    // Friday of its own end-week (end-week Monday + 4), preserving the Monday+4
    // convention no matter which weekday the user picked. Clear mode (both
    // null) passes straight through. bp_set_bp_dd_dates re-date_trunc's these,
    // so a Monday in is a no-op there — the client just makes it forward.
    const startNorm = snapToMonday(rawStart, 'forward');
    let endNorm = rawEnd === null ? null : addDays(snapToMonday(rawEnd, 'back'), 4);
    // Never let the snapped end fall before the snapped start (tiny same-week
    // spans) — collapse to the Friday of the start week.
    if (startNorm && endNorm && endNorm < startNorm) {
      endNorm = addDays(startNorm, 4);
    }
    // No-op when the snapped values match what's stored AND not retrying.
    if (
      !opts.forceNp &&
      startNorm === (bp.dd_start ?? null) &&
      endNorm === (bp.dd_end ?? null)
    ) {
      return;
    }
    try {
      const result = await setBpDdDates.mutateAsync({
        projectId: bp.project_id,
        ddStart: startNorm,
        ddEnd: endNorm,
        expectedUpdatedAt: bp.updated_at,
        forceNp: opts.forceNp ?? false,
      });
      if (result.overlapKind === 'project') {
        if (
          !drawRow ||
          !drawRow.da_assigned ||
          !result.drawScheduleUpdatedAt ||
          !result.proposedStartWeek ||
          !result.proposedEndWeek
        ) {
          // Missing context to drive Push Down — fall through silently.
          return;
        }
        setPendingOverlap({
          kind: 'project',
          proposedStartWeek: result.proposedStartWeek,
          proposedEndWeek: result.proposedEndWeek,
          conflicts: result.overlapConflicts as ProjectOverlapConflict[],
          drawScheduleUpdatedAt: result.drawScheduleUpdatedAt,
          daAssigned: drawRow.da_assigned,
          scheduleStatus: drawRow.status,
          anchorAddress: project.address,
        });
      } else if (result.overlapKind === 'np') {
        if (!startNorm || !endNorm || !drawRow?.da_assigned) return;
        setPendingNp({
          kind: 'np',
          ddStart: startNorm,
          ddEnd: endNorm,
          bpUpdatedAt: bp.updated_at,
          conflicts: result.overlapConflicts as NpOverlapConflict[],
          daAssigned: drawRow.da_assigned,
          anchorAddress: project.address,
        });
      }
    } catch {
      // Toasts surfaced inside the hook; swallow so input blur doesn't crash.
    }
  }

  async function confirmPushDown() {
    if (!pendingOverlap) return;
    try {
      await resolveOverlap.mutateAsync({
        anchorProjectId: bp.project_id,
        expectedUpdatedAt: pendingOverlap.drawScheduleUpdatedAt,
        daAssigned: pendingOverlap.daAssigned,
        startWeek: pendingOverlap.proposedStartWeek,
        endWeek: pendingOverlap.proposedEndWeek,
        scheduleStatus: pendingOverlap.scheduleStatus,
      });
      setPendingOverlap(null);
    } catch {
      // Toasts surfaced inside useResolveDaOverlap.
    }
  }

  async function confirmNpSaveAnyway() {
    if (!pendingNp) return;
    setPendingNp(null);
    await commitDd({ forceNp: true });
  }

  return (
    <>
      {/* ★★★ fix-506 §G: BARE, not a card. This rendered
          `<OverviewCard title="Milestones">` when it WAS the Milestones card;
          it is the Project Data modal's Dates tab now, and a card banner
          reading "Milestones" inside a tab labelled "Dates" would be the second
          name for one thing that fix-364 spent a whole ticket removing. */}
      <div className="flex flex-col" data-testid="pd-dates-editor">
       {/* ★ fix-296: two sections, because these are two different kinds of
           date and reading them as one list is what made "Start"/"End"
           ambiguous in the first place.

           ★ fix-309 #51: Key dates is now GO Date then Closing date and
           nothing else, in one shared component. The fix-148 comment used to
           claim Closing sat at the top; rather than leave a comment and an
           order disagreeing, the order is stated once in KeyDatesSection and
           every branch renders it. */}
       <KeyDatesSection project={project} />
       <OverviewSection title="DD window">
        <div className="flex flex-col gap-1.5">
          {/* ★ fix-309 #53: Schematic sits ABOVE the DD window — it is the
              four weeks that run into it. ★ fix-311 split it into SD start and
              SD end, and it carries the divider that separates schematic from
              design development. */}
          <SchematicRows ddStart={startDraft || null} />
          {/* ★ fix-309 #52: DISPLAY ONLY. The column is still dd_start, the RPC
              is still bp_set_bp_dd_dates and the testid is still
              pd-bp-dd_start — the same rename discipline as fix-296b, where
              nothing in the database was renamed. */}
          <MilestoneDateRow
            label="DD start"
            value={startDraft}
            onChange={setStartDraft}
            onBlur={() => void commitDd()}
            disabled={occMissing || !canEdit}
            testId="pd-bp-dd_start"
            ariaLabel="DD start"
          />
          {/* ★ fix-311: the external/consultant target, between the two DD
              dates as briefed — the date we are committing to hand documents
              over, one week before DD end. */}
          <ConsultantDateRow ddEnd={endDraft || null} />
          <MilestoneDateRow
            label="DD end"
            value={endDraft}
            onChange={setEndDraft}
            onBlur={() => void commitDd()}
            disabled={occMissing || !canEdit}
            testId="pd-bp-dd_end"
            ariaLabel="DD end"
          />
          {/* fix-309 #49: the Duration line is gone. The two dates say it. */}
        </div>
       </OverviewSection>
       {/* ★★★ fix-384: the design windows draw_schedule cannot hold. Its PK
           is project_id, so a project that took a SECOND window months later
           had nowhere to put it and people typed the address into an NP
           block's label instead. A linked block surfaces here, right under
           the one window of record, and renders nothing when there are none. */}
       <LinkedTimeBlocksSection projectId={bp.project_id} />
       {/* ★ fix-311: Permit intake — what we are AIMING at, then what actually
           happened.

           ★ fix-325 #3 removed the divider that used to sit between the two.
           fix-311 added it to say which was which; Bobby has seen it and does
           not want it. The two labels already say it, and the SD/DD divider
           stays — that one separates two different phases, not a plan from its
           outcome.

           fix-309 put Target Submit under the DD window "where its anchor
           (dd_end) lives". That reasoning still holds mechanically — it is
           still derived from dd_end when nobody has set it by hand — but it
           belongs with the intake it targets, and this comment moves with it
           rather than being left behind contradicting the code. */}
       <OverviewSection title="Permit intake">
        <div className="flex flex-col gap-1.5">
          {/* fix-66: BP-anchored Target Submit. Still editable, still writes
              permits.target_submit — it changed sections, not nature. */}
          <TargetSubmitRow project={project} bp={targetSubmitBp} />
          {/* ★★★ fix-508 §D — THE ACQ DATE, AND THIS IS WHERE THE INLINE EDIT
              FROM SCHEDULE HEALTH LANDED.

              §D makes `Target Approval` DERIVED — the latest of the ACQ date,
              the closing date and the GO date plus six calendar months — so the
              box fix-63 put on Schedule Health was editing one of three inputs
              while displaying the answer. Two surfaces writing one number by
              different rules is exactly P-179, so the number is authored HERE,
              once, beside the other project dates, and every surface derives.

              ★★ IT IS THE SAME COLUMN (`permits.expected_issue`), the same RPC
                 and the same OCC token fix-63 used — the control moved, the
                 write path did not. And it is renamed to what it is: ACQ types
                 a date, and the target approval is computed from it.
              ★ Before this it had NO editor in Project Data at all, so removing
                the Schedule Health box without adding this would have stranded
                the column behind the New Project wizard. Checked, not assumed. */}
          <AcqDateRow project={project} bp={targetSubmitBp} />
          {/* ★ Reads the SAME `bp` this card already resolved — no second
              notion of "the primary permit" gets invented here. */}
          <IntakeAcceptedRow bp={bp} />
        </div>
       </OverviewSection>
       {/* ★★ fix-335 §7: "Under milestones, at the bottom, underneath permit
           date, we want a button that from there will take you to the draw
           schedule." Underneath Permit intake, which is the section the permit
           dates live in — so it is the last thing in the card, as drawn. */}
       {/* ★ fix-335 §7's draw-schedule button does NOT come to the modal. It
           is navigation, and it lives at the foot of the overview's Dates box
           where Bobby put it — a modal that sends you somewhere else is a modal
           you have to close first. */}
      </div>
      {pendingOverlap && (
        <OverlapPrompt
          anchorAddress={pendingOverlap.anchorAddress}
          conflictingAddresses={pendingOverlap.conflicts.map((c) => c.address)}
          conflictCount={pendingOverlap.conflicts.length}
          onCancel={() => setPendingOverlap(null)}
          onConfirm={() => void confirmPushDown()}
          pending={resolveOverlap.isPending}
        />
      )}
      {pendingNp && (
        <NpWarningPrompt
          anchorAddress={pendingNp.anchorAddress}
          daName={pendingNp.daAssigned}
          conflicts={pendingNp.conflicts.map((c) => ({
            id: c.id,
            type: c.type,
            label: c.label,
            startWeek: c.start_week,
            endWeek: c.end_week,
          }))}
          onCancel={() => setPendingNp(null)}
          onConfirm={() => void confirmNpSaveAnyway()}
          pending={setBpDdDates.isPending}
        />
      )}
    </>
  );
}

// ============================================================
// fix-66: Target Submit row — BP-anchored, inline-editable.
//
// Mirrors fix-63's AcqTargetCell (ScheduleHealthTable): own local draft +
// mutation, React 19 in-render snapshot to stay synced when the prop moves
// (BP swap OR save→invalidate→refetch), conflict toast that preserves the
// typed value. Writes target_submit via useUpdateProjectWithPermits; the
// DB trigger sets target_submit_is_manual, so we never send that flag.
// ============================================================

export function TargetSubmitRow({
  project,
  bp,
}: {
  project: Project;
  /** The project's Building Permit anchor (lowest id), or null when the
   *  project has no BP — in which case the row renders disabled "—". */
  bp: PermitWithCycles | null;
}) {
  const stored = bp?.target_submit ?? '';
  const [draft, setDraft] = useState(stored);
  // React 19 in-render setState pattern (matches AcqTargetCell). useState
  // only seeds once; track a {bpId, value} snapshot and reset the draft
  // synchronously when either moves — a BP swap (rare) or a save-success
  // refetch (same bp, fresh target_submit). bpId uses -1 as the
  // no-BP sentinel so a project gaining/losing its BP also resyncs.
  const bpId = bp?.id ?? -1;
  const [snapshot, setSnapshot] = useState<{ id: number; value: string }>({
    id: bpId,
    value: stored,
  });
  if (snapshot.id !== bpId || snapshot.value !== stored) {
    setSnapshot({ id: bpId, value: stored });
    setDraft(stored);
  }

  const mut = useUpdateProjectWithPermits();
  // Need both OCC tokens. bp null → no anchor; project.updated_at missing →
  // project query hasn't landed. Either disables the input.
  const occMissing = !bp || !bp.updated_at || !project.updated_at;

  async function commit() {
    if (!bp || !bp.updated_at || !project.updated_at) return;
    const next = draft.trim() || null;
    const current = bp.target_submit ?? null;
    if (next === current) return;
    try {
      const result = await mut.mutateAsync({
        projectId: project.id,
        projectExpectedUpdatedAt: project.updated_at,
        // Empty patch — only the permit row is written. The RPC skips the
        // project UPDATE when p_project_patch is `{}`.
        projectPatch: {},
        permitUpserts: [
          {
            id: bp.id,
            expected_updated_at: bp.updated_at,
            // RPC casts NULLIF(elem->>'target_submit','')::date, so null
            // clears the column. The bp_trg_set_target_submit_manual_flag
            // trigger sets target_submit_is_manual on this write — we do
            // NOT pass it.
            target_submit: next,
          },
        ],
        permitDeletes: [],
      });
      if (result.conflict) {
        // out_conflict_kind is 'permit' here (the BP's updated_at moved).
        // Whole edit rolled back atomically — surface the reload prompt and
        // keep `draft` as-typed so the user doesn't lose input. Same copy
        // as fix-62/63 + the ProjectSettings modal.
        pushToast(
          'This project was modified elsewhere — reload and retry.',
          'warn',
        );
        return;
      }
      // onSuccess invalidates the permit queries → fresh bp.target_submit +
      // updated_at land next render; the snapshot block resyncs the draft.
    } catch {
      // hook-level onError already toasted.
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Commit directly — blur()→onBlur is flaky in jsdom and a redundant
      // onBlur is a no-op (commit short-circuits when next === current).
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(stored);
      e.currentTarget.blur();
    }
  }

  // ★ fix-311: both states render through MilestoneDateRow — the editable one
  // and the no-BP one. The row moved into "Permit intake" and grew a box; the
  // write path underneath it is untouched.
  return bp ? (
    <MilestoneDateRow
      label="Target Submit"
      value={draft}
      onChange={setDraft}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
      disabled={occMissing || mut.isPending}
      title="Target Submit (projected submit date, anchored on the Building Permit)"
      testId="pd-target-submit"
      ariaLabel="Target Submit"
    />
  ) : (
    <MilestoneDateRow
      label="Target Submit"
      value=""
      title="No Building Permit to anchor Target Submit"
      testId="pd-target-submit-empty"
    />
  );
}


/**
 * ★★★ fix-508 §D — THE ACQ DATE, THE ONE PLACE IT IS AUTHORED.
 *
 * `permits.expected_issue` has been on screen as **`ACQ target`** since fix-506
 * and editable inline on Schedule Health since fix-63. §D turns the thing it
 * used to BE — the target approval — into a computed value: the latest of this
 * date, the project's closing date, and the GO date plus six calendar months.
 *
 * ★★★ SO THE EDITOR HAD TO MOVE RATHER THAN STAY OR VANISH. A box on Schedule
 *     Health writing `expected_issue` while the cell above it printed a `max`
 *     over three dates is [[P-179-pipeline-stage-and-draw-schedule-disagree]]
 *     in miniature: type a date earlier than the closing and the number would
 *     refuse to move. Here it is one input among the project's other dates, and
 *     what it feeds is derived everywhere it appears.
 *
 * ★★ THE WRITE PATH IS fix-63's, UNCHANGED — same column, same
 *    `useUpdateProjectWithPermits`, same two OCC tokens, same conflict copy.
 *    A moved control that also changes how it writes is two changes wearing one
 *    ticket number.
 */
function AcqDateRow({
  project,
  bp,
}: {
  project: Project;
  bp: PermitWithCycles | null;
}) {
  const stored = bp?.expected_issue ?? '';
  const [draft, setDraft] = useState(stored);
  // ★ The React 19 in-render reseed `TargetSubmitRow` above uses, for the same
  //   reason: `useState` seeds once, so a BP swap or a save→refetch would leave
  //   the draft stale. `-1` is the no-BP sentinel.
  const bpId = bp?.id ?? -1;
  const [snapshot, setSnapshot] = useState<{ id: number; value: string }>({
    id: bpId,
    value: stored,
  });
  if (snapshot.id !== bpId || snapshot.value !== stored) {
    setSnapshot({ id: bpId, value: stored });
    setDraft(stored);
  }

  const mut = useUpdateProjectWithPermits();
  const occMissing = !bp || !bp.updated_at || !project.updated_at;

  async function commit() {
    if (!bp || !bp.updated_at || !project.updated_at) return;
    const next = draft.trim() || null;
    if (next === (bp.expected_issue ?? null)) return;
    try {
      const result = await mut.mutateAsync({
        projectId: project.id,
        projectExpectedUpdatedAt: project.updated_at,
        projectPatch: {},
        permitUpserts: [
          {
            id: bp.id,
            expected_updated_at: bp.updated_at,
            // ★ The RPC casts `NULLIF(elem->>'expected_issue','')::date`, so an
            //   emptied box clears the column — and Target Approval falls back
            //   to whichever of the other two candidates is latest, which is
            //   the point of it being a `max` rather than a single field.
            expected_issue: next,
          },
        ],
        permitDeletes: [],
      });
      if (result.conflict) {
        pushToast('This project was modified elsewhere — reload and retry.', 'warn');
      }
    } catch {
      // hook-level onError already toasted.
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(stored);
      e.currentTarget.blur();
    }
  }

  return bp ? (
    <MilestoneDateRow
      label="ACQ date"
      value={draft}
      onChange={setDraft}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
      disabled={occMissing || mut.isPending}
      title="ACQ date — Acquisitions' own target. Target Approval is the latest of this, the closing date, and the GO date plus 6 months."
      testId="pd-acq-date"
      ariaLabel="ACQ date"
    />
  ) : (
    <MilestoneDateRow
      label="ACQ date"
      value=""
      title="No Building Permit to hold the ACQ date"
      testId="pd-acq-date-empty"
    />
  );
}


// ============================================================
// fix-22 Mig 3: Site editor — writes zone / lot / alley / parking_type /
// parking_stalls to projects via useUpdateProject. Previously wrote to
// permits via useUpdatePermit on the BP.
// ============================================================

export function SiteEditor({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;

  async function commit<K extends keyof Project>(
    field: K,
    next: Project[K],
    original: Project[K] | null | undefined,
    label: string,
  ) {
    if (!project.updated_at) return;
    if (next === (original ?? null)) return;
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { [field]: next } as Partial<Project>,
      fieldLabel: label,
    });
  }

  return (
    <div className="flex flex-col gap-1">
      {/* ★★★ fix-415 A3: Zone is a DROPDOWN here now. This was a free-text
          SiteTextRow, and it is the surface that produced most of the 33
          spellings of 21 zones — it writes the table DIRECTLY through
          useUpdateProject (not through either RPC), so nothing server-side was
          ever going to normalise it. */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[9px] text-dim min-w-[32px]">Zone</span>
        {/* ★ fix-417 §C: content-sized like its siblings, but wider — its
            longest option is "MIO-37-LR3", where theirs is "Yes". */}
        <ZoneSelect
          value={project.zone}
          disabled={occMissing}
          onChange={(v) => commit('zone', v || null, project.zone, 'Zone')}
          testid="pd-site-zone"
          className="w-[124px] flex-none text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
        />
      </div>
      <SiteLotRow project={project} disabled={occMissing} onCommit={commit} />
      {/* ★★★ fix-488 §A: the typed lot size, directly under the pair it
          relates to — and the row that renders `varies` when one dimension is
          blank beside a typed size. */}
      <SiteLotSizeRow
        project={project}
        disabled={occMissing}
        onCommit={(field, next, prev, label) => {
          void commit(field, next, prev, label);
        }}
      />
      {/* ★★★ fix-488 §A: TAGS, moved here from Proposal — Bobby asked for it
          beside the lot size, and it is a fact about the parcel. Read-only
          chips, exactly as they rendered before; `project_tags` is written
          elsewhere and this ticket does not change that. */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-[9px] text-dim min-w-[32px]">Tags</span>
        <div className="flex flex-wrap gap-0.5">
          {(Array.isArray(project.project_tags) ? project.project_tags : [])
            .length === 0 ? (
            <span className="text-[9px] text-dim italic">none</span>
          ) : (
            (project.project_tags as string[]).map((t) => (
              <span
                key={t}
                className="text-[8px] font-bold px-1.5 py-0.5 rounded border"
                style={{
                  background: 'var(--color-de-bg)',
                  color: 'var(--color-de)',
                  borderColor: 'var(--color-de-border)',
                }}
              >
                {t}
              </span>
            ))
          )}
        </div>
      </div>
      {/* fix-122: Number of Lots (1-20 dropdown, blank = unset). Lives in
          Site because a subdivision count is a parcel-level fact, not a
          proposal/scope fact. Users who need >20 can backfill via the
          wizard or admin tools — the CHECK only enforces >= 1. */}
      <SiteSelectRow
        label="Lots"
        value={project.num_lots != null ? String(project.num_lots) : ''}
        options={[
          '',
          ...Array.from({ length: 20 }, (_, i) => String(i + 1)),
        ]}
        disabled={occMissing}
        onCommit={(v) => {
          const next = v === '' ? null : Number(v);
          void commit(
            'num_lots',
            Number.isFinite(next as number) ? (next as number | null) : null,
            project.num_lots,
            'Number of Lots',
          );
        }}
      />
      {/* fix-122: Corner Lot tri-state. Mirrors Alley's Yes/No/blank
          pattern — blank stays a true "user hasn't picked" so historical
          projects don't get silently flipped to a false answer. */}
      <SiteSelectRow
        label="Corner"
        value={
          project.is_corner_lot === true
            ? 'Yes'
            : project.is_corner_lot === false
              ? 'No'
              : ''
        }
        options={['', 'Yes', 'No']}
        disabled={occMissing}
        onCommit={(v) => {
          const next = v === 'Yes' ? true : v === 'No' ? false : null;
          void commit(
            'is_corner_lot',
            next,
            project.is_corner_lot,
            'Corner Lot',
          );
        }}
      />
      {/* ★★★ fix-506 §C (P-161) — THE REGULAR / IRREGULAR ROW IS GONE.
          Bobby, 2026-09-08: the shape is IMPLIED BY THE DIMENSIONS and does not
          need a label of its own — width × depth both present reads as a
          rectangle; one of them plus a lot size reads as irregular. A row that
          restates what the two rows above it already say is a row somebody has
          to keep true.

          ★★ THE COLUMN STAYS AND SO DOES THE WIZARD. `projects.is_regular_shape`
          is still written at creation (fix-410's own ruling is untouched this
          ticket) and still renders in the Library's Shape column. What went is
          the OVERVIEW's restatement of it — this is a display change, not a
          data one, which is why no migration rides with it.

          ★ fix-410's note on why the blank option existed here is worth keeping
          as the record: this row had to render what a row ACTUALLY holds, so a
          NULL read as blank rather than as "Yes" — turning an absence into a
          claim about somebody's lot. That reasoning was right and is why the
          field can be dropped from the overview without a backfill. */}
      {/* fix-148: Closing Date moved to the DD Phase cell (ClosingRow) — it was
          crowding Project Site, and it fits DD Phase thematically. */}
      <SiteSelectRow
        label="Alley"
        value={project.alley ?? ''}
        options={['', 'Yes', 'No']}
        disabled={occMissing}
        onCommit={(v) => commit('alley', v || null, project.alley, 'Alley')}
      />
      {/* ★★★ fix-402 — PARKING LEFT THE SITE SECTION.
          Bobby, 2026-08-25: *"Remove [parking] from the holistic site and merge
          that under the units for proposal."* The two site-level rows that sat
          here (Parking / Stalls) are gone; the values were archived to
          _parking_site_archive_2026_08_25 and the columns cleared. Parking now
          lives on each UNIT, in the Unit Dimensions editor below. */}
    </div>
  );
}

// fix-122: date input variant of SiteTextRow. Same look-and-feel as the
// neighbouring text/select/number rows; commits on blur with empty → null.
// ★★★ fix-415: `SiteTextRow` IS DELETED, not left for a future caller.
//
// It existed for exactly one field — Zone — and Zone is a <ZoneSelect> now
// (Scope A3: dropdown-only on every surface that writes zone). A free-text row
// component sitting in the Site editor is an invitation to use it, and using it
// is what produced 33 spellings of 21 zones. The component is the affordance;
// removing the affordance is part of the fix.

function SiteSelectRow({
  label,
  value,
  options,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  options: string[];
  disabled: boolean;
  onCommit: (next: string) => void;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">{label}</span>
      <select
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        disabled={disabled}
        // ★★★ fix-417 SCOPE C — SIZED TO ITS CONTENT, NOT TO THE CARD.
        //
        // Bobby: a two-character answer with its chevron parked hundreds of
        // pixels away, using more width than the whole TEAM card. `flex-1
        // min-w-0` stretched a Yes/No control across the entire PROJECT card.
        // 90px holds "Regular Shape"'s widest option plus the chevron.
        //
        // ★★ AND THIS DOES NOT LOWER THE PROJECT CARD'S FLOOR — said plainly
        // because it would be easy to present it as part of the proportions
        // fix. These selects carried `min-w-0`, so they could already shrink to
        // nothing and never contributed to min-content. The Units row set that
        // floor, and §B is what moved it. This one is looks.
        className="w-[90px] flex-none text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid={`pd-site-${label.toLowerCase()}`}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === '' ? '—' : opt}
          </option>
        ))}
      </select>
    </div>
  );
}

// ★ fix-402: SiteNumberRow removed — Stalls was its only caller, and site
//   parking is archived and gone (see the note in the Site section).

function SiteLotRow({
  project,
  disabled,
  onCommit,
}: {
  project: Project;
  disabled: boolean;
  onCommit: <K extends keyof Project>(
    field: K,
    next: Project[K],
    original: Project[K] | null | undefined,
    label: string,
  ) => Promise<void>;
}) {
  const [wDraft, setWDraft] = useState<string>(
    project.lot_width != null ? String(project.lot_width) : '',
  );
  const [dDraft, setDDraft] = useState<string>(
    project.lot_depth != null ? String(project.lot_depth) : '',
  );
  // ★★★ fix-415 B2 — ROUNDED ON COMMIT, at the write path that actually runs.
  //
  // This row writes `projects.lot_width` / `lot_depth` DIRECTLY to the table
  // through useUpdateProject — not through bp_update_project_with_permits,
  // which is the trap fix-410 documented (is_corner_lot is absent from that
  // RPC's SET list entirely). Rounding server-side in the RPC would therefore
  // have left this surface, the one people actually use, still storing 100.47.
  //
  // ★ `parse` is called from onBlur, never from onChange, so a half-typed
  //   "100." is never rounded out from under the user.
  const parse = (s: string): number | null => {
    const trimmed = s.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? roundLotForStorage(n) : null;
  };
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">Lot</span>
      <input
        type="number"
        min={0}
        value={wDraft}
        placeholder="W"
        onChange={(e) => setWDraft(e.target.value)}
        onBlur={() =>
          onCommit('lot_width', parse(wDraft), project.lot_width, 'Lot Width')
        }
        disabled={disabled}
        className="w-10 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 text-center disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="pd-site-lot-w"
      />
      <span className="text-[9px] text-dim">×</span>
      <input
        type="number"
        min={0}
        value={dDraft}
        placeholder="D"
        onChange={(e) => setDDraft(e.target.value)}
        onBlur={() =>
          onCommit('lot_depth', parse(dDraft), project.lot_depth, 'Lot Depth')
        }
        disabled={disabled}
        className="w-10 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 text-center disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="pd-site-lot-d"
      />
      <span className="text-[9px] text-dim">ft</span>
    </div>
  );
}

/**
 * ★★★ fix-488 §A (P-142) — LOT SIZE, AND WHAT "VARIES" LOOKS LIKE.
 *
 * Bobby, 2026-09-02: *"if I put width 100 and lot size 10,000 and leave depth
 * blank, that's because the depth is irregular… instead of Target it would say
 * Varies."*
 *
 * ★★ AN INPUT AND A READING, ON ONE LINE. The box is where the number is typed;
 * the text beside it is what `lotSizeView` makes of the three fields together —
 * including the word `varies` in place of the dimension nobody could give, and
 * the `~` that marks a size this app worked out rather than one somebody
 * measured.
 *
 * ★★★ IT IS AN INTEGER PARSE, NOT `roundLotForStorage`. That helper is named
 * for the LOT DIMENSION on purpose (lib/lotDimensions' header: "so that a call
 * site rounding a unit reads obviously wrong"), and square feet are a different
 * quantity from feet. Same arithmetic, different reason, so it is written here
 * rather than borrowed.
 */
function SiteLotSizeRow({
  project,
  disabled,
  onCommit,
}: {
  project: Project;
  disabled: boolean;
  onCommit: (
    field: 'lot_size_sf',
    next: number | null,
    prev: number | null | undefined,
    label: string,
  ) => void;
}) {
  const [draft, setDraft] = useState(
    project.lot_size_sf != null ? String(project.lot_size_sf) : '',
  );
  const dirtyRef = useRef(false);
  // ★ The fix-73/98 dirty-flag pattern, like SiteLotRow above: follow the row
  //   unless somebody is mid-edit.
  useEffect(() => {
    if (dirtyRef.current) return;
    setDraft(project.lot_size_sf != null ? String(project.lot_size_sf) : '');
  }, [project.lot_size_sf]);

  const view = lotSizeView(project.lot_width, project.lot_depth, project.lot_size_sf);

  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[9px] text-dim min-w-[32px]">Lot size</span>
      <input
        type="number"
        min={0}
        // ★ fix-511 §C: the column's real ceiling, so the browser's own spinner
        //   and validity state agree with the check below. It does not PREVENT
        //   the value — `type="number"` accepts `1.015e+68` regardless — which
        //   is exactly why the check below exists as well.
        max={LOT_SIZE_SF_MAX}
        step={1}
        value={draft}
        placeholder="—"
        onChange={(e) => {
          dirtyRef.current = true;
          setDraft(e.target.value);
        }}
        onBlur={() => {
          const parsed = parseLotSizeSf(draft);
          if (!parsed.ok) {
            // ★★★ fix-511 §C (P-198): REFUSED HERE, so the person reads a
            // sentence about lot sizes rather than Postgres's about integers —
            // and the box goes back to what is stored, because leaving the
            // rejected number on screen is how Cam lost an edit and never knew
            // which of his fields the database had objected to.
            pushToast(parsed.message, 'warn');
            setDraft(project.lot_size_sf != null ? String(project.lot_size_sf) : '');
            dirtyRef.current = false;
            return;
          }
          onCommit('lot_size_sf', parsed.value, project.lot_size_sf, 'Lot Size');
          dirtyRef.current = false;
        }}
        disabled={disabled}
        className="w-14 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 text-center disabled:opacity-50"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="pd-site-lot-size"
      />
      <span className="text-[9px] text-dim">sf</span>
      {/* ★★ THE DERIVED READING, and it is NOT written back. The box stays
          empty while this shows the product — which is the whole distinction
          the column exists for. */}
      {view.sizeDerived && view.sizeText !== null && (
        <span
          className="text-[9px] text-dim italic"
          title="Width × depth. Nobody has typed a lot size — type one to record an irregular parcel."
          data-testid="pd-site-lot-size-derived"
        >
          ~{view.sizeText}
        </span>
      )}
      {/* ★ THE IRREGULAR NOTE — quiet, and never an error or an auto-correct.
          Both numbers are things a person typed. */}
      {view.irregular && (
        <span
          className="text-[9px] italic"
          style={{ color: 'var(--color-co)' }}
          title="The typed size is more than 5% from width × depth."
          data-testid="pd-site-lot-irregular"
        >
          irregular lot
        </span>
      )}
    </div>
  );
}


// ============================================================
// fix-22 Mig 3: Unit Dimensions editor — unit_types moved permits →
// projects. Writes via useUpdateProject.
// fix-206: parseUnitTypes + resolveUnitTypesForSave now live in
// lib/unitTypeNaming so the Library matrix shares the identical read/write
// shape (one store, two editable views).
// ============================================================

export function UnitDimensions({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;
  const types = parseUnitTypes(project.unit_types);
  // fix-205: the project's product types drive the per-row Label (auto when
  // there's exactly one type; a dropdown when several).
  const productTypes = Array.isArray(project.product_types)
    ? project.product_types.filter(
        (t): t is string => typeof t === 'string' && t.trim().length > 0,
      )
    : [];

  // fix-99: OCC auto-recovery moved into useUpdateProject's mutationFn
  // (silent first attempt → refetch → retry once on stale-token OCC,
  // toast only on a real concurrent edit). writeTypes is back to a
  // single mutateAsync call. The trailing .catch swallows any error
  // (the hook's onError already surfaced the right toast) so the
  // `void writeTypes(...)` callers below don't trip an
  // unhandled-promise-rejection — same pattern as DateCell.tryCommit.
  async function writeTypes(next: UnitType[]) {
    if (!project.updated_at) return;
    // fix-205/206: resolve "unnamed" rows on save — a blank label + a single
    // product type persists as that type. Shared helper so a Library save and a
    // Project Overview save produce identical rows.
    const resolved = resolveUnitTypesForSave(next, productTypes);
    await updateMutation
      .mutateAsync({
        projectId: project.id,
        expectedUpdatedAt: project.updated_at,
        patch: { unit_types: resolved },
        fieldLabel: 'Unit Dimensions',
      })
      .catch(() => {
        /* hook's onError already pushed the user-visible message */
      });
  }

  // Compact mode: empty or single unnamed entry
  const isCompact =
    types.length <= 1 && (types.length === 0 || !types[0]?.label);
  if (isCompact) {
    return (
      <UnitDimensionsCompact
        current={types[0]}
        disabled={occMissing}
        onSet={(field, val) => {
          const base = types[0] ?? { label: '', width_ft: null, depth_ft: null, qty: 1 };
          const next: UnitType = { ...base, [field]: val };
          void writeTypes([next]);
        }}
        onExpand={() => {
          // fix-81: route through nextUnitTypeLabel so the seed letters
          // come from the same pool that + Add uses downstream.
          const first: UnitType =
            types.length === 0
              ? {
                  label: nextUnitTypeLabel([]),
                  width_ft: null,
                  depth_ft: null,
                  qty: 1,
                  stories: null,
                }
              : { ...types[0], label: types[0].label || nextUnitTypeLabel([]) };
          const second: UnitType = {
            label: nextUnitTypeLabel([first.label]),
            width_ft: null,
            depth_ft: null,
            qty: 1,
            stories: null,
          };
          void writeTypes([first, second]);
        }}
      />
    );
  }

  return (
    <UnitDimensionsExpanded
      types={types}
      productTypes={productTypes}
      disabled={occMissing}
      onUpdate={(idx, field, val) => {
        const next = types.map((t, i) =>
          i === idx ? { ...t, [field]: val } : t,
        );
        void writeTypes(next);
      }}
      onRemove={(idx) => {
        const next = types.filter((_, i) => i !== idx);
        void writeTypes(next);
      }}
      onAdd={() => {
        const next = [
          ...types,
          {
            label: nextUnitTypeLabel(types.map((t) => t.label)),
            width_ft: null,
            depth_ft: null,
            qty: 1,
            stories: null,
          },
        ];
        void writeTypes(next);
      }}
    />
  );
}

function UnitDimensionsCompact({
  current,
  disabled,
  onSet,
  onExpand,
}: {
  current: UnitType | undefined;
  disabled: boolean;
  onSet: (field: 'width_ft' | 'depth_ft', val: number) => void;
  onExpand: () => void;
}) {
  const [w, setW] = useState<string>(
    current?.width_ft != null ? String(current.width_ft) : '',
  );
  const [d, setD] = useState<string>(
    current?.depth_ft != null ? String(current.depth_ft) : '',
  );
  // fix-98: mirror fix-73's DateCell pattern. useState(prop) anchors to
  // the first render's value; without re-syncing, an OCC rollback or any
  // subsequent prop refresh leaves these inputs showing stale typed
  // values. Sync the local state from the prop on every change EXCEPT
  // while the user has a live unsaved edit (dirty=true). The dirty flag
  // clears on blur after the parent's writeTypes resolves the new value
  // through the prop, so the next prop refresh flows through.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setW(current?.width_ft != null ? String(current.width_ft) : '');
    setD(current?.depth_ft != null ? String(current.depth_ft) : '');
  }, [current?.width_ft, current?.depth_ft]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={w}
          placeholder="W"
          onChange={(e) => {
            dirtyRef.current = true;
            setW(e.target.value);
          }}
          onBlur={() => {
            onSet('width_ft', Number(w) || 0);
            dirtyRef.current = false;
          }}
          disabled={disabled}
          className="w-9 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent text-center disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="pd-units-compact-w"
        />
        <span className="text-[9px] text-dim">×</span>
        <input
          type="number"
          min={0}
          value={d}
          placeholder="D"
          onChange={(e) => {
            dirtyRef.current = true;
            setD(e.target.value);
          }}
          onBlur={() => {
            onSet('depth_ft', Number(d) || 0);
            dirtyRef.current = false;
          }}
          disabled={disabled}
          className="w-9 text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent text-center disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="pd-units-compact-d"
        />
        <span className="text-[9px] text-dim">ft</span>
      </div>
      <button
        type="button"
        onClick={onExpand}
        disabled={disabled}
        className="text-[9px] px-1.5 py-0.5 rounded border border-dashed bg-transparent text-dim self-start cursor-pointer disabled:opacity-50"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="pd-units-expand"
      >
        + different sizes
      </button>
    </div>
  );
}

function UnitDimensionsExpanded({
  types,
  productTypes,
  disabled,
  onUpdate,
  onRemove,
  onAdd,
}: {
  types: UnitType[];
  productTypes: string[];
  disabled: boolean;
  // ★ fix-402: boolean joins the value union — roof_deck is yes/no/not-recorded.
  onUpdate: (
    idx: number,
    field: keyof UnitType,
    val: string | number | boolean | null,
  ) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  // ★★ fix-449 §C: the CANONICAL product-type registry, read ONCE here rather
  //    than per row. "Off list" has to mean "the app offers this nowhere" — a
  //    project whose own product_types are [Detached] would otherwise mark a
  //    unit labelled Attached as off-list, and Attached is a real type.
  //
  // ★ fix-486 (P-143) re-worded this with the new vocabulary rather than
  //   leaving the old one in the explanation. The example IS the rule here, so
  //   an example in a vocabulary the app no longer offers reads as a live case.
  const registryTypes = productTypeRegistry(useAppConfig().map);

  // ★★★ fix-422 SCOPE 2 — A MATRIX: ONE HEADER ROW, ONE ROW PER UNIT TYPE.
  //
  // Bobby, 2026-08-27: *"When you have more than two different unit dimensions,
  // the page gets way too vertically long, and it stretches out milestones,
  // team, design plan of record, builder/owner… go back to horizontal."*
  //
  // ★★★ WHY fix-418's VERTICAL FORM HAD TO GO, IN ONE SENTENCE: it solved a
  // WIDTH problem by spending HEIGHT, and height is not this card's to spend.
  // The five cards are `alignItems: stretch` (fix-309 #55), so every unit type
  // added ~64px to Milestones, Team, Plan of Record and Builder/Owner as well.
  // At the six-type project in prod that is ~380px of blank space in four
  // cards. A matrix costs ~14px a type and nothing to anybody else.
  //
  // ★★ THE HEADER IS DECLARED ONCE AND SO IS EVERY ROW — fix-412's ruling,
  // which never stopped being right. Both render from `UNIT_MATRIX_GRID`, so a
  // header cannot sit over the wrong control; that was the defect fix-412 was
  // raised for and it is structurally impossible here.
  return (
    <div className="flex flex-col gap-1" data-testid="pd-unit-matrix">
      <div
        className="grid items-center"
        style={{ gridTemplateColumns: UNIT_MATRIX_GRID }}
        data-testid="pd-unit-header"
      >
        {UNIT_ROW_COLUMNS.map((c, i) => (
          <Fragment key={c.key}>
            {c.header ? (
              <UnitHeaderCell column={c} />
            ) : (
              <span aria-hidden="true" />
            )}
            {i < UNIT_ROW_COLUMNS.length - 1 && <span aria-hidden="true" />}
          </Fragment>
        ))}
      </div>
      {types.map((ut, i) => (
        <UnitRow
          registryTypes={registryTypes}
          key={i}
          row={ut}
          productTypes={productTypes}
          disabled={disabled}
          onChange={(field, val) => onUpdate(i, field, val)}
          onRemove={() => onRemove(i)}
        />
      ))}
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="text-[9px] px-1.5 py-0.5 rounded border border-dashed bg-transparent text-dim self-start mt-0.5 cursor-pointer disabled:opacity-50"
        style={{ borderColor: 'var(--color-border)' }}
        data-testid="pd-units-add"
      >
        + Add type
      </button>
    </div>
  );
}

/**
 * ★★★ fix-422 SCOPE 6 — ONE HEADER CELL, REACHABLE BY HOVER **AND** BY TAB.
 *
 * Bobby: *"If someone hovered their cursor over QTY, or STY, or P, or S,
 * there'd be a summary of what that is."*
 *
 * ★★★ A `title` ALONE WOULD HAVE BEEN A MOUSE-ONLY ANSWER, and this row is now
 * eight abbreviations — `P`, `#`, `RD`, `Sty` mean nothing on their own. A
 * tooltip that only fires on hover leaves the entire matrix unreadable to
 * anybody tabbing the form and to anybody on a tablet, which is a worse state
 * than the spelled-out headers fix-412 shipped.
 *
 * ★★ SO THE HEADER IS A `<button>`: focusable in the natural tab order, with
 * `title` for the pointer and `aria-describedby`-grade text as its accessible
 * description for everything else. `type="button"` because it is inside a form
 * region and must never submit; it does nothing on click by design — the
 * affordance IS the description.
 */
function UnitHeaderCell({ column }: { column: UnitRowColumn }) {
  return (
    <button
      type="button"
      title={column.tooltip}
      aria-label={`${column.header}: ${column.tooltip}`}
      className="text-[8px] font-extrabold uppercase tracking-wide text-dim text-center truncate bg-transparent border-0 p-0 cursor-help focus:outline-none focus-visible:ring-1 focus-visible:ring-de rounded"
      data-testid={`pd-unit-h-${column.key}`}
      data-tooltip={column.tooltip}
    >
      {column.header}
    </button>
  );
}

function UnitRow({
  row,
  productTypes,
  registryTypes,
  disabled,
  onChange,
  onRemove,
}: {
  row: UnitType;
  productTypes: string[];
  /** ★ fix-449 §C: the canonical registry, for the off-list mark. */
  registryTypes: string[];
  disabled: boolean;
  onChange: (field: keyof UnitType, val: string | number | boolean | null) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const [w, setW] = useState(row.width_ft != null ? String(row.width_ft) : '');
  const [d, setD] = useState(row.depth_ft != null ? String(row.depth_ft) : '');
  const [qty, setQty] = useState(String(row.qty || 1));
  const [stories, setStories] = useState(
    row.stories != null ? String(row.stories) : '',
  );
  // ★ fix-402: buffered like every other numeric cell here (fix-73/98).
  const [stalls, setStalls] = useState(
    row.parking_stalls != null ? String(row.parking_stalls) : '',
  );
  // fix-98: dirty-flag prop sync (fix-73 pattern). UnitRow is keyed by array
  // index in the parent, so React reuses the same instance across re-renders
  // when the underlying row data changes (after a save). The dirty flag
  // preserves the user's live edit; cleared on blur so the next prop arrival
  // flows through.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setLabel(row.label);
    setW(row.width_ft != null ? String(row.width_ft) : '');
    setD(row.depth_ft != null ? String(row.depth_ft) : '');
    setQty(String(row.qty || 1));
    setStories(row.stories != null ? String(row.stories) : '');
    setStalls(row.parking_stalls != null ? String(row.parking_stalls) : '');
    // ★ fix-488 §B: no `size_sf` state here — the column was measured and
    //   reverted (see the note where the input would have been).
    //   ★ `row.parking_stalls` is seeded in the body and MISSING from these
    //     deps — a pre-existing gap (fix-402). Left as found, and named so
    //     whoever fixes it also fixes the Library's copy of this row, which
    //     does list it.
  }, [row.label, row.width_ft, row.depth_ft, row.qty, row.stories]);

  // ★ fix-422: the matrix cell. 9px, centred, one baseline for every column so
  //   a number and a letter code sit on the same line.
  const cellClass =
    'w-full h-[16px] text-[9px] font-semibold text-text text-center border border-border rounded bg-bg px-0 outline-none focus:border-de focus:ring-1 focus:ring-de disabled:opacity-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  // fix-205 → fix-209 → fix-212 → fix-232: the label is DROPDOWN-ONLY and
  // product-type-driven. With no product types the stored label renders
  // READ-ONLY rather than blanked.
  const hasProductTypes = productTypes.length >= 1;
  const selectValue = resolveUnitLabel(label, productTypes);
  const offListLabel = isOffListUnitLabel(selectValue, registryTypes);
  // ★★★ fix-486 §C (P-143) — "NEEDS A TYPE" IS NOT THE SAME AS "OFF-LIST".
  //
  // Eleven prod rows carry the wizard's seed letters (`Type A`…`Type D`) — the
  // intake habit is to add rows first and name them later, so those labels were
  // never a type, they are a question nobody answered. The remap deliberately
  // left them (a rule that guessed would have declared eleven unanswered rows
  // answered), and this is how the row says so.
  //
  // ★★ THE TWO MARKS ARE DIFFERENT STATES AND MUST STAY DIFFERENT. An off-list
  //    label is a word somebody CHOSE; telling that person they had failed to
  //    answer would be wrong, and telling somebody staring at `Type C` that
  //    their deliberate choice is merely "not in the list" is wrong the other
  //    way. Same slot, same size, different word.
  const needsType = unitLabelNeedsType(selectValue);
  // ★★★ fix-486 §D (P-143) — THREE THINGS LEFT THIS ROW WITH `work_scope`.
  //
  //   fix-412 §B5  a confirmed No-work unit greyed out its drawn detail
  //   fix-418 §B   the control appeared only on a `Remodel` label
  //   fix-422 §7   it rendered as a chip under the row, not a matrix cell
  //
  // ★★★ ALL THREE WERE ABOUT A QUESTION THE TYPE NOW ANSWERS. Bobby,
  //     2026-09-03: *one way to say remodel — the type.* fix-418's own gate is
  //     the tell: the control only ever showed on a row already LABELLED
  //     Remodel, which is to say it asked whether a remodel was a remodel.
  //
  // ★★ AND NOTHING WAS LOST. Measured on prod 2026-09-03: 245 unit rows, 95
  //    carrying the key at all, **zero non-null**. The suppression fix-412 §B5
  //    built therefore never suppressed anything — it fires on
  //    `work_scope === 'none'`, and no row has ever held it.
  const off = disabled;

  // ★★★ fix-486 §D — THE `pd-unit-row-group` WRAPPER GOES WITH THE CHIP.
  //
  // fix-422 Scope 7 added it so the Work chip could sit UNDER its own row and
  // still be associated with it. There is no chip, so the wrapper wrapped one
  // element — and fix-418's lesson is that a pass-through div is not free: a
  // wrapper between a flex parent and its children swallows the height
  // distribution the parent is trying to do. The row is the units band's own
  // child again, exactly as it was before Scope 7.
  return (
    <div
      className="grid items-center"
      style={{ gridTemplateColumns: UNIT_MATRIX_GRID }}
      data-testid="pd-unit-row"
    >
      {/* Type */}
      {hasProductTypes ? (
        <select
          value={selectValue}
          onChange={(e) => {
            const v = e.target.value;
            // ★★★ fix-449 §C1: an off-list label is a DELIBERATE act.
            if (v === OTHER_UNIT_LABEL) {
              const typed = window.prompt('Unit type label', label);
              if (typed === null) return;
              const next = typed.trim();
              dirtyRef.current = true;
              setLabel(next);
              onChange('label', next);
              dirtyRef.current = false;
              return;
            }
            dirtyRef.current = true;
            setLabel(v);
            onChange('label', v);
            dirtyRef.current = false;
          }}
          disabled={disabled}
          // ★ SCOPE 8: a label longer than the column truncates, and the FULL
          //   text is on hover. 9 of 235 prod rows are off-registry free text
          //   — "SFR w/ Accessory Units" is 22 characters — and sizing the
          //   column for those nine would tax every other project.
          title={label || undefined}
          className={`${cellClass} text-left px-0.5 truncate`}
          data-testid="pd-unit-label-select"
        >
          <option value="">Pick type…</option>
          {/* ★★★ fix-449 §C1: the stored value is IN the list when it is
              off-list, so this control shows what it holds rather than
              blanking it or substituting the project's lone type. */}
          {unitLabelOptions(productTypes, selectValue).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value={OTHER_UNIT_LABEL}>Other…</option>
        </select>
      ) : (
        <span
          className={`${cellClass} text-left px-0.5 truncate leading-[16px] ${label ? '' : 'text-dim'}`}
          title={
            label
              ? `${label} — add a product type to change`
              : 'Add a product type to label units'
          }
          data-testid="pd-unit-label-readonly"
        >
          {label || NOT_RECORDED}
        </span>
      )}
      {/* ★★ fix-449 §C3: the mark rides in the SPACER that already sits
          between Type and W — so it costs the matrix no width at all. The
          column keeps fix-422's measured size. */}
      <span aria-hidden={offListLabel || needsType ? undefined : 'true'}>
        {needsType ? (
          <span
            className="text-[8px] px-1 rounded font-bold uppercase"
            style={{ background: 'var(--color-co-bg)', color: 'var(--color-co)' }}
            title="Needs a type — this is the wizard's placeholder, not a unit type. Pick one from the list."
            data-testid="pd-unit-label-needs-type"
          >
            ?
          </span>
        ) : (
          offListLabel && (
            <span
              className="text-[8px] px-1 rounded font-bold uppercase"
              style={{ background: 'var(--color-s2)', color: 'var(--color-muted)' }}
              title="Not in the product-type list — kept exactly as stored"
              data-testid="pd-unit-label-offlist"
            >
              !
            </span>
          )
        )}
      </span>
      {/* W */}
      <input
        type="number"
        min={0}
        step="0.5"
        value={w}
        placeholder={NOT_RECORDED}
        onChange={(e) => {
          dirtyRef.current = true;
          setW(e.target.value);
        }}
        onBlur={() => {
          onChange('width_ft', w === '' ? null : Number(w) || 0);
          dirtyRef.current = false;
        }}
        disabled={off}
        className={cellClass}
        aria-label={unitFieldTooltip('width_ft')}
        data-testid="pd-unit-w"
      />
      {/* ★ SCOPE 3: the tighter W–D gap. No `×`, so the pair has to group by
          proximity instead. */}
      <span aria-hidden="true" />
      {/* D */}
      <input
        type="number"
        min={0}
        step="0.5"
        value={d}
        placeholder={NOT_RECORDED}
        onChange={(e) => {
          dirtyRef.current = true;
          setD(e.target.value);
        }}
        onBlur={() => {
          onChange('depth_ft', d === '' ? null : Number(d) || 0);
          dirtyRef.current = false;
        }}
        disabled={off}
        className={cellClass}
        aria-label={unitFieldTooltip('depth_ft')}
        data-testid="pd-unit-d"
      />
      <span aria-hidden="true" />
      {/* ★★★ fix-488 §B — THE UNIT SIZE INPUT IS **NOT** HERE, AND THE
          NUMBER IS WHY.

          It was built as a ninth column, measured, and reverted: the matrix
          goes 274px → 312px, which is 76px on the overview row minimum, and
          fix-423 §D's guarantee is that below the wrap point BOTH LINES FIT AT
          1280. They would not — the wider line needs 736px against 710
          available, i.e. a horizontal scrollbar on the overview, the exact
          defect fix-417 exists to prevent. The two-line layout has 12px of
          slack and the smallest honest cell plus its gap is 30px.

          ★★ THE FIELD ITSELF SHIPPED. `unit_types[].size_sf` is typed in the
             Library's unit table and in the wizard's unit editor, and searched
             by the Library's Unit Size ± filter — which is what Bobby asked
             for: *"something we actually type in… so we can search for units
             that fit that criteria."* What is missing is only this DISPLAY.
             See lib/unitRowLayout for the full arithmetic and the fix-488 PR
             for the options put to him. */}
      {/* Qty */}
      <input
        type="number"
        min={1}
        value={qty}
        placeholder={NOT_RECORDED}
        onChange={(e) => {
          dirtyRef.current = true;
          setQty(e.target.value);
        }}
        onBlur={() => {
          onChange('qty', Number(qty) || 1);
          dirtyRef.current = false;
        }}
        disabled={off}
        className={cellClass}
        aria-label={unitFieldTooltip('qty')}
        data-testid="pd-unit-qty"
      />
      <span aria-hidden="true" />
      {/* Sty */}
      <input
        type="number"
        min={1}
        value={stories}
        placeholder={NOT_RECORDED}
        onChange={(e) => {
          dirtyRef.current = true;
          setStories(e.target.value);
        }}
        onBlur={() => {
          const n =
            stories === '' ? null : Math.max(1, Number(stories) || 0) || null;
          onChange('stories', n);
          dirtyRef.current = false;
        }}
        disabled={off}
        className={cellClass}
        aria-label={unitFieldTooltip('stories')}
        data-testid="pd-unit-stories"
      />
      <span aria-hidden="true" />
      {/* P — the cell is a letter, the menu is words. */}
      <ParkingKindSelect
        value={row.parking_kind}
        disabled={off}
        onChange={(v) => onChange('parking_kind', v)}
        testid="pd-unit-parking-kind"
        code
      />
      <span aria-hidden="true" />
      {/* # */}
      <StallsInput
        value={stalls}
        disabled={off}
        compact
        onChange={(raw) => {
          dirtyRef.current = true;
          setStalls(raw);
        }}
        onBlur={() => {
          onChange('parking_stalls', parseStalls(stalls));
          dirtyRef.current = false;
        }}
        testid="pd-unit-stalls"
      />
      <span aria-hidden="true" />
      {/* RD */}
      <RoofDeckSelect
        value={row.roof_deck}
        disabled={off}
        onChange={(v) => onChange('roof_deck', v)}
        testid="pd-unit-roof-deck"
        code
      />
      <span aria-hidden="true" />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="bg-transparent border-0 text-dim cursor-pointer text-[12px] leading-none p-0 disabled:opacity-50"
        title="Remove type"
        data-testid="pd-unit-remove"
      >
        ×
      </button>
    </div>
  );
}
