import { useEffect, useMemo, useRef, useState } from 'react';
import { unitLabelParts } from '../../lib/unitLabels';
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
// ★★★ fix-572 §C — `lib/unitRowLayout` IS RETIRED. It declared a fixed-width
//     GRID for a matrix this tab no longer renders; the new form is one
//     labelled block per type. See lib/unitConfigFields for why the split the
//     brief called "the whole risk" had already happened.
import {
  unitFieldHint,
  unitFieldLabel,
  type UnitConfigField,
} from '../../lib/unitConfigFields';
import {
  ParkingKindSelect,
  RoofDeckSelect,
  StoriesSelect,
} from '../shared/UnitParkingInputs';
import {
  NOT_RECORDED,
  parkingOptions,
  roofDeckOptions,
  storiesOptions,
} from '../../lib/unitVocabulary';
import { unitLabelNeedsType as isPlaceholderUnitLabel } from '../../lib/unitTypeVocabulary';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useSavedFlash } from '../../hooks/useSavedFlash';
import {
  nextUnitTypeLabel,
  OTHER_UNIT_LABEL,
  parseUnitTypes,
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
import { useAppConfig, readAppConfigStringArray } from '../../hooks/useAppConfig';
import { pushToast } from '../../stores/toastStore';
import OverlapPrompt from '../OverlapPrompt';
import NpWarningPrompt from '../NpWarningPrompt';
import type { PermitWithCycles, Project, UnitType } from '../../lib/database.types';
import { shouldShowLotsField, ADD_LOTS_LABEL } from '../../lib/lotsVisibility';
import { useMayWriteProject } from '../../hooks/useMayWriteProject';

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
  // ★★★ fix-549 §B: the same server answer the write path asks. A field that
  //     will be refused must not accept typing first.
  const mayWrite549 = useMayWriteProject(project.id);
  const locked = occMissing || !mayWrite549;
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
      disabled={locked}
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
          title="The GO date is set in Project Details → Dates"
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
          {/* ★★★ fix-514 §G (P-221/P-207) — `AcqDateRow` IS GONE FROM HERE.
              fix-508 §D put it on this tab because Schedule Health could not
              keep an editable box over a derived column. That was right, and it
              was still BUILDING-PERMIT ONLY: `permitUpserts` carried `bp.id`
              and nothing else, which is why fix-513 §E refused to fold
              `PermitDetailV2`'s box into it and 153 non-BP permits on 105
              projects had exactly one editor in the whole app.
              ★★★ THE PERMITS TAB EDITS IT PER PERMIT NOW — including the
                  Building Permit's — so this row is not a smaller version of
                  that control, it is a SECOND WRITER of the same column, which
                  is the thing P-207 exists to close. One writer, and a test
                  that reads ONE rather than two. */}
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


// ============================================================

export function SiteEditor({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  // ══════════════════════════════════════════════════════════════
  // ★★★ fix-549 §B (P-255) — ASK BEFORE RENDERING AN INPUT
  // ══════════════════════════════════════════════════════════════
  //
  // Nine refusals in four minutes, one person, six of them on Lot Size — the
  // row immediately below. The product let him type and then threw it away.
  //
  // ★★★ It asks `bp_may_write_project`, **the same function the RLS policy and
  //     the write RPC ask**, rather than re-deriving the rule here. Two writers
  //     of one rule is the most repeated defect in this Brain (P-207, P-179,
  //     P-244, fix-531, fix-541 §A) and this is exactly where a fifth would go.
  //
  // ★★ READ-ONLY, not disabled: a greyed box still reads as a box you could
  //    use if you tried harder. The rows below render their value as text.
  const mayWrite = useMayWriteProject(project.id);
  const occMissing = !project.updated_at;
  const locked = occMissing || !mayWrite;
  // ★★ fix-541 (P-236): the route back. Local to the visit — once a real
  //    count is committed the predicate keeps the field visible on its own,
  //    so there is nothing to persist.
  const [lotsRevealed, setLotsRevealed] = useState(false);

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
          disabled={locked}
          onChange={(v) => commit('zone', v || null, project.zone, 'Zone')}
          testid="pd-site-zone"
          className="w-[124px] flex-none text-[10px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
        />
      </div>
      <SiteLotRow project={project} disabled={locked} onCommit={commit} />
      {/* ★★★ fix-488 §A: the typed lot size, directly under the pair it
          relates to — and the row that renders `varies` when one dimension is
          blank beside a typed size. */}
      <SiteLotSizeRow
        project={project}
        disabled={locked}
        onCommit={(field, next, prev, label) => {
          void commit(field, next, prev, label);
        }}
      />
      {/* ★★★ fix-488 §A: TAGS, moved here from Proposal — Bobby asked for it
          beside the lot size, and it is a fact about the parcel.
          ★★★ fix-514 §F (P-216): and EDITABLE now. */}
      <ProjectTagsEditor project={project} />
      {/* fix-122: Number of Lots (1-20 dropdown, blank = unset). Lives in
          Site because a subdivision count is a parcel-level fact, not a
          proposal/scope fact. Users who need >20 can backfill via the
          wizard or admin tools — the CHECK only enforces >= 1.

          ═══════════════════════════════════════════════════════════
          ★★★ fix-541 (P-236) — SHOWN ONLY WHEN IT IS NOT 1
          ═══════════════════════════════════════════════════════════

          202 of 220 projects answer 1 and stop carrying a box whose answer is
          never in doubt. The 15 that hold more stay visible AND editable, and
          the 3 NULLs stay visible too — **a NULL is not a 1**, and hiding it
          would render "nobody recorded an answer" as agreement.

          ★★ The route back is below: hidden is not gone. */}
      {(shouldShowLotsField(project.num_lots) || lotsRevealed) && (
      <SiteSelectRow
        label="Lots"
        value={project.num_lots != null ? String(project.num_lots) : ''}
        options={[
          '',
          ...Array.from({ length: 20 }, (_, i) => String(i + 1)),
        ]}
        disabled={locked}
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
      )}
      {/* ★★ fix-541 (P-236) — THE ROUTE BACK, so hiding is not a one-way door.
          A project entered as 1 that turns out to be 2 needs somewhere to go.
          It appears only while the field is hidden, and disappears for good
          once a real count is committed. */}
      {!shouldShowLotsField(project.num_lots) && !lotsRevealed && (
        <button
          type="button"
          onClick={() => setLotsRevealed(true)}
          disabled={locked}
          className="text-[10px] text-dim hover:text-text underline underline-offset-2 self-start disabled:opacity-40"
          data-testid="site-add-lots"
        >
          {ADD_LOTS_LABEL}
        </button>
      )}
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
        disabled={locked}
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
        disabled={locked}
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

// ===========================================================================
// ★★★ fix-514 §E (P-215) — A UNIT'S SQUARE FOOTAGE BECOMES EDITABLE
// ===========================================================================
// ★★★ fix-572 §C — `UnitSizeEditor` AND `UnitSizeRow` ARE DELETED
// ===========================================================================
//
// fix-514 §E gave `unit_types[].size_sf` a list of its own, BELOW the matrix,
// for one reason and it was arithmetic: a ninth matrix column cost 38px of
// matrix, 76px of OVERVIEW row minimum, and broke fix-423 §D's guarantee that
// both wrapped lines fit at 1280 (fix-488 §B built it, measured it, reverted).
//
// ★★★ EVERY NUMBER IN THAT ARGUMENT IS ABOUT THE OVERVIEW ROW, and this editor
//     is inside a 760px modal that owes the overview row nothing. So the field
//     folds into each unit's block beside the two dimensions it is read
//     against, and a second list asking about one unit from a different place
//     stops existing — which is the shape §C is removing everywhere.
//
// ⚠️ THE OVERVIEW MATRIX STILL DOES NOT SHOW UNIT SIZE. fix-488's ruling is
//    unchanged on the surface it was made about; this is a scoped exception,
//    not a reversal.

export function ProjectTagsEditor({ project }: { project: Project }) {
  // ★★★ fix-549 §B: the same server answer the write path asks. A field that
  //     will be refused must not accept typing first.
  const mayWrite549 = useMayWriteProject(project.id);
  const updateMutation = useUpdateProject();
  const appConfigQ = useAppConfig();
  const options = readAppConfigStringArray(appConfigQ.map, 'projectTagOptions');
  const chosen = Array.isArray(project.project_tags)
    ? (project.project_tags as string[]).filter((t) => typeof t === 'string')
    : [];
  const occMissing = !project.updated_at;
  const locked = occMissing || !mayWrite549;

  async function write(next: string[]) {
    if (!project.updated_at) return;
    await updateMutation
      .mutateAsync({
        projectId: project.id,
        expectedUpdatedAt: project.updated_at,
        patch: { project_tags: next.length > 0 ? next : null } as Partial<Project>,
        fieldLabel: 'Project Tags',
      })
      .catch(() => {
        /* hook's onError already pushed the user-visible message */
      });
  }

  const addable = options.filter((t) => !chosen.includes(t));

  return (
    <div className="flex items-baseline gap-1.5" data-testid="pd-tags-editor">
      <span className="text-[9px] text-dim min-w-[32px]">Tags</span>
      <div className="flex flex-wrap items-center gap-0.5">
        {chosen.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded border"
            style={{
              background: 'var(--color-de-bg)',
              color: 'var(--color-de)',
              borderColor: 'var(--color-de-border)',
            }}
            data-testid={`pd-tag-chip-${t}`}
          >
            {t}
            <button
              type="button"
              disabled={locked}
              onClick={() => void write(chosen.filter((x) => x !== t))}
              className="leading-none disabled:opacity-40"
              title={`Remove ${t}`}
              data-testid={`pd-tag-remove-${t}`}
            >
              ×
            </button>
          </span>
        ))}
        <select
          value=""
          disabled={occMissing || addable.length === 0}
          onChange={(e) => {
            const v = e.target.value;
            if (!v || chosen.includes(v)) return;
            void write([...chosen, v]);
          }}
          className="text-[9px] font-semibold text-text border-0 border-b outline-none bg-transparent px-0 py-0.5 disabled:opacity-50"
          style={{ borderBottomColor: 'var(--color-border)' }}
          data-testid="pd-tag-add"
        >
          <option value="">
            {options.length === 0
              ? 'No tags — add them in Settings → Projects'
              : addable.length === 0
                ? 'All tags added'
                : '+ Add tag'}
          </option>
          {addable.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function UnitDimensions({ project }: { project: Project }) {
  // ★★★ fix-549 §B: the same server answer the write path asks. A field that
  //     will be refused must not accept typing first.
  const mayWrite549 = useMayWriteProject(project.id);
  const updateMutation = useUpdateProject();
  const occMissing = !project.updated_at;
  const locked = occMissing || !mayWrite549;
  const types = parseUnitTypes(project.unit_types);
  const productTypes = Array.isArray(project.product_types)
    ? project.product_types.filter(
        (t): t is string => typeof t === 'string' && t.trim().length > 0,
      )
    : [];

  // ★★★ fix-572 §C — THE THREE VOCABULARIES, READ ONCE FOR THE WHOLE BLOCK.
  //     fix-232's rule: the options are canonical in `app_config` and the
  //     control is dropdown-only. fix-562 made them registries; fix-571 made
  //     the Library filters read them. Nothing here hand-writes a list.
  const cfgMap = useAppConfig().map;
  const registryTypes = productTypeRegistry(cfgMap);
  const parkingOpts = parkingOptions(cfgMap);
  const roofDeckOpts = roofDeckOptions(cfgMap);
  const storiesOpts = storiesOptions(cfgMap);

  /**
   * ★★★ fix-572 §D — IT RETURNS WHETHER THE WRITE LANDED.
   *
   * It used to `.catch(() => {})` and return nothing, which was right while
   * nothing downstream cared: the hook's `onError` had already pushed the
   * toast, and the `void` callers must not trip an unhandled rejection. Now a
   * field has to know, because a confirmation fired regardless of the result is
   * worse than no confirmation at all (§D).
   */
  async function writeTypes(next: UnitType[]): Promise<boolean> {
    if (!project.updated_at) return false;
    // fix-205/206: resolve "unnamed" rows on save — a blank label + a single
    // product type persists as that type. Shared helper so a Library save and a
    // Project Overview save produce identical rows.
    const resolved = resolveUnitTypesForSave(next, productTypes);
    try {
      await updateMutation.mutateAsync({
        projectId: project.id,
        expectedUpdatedAt: project.updated_at,
        patch: { unit_types: resolved },
        fieldLabel: 'Unit Dimensions',
      });
      return true;
    } catch {
      // ★ The hook's onError already surfaced the right toast. What is new is
      //   that `false` travels back, so the field stays silent.
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ★★★ fix-572 §C — ONE LABELLED BLOCK PER TYPE, AND NO COMPACT MODE
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Bobby: *"in one swoop, you can cleanly and quickly organize the unit
  // configuration."*
  //
  // ★★★ THE COMPACT / EXPANDED SPLIT IS GONE. A project with no named types
  //     rendered a different, smaller editor with its own two inputs and a
  //     `+ different sizes` button — a second shape for one job, which is what
  //     made "where do I type this" a question at all. There is one shape now:
  //     a block per type, and `+ Add type` in TYPES above is the only way to
  //     get another.
  //
  // ★ An empty list says so rather than rendering nothing, and points at the
  //   control that fixes it.
  return (
    <div className="flex flex-col gap-2" data-testid="pd-unit-config">
      {types.length === 0 ? (
        <p className="text-[10px] italic text-dim" data-testid="pd-unit-config-empty">
          {/* ★ fix-520 §C: `Type` is the word, so this says *types* rather
              than *unit types* — one word for one thing. */}
          No types yet — add one under Types above.
        </p>
      ) : (
        types.map((ut, i) => (
          <UnitConfigBlock
            key={i}
            row={ut}
            index={i}
            disabled={locked}
            productTypes={productTypes}
            registryTypes={registryTypes}
            parkingOpts={parkingOpts}
            roofDeckOpts={roofDeckOpts}
            storiesOpts={storiesOpts}
            unitLabel={unitLabelParts(types)[i]?.full ?? ''}
            unitOrdinal={unitLabelParts(types)[i]?.ordinal ?? i + 1}
            onChange={(patch) =>
              writeTypes(types.map((t, k) => (k === i ? { ...t, ...patch } : t)))
            }
            onRemove={() => void writeTypes(types.filter((_, k) => k !== i))}
          />
        ))
      )}
    </div>
  );
}

/** ★★★ fix-572 §D — the acknowledgement. One word, on the field, gone in a
 *  moment. Declared once so eight controls cannot say it eight ways. */
function SavedTick({ saved, testid }: { saved: boolean; testid: string }) {
  return (
    <span
      className="text-[8px] font-bold uppercase tracking-wide transition-opacity"
      style={{
        color: 'var(--color-ap)',
        opacity: saved ? 1 : 0,
      }}
      // ★★ `aria-live="polite"` rather than an alert: a save is worth hearing
      //    about, and worth hearing about AFTER whatever the person is doing.
      aria-live="polite"
      data-saved={saved ? 'true' : 'false'}
      data-testid={testid}
    >
      {saved ? 'Saved' : ''}
    </span>
  );
}

/** ★ One field: its label above, its control below, its acknowledgement beside
 *  the label. ONE declaration, so every field on this block reads identically —
 *  the property fix-412's single grid string was protecting, now structural. */
function ConfigField({
  fieldKey,
  saved,
  children,
}: {
  fieldKey: UnitConfigField['key'];
  saved: boolean;
  children: React.ReactNode;
}) {
  // ★★★ THE TESTID IS DERIVED FROM THE KEY, NOT PASSED IN. A hand-passed one
  //     is a second list beside `UNIT_CONFIG_FIELDS`, and a second list is what
  //     fix-412 exists about — the first draft of this component already had
  //     `pd-unit-f-width` sitting against a field keyed `width_ft`.
  const testid = `pd-unit-f-${fieldKey}`;
  return (
    <label className="flex flex-col gap-0.5 min-w-0" data-testid={testid}>
      <span className="flex items-center gap-1">
        <span
          className="text-[8px] font-bold uppercase tracking-wide whitespace-nowrap"
          style={{ color: 'var(--color-dim)' }}
          data-testid={`${testid}-label`}
        >
          {unitFieldLabel(fieldKey)}
        </span>
        <SavedTick saved={saved} testid={`${testid}-saved`} />
      </span>
      {children}
    </label>
  );
}

function UnitConfigBlock({
  row,
  index,
  disabled,
  productTypes,
  registryTypes,
  parkingOpts,
  roofDeckOpts,
  storiesOpts,
  unitLabel,
  unitOrdinal,
  onChange,
  onRemove,
}: {
  row: UnitType;
  index: number;
  disabled: boolean;
  productTypes: string[];
  registryTypes: string[];
  parkingOpts: readonly string[];
  roofDeckOpts: readonly string[];
  storiesOpts: readonly string[];
  unitLabel: string;
  unitOrdinal: number;
  /** ★ Resolves TRUE when the write landed — see `writeTypes`. */
  onChange: (patch: Partial<UnitType>) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(String(row.qty || 1));
  const [w, setW] = useState(row.width_ft != null ? String(row.width_ft) : '');
  const [d, setD] = useState(row.depth_ft != null ? String(row.depth_ft) : '');
  const [size, setSize] = useState(row.size_sf != null ? String(row.size_sf) : '');
  // fix-98: dirty-flag prop sync (fix-73 pattern) — the block is keyed by array
  // index, so React reuses the instance when the row data changes after a save.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setQty(String(row.qty || 1));
    setW(row.width_ft != null ? String(row.width_ft) : '');
    setD(row.depth_ft != null ? String(row.depth_ft) : '');
    setSize(row.size_sf != null ? String(row.size_sf) : '');
  }, [row.qty, row.width_ft, row.depth_ft, row.size_sf]);

  // ★★★ fix-572 §D: one flash per FIELD, so two saves in a row on two fields
  //     acknowledge separately rather than one stealing the other's tick.
  const flashes = {
    label: useSavedFlash(),
    qty: useSavedFlash(),
    width_ft: useSavedFlash(),
    depth_ft: useSavedFlash(),
    size_sf: useSavedFlash(),
    stories: useSavedFlash(),
    parking_kind: useSavedFlash(),
    roof_deck: useSavedFlash(),
  } as const;

  /**
   * ★★★ Commit, then acknowledge ONLY on success. Every control goes through
   *  this — there is no second path that could confirm optimistically.
   *
   * ★★★ AND A BLUR THAT CHANGED NOTHING WRITES NOTHING. §D asks for *"one
   *     acknowledgement per completed save, not a toast per keystroke"*, and
   *     every one of these controls commits on blur — so without this guard,
   *     TABBING THROUGH THE FORM would fire eight RPCs and leave a row of ticks
   *     behind, which is the noise §D names as its own failure mode.
   *
   * ★★ It also stops eight no-op writes bumping `updated_at`, which is what
   *    fix-341 traced "modified by someone else" false alarms to.
   */
  async function commit(key: UnitConfigField['key'], patch: Partial<UnitType>) {
    const unchanged = (Object.keys(patch) as (keyof UnitType)[]).every(
      (k) => (row[k] ?? null) === (patch[k] ?? null),
    );
    if (unchanged) return;
    const ok = await onChange(patch);
    if (ok) flashes[key].markSaved();
  }

  const hasProductTypes = productTypes.length >= 1;
  const selectValue = resolveUnitLabel(row.label, productTypes);
  const offListLabel = isOffListUnitLabel(selectValue, registryTypes);
  const needsType = isPlaceholderUnitLabel(row.label);

  // ★★★ fix-572 §C — EVERY BOX READABLE. `w-full` inside a wrapping flex row
  //     rather than fix-422's fixed 22–30px cells: the Type dropdown rendered
  //     `D…` at 52px, which is the complaint this section exists to answer.
  const box =
    'w-full bg-bg border border-border rounded px-1.5 py-1 text-[11px] text-text ' +
    'outline-none focus:border-de focus:ring-1 focus:ring-de disabled:opacity-40';

  return (
    <div
      className="border rounded px-2 py-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-s2)' }}
      data-testid="pd-unit-block"
      data-unit-label={unitLabel}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="text-[9px] font-bold uppercase tracking-wide"
          style={{ color: 'var(--color-muted)' }}
          data-testid={`pd-unit-block-title-${index}`}
        >
          {unitLabel || `Unit ${unitOrdinal}`}
        </span>
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

      {/* ★ A wrapping grid rather than a fixed track list: at 760px the eight
          fields sit two rows deep, and at any narrower width they reflow
          instead of clipping. fix-417's lesson, applied where it belongs. */}
      <div
        className="grid gap-x-2 gap-y-1.5"
        style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
      >
        <ConfigField fieldKey="label" saved={flashes.label.saved}>
          {hasProductTypes ? (
            <span className="flex items-center gap-1 min-w-0">
              <select
                value={selectValue}
                disabled={disabled}
                onChange={(e) => {
                  const v = e.target.value;
                  // ★★★ fix-449 §C1 SURVIVES THE RESTACK: an off-list label is a
                  //     DELIBERATE act, so `Other…` asks for the word rather
                  //     than letting one be typed into the picker by accident.
                  if (v === OTHER_UNIT_LABEL) {
                    const typed = window.prompt('Type label', row.label || '');
                    if (typed === null) return;
                    void commit('label', { label: typed.trim() });
                    return;
                  }
                  void commit('label', { label: v });
                }}
                // ★★ fix-422 §8's RULING SURVIVES THE WIDER FIELD. Its own
                //    worst case — `SFR w/ Accessory Units`, 22 characters — is
                //    still longer than any track this form gives Type, so a
                //    long label must truncate and keep its full text on hover.
                //    What changed is that a REGISTRY value no longer does:
                //    measured in Chrome, `Detached` rendered `D…` at fix-422's
                //    52px and renders in full at 172.
                className={`${box} min-w-0 flex-1 truncate`}
                title={row.label || undefined}
                aria-label={unitFieldHint('label')}
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
              {needsType ? (
                <span
                  className="text-[8px] px-1 rounded font-bold uppercase flex-none"
                  style={{ background: 'var(--color-co-bg)', color: 'var(--color-co)' }}
                  title="Needs a type — this is the wizard's placeholder, not a type. Pick one from the list."
                  data-testid="pd-unit-label-needs-type"
                >
                  ?
                </span>
              ) : (
                offListLabel && (
                  <span
                    className="text-[8px] px-1 rounded font-bold uppercase flex-none"
                    style={{ background: 'var(--color-s2)', color: 'var(--color-muted)' }}
                    title="Not in the product-type list — kept exactly as stored"
                    data-testid="pd-unit-label-offlist"
                  >
                    !
                  </span>
                )
              )}
            </span>
          ) : (
            /* fix-232: with no product types the stored label is READ-ONLY
               rather than blanked — it shows what it holds. */
            <span
              className="text-[11px] text-text px-1.5 py-1 truncate"
              title={selectValue || undefined}
              data-testid="pd-unit-label-readonly"
            >
              {selectValue || NOT_RECORDED}
            </span>
          )}
        </ConfigField>

        <ConfigField fieldKey="qty" saved={flashes.qty.saved}>
          {/* ⚠️ fix-562 §H removed QTY from BOTH Library views on the
              understanding that this is where it is typed. 102 of 270 unit rows
              carry a qty above 1; breaking this makes them uneditable. */}
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
              dirtyRef.current = false;
              void commit('qty', { qty: Number(qty) || 1 });
            }}
            disabled={disabled}
            className={box}
            aria-label={unitFieldHint('qty')}
            data-testid="pd-unit-qty"
          />
        </ConfigField>

        <ConfigField fieldKey="width_ft" saved={flashes.width_ft.saved}>
          <input
            type="number"
            step="0.5"
            value={w}
            placeholder={NOT_RECORDED}
            onChange={(e) => {
              dirtyRef.current = true;
              setW(e.target.value);
            }}
            onBlur={() => {
              dirtyRef.current = false;
              void commit('width_ft', { width_ft: w === '' ? null : Number(w) || 0 });
            }}
            disabled={disabled}
            className={box}
            aria-label={unitFieldHint('width_ft')}
            data-testid="pd-unit-w"
          />
        </ConfigField>

        <ConfigField fieldKey="depth_ft" saved={flashes.depth_ft.saved}>
          <input
            type="number"
            step="0.5"
            value={d}
            placeholder={NOT_RECORDED}
            onChange={(e) => {
              dirtyRef.current = true;
              setD(e.target.value);
            }}
            onBlur={() => {
              dirtyRef.current = false;
              void commit('depth_ft', { depth_ft: d === '' ? null : Number(d) || 0 });
            }}
            disabled={disabled}
            className={box}
            aria-label={unitFieldHint('depth_ft')}
            data-testid="pd-unit-d"
          />
        </ConfigField>

        <ConfigField fieldKey="size_sf" saved={flashes.size_sf.saved}>
          {/* ★★★ fix-572 §C — UNIT SIZE FOLDS IN, retiring the separate list.
              It writes `unit_types[].size_sf`, the same field the Library's
              unit table types and its ± filter searches (fix-488 §B). ★ Never
              computed from width × depth: that product is a FOOTPRINT and this
              is a FLOOR AREA across `stories`. */}
          <input
            type="number"
            min={1}
            value={size}
            placeholder={NOT_RECORDED}
            onChange={(e) => {
              dirtyRef.current = true;
              setSize(e.target.value);
            }}
            onBlur={() => {
              dirtyRef.current = false;
              const n = size.trim() === '' ? null : Math.round(Number(size));
              void commit('size_sf', {
                size_sf: n != null && Number.isFinite(n) && n > 0 ? n : null,
              });
            }}
            disabled={disabled}
            className={box}
            aria-label={unitFieldHint('size_sf')}
            data-testid="pd-unit-size"
          />
        </ConfigField>

        <ConfigField fieldKey="stories" saved={flashes.stories.saved}>
          <StoriesSelect
            stories={row.stories}
            basement={row.basement}
            options={storiesOpts}
            disabled={disabled}
            fill
            onChange={(v) =>
              void commit('stories', {
                stories: v?.stories ?? null,
                basement: v?.basement ?? null,
              })
            }
            testid="pd-unit-stories"
          />
        </ConfigField>

        <ConfigField
          fieldKey="parking_kind"
          saved={flashes.parking_kind.saved}
        >
          <ParkingKindSelect
            kind={row.parking_kind}
            count={row.parking_count}
            options={parkingOpts}
            disabled={disabled}
            fill
            onChange={(v) =>
              void commit('parking_kind', {
                parking_kind: v?.kind ?? null,
                parking_count: v?.count ?? null,
              })
            }
            testid="pd-unit-parking-kind"
          />
        </ConfigField>

        <ConfigField
          fieldKey="roof_deck"
          saved={flashes.roof_deck.saved}
        >
          <RoofDeckSelect
            deck={row.roof_deck}
            penthouse={row.penthouse}
            options={roofDeckOpts}
            disabled={disabled}
            fill
            onChange={(v) =>
              void commit('roof_deck', {
                roof_deck: v?.deck ?? null,
                penthouse: v?.penthouse ?? null,
              })
            }
            testid="pd-unit-roof-deck"
          />
        </ConfigField>
      </div>
    </div>
  );
}

// ===========================================================================
// ★★★ fix-572 §C — `+ Add type` LIVES IN **TYPES**, NOT IN THE BLOCKS
// ===========================================================================
//
// Bobby: *"types should be at the top and then unit configuration is the
// category that then nicely and cleanly organizes this info."* Adding a type is
// a TYPES action; the blocks below are where you configure the ones that exist.
//
// ★ It seeds through `nextUnitTypeLabel`, the same pool the wizard uses, so the
//   team's intake habit (Type A, B, C…) keeps working and a deleted letter is
//   reused rather than skipped (fix-81).
export function AddUnitTypeButton({ project }: { project: Project }) {
  const mayWrite = useMayWriteProject(project.id);
  const updateMutation = useUpdateProject();
  const locked = !project.updated_at || !mayWrite;
  const types = parseUnitTypes(project.unit_types);

  return (
    <button
      type="button"
      disabled={locked}
      onClick={() => {
        if (!project.updated_at) return;
        void updateMutation
          .mutateAsync({
            projectId: project.id,
            expectedUpdatedAt: project.updated_at,
            patch: {
              unit_types: [
                ...types,
                {
                  label: nextUnitTypeLabel(types.map((t) => t.label)),
                  width_ft: null,
                  depth_ft: null,
                  qty: 1,
                  size_sf: null,
                  stories: null,
                  basement: null,
                  parking_kind: null,
                  parking_count: null,
                  roof_deck: null,
                  penthouse: null,
                },
              ],
            },
            fieldLabel: 'Unit Dimensions',
          })
          .catch(() => {
            /* the hook's onError already surfaced the message */
          });
      }}
      className="text-[9px] px-1.5 py-0.5 rounded border border-dashed bg-transparent text-dim self-start cursor-pointer disabled:opacity-50"
      style={{ borderColor: 'var(--color-border)' }}
      data-testid="pd-units-add"
    >
      + Add type
    </button>
  );
}
