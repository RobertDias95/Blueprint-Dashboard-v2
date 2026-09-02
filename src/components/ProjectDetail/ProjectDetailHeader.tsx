import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import OriginLink from '../OriginLink';
import { schematicWindow } from '../../lib/schematicWindow';
import {
  OVERVIEW_CELL_ATTR,
  OVERVIEW_GRID_AREAS,
  OVERVIEW_GRID_GAP,
  OVERVIEW_GRID_TEMPLATE,
  OVERVIEW_ROW_BREAK_CLASS,
  OVERVIEW_ROW_CLASS,
  OVERVIEW_ROW_CONTAINER,
  OVERVIEW_ROW_RESPONSIVE_CSS,
  TEAM_INTERNAL_ROWS,
  TEAM_INTERNAL_ROW_GAP,
} from '../../lib/overviewCardLayout';
import {
  UNIT_MATRIX_GRID,
  UNIT_ROW_COLUMNS,
  WORK_SCOPE_LABEL,
  WORK_SCOPE_TOOLTIP,
  unitFieldTooltip,
  type UnitRowColumn,
} from '../../lib/unitRowLayout';
import { isNoWorkUnit } from '../../lib/unitWorkScope';
import ZoneSelect from '../shared/ZoneSelect';
import { roundLotForStorage } from '../../lib/lotDimensions';
import { VENDOR_SEND_LEAD_DAYS, vendorTargetSend } from '../../lib/vendorReport';
import type {
  Builder,
  PermitWithCycles,
  Project,
  UnitType,
} from '../../lib/database.types';
import type { WaitingOnDiscipline } from '../../lib/database.types';
import { WAITING_ON_OPTIONS } from '../../lib/database.types';
import {
  ParkingKindSelect,
  RoofDeckSelect,
  WorkScopeSelect,
  StallsInput,
} from '../shared/UnitParkingInputs';
import { parseStalls, NOT_RECORDED } from '../../lib/unitParking';
import {
  asExternalTeamBlob,
  directoryFirmNamesForDiscipline,
  type ExternalTeamBlob,
} from '../../lib/externalTeam';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useExternalTeamShowRules } from '../../hooks/useExternalTeamShowRules';
import { useExternalTeamDirectory } from '../../hooks/useExternalTeamDirectory';
import ExternalFirmSelect from './ExternalFirmSelect';
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
import ReuseRedesignDdEditor from './ReuseRedesignDdEditor';
import ReuseEditor from './ReuseEditor';
import {
  useSetBpDdDates,
  type ProjectOverlapConflict,
  type NpOverlapConflict,
} from '../../hooks/useSetBpDdDates';
import { useResolveDaOverlap } from '../../hooks/useResolveDaOverlap';
import { useIsTenantAdmin } from '../../hooks/useIsTenantAdmin';
import { useDrawSchedule } from '../../hooks/useDrawSchedule';
import { drawScheduleTarget } from '../../lib/drawScheduleLink';
import { useUpdateProjectWithPermits } from '../../hooks/useUpdateProjectWithPermits';
import { pushToast } from '../../stores/toastStore';
import OverlapPrompt from '../OverlapPrompt';
import NpWarningPrompt from '../NpWarningPrompt';
// ★★★ fix-448 §B: the pick-only replacement for the five autocomplete
// boxes. See components/builder/BuilderPicker for why blur reverts.
import BuilderPicker from '../builder/BuilderPicker';
// ★ fix-449 §C: the canonical product-type registry, for the off-list mark.
import { useAppConfig } from '../../hooks/useAppConfig';
import PlanOfRecordCard from './PlanOfRecordCard';
import ProjectChatSection, { ProjectChatUnread } from './ProjectChatSection';
import { projectInternalTeam } from '../../lib/projectTeam';
import { useProjectPostCount } from '../../hooks/useProjectMessages';
import ProjectChatModal from './ProjectChatModal';
import {
  PARAM_CHAT,
  PARAM_MESSAGE,
} from '../../lib/notificationTargets';
import { OverviewAction, OverviewCard, OverviewSection } from './OverviewCard';
// ★ fix-475 (P-116): the column that takes Builder/Owner's slot.
import ConsultantsCard from './ConsultantsCard';
// ★ fix-475 §2: the fix-343 pair, reached through the components that already
//   use it (fix-467/fix-468). No third initials function.
import { useRosterFullName } from '../../hooks/useRosterFullName';
import { Avatar } from './ChatMessageBody';
import LinkedTimeBlocksSection from './LinkedTimeBlocksSection';

// Q9.5.e: 4-column header top strip per v1 §4.2.1. Left card holds an
// inner 3-column grid (DD Phase 0.75fr / Project 1.5fr / Team 1.75fr)
// inside a single bordered container with var(--color-s2) background.
// Right panel is a 240px fixed-width Builder/Owner card.
//
// fix-22 Migration 3 sweep: the 11 physical fields (zone/alley/lot/units/
// unit_types/parking/product_types/project_tags/go_date) plus the 4 new
// builder fields moved permits → projects. This file now reads them off
// the joined project and writes them via useUpdateProject. Per-permit
// fields that intentionally stayed on permits (ent_lead, dm, da, dual_da,
// architect, kickoff_date, dd_start, dd_end) still flow through
// useUpdatePermit on the BP anchor.

interface Props {
  project: Project;
  permits: PermitWithCycles[];
  /** When set, edits operate against this permit (the Building Permit
   *  by default). Mirrors v1's pattern of using the BP as the
   *  project-level anchor for permit-scoped fields. */
  bp: PermitWithCycles | null;
  /** fix-126: full project list (cached) so the Proposal-section
   *  "Redesigns (N)" subsection can list this project's children
   *  without prop drilling all the way to ProjectCell. Defaulted in the
   *  component so legacy callers that don't pass it (none in v2 today,
   *  but defensive) render the header exactly as before. */
  allProjects?: Project[];
}

export default function ProjectDetailHeader({
  project,
  permits,
  bp,
  allProjects = [],
}: Props) {
  return (
    <div
      className="border-b border-border px-4 pt-2 pb-2"
      style={{
        background: 'var(--color-s2)',
        // ★★★ fix-423 SCOPE 4: this element's CONTENT BOX is the row's width,
        //     so it is the thing the wrap has to be measured against. A media
        //     query cannot do it — the ribbon collapses 156px without the
        //     window changing size, so half the time it would answer for a
        //     layout that is not on screen. Verified in Chrome: the band
        //     switches at exactly OVERVIEW_ROW_MIN_WIDTH of content box.
        containerType: 'inline-size',
        containerName: OVERVIEW_ROW_CONTAINER,
      }}
      data-testid="project-detail-header"
    >
      {/* ★★ The wrapped band, generated from lib/overviewCardLayout so the
          floors in the stylesheet and the floors in the grid template are the
          same numbers. It is a <style> and not a .css file because a `?raw`
          CSS import reads EMPTY under vitest (fix-406) and these are exactly
          the numbers that must not drift unasserted. */}
      <style data-testid="pd-overview-row-css">{OVERVIEW_ROW_RESPONSIVE_CSS}</style>
      {/* fix-285: five columns, two rows. The Design Plan of Record card takes
          the slot between Team and Builder/Owner.

              [ DD Phase ] [ Project ] [ Team    ] [ Plan of ] [ Builder ]
              [ Notes    ] [(stacked)] [(stacked)] [ Record  ] [ / Owner ]

          fix-290: Notes now sits under DD PHASE ONLY, not spanning DD Phase and
          Project. Project spans both rows instead, because it carries two
          stacked sections (Proposal and Site) and the old half-height slot is
          what squeezed Site out of view. Notes gains the height it was missing
          without losing width, which was the other half of the complaint.

          Team, Project, Plan of Record and Builder/Owner each span both rows.
          Grid AREAS rather than nested flex so the two-row spans are declared
          once and cannot drift out of step with the column count.

          fix-290 widths: Team was much wider than its content needed and
          Project was wide enough to hide its own second section. Both narrow;
          the room goes to Notes (under DD Phase) and to the Plan of Record
          preview, which is the only card whose content is genuinely
          resolution-bound.

          ★ fix-295 widened `por` again, 1.10fr -> 1.58fr, and the room comes
          from TEAM (0.86 -> 0.74) and BUILDER/OWNER (0.84 -> 0.72) -- both text
          that reflows -- plus a shaving off DD Phase (0.90 -> 0.86). NOT from
          Project: fix-290 already narrowed that to the point where it hid its
          own Site section, and undoing that would re-create the bug fix-290
          existed to fix.

          At 1440px the Plan of Record column goes from ~320px to ~444px, and at
          1920px from ~437px to ~606px -- judged by rendering both, not by
          arithmetic alone. The preview is the only content on this row bound by
          resolution; everything else reflows. */}
      {/* ★ fix-309 #55: ONE EQUAL ROW. Milestones, Project, Team and
          Builder/Owner were each as tall as their own content, so the row read
          as a ragged staircase beside the Plan of Record.

          `alignItems: stretch` (rather than the old `items-start`) makes every
          cell as tall as the tallest — which is the Plan of Record, because
          fix-295 widened it and fix-295c raised the thumbnail resolution. The
          others are matched UP to it; it is never shrunk to them.

          alignItems and the per-cell height are set INLINE rather than through
          Tailwind so the contract is readable in a test: jsdom has no layout
          engine, so "the heights are equal" cannot be measured there, and the
          honest assertion is on the two style values that produce it.

          fix-309 #54: the `notes` area is gone from this grid — Notes moved to
          the bottom of Schedule health, one long vertical bar the way it was
          before fix-285 moved it here. */}
      {/* ★★★ fix-417 SCOPE A — THE PROPORTIONS ARE DECLARED IN ONE PLACE.
          Bobby: *"the proportions are way off now. the Design plan of record
          should be the widest of the boxes, but the team and builder owner info
          is way too slim."*

          ★★★ THE SHARES WERE ALREADY HERE — `0.86fr 1.00fr 0.74fr 1.58fr
          0.72fr`. What was missing is that a bare `1fr` track is
          `minmax(AUTO, 1fr)`: its floor is its own min-content, so when
          fix-412 grew the Units row to ~642px the PROJECT card simply took the
          extra from its four neighbours and the declaration became a
          suggestion. Every column carries an EXPLICIT px minimum now, which is
          what actually replaces that automatic floor.

          ★★ The five widths, their floors and the reason for each live in
          lib/overviewCardLayout — one edit, one place, and a test that fails if
          a later change demotes the Plan of Record or unbalances the
          percentages. `gap` comes from there too so the template and any width
          arithmetic cannot disagree.

          ★ fix-309 #55's contract is UNTOUCHED: `alignItems: stretch` plus the
          per-cell `height: 100%` below still make every card as tall as the
          tallest. This ticket changes widths only. */}
      {/* ★★★ fix-423 SCOPE 4 — THE WIDE LAYOUT IS THIS INLINE STYLE, AND IT IS
          UNCHANGED IN KIND. The five floors now total 1218px and the row gets
          710 at a 1280 window and 870 at 1440, so below a 1788px window the
          cards cannot share a line — and what happens there today is the
          sideways scroll fix-422 reported. The container query in
          OVERVIEW_ROW_RESPONSIVE_CSS overrides these declarations for the
          wrapped band, with `!important` because they are inline: fix-309,
          fix-331 and fix-417 all read this template and this `alignItems` off
          the element, and moving them into the stylesheet would take three
          regression guards with it. */}
      <div
        className={`grid ${OVERVIEW_ROW_CLASS}`}
        style={{
          gridTemplateColumns: OVERVIEW_GRID_TEMPLATE,
          gridTemplateAreas: OVERVIEW_GRID_AREAS,
          gap: OVERVIEW_GRID_GAP,
          alignItems: 'stretch',
        }}
        data-testid="project-overview-grid"
      >
        <div {...{ [OVERVIEW_CELL_ATTR]: 'dd' }} style={{ gridArea: 'dd', height: '100%' }}>
          <DDPhaseCell project={project} bp={bp} permits={permits} />
        </div>
        <div {...{ [OVERVIEW_CELL_ATTR]: 'proj' }} style={{ gridArea: 'proj', height: '100%' }}>
          <ProjectCell project={project} bp={bp} allProjects={allProjects} />
        </div>
        {/* Internal and External stack vertically inside this column now. */}
        <div
          {...{ [OVERVIEW_CELL_ATTR]: 'team' }}
          style={{ gridArea: 'team', height: '100%' }}
          data-testid="project-overview-team-col"
        >
          <TeamCell project={project} bp={bp} permits={permits} />
        </div>
        {/* ★★ THE FORCED LINE BREAK. `display:none` unless the row has wrapped
            AND the first line still fits, because flex picks its own break
            points and they are wrong just under the threshold: at 1217px of row
            it puts FOUR cards on line one and leaves Builder/Owner alone on a
            1217px line. Zero height, no margin, aria-hidden — it is a layout
            instruction and not content. */}
        <div className={OVERVIEW_ROW_BREAK_CLASS} aria-hidden="true" data-testid="pd-overview-break" />
        <div {...{ [OVERVIEW_CELL_ATTR]: 'por' }} style={{ gridArea: 'por', height: '100%' }}>
          <PlanOfRecordCard projectId={project.id} />
        </div>
        {/* ★★★ fix-475 (P-116) — CONSULTANTS TAKES THE SLOT BUILDER/OWNER
            VACATES, and Builder/Owner is NOT deleted: it becomes the Team
            card's top section, collapsed to Owner + Business.

            ★★ THE ROW MINIMUM FELL. `builder`'s floor was 190; the Consultants
            floor is 144 (derived — see CONSULTANT_CARD_MIN_WIDTH), so
            OVERVIEW_ROW_MIN_WIDTH goes 1218 → 1172. Five columns before, five
            after, and the permits rail is untouched.

            ★ fix-441 §B's `alignSelf: 'start'` is KEPT and it still applies for
            the same reason: this card is a list that stops at its own content,
            and the row's height is a MAX over its cells (fix-423). A card with
            two consultants on it must not stretch to the height of Plan of
            Record. */}
        <div
          {...{ [OVERVIEW_CELL_ATTR]: 'consultants' }}
          style={{ gridArea: 'consultants', alignSelf: 'start' }}
        >
          <ConsultantsCard projectId={project.id} bp={bp} />
        </div>
      </div>
    </div>
  );
}

/**
 * ★★★ fix-475 — BUILDER/OWNER, COLLAPSED TO WHAT ACQUISITIONS ASKS FIRST.
 *
 * Bobby: *"Owner + Business visible, click to expand to the full card."* The
 * summary is two lines of TEXT — and text is the point: text wraps, so the
 * collapsed state costs the Team card no floor at all. The `<input>` elements
 * that earned Builder/Owner its 190px only exist once somebody opens it.
 *
 * ★ COLLAPSED BY DEFAULT. This card already carries Internal, External and
 *   Chat; opening every project with a fourth section expanded would push the
 *   chat preview below the fold on the screen Bobby actually reads.
 */
function BuilderOwnerDisclosure({ project }: { project: Project }) {
  const [open, setOpen] = useState(false);
  const owner = (project.builder_name ?? '').trim();
  const business = (project.builder_company ?? '').trim();

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left rounded border px-2 py-1"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-s2)',
        }}
        data-testid="pd-builder-disclose"
      >
        <span
          className="block text-[9px] font-bold"
          style={{ color: 'var(--color-muted)' }}
        >
          {open ? 'Collapse ⌃' : 'Expand ⌄'}
        </span>
        {/* ★ Owner and Business, and nothing else — the two an Acquisitions
            reader wants before they open anything. An unset one renders the
            card's normal em dash rather than a blank, so "not recorded" and
            "still loading" cannot look the same. */}
        <span className="block text-[11.5px] font-semibold truncate" style={{ color: 'var(--color-text)' }}>
          {owner || '—'}
        </span>
        <span className="block text-[10.5px] truncate" style={{ color: 'var(--color-muted)' }}>
          {business || '—'}
        </span>
      </button>
      {open && (
        <div data-testid="pd-builder-expanded">
          <BuilderOwnerCell project={project} />
        </div>
      )}
    </div>
  );
}

// ★★★ fix-441 §B (P-019) — BUILDER/OWNER MAY BE SHORTER THAN THE ROW.
// Bobby, 2026-08-29: that card was allowed to stop at its own content, and
// fix-475 keeps the same `alignSelf: 'start'` on the cell that replaced it —
// see the note there. The reasoning is preserved because it is about the CELL,
// not about Builder/Owner: every cell is a grid item with `height:'100%'` and a
// grid item's default `align-self` is `stretch`, so the item fills the row and
// OverviewCard's own `h-full` (fix-309 #55) fills the item. Dropping BOTH is
// what lets a short card be short.

// fix-290: BoxedCell and CellShell are gone. Between them they were half of the
// reason the five cards looked like five different things — BoxedCell drew the
// frame, CellShell drew a centred title inside the padding, and Team wrapped
// both in a THIRD bordered box. OverviewCard now draws frame and banner
// together, so there is one answer instead of three that could drift.

// ============================================================
// DD Phase cell — GO date (read-only, project-level) + DD Start/End
// (editable, permit-level) + Duration
// ============================================================

// ============================================================
// ============================================================
// ★★ fix-335 §7 — the foot of the Milestones card: the draw schedule
// ============================================================
//
// A SECTION, not a button floating under the last one, so it inherits the
// card's separator and the fix-331 §1 distribution like everything else above
// it. The label is the whole design:
//
//     block in Q3 2026  →  "Draw schedule · Q3 2026 →"
//     no block at all   →  "Draw schedule →"  ·  "Not scheduled yet"
//
// ★ IT IS NEVER INERT. fix-335 §8 allows exactly one placeholder in this ticket
// and it is the Connect button, not this. An unscheduled project still gets a
// working link to the live board; the second line says why there is nothing to
// jump to, rather than a disabled control saying nothing at all.
//
// ★ WHY THE QUARTER IS ON THE FACE and not just in the URL: fix-182 renders a
// different board per quarter, so "the draw schedule" is ambiguous and the
// button would otherwise be making a promise it cannot keep. Naming the quarter
// turns a jump into a statement — this project's block starts in Q3 2026, and
// that is where you are about to land. See lib/drawScheduleLink.
function DrawScheduleLinkRow({
  projectId,
  startWeek,
}: {
  projectId: string;
  startWeek: string | null;
}) {
  const target = drawScheduleTarget(projectId, startWeek);
  return (
    // ★ fix-345 §3: pinned to the card's floor, and the button's own treatment
    // extracted into <OverviewAction> — this one was the model the other two are
    // being matched to, so it is the shape that moved, not the shape that changed.
    <OverviewSection testId="pd-draw-schedule-section" pinBottom>
      {/* ★★ fix-345 §3: THE UNSCHEDULED NOTE MOVED ABOVE THE BUTTON. It used to
          sit underneath, which was fine when this card's button was the only
          one — and fatal the moment three buttons had to share a baseline,
          because a note below would push this one a line off the floor while
          Connect and Chat sat on it. Above, the note eats spare height that was
          empty anyway and the button still lands on the same edge as the others. */}
      {!target.hasBlock && (
        <div
          className="text-[9px] text-dim text-center mb-1"
          data-testid="pd-draw-schedule-unscheduled"
        >
          Not scheduled yet — no block on the board.
        </div>
      )}
      <OverviewAction
        to={target.href}
        testId="pd-draw-schedule-link"
        data={{
          'data-has-block': target.hasBlock ? 'true' : 'false',
          'data-quarter': target.quarter ?? undefined,
        }}
        title={
          target.hasBlock
            ? `Open the draw schedule at ${target.quarterLabel}, where this project's block starts`
            : 'Open the draw schedule — this project has no block on it yet'
        }
      >
        <span>
          Draw schedule
          {target.quarterLabel ? ` · ${target.quarterLabel}` : ''}
        </span>
        <span aria-hidden>→</span>
      </OverviewAction>
    </OverviewSection>
  );
}

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

function MilestoneDateRow({
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
function KeyDatesSection({ project }: { project: Project }) {
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

function DDPhaseCell({
  project,
  bp,
  permits,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
}) {
  if (!bp) {
    // fix-145: a reuse-redesign has no BP permit but DOES carry a draw_schedule
    // lane (fix-144). Render the inline lane editor instead of the dead
    // "No building permit" placeholder so DA / dates / status stay editable.
    // fix-148: Closing date renders above whichever editor mounts.
    if (project.redesign_of_project_id && project.redesign_reuses_original_permit) {
      return (
        <OverviewCard title="Milestones" testId="pd-milestones-card">
          <KeyDatesSection project={project} />
          <OverviewSection title="DD window">
            {/* fix-145: a reuse-redesign has no BP permit but DOES carry a
                draw_schedule lane, so the inline lane editor renders here --
                DA, dates and status are one control acting on one block. */}
            <ReuseRedesignDdEditor project={project} />
          </OverviewSection>
        </OverviewCard>
      );
    }
    return (
      <OverviewCard title="Milestones" testId="pd-milestones-card">
        <KeyDatesSection project={project} />
        <OverviewSection title="DD window">
          {/* The draw block hangs off the building permit, so there is no
              window to show until one exists. Said plainly under the heading it
              belongs to rather than as a loose line among the dates. */}
          <div className="text-[11px] text-dim">No building permit</div>
        </OverviewSection>
        <OverviewSection title="Permit intake">
          {/* ★ fix-311: the same plain treatment as the DD window above —
              Target Submit is BP-anchored and Intake Accepted is a cycle on the
              BP, so with no BP there are no values, and two empty boxes would
              claim there are. */}
          <div className="text-[11px] text-dim">No building permit</div>
        </OverviewSection>
      </OverviewCard>
    );
  }
  return <DDPhaseEditor project={project} bp={bp} permits={permits} />;
}

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

function DDPhaseEditor({
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
      <OverviewCard title="Milestones" testId="pd-milestones-card">
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
          {/* ★ Reads the SAME `bp` this card already resolved — no second
              notion of "the primary permit" gets invented here. */}
          <IntakeAcceptedRow bp={bp} />
        </div>
       </OverviewSection>
       {/* ★★ fix-335 §7: "Under milestones, at the bottom, underneath permit
           date, we want a button that from there will take you to the draw
           schedule." Underneath Permit intake, which is the section the permit
           dates live in — so it is the last thing in the card, as drawn. */}
       <DrawScheduleLinkRow projectId={bp.project_id} startWeek={drawRow?.start_week ?? null} />
      </OverviewCard>
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

function TargetSubmitRow({
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
// Project cell — Proposal (units/type/unit_types/tags) + Site (zone/
// lot/alley/parking). All values read from projects.*, all writes via
// useUpdateProject post-Mig 3.
// ============================================================

function ProjectCell({
  project,
  bp,
  allProjects,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  allProjects: Project[];
}) {
  void bp;
  // fix-91: product_types is an array. A project can carry multiple
  // (SFR + Attached Units + Cottages on the same parcel). Render each
  // as a chip. Empty array → "Type" row is hidden.
  const productTypes = Array.isArray(project.product_types)
    ? project.product_types
    : [];
  const tags = Array.isArray(project.project_tags)
    ? (project.project_tags as string[])
    : [];
  // fix-126: children of this project (descendant redesigns), sorted by
  // created_at ascending so "Redesign #1" is the first one spawned.
  // Filtered in-place from the already-cached projects list.
  const childRedesigns = useMemo(() => {
    return allProjects
      .filter((p) => p.redesign_of_project_id === project.id)
      .sort((a, b) => {
        const aT = a.created_at ?? '';
        const bT = b.created_at ?? '';
        if (aT !== bT) return aT.localeCompare(bT);
        return a.id.localeCompare(b.id);
      });
  }, [allProjects, project.id]);
  const [redesignsOpen, setRedesignsOpen] = useState(false);

  return (
    // fix-290: ★ THE REGRESSION THIS TICKET EXISTS FOR.
    //
    // Proposal and Site used to sit SIDE BY SIDE in a `1fr 1fr` grid inside one
    // fifth of the screen. Each half was then ~10% of the viewport, and Site --
    // Zone, Lot, Lots, Corner, Alley, Parking, Stalls -- was squeezed to the
    // point of being unreadable. The data never stopped being fetched or
    // rendered; it stopped being LEGIBLE, which from the desk is the same thing
    // as gone. Stacking them gives each the card's full width.
    <OverviewCard title="Project" testId="pd-project-card">
      {/* ★★★ fix-422 SCOPE 1 — ONE COLUMN: PROPOSAL, SITE, UNIT DIMENSIONS.
          Bobby, 2026-08-27: *"Maybe the stack goes proposal, site, then unit
          dimensions at the bottom of that category."*

          ★★★ THIS RETIRES fix-418's TWO-COLUMN INTERIOR, and it takes its
          wrapper `<div>` with it. That wrapper existed only to make two columns
          possible; with one column the sections are DIRECT children of the card
          again, which is the shape fix-331 §1 distributes height across without
          any help. fix-418 had to add `flex-1` to the wrapper to keep that rule
          alive through it — the regression two MilestonesCard tests caught.
          Removing the wrapper removes the need for the workaround, and
          `topLevelSections()` in that suite keeps both shapes honest.

          ★★★ UNITS GOES LAST, AND THAT IS THE WHOLE REASON THE ORDER IS
          SPECIFIED. It is the only band whose height varies with the data — one
          row per unit type, one to six of them in prod. Put it between Proposal
          and Site and every extra unit type pushes Site down the card; put it at
          the foot and it grows against the card's bottom edge, where the spare
          height already is. */}
      <OverviewSection title="Proposal" testId="pd-project-proposal">
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] text-dim min-w-[36px]">Units</span>
              {project.units != null && project.units > 0 ? (
                <span className="text-sm font-extrabold text-text">
                  {project.units}
                </span>
              ) : (
                // fix-88: Bobby spotted 2724 Walnut Ave SW (and 1 other)
                // saved without a unit count — the wizard pre-fix-88
                // didn't gate this. The badge makes the gap visible at a
                // glance so the team can backfill the value via Project
                // Settings (NULL and 0 both flag — 0 isn't a real unit
                // count for any project type we handle).
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border bg-co-bg text-co border-co-border"
                  title="This project was saved without a unit count. Open Project Settings to add one."
                  data-testid="units-missing-badge"
                >
                  ⚠ missing
                </span>
              )}
            </div>
            {productTypes.length > 0 && (
              <div
                className="flex items-baseline gap-1.5"
                data-testid="pd-product-types"
              >
                <span className="text-[9px] text-dim min-w-[36px]">Type</span>
                <div className="flex flex-wrap gap-1">
                  {productTypes.map((t) => (
                    <span
                      key={t}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-de-bg text-de border-de-border"
                      data-testid={`pd-product-type-${t}`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* fix-216: Reuse provenance badge + set/change/clear editor.
                Parallel to the Redesigns section; one field shared with the
                wizard + reports. */}
            <ReuseEditor project={project} allProjects={allProjects} />
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-[9px] text-dim min-w-[36px]">Tags</span>
              <div className="flex flex-wrap gap-0.5">
                {tags.length === 0 ? (
                  <span className="text-[9px] text-dim italic">none</span>
                ) : (
                  tags.map((t) => (
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

            {/* fix-126: expandable Redesigns (N) subsection. Hidden
                entirely when zero descendants exist (empty state is
                noise). Collapsed by default — caret toggles open. */}
            {childRedesigns.length > 0 && (
              <div
                className="mt-1 pt-1 border-t"
                style={{ borderTopColor: 'var(--color-border)' }}
                data-testid="pd-redesigns-section"
              >
                <button
                  type="button"
                  onClick={() => setRedesignsOpen((v) => !v)}
                  className="flex items-center gap-1 text-[10px] font-bold text-co hover:opacity-80 transition"
                  aria-expanded={redesignsOpen}
                  data-testid="pd-redesigns-toggle"
                >
                  <span className="font-mono">
                    {redesignsOpen ? '▾' : '▸'}
                  </span>
                  Redesigns ({childRedesigns.length})
                </button>
                {redesignsOpen && (
                  <ul
                    className="mt-1 flex flex-col gap-0.5"
                    data-testid="pd-redesigns-list"
                  >
                    {childRedesigns.map((r, i) => (
                      <li
                        key={r.id}
                        data-testid={`pd-redesign-row-${r.id}`}
                        className="flex items-baseline justify-between gap-2 text-[10px]"
                      >
                        <OriginLink
                          to={`/project/${r.id}`}
                          className="font-display font-bold text-de hover:underline truncate"
                        >
                          Redesign #{i + 1}
                        </OriginLink>
                        <span className="text-dim font-mono truncate">
                          {r.redesign_trigger ?? '—'}
                          {r.redesign_reuses_original_permit === true
                            ? ' · reuse'
                            : r.redesign_reuses_original_permit === false
                              ? ' · new permits'
                              : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
      </OverviewSection>

      {/* Site — fix-22 Mig 3: zone/alley/lot/parking moved to projects; writes
          via useUpdateProject. fix-290 restored it to a legible width by
          stacking it under Proposal instead of halving the column. */}
      <OverviewSection title="Site" testId="pd-project-site">
        <SiteEditor project={project} />
      </OverviewSection>

      {/* ★★★ AND STILL NO `overflow-x` ANYWHERE IN HERE. fix-417 §B's scroller
          stays deleted — that is the thing this whole sequence exists to
          remove. What keeps the matrix legible instead is that the PROJECT
          card's FLOOR is derived from `UNIT_MATRIX_WIDTH`, so the card can
          never be narrower than the grid inside it and never has anything to
          scroll. See lib/overviewCardLayout. */}
      <OverviewSection title="Unit dimensions" testId="pd-project-units">
        <UnitDimensions project={project} />
      </OverviewSection>

      {/* ★★ fix-335 §8: the Connect control. THE ONE PLACEHOLDER IN THIS
          TICKET — see ConnectPlaceholder for why it is allowed and what makes
          it honest. */}
      <ConnectPlaceholder />
    </OverviewCard>
  );
}

// ============================================================
// ★★★ fix-335 §8 — the Connect button, and the ONLY inert control here
// ============================================================
//
// Bobby: "How we had talked about adding the connect button that would then
// take you to the app and/or feature link, that placeholder, we want to put
// that at the bottom of project."
//
// ★★ THIS WAS HELD ON 2026-08-16, and by his own rule: nobody knew what URL it
// should open, and he had just said nothing ships as a placeholder. He has now
// waived that, knowingly, having been told he was waiving it — "connect is
// currently an app on our PCs. we can just use a placeholder button for it
// until we get to this point."
//
// ★★★ SO IT SHIPS, AND IT MUST BE AN HONEST ONE. The chat "Attach" stub that
// set the no-placeholder rule (fix-330) failed on more than its label; it was
// that nobody had chosen what the thing would do, and the UI hid that behind a
// date-shaped promise. Three things follow, and all three are asserted:
//
//   1. IT READS AS NOT-YET-WORKING BEFORE IT IS CLICKED. `disabled`, dashed
//      border, muted text, cursor:not-allowed. A live-looking button that
//      silently does nothing is strictly worse than no button — the user
//      concludes the app is broken rather than unfinished.
//   2. NO INVENTED DATE, and none of the banned phrasing either — fix-331 §5
//      greps the whole tree for it and this file is not exempt. The face says
//      **"Connect"** with **"no link yet"** beside it. That is a fact about
//      today: checkable, already true, and it promises nothing. A word like
//      "soon" would be a forecast nobody has made. When the link exists, the
//      tag comes off and the label does not have to change.
//   3. IT IS THE ONLY ONE. Every other control this ticket adds — SharePoint,
//      Draw schedule — works.
//
// ★ WHAT THE REAL VERSION LIKELY IS, for whoever picks this up: Connect is
// desktop software, so the working version is probably a protocol handler
// (`connect://<something>`) registered by the app's installer. Note fix-289's
// finding while you are here — Chrome refuses to navigate an https page to
// `file:` or a UNC path and does it SILENTLY, which is the failure mode this
// button is currently being honest about instead of reproducing.
function ConnectPlaceholder() {
  return (
    // ★★ fix-345 §3 RESTYLED THIS AND DID NOT ACTIVATE IT — the brief's words.
    // It takes the shared geometry so it lines up with the other two, and keeps
    // its dashed border, muted fill and disabled state, because the ONLY thing
    // that made this placeholder honest is that it reads as not-yet-working
    // before it is clicked. Uniform in size and position; not in promise.
    <OverviewSection testId="pd-connect-section" pinBottom>
      <OverviewAction
        disabled
        testId="pd-connect-button"
        // ★ Declared in the DOM, so "is anything inert on this screen?" is a
        // question a test can ask of the whole app rather than of a list
        // somebody has to maintain.
        data={{ 'data-placeholder': 'true' }}
        title="Connect is an application on our PCs. There is no link for the browser to open yet."
      >
        <span>Connect</span>
        <span className="font-normal text-[9px] uppercase tracking-wide">
          no link yet
        </span>
      </OverviewAction>
    </OverviewSection>
  );
}

// ============================================================
// Team cell — Internal (ENT/DA/DM/ACQ) + External
// ============================================================

function TeamCell({
  project,
  bp,
  permits,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  permits: PermitWithCycles[];
}) {
  // ★ fix-475 §2: the roster's short name is what renders; the FULL name is
  //   what the initials come from (board decision #125).
  const fullNameOf = useRosterFullName();
  // fix-22 Mig 3: project-level entitlement_lead is the default; bp.ent_lead
  // overrides per-permit (Bobby's PAR/SDOT/ECA pattern). Display the BP
  // override when present, else fall back to project-level default.
  // ★★★ fix-347 §3: THE ONE DEFINITION. This card's five internal rows and the
  // `@project` smart tag read the same computation (lib/projectTeam) — the
  // brief's rule, "do not write a second definition of who is on this project",
  // and the reason a tag cannot drift from the card that displays the team.
  const internal = projectInternalTeam(project, bp);
  const ent = internal.ent;
  const da = internal.da;
  const dm = internal.dm;
  // ★ fix-331 §3: `permits` is no longer a void — the chat section needs it to
  // anchor a chat-born task (fix-330's permit chooser defaults to the project's
  // Building Permit and lists the rest).

  // ★ fix-321 #78: the SD tier. Bobby: "the hierarchy should go: acquisitions,
  // entitlements, we want to add schematic design — so SD — then design
  // manager, then design associate."
  //
  // ★ NO NEW ROLE AND NO MIGRATION. `schematic` already exists in team_members
  // (4 people), and the project already carries its own designers in
  // projects.schematic_designer — fix-222/fix-228 put them there, and
  // PermitDetailV2 already reads exactly this field. The tier was missing from
  // this card's DISPLAY, not from the data, so this reads the field the rest of
  // the app reads rather than inventing a second lookup.
  //
  // A project can carry more than one; joined rather than truncated, because a
  // second designer silently dropped is the kind of half-truth this card keeps
  // being fixed for.
  const sd = internal.sd.length > 0 ? internal.sd.join(', ') : null;

  /** ★ fix-423: the five values, keyed the way TEAM_INTERNAL_ROWS names them,
   *  so the ORDER and the COLUMNS live in the layout table and this component
   *  only says what each row holds. Nothing about how a role is read or written
   *  changes here — P-075 is about to change what these fields mean and this
   *  ticket deliberately does not pre-empt it. */
  const internalValues: Record<(typeof TEAM_INTERNAL_ROWS)[number]['key'], string | null> = {
    acq: project.acq_lead ?? null,
    ent,
    sd,
    dm,
    da,
  };

  // ★★ fix-345 §3: the card owns the modal now, because the two things that
  // talk to it — the preview section and the pinned Chat button — are separate
  // children of it. ProjectChatSection used to hold this state, which worked
  // only while the opener lived inside the preview.
  const [chatOpen, setChatOpen] = useState(false);
  const postCount = useProjectPostCount(project.id);

  // ★★★ fix-362 §2 — ARRIVING IS NOT LANDING, and this is the door.
  //
  // A notification about a chat message links to `?msg=<uuid>`; one about the
  // conversation itself links to `?chat=1`. Either OPENS this modal, because a
  // link to a page that merely contains the thing is what Bobby was
  // complaining about.
  //
  // ★★ THE URL IS THE STATE. Not a router `state` object, not a store: §2's
  // rule is that the destination must work from a cold browser load, because a
  // notification is exactly the thing somebody opens tomorrow or on another
  // machine. If you cannot paste the URL and get the same result, it is not
  // done.
  //
  // ★ Applied ONCE per parameter value, using the in-render adjust-on-change
  // pattern that fix-217/218 established two cards away for `?permit=` — not a
  // setState-in-effect (no cascading render, and the React Compiler rejects the
  // effect form outright, as fix-350 found twice). Applying once is what lets
  // somebody CLOSE the modal and have it stay closed.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkChat =
    searchParams.get(PARAM_MESSAGE) ?? (searchParams.get(PARAM_CHAT) ? '1' : null);
  const [appliedChatParam, setAppliedChatParam] = useState<string | null>(null);
  if (deepLinkChat === null) {
    // ★★ THE RESET IS DRIVEN BY THE URL, NOT BY THE CLOSE HANDLER, and getting
    // that backwards cost a test. Clearing the applied value inside `closeChat`
    // runs BEFORE `setSearchParams` has been observed, so the very next render
    // still saw `?msg=…` with nothing applied and re-opened the modal the click
    // had just closed. Reading the reset off the URL means the two can never be
    // out of order: the guard clears only once the parameter is actually gone,
    // which is also what lets the SAME notification be followed twice.
    if (appliedChatParam !== null) setAppliedChatParam(null);
  } else if (deepLinkChat !== appliedChatParam) {
    setAppliedChatParam(deepLinkChat);
    setChatOpen(true);
  }

  /** ★ Closing clears the parameters as well as the modal.
   *
   *  Otherwise the URL still says "open at this message" while the modal is
   *  shut — and the next click on the Chat button would land on a stale
   *  message, or worse, be swallowed because the applied-value guard has
   *  already seen it. The URL is the state, so closing has to write to it. */
  function closeChat() {
    setChatOpen(false);
    if (searchParams.has(PARAM_MESSAGE) || searchParams.has(PARAM_CHAT)) {
      const next = new URLSearchParams(searchParams);
      next.delete(PARAM_MESSAGE);
      next.delete(PARAM_CHAT);
      setSearchParams(next, { replace: true });
    }
  }

  // fix-285: Internal and External STACK vertically now — two cards in one
  // column — rather than sitting side by side in a 2-col grid. Side by side,
  // each got half of a narrow column and the External discipline selects were
  // squeezed; stacked, both get the full column width.
  // fix-290: the two blocks are now the card's own stacked SECTIONS rather than
  // two bordered boxes nested inside a third. Same order, same content, one
  // frame instead of three — and Consultants can be added as a third section
  // without touching anything here but the JSX.
  return (
    <OverviewCard title="Team" testId="project-overview-team">
      {/* ★★★ fix-475 (P-116) — BUILDER/OWNER IS TEAM'S TOP SECTION NOW.
          Bobby: *"Owner + Business visible, click to expand to the full card."*
          Its own column became Consultants; the content did not go anywhere.

          ★★★ AND ITS 190px FLOOR DID NOT COME WITH IT — DELIBERATELY, AND
          fix-423 SET THIS PRECEDENT ON THIS VERY CARD. Builder/Owner's floor
          existed because *"these are <input> elements and an input does NOT
          wrap"* (fix-417). Those inputs are still here when the section is
          EXPANDED, so a naive reading says Team's floor must rise 160 → 268
          (measured: a full email at 11px is 164px, plus the 62px label, the
          gap, and the card chrome). Team 268 + Consultants 144 = 412 against
          the 350 this reshuffle has to fit in — it does not.

          ★★ So the expanded block STACKS its label above its input below a
          container-query threshold, exactly as fix-423 made the two-up Internal
          block a container query rather than a floor. Its own words: *"A layout
          that asks for width the row cannot always give is not a floor."* The
          full-width fields appear whenever the card can hold them — which is
          every width Bobby works at — and the card stacks gracefully when it
          cannot. Team's floor stays 160 and the row minimum FALLS to 1172. */}
      <OverviewSection title="Builder / Owner" testId="project-overview-team-builder">
        <BuilderOwnerDisclosure project={project} />
      </OverviewSection>

      {/* ★ fix-321 #78: the order IS the requirement, and it follows the work —
          land, then entitlement, then schematic design, then the manager, then
          the associate doing it. Written as one list in one place so it cannot
          drift the way the Milestones rows did before fix-311. */}
      <OverviewSection title="Internal" testId="project-overview-team-internal">
        {/* ★★★ fix-423 SCOPE 2 — ACQ / ENT LEFT, SD / DM / DA RIGHT, which is
            Bobby's own mock. Five stacked rows were the tallest thing in this
            card after External, and the card is what sets the row's height on a
            project with no external team (143 of 196 in prod).

            ★★★ IT COLLAPSES BY WRAPPING, NOT BY A BREAKPOINT. Two flex columns
            with a declared minimum sit side by side when the card can hold them
            and stack when it cannot — and stacked they render ACQ, ENT, SD, DM,
            DA in one column, which is byte-for-byte the card this replaces.
            That matters at a 1280 window, where the row itself has wrapped and
            Team renders 172px.

            ★★ NO NEW WRAPPER AROUND THE SECTIONS. fix-418 added one inside the
            PROJECT card and lost fix-331 §1's height distribution; two
            MilestonesCard tests caught it. This grid replaces the section's
            existing `flex flex-col` body — same element, same depth — so the
            sections are still the card's own children and nothing about the
            distribution changes. */}
        {/* ★★★ fix-475 §2 — ONE ROLE PER BLOCK, SPELLED OUT, WITH A FACE.
            Bobby: roles spelled out, one per block, in order — Acquisitions ·
            Entitlement · Schematic · Design Manager · Design Associate — each
            with an initials avatar.

            ★★★ THE ORDER AND THE WORDS COME FROM `TEAM_INTERNAL_ROWS`, NOT
            FROM A LIST TYPED HERE. `title` is the spelled-out name that has
            been sitting in that table since fix-321 as the abbreviation's
            tooltip; this promotes it to the label. Nothing about the order
            moved, and a sixth role added to the table appears here for free.

            ★★ THIS REVERSES fix-423's TWO-UP, AND THAT IS A REAL TRADE. That
            ticket paired the rows because *"five stacked rows were the tallest
            thing in this card"*. Bobby has now asked for one per block with a
            face on each, and the Team card is also gaining Builder/Owner — so
            this card gets taller in both directions at once. The row's height
            is a MAX over its cells (fix-423), so Team may now be what sets it.
            Flagged in the PR rather than quietly absorbed: nothing here is a
            width change, so it cannot re-open the sideways scroll fix-423 was
            closing.

            ★ AN UNFILLED ROLE RENDERS NOTHING — the brief's rule, and the
              opposite of fix-321's em dash. With a face on every line, an
              empty circle beside an empty name reads as a broken avatar rather
              than an unassigned role. */}
        <div
          className="flex flex-col"
          style={{ gap: TEAM_INTERNAL_ROW_GAP }}
          data-testid="project-overview-team-internal-columns"
        >
          {TEAM_INTERNAL_ROWS.map((r) => {
            const value = (internalValues[r.key] ?? '').trim();
            if (!value || value === '—') return null;
            return (
              <div key={r.key} data-testid={`pd-role-${r.key}`}>
                <div
                  className="text-[8.5px] font-extrabold uppercase"
                  style={{ letterSpacing: '0.06em', color: 'var(--color-muted)' }}
                >
                  {r.title}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {/* ★★ SHORT NAME ON THE LINE, FULL INITIALS IN THE CIRCLE —
                      board decision #125: *"Cam instead of Cameron, and Shire
                      goes by Shire."* The roster name IS the short name (it is
                      the join key the whole app uses), and `rosterFullName`
                      resolves the full one for the initials — which is what
                      stops **Fisk** rendering as *Matt Fisk* on the line while
                      still giving the circle both letters.
                      ★ The fix-343 pair, reused through the same `Avatar`
                        fix-467/fix-468 use. No third initials function. */}
                  <Avatar name={fullNameOf(value)} titled title={`${r.title} · ${fullNameOf(value)}`} />
                  <span
                    className="text-[11.5px] font-semibold truncate"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {value}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </OverviewSection>

      <OverviewSection title="External" testId="project-overview-team-external">
        <ExternalTeamEditor project={project} />
      </OverviewSection>

      {/* ★★★ fix-346 §1: THE CHAT PREVIEW SITS AFTER EXTERNAL NOW, directly
          above the button that opens it.

          Bobby: "We want to keep the chat where it's showing the last two most
          common posts, but what we actually want to do is move that chat down
          below… so that it goes internal, external, and then here's the chat
          section, and then it shows your two most recent chats, and then the
          chat button, which would then open up the chat."

          ★ THE PREVIEW IS NOT DELETED and its content is untouched — the posts,
          the reply counts, the mention tint. fix-331 §3 put it between Internal
          and External, which was right while the way in lived inside it; the
          opener became the pinned button at the card's foot (fix-345 §3), and
          the preview now sits with it. Preview then button reads as one thing:
          here is the conversation, here is the way into it. My fix-345 brief's
          "do not move the chat preview out of the middle of the Team card" is
          withdrawn by Bobby, and the order is asserted whole, not by presence.

          ★ It uses <OverviewSection> like the two above it and NOTHING ELSE.
          No nested card, no second border, no second background: the separator
          above it, the heading treatment and the padding all come from the same
          component that draws INTERNAL and EXTERNAL, which is what makes it a
          section of this card rather than a widget parked inside one. That was
          fix-331's actual complaint — "feels like it is part of the team card,
          not a separate UI feature/function like it shows now" — and it is
          asserted by a test that looks for a second bordered container and
          finds none. Moving the section did not move that.

          ★ THE SECTION COUNT IS STILL FOUR, so fix-345 §3's pinning is
          untouched: the button section still takes no share of the spare height
          and still lands on the same baseline as Milestones' and Project's. */}
      <OverviewSection title="Chat" testId="project-overview-team-chat">
        <ProjectChatSection projectId={project.id} />
      </OverviewSection>

      {/* ★★ fix-345 §3: the Team card's action, matching Milestones and Project.
          fix-346 §1 moved the preview down to sit directly above it; the button
          itself is unchanged, and it is still the ONLY way into the modal. */}
      <OverviewSection testId="pd-chat-section" pinBottom>
        <OverviewAction
          onClick={() => setChatOpen(true)}
          testId="project-chat-open"
          title={
            postCount > 0
              ? `Open the project chat — ${postCount} ${postCount === 1 ? 'post' : 'posts'}`
              : 'Open the project chat'
          }
          data={{ 'data-post-count': String(postCount) }}
        >
          <span>Chat{postCount > 0 ? ` · ${postCount}` : ''}</span>
          {/* ★ The unread count rides the control, per the brief — same query,
              same subtraction, same source as the bell. */}
          <ProjectChatUnread projectId={project.id} />
          <span aria-hidden>→</span>
        </OverviewAction>
      </OverviewSection>

      {chatOpen && (
        <ProjectChatModal
          projectId={project.id}
          permits={permits}
          // ★ fix-362: the message to land on, read from the URL. Null when the
          // link only asked for the conversation.
          focusMessageId={searchParams.get(PARAM_MESSAGE)}
          onClose={closeChat}
        />
      )}
    </OverviewCard>
  );
}

// Q9.5.e-fix-3 / fix-190d / fix-195 / fix-196: External team editor on the
// Project Overview. Reads/writes the projects.external_team BLOB (the single
// source — My Tasks → Waiting + the Settings panel use the same store), keyed by
// the canonical WAITING_ON_OPTIONS disciplines (survey term = "Surveyor"). Each
// edit writes the full external_team JSON back via useUpdateProject (OCC).
//
// fix-196: applies the SHARED show-rules (useExternalTeamShowRules) so this
// editor and the Settings panel can't drift — common four always shown; other
// disciplines only when assigned or surfaced via "+ Add discipline"; empty-state
// CTA when nothing assigned. fix-227: the firm field is a DROPDOWN sourced from
// the central External Team directory (shared ExternalFirmSelect), same as the
// Settings panel; picking still writes the blob, "+ Add new firm…" also inserts
// into the directory. Existing free-text blob firms not in the directory show.
function ExternalTeamEditor({ project }: { project: Project }) {
  const updateMutation = useUpdateProject();
  const directoryQ = useExternalTeamDirectory();
  const external = useMemo<ExternalTeamBlob>(
    () => asExternalTeamBlob(project.external_team) ?? {},
    [project.external_team],
  );
  const directory = directoryQ.data ?? [];
  const {
    shownDisciplines,
    addableDisciplines,
    noneAssigned,
    addDiscipline,
    addedDisciplines,
  } = useExternalTeamShowRules(external);
  const occMissing = !project.updated_at;

  // ★★★ fix-423 SCOPE 3 — AN EMPTY EXTERNAL BLOCK IS ONE LINE.
  //
  // ★★★ AND THE BRIEF'S PREMISE FOR THIS WAS WRONG, MEASURED THE OTHER WAY.
  // It described the empty case as *"a heading plus a lone '+ Add discipline…'
  // — about 40px of chrome around nothing"*. It is not: fix-193's rule renders
  // the COMMON FOUR (Civil, Surveyor, Structural, Arborist) as fill-in slots
  // whatever the project holds, plus fix-196's empty-state banner above them.
  // Measured in Chrome on the real markup at this card's real width, an EMPTY
  // External section is **251px** — the tallest section in the Team card, and
  // taller than everything above it put together. A FULL one (five firms) is
  // 256px. So the empty case costs 98% of the full case to say nothing at all,
  // on 143 of 196 active projects.
  //
  // ★★ WHAT COLLAPSES IS THE PRESENTATION, NOT THE AFFORDANCE. The picker in
  // the collapsed row offers EVERY discipline rather than the leftovers, so a
  // Surveyor is still one click away — which it would not be if the four slots
  // were simply deleted. Picking any of them opens the section into exactly the
  // block that renders today.
  //
  // ★ THE SHARED RULE (lib/externalTeam) IS UNTOUCHED and so is the Settings
  // panel, which is the surface you go to to set an external team up and where
  // four ready slots are the point. This is the overview's presentation of the
  // same rule.
  const externalCollapsed = noneAssigned && addedDisciplines.size === 0;

  async function writeFirm(discipline: WaitingOnDiscipline, firm: string) {
    if (!project.updated_at) return;
    const t = firm.trim();
    const prev = (external[discipline] ?? '').trim();
    if (t === prev) return; // no-op
    const next: ExternalTeamBlob = { ...external };
    if (t) next[discipline] = t;
    else delete next[discipline];
    await updateMutation.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: { external_team: next },
      fieldLabel: `${discipline} consultant`,
    });
  }

  /** The "+ Add discipline…" control. Collapsed, it offers EVERY discipline,
   *  because the four slots that would normally carry them are not drawn. */
  function addPicker(options: readonly WaitingOnDiscipline[]) {
    return (
      <select
        value=""
        onChange={(e) => {
          const d = e.target.value as WaitingOnDiscipline;
          if (d) addDiscipline(d);
        }}
        className="text-[9px] border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 cursor-pointer text-dim"
        style={{ borderBottomColor: 'var(--color-border)' }}
        data-testid="pd-ext-add-discipline"
      >
        <option value="">+ Add discipline…</option>
        {options.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
    );
  }

  if (externalCollapsed) {
    return (
      <div className="flex items-center gap-1.5" data-testid="pd-ext-section">
        {/* ★ The fact, said in the words the CTA used to spend two lines on.
            "None yet" is the whole state; the control beside it is the way out
            of it, and the two together are one row. */}
        <span className="text-[9px] text-dim whitespace-nowrap" data-testid="pd-ext-none">
          None yet
        </span>
        {addPicker(WAITING_ON_OPTIONS)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="pd-ext-section">
      {/* fix-196: empty-state reminder — most projects need at least a
          surveyor / structural / arborist. ★ fix-423: only ever seen now on a
          project where somebody has surfaced a slot but filled none in, which
          is the moment it is actually useful. */}
      {noneAssigned && (
        <div
          className="text-[8px] leading-tight rounded border px-1.5 py-1"
          style={{
            background: 'var(--color-co-bg)',
            borderColor: 'var(--color-co-border)',
            color: 'var(--color-co)',
          }}
          data-testid="pd-ext-empty-cta"
        >
          No external team yet — add a Surveyor / Structural / Arborist below.
        </div>
      )}

      {shownDisciplines.map((discipline) => {
        const saved = external[discipline] ?? '';
        return (
          <div
            key={discipline}
            className="flex flex-col gap-0.5"
            data-testid={`pd-ext-row-${discipline}`}
          >
            <span className="text-[8px] font-bold text-dim uppercase tracking-wide">
              {discipline}
            </span>
            <ExternalFirmSelect
              discipline={discipline}
              value={saved}
              firms={directoryFirmNamesForDiscipline(directory, discipline)}
              disabled={occMissing || updateMutation.isPending}
              variant="compact"
              testIdBase={`pd-ext-${discipline.toLowerCase()}`}
              onCommit={(firm) => void writeFirm(discipline, firm)}
            />
          </div>
        );
      })}

      {/* fix-196: surface an as-yet-unshown discipline. */}
      {addableDisciplines.length > 0 && addPicker(addableDisciplines)}
    </div>
  );
}

// ============================================================
// Builder / Owner cell — fix-24d: BuilderAutocompleteField on all 4
// fields (Owner / Business / Email / Cell). Typing surfaces matching
// catalog entries; picking one calls fillFromBuilder which sets all
// four siblings and fires ONE save with the full patch (avoids the
// 4-saves-per-pick race you'd get from blurring each input in
// sequence). Typing without picking still commits-on-blur as before
// and the auto-promote in useUpdateProject (fix-24b) puts the typed
// name into the catalog.
//
// Pre-history: fix-22 Mig 6+7 moved the 4 builder fields permits →
// projects; this cell wrote them as plain inputs until fix-24d wired
// the autocomplete here to match the wizard's Step 1 panel and the
// Project Settings modal.
// ============================================================

/** ★★ fix-448 §B4: one cached builder field, displayed.
 *
 *  It keeps the label/height of the input it replaced so the Builder / Owner
 *  card is the same size it was (fix-441 set that size, and the MUST-NOT-CHANGE
 *  list keeps it) — but it is text, so there is no path from this card into
 *  `builder_email` and friends. An em dash for an empty one: a blank line would
 *  read as a rendering gap rather than "not recorded". */
function ReadOnlyBuilderLine({
  label,
  value,
  testid,
  accent,
}: {
  label: string;
  value: string | null | undefined;
  testid: string;
  accent?: boolean;
}) {
  const has = (value ?? '').trim() !== '';
  return (
    <div>
      <span className="text-[8px] font-bold text-dim uppercase tracking-wide">
        {label}
      </span>
      {/* ★★★ fix-475 — WRAPS NOW, AND ONLY fix-448 MADE THAT POSSIBLE.
          fix-417 gave Builder/Owner a 190px floor because *"these are <input>
          elements and an input does NOT wrap"*. fix-448 then made Email / Cell
          / LLC Address READ-ONLY TEXT — but left `truncate` on them, so they
          kept clipping for a reason that had stopped applying.

          ★★ fix-475 moves this card into Team, whose floor is 160. Text that
          WRAPS is readable at 160px; text that truncates is not, and an
          `<input>` never could be. So the ellipsis goes and a long email takes
          two lines — which is exactly the fix that was unavailable when the
          floor was set, and is why the floor does not have to travel with the
          content. `break-all` because an email has no spaces to break at. */}
      <div
        className="text-[12px] font-bold py-0.5 break-all"
        style={{
          color: has
            ? accent
              ? 'var(--color-de)'
              : 'var(--color-text)'
            : 'var(--color-dim)',
        }}
        title={value ?? undefined}
        data-testid={testid}
      >
        {has ? value : '—'}
      </div>
    </div>
  );
}

function BuilderOwnerCell({ project }: { project: Project }) {
  const updateProject = useUpdateProject();
  const occMissing = !project.updated_at;

  // ★★★ fix-448 §B: THE FIVE LOCAL DRAFTS ARE GONE with the free-text boxes.
  //
  // They existed so a half-typed value could live in the component until blur.
  // Nothing types into these fields any more — the picker writes all six
  // columns at once and the four lines below render `project.*` directly — so a
  // local copy would only be a second, staler answer to a question the project
  // row already answers. The POC pair below stays: it IS per-project free text.
  const [pocName, setPocName] = useState(project.poc_name ?? '');
  const [pocEmail, setPocEmail] = useState(project.poc_email ?? '');

  async function commit<K extends keyof Project>(
    field: K,
    next: string,
    original: string | null | undefined,
    label: string,
  ) {
    if (!project.updated_at) return;
    const trimmed = next.trim();
    const normalized: string | null = trimmed === '' ? null : trimmed;
    if (normalized === (original ?? null)) return;
    // ★★ fix-425: CLEARING THE BUILDER'S NAME DROPS THE LINK TOO. A project
    //    that names no builder must not still point at one — that is a
    //    dangling reference, and it is worse for "group by builder" than no
    //    reference at all. This is the only builder_id write on the blur path
    //    and it is a CLEAR: it can never produce a wrong link, only remove
    //    one, so fix-174's rule about partial names is untouched.
    //
    //    ★ Deliberately NOT the mirror case: typing a new name by hand does
    //      not re-point the link, because a half-typed name is exactly what
    //      fix-174 exists to keep out of the catalog. Re-linking happens on a
    //      pick, or on a save through one of the two RPCs.
    const clearsBuilder = field === 'builder_name' && normalized === null;
    await updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: {
        [field]: normalized,
        ...(clearsBuilder ? { builder_id: null } : null),
      } as Partial<Project>,
      fieldLabel: label,
    });
  }

  /** fix-24d: user picked an existing builder from the autocomplete
   *  menu. Mirror the modal's pattern — fill all four local states,
   *  then fire ONE save carrying the full patch so OCC sees a single
   *  atomic write instead of four racing per-field commits.
   *
   *  ★★★ fix-425: AND IT RECORDS WHICH BUILDER, which is the entire point of
   *  the catalog. 33 of 202 projects carry a `builder_id` and every one of
   *  them was written by the 2026-05-01 import — nothing has linked a project
   *  since, while 114 of them name a builder that is already a catalog row.
   *
   *  ★★ THIS IS THE ONE PICK PATH THAT NEEDS THE ID CLIENT-SIDE. The Settings
   *  modal and the New Project wizard both save through
   *  bp_update/create_project_with_permits, and fix-425 has those RESOLVE the
   *  builder server-side from the name + company they were given — the same
   *  (name, company) key the catalog's unique index uses. That is strictly
   *  more correct than carrying an id, because somebody who picks a builder
   *  and then edits the name before saving has chosen a different builder, and
   *  a carried id would still point at the old one. This cell does not go
   *  through either RPC (fix-99's useUpdateProject writes the table directly),
   *  so here the id has to travel with the pick or the link never happens.
   *
   *  ★ IT IS NOT fix-24b. Nothing is created: `b` IS a catalog row the user
   *  chose from a menu, so this writes a reference to something that already
   *  exists. fix-174's boundary is about when a row is CREATED from a
   *  half-typed field, and picking from a list is the opposite of that. */
  /** ★★★ fix-448 §B3 — CLEAR TAKES THE LINK AND ALL FIVE CACHE FIELDS.
   *
   *  fix-425 made "clearing the name clears `builder_id`" true on the blur
   *  path; with the free-text path gone this is the only clear there is, and
   *  it empties all six in ONE patch under one OCC token. Never one without
   *  the other — a project showing a company with no link is the same defect
   *  wearing different clothes. */
  function clearBuilder() {
    if (!project.updated_at) return;
    void updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: {
        builder_id: null,
        builder_name: null,
        builder_company: null,
        builder_email: null,
        builder_phone: null,
        builder_address: null,
      },
      fieldLabel: 'Builder',
    });
  }

  function fillFromBuilder(b: Builder) {
    const nextName = b.name ?? '';
    const nextCompany = b.company ?? '';
    const nextEmail = b.email ?? '';
    const nextPhone = b.phone ?? '';
    // fix-175: the entity address travels on pick; POC is per-project and is
    // intentionally left untouched.
    const nextAddress = b.address ?? '';
    // ★ No local state to sync: the patch below is the only writer, and the
    //   card re-renders from the project cache the mutation updates.
    if (!project.updated_at) return;
    void updateProject.mutateAsync({
      projectId: project.id,
      expectedUpdatedAt: project.updated_at,
      patch: {
        builder_name: nextName || null,
        builder_company: nextCompany || null,
        builder_email: nextEmail || null,
        builder_phone: nextPhone || null,
        builder_address: nextAddress || null,
        // ★★★ fix-425: the link, in the same atomic patch as the five fields
        //     it belongs with. One write, one OCC token, no racing.
        builder_id: b.id,
      },
      fieldLabel: 'Builder',
    });
  }

  const labelStyle =
    'text-[8px] font-bold text-dim uppercase tracking-wide';
  const inputClass =
    'text-[12px] font-bold text-text border-0 border-b outline-none bg-transparent w-full px-0 py-0.5 disabled:opacity-50';
  const inputStyle = { borderBottomColor: 'var(--color-border)' };
  const emailInputClass = `${inputClass} font-semibold`;
  const emailInputStyle = { ...inputStyle, color: 'var(--color-de)' };

  return (
    // fix-290: was a fixed 240px column with a left border — a holdover from the
    // pre-fix-285 flex row, and the last card not to look like the others. It is
    // now a grid column like every other card, so its width comes from the grid
    // rather than from a number nothing else knows about.
    <OverviewCard title="Builder / Owner" testId="pd-builder-cell">
     <OverviewSection>
      <div className="flex flex-col gap-1.5">
      {/* ★★★ fix-448 §B (P-082) — ONE PICKER, THEN FOUR READ-ONLY LINES.
          Bobby, 2026-08-29: *"PICK-ONLY, like Zone … Text and link can never
          disagree again."*

          ★★ THE FIVE BOXES WERE FIVE WAYS TO BREAK THE LINK. Each was a
          free-text commit; typing over the name after a pick left `builder_id`
          pointing at the row you had stopped naming, which is P-082. There is
          no free-text commit path left on this card. */}
      <div>
        <span className={labelStyle}>Owner</span>
        <BuilderPicker
          value={
            project.builder_company
              ? `${project.builder_name ?? ''} — ${project.builder_company}`
              : (project.builder_name ?? '')
          }
          linkedCompany={project.builder_company}
          onPick={fillFromBuilder}
          onCreated={fillFromBuilder}
          onClear={clearBuilder}
          disabled={occMissing}
          inputClassName={inputClass}
          inputStyle={inputStyle}
          testid="pd-builder-name"
        />
      </div>
      {/* ★★★ §B4 — THE FIVE CACHE COLUMNS ARE A CACHE, NOT A SECOND TRUTH.
          `projects.builder_company/_email/_phone/_address` are fix-175's
          autofill copy of the catalogue row. Rendering them as inputs invited
          exactly the divergence this ticket abolishes, so they display what the
          LINKED ROW says and nothing else. Contact details are edited once, in
          Settings → Lists & Catalogs → Builders & Owners, where every project
          using that LLC picks the change up. */}
      <ReadOnlyBuilderLine
        label="Business"
        value={project.builder_company}
        testid="pd-builder-company"
      />
      <ReadOnlyBuilderLine
        label="Email"
        value={project.builder_email}
        testid="pd-builder-email"
        accent
      />
      <ReadOnlyBuilderLine
        label="Cell"
        value={project.builder_phone}
        testid="pd-builder-phone"
      />
      {/* fix-175: owner LLC address, from the builder entity. */}
      <ReadOnlyBuilderLine
        label="LLC Address"
        value={project.builder_address}
        testid="pd-builder-address"
      />
      {/* fix-175: per-project point-of-contact. Plain inputs (no catalog
          autocomplete) — the contact can differ deal-to-deal. */}
      <div>
        <span className={labelStyle}>Point of Contact</span>
        <input
          type="text"
          value={pocName}
          onChange={(e) => setPocName(e.target.value)}
          onBlur={() => commit('poc_name', pocName, project.poc_name, 'Point of Contact')}
          placeholder="Contact name"
          disabled={occMissing}
          className={inputClass}
          style={inputStyle}
          data-testid="pd-poc-name"
        />
      </div>
      <div>
        <span className={labelStyle}>Contact Email</span>
        <input
          type="email"
          value={pocEmail}
          onChange={(e) => setPocEmail(e.target.value)}
          onBlur={() => commit('poc_email', pocEmail, project.poc_email, 'Contact Email')}
          placeholder="contact@email.com"
          disabled={occMissing}
          className={emailInputClass}
          style={emailInputStyle}
          data-testid="pd-poc-email"
        />
      </div>
      </div>
     </OverviewSection>
    </OverviewCard>
  );
}

// ============================================================
// Helpers
// ============================================================

// ★ fix-311: PhaseRow is gone. It existed to render GO Date as bare text with
// an optional dashed underline — the two things this ticket removed. Every date
// on the Milestones card now goes through MilestoneDateRow, and leaving a second
// date-row component in the file is how a ninth row quietly gets built the old
// way six months from now.

// ★★★ fix-475 §2 removed `TeamRow`. It rendered an abbreviation + a value on
// one line, which is what the roster stopped being: one role per block,
// spelled out, with a face. Its em-dash-for-empty behaviour went with it
// deliberately — the brief's rule is that an unfilled role renders NOTHING,
// because an empty circle beside an empty name reads as a broken avatar rather
// than an unassigned role.


// ★ fix-311: formatGoDate ("Jun 5, 2026") is gone with PhaseRow. ★ fix-320
// settled which format replaced it: `formatMilestoneDate`, up beside
// MilestoneDateRow, renders read-only rows the way the date INPUTS render —
// 09/11/2026 in a US browser — because a native date input follows the
// browser's locale and cannot be told otherwise. ISO was fixed-width but was
// the wrong half of the mismatch to keep.
//
// ★ There is ONE date formatter in this file and it lives with the row that
// uses it. formatGoDate was deleted so a second could not exist; do not add one
// back for a ninth row.

// ============================================================
// fix-22 Mig 3: Site editor — writes zone / lot / alley / parking_type /
// parking_stalls to projects via useUpdateProject. Previously wrote to
// permits via useUpdatePermit on the BP.
// ============================================================

function SiteEditor({ project }: { project: Project }) {
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
      {/* ★★★ fix-410 (P-040) — REGULAR SHAPE, editable after setup.
          Bobby: *"an equal widths / equal lengths rectangle, or irregular."*

          ★★ THE BLANK OPTION IS KEPT HERE EVEN THOUGH THE WIZARD HAS NONE.
          The form answers for every NEW project; this row has to render what a
          row ACTUALLY holds, and a NULL must read as blank rather than as
          "Yes". A blank means nobody has said — showing it as a Yes would turn
          an absence into a claim about somebody's lot. (After fix-410's
          approved backfill no project is null today; the state is built
          because a future create path that omits the key still produces one.)

          ★ Same SiteSelectRow, same commit(), same OCC token as every other
          field in this section — see the note on Corner above. */}
      <SiteSelectRow
        label="Regular Shape"
        value={
          project.is_regular_shape === true
            ? 'Yes'
            : project.is_regular_shape === false
              ? 'No'
              : ''
        }
        options={['', 'Yes', 'No']}
        disabled={occMissing}
        onCommit={(v) => {
          const next = v === 'Yes' ? true : v === 'No' ? false : null;
          void commit(
            'is_regular_shape',
            next,
            project.is_regular_shape,
            'Regular Shape',
          );
        }}
      />
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

// ============================================================
// fix-22 Mig 3: Unit Dimensions editor — unit_types moved permits →
// projects. Writes via useUpdateProject.
// fix-206: parseUnitTypes + resolveUnitTypesForSave now live in
// lib/unitTypeNaming so the Library matrix shares the identical read/write
// shape (one store, two editable views).
// ============================================================

function UnitDimensions({ project }: { project: Project }) {
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
  //    project whose own product_types are ['SFR'] would otherwise mark a unit
  //    labelled "Duplex" as off-list, and Duplex is a perfectly real type.
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
  // ★★★ fix-412 SCOPE B5 — a confirmed No-work unit hides its drawn detail.
  //     DISABLED, not cleared: `onChange` is never called, so whatever is
  //     stored stays stored and comes back the moment the answer changes.
  const noWork = isNoWorkUnit(row);
  const off = disabled || noWork;
  // ★★★ fix-418 SCOPE B, KEPT EXACTLY — WORK BELONGS TO A REMODEL.
  //
  // Bobby, 2026-08-26: *"that should only populate if and when the remodel
  // label is deployed."* P-050 specified `work_scope` as a property of a
  // Remodel; a Duplex has no meaningful answer, and a greyed control still says
  // "there is a question here you have not answered". ABSENT, not disabled.
  //
  // ★★★ AND THE STORED VALUE IS STILL NEVER TOUCHED. Nothing here writes
  // `work_scope` when the label changes — `onUpdate` spreads the existing unit
  // and `parseUnitTypes` still names the key — so a unit relabelled away from
  // Remodel keeps its answer and relabelling back shows it again.
  const isRemodel = label === 'Remodel';

  // ★★★ fix-422 SCOPE 7 — WORK IS A CHIP UNDER THE ROW, NOT A MATRIX COLUMN.
  //
  // ★★ IT HAS THREE STATES AND THE THIRD IS "NOT YET ANSWERED". Every other
  // matrix cell answers with one glyph; `work_scope` cannot, because any letter
  // in a one-glyph box reads as an answer and the whole point of the third
  // state is that nobody has given one. `—` would collide with the "not
  // recorded" glyph the other columns already use for NULL, which is the same
  // conflation fix-402 exists to prevent.
  //
  // ★ So it keeps its words, under the row it belongs to, indented to the
  //   matrix's Type column so it reads as that row's footnote rather than a
  //   free-floating control.
  return (
    <div data-testid="pd-unit-row-group">
      <div
        className="grid items-center"
        style={{ gridTemplateColumns: UNIT_MATRIX_GRID }}
        data-testid="pd-unit-row"
        data-no-work={noWork ? 'true' : 'false'}
        data-remodel={isRemodel ? 'true' : 'false'}
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
        <span aria-hidden={offListLabel ? undefined : 'true'}>
          {offListLabel && (
            <span
              className="text-[8px] px-1 rounded font-bold uppercase"
              style={{ background: 'var(--color-s2)', color: 'var(--color-muted)' }}
              title="Not in the product-type list — kept exactly as stored"
              data-testid="pd-unit-label-offlist"
            >
              !
            </span>
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
      {isRemodel && (
        <div
          className="flex items-center gap-1 mt-0.5 mb-0.5"
          data-testid="pd-unit-work-chip"
        >
          <span
            className="text-[8px] font-extrabold uppercase tracking-wide text-dim cursor-help"
            title={WORK_SCOPE_TOOLTIP}
          >
            {WORK_SCOPE_LABEL}
          </span>
          <WorkScopeSelect
            value={row.work_scope}
            disabled={disabled}
            onChange={(v) => onChange('work_scope', v)}
            testid="pd-unit-work-scope"
          />
        </div>
      )}
    </div>
  );
}
