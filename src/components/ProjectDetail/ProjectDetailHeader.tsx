import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import type {
  Builder,
  PermitWithCycles,
  Project,
} from '../../lib/database.types';
import { useUpdateProject } from '../../hooks/useUpdateProject';
import { useDrawSchedule } from '../../hooks/useDrawSchedule';
import { useViewportAwarePopover } from '../../hooks/useViewportAwarePopover';
import { drawScheduleTarget } from '../../lib/drawScheduleLink';
// ★★★ fix-448 §B: the pick-only replacement for the five autocomplete
// boxes. See components/builder/BuilderPicker for why blur reverts.
import BuilderPicker from '../builder/BuilderPicker';
// ★ fix-449 §C: the canonical product-type registry, for the off-list mark.
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
// ★ fix-506 §B/§C/§D: the read-only interior of the Project card.
import { SiteAndDates, UnitsMatrix } from './ProjectOverviewBoxes';
// ★ fix-507 §B/§C: the pair's declared breakpoint, and the Team card's grid.
import {
  PROJECT_CARD_CLASS,
  SITE_DATES_RESPONSIVE_CSS,
} from '../../lib/projectCardLayout';
import {
  TEAM_CARD_CLASS,
  TEAM_GRID_CHAT_CLASS,
  TEAM_GRID_CLASS,
  TEAM_GRID_COLUMN_1_CLASS,
  TEAM_GRID_CSS,
} from '../../lib/teamCardLayout';
import { parseUnitTypes } from '../../lib/unitTypeNaming';
// ★ fix-506 §F: the pills the Consultants CARD used to hold, now a band
//   across the foot of Team.
import { ConsultantBand } from './ConsultantBand';
// ★ fix-475 §2: the fix-343 pair, reached through the components that already
//   use it (fix-467/fix-468). No third initials function.
import { useRosterFullName } from '../../hooks/useRosterFullName';
import { Avatar } from './ChatMessageBody';

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
      {/* ★★★ fix-507 §B/§C — the Site/Dates pair's declared breakpoint and the
          Team card's three-column grid, generated from their own modules for
          the same reason as the band above: a `?raw` CSS import is EMPTY under
          vitest (fix-406), and both of these carry numbers a test has to be
          able to read. */}
      <style data-testid="pd-site-dates-css">{SITE_DATES_RESPONSIVE_CSS}</style>
      <style data-testid="pd-team-grid-css">{TEAM_GRID_CSS}</style>
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
        {/* ★★★ fix-506 §A — THREE CELLS, AND THE PLAN OF RECORD LEADS.
            Bobby reads the overview left to right as a book (P-139), and the
            plan is what the page is about. Milestones' dates are the Project
            card's Dates box now; the Consultants card is the Team card's
            bottom band. */}
        <div {...{ [OVERVIEW_CELL_ATTR]: 'por' }} style={{ gridArea: 'por', height: '100%' }}>
          <PlanOfRecordCard projectId={project.id} />
        </div>
        <div {...{ [OVERVIEW_CELL_ATTR]: 'proj' }} style={{ gridArea: 'proj', height: '100%' }}>
          <ProjectCell project={project} bp={bp} allProjects={allProjects} />
        </div>
        {/* ★★ THE FORCED LINE BREAK, unchanged in kind. `display:none` unless
            the row has wrapped AND the first line still fits, because flex
            picks its own break points and they are wrong just under the
            threshold. With three cards it pins Plan of Record + Project on line
            one and Team on line two — the pair that is read against each other,
            together. Zero height, no margin, aria-hidden: a layout instruction,
            not content. */}
        <div className={OVERVIEW_ROW_BREAK_CLASS} aria-hidden="true" data-testid="pd-overview-break" />
        <div
          {...{ [OVERVIEW_CELL_ATTR]: 'team' }}
          style={{ gridArea: 'team', height: '100%' }}
          data-testid="project-overview-team-col"
        >
          <TeamCell project={project} bp={bp} permits={permits} />
        </div>
      </div>
    </div>
  );
}

/** ★ fix-479 §B: the floating panel's declared geometry, in one place.
 *  The WIDTH is measured off the trigger when the panel opens — these two
 *  are the fallback for a zero-rect environment (jsdom) and the cap that
 *  makes a short viewport SCROLL the panel rather than clip it. */
const BUILDER_PANEL_FALLBACK_WIDTH = 240;
const BUILDER_PANEL_MAX_HEIGHT = 420;
// ★ Above the cards (none of which draws a stacking context of its own) and
//   below the app's modals, which sit at 50+.
const BUILDER_PANEL_Z = 40;

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

  // ★★★ fix-479 §B (P-132 #3) — THE EXPANDED CARD FLOATS. IT DOES NOT PUSH.
  //
  // Bobby, 2026-09-02: *"when you click to expand, it pushes everything
  // vertically down, and maybe it would just overlap like the internal team
  // when you expand and collapse. That way the vertical height isn't pushing
  // everything down."*
  //
  // ★★★ AND "DOES NOT PUSH" IS A CLAIM ABOUT THE WHOLE ROW, NOT JUST THIS CARD.
  //     fix-423's rule is that the overview row's height is a MAX over its five
  //     cells, so an inline block that grows the Team card grows Milestones,
  //     Project, the Plan of Record and Consultants with it. That is the defect;
  //     a layer that takes no space in flow is the fix, and it is asserted by
  //     measuring the card's own offsetHeight open and closed.
  //
  // -------------------------------------------------------------------------
  // ★★★ WHY IT IS `position: fixed` AND NOT `position: absolute`
  // -------------------------------------------------------------------------
  // The brief allowed an absolutely-positioned layer inside the card *"if the
  // Team cell (or its card) has position: relative and does not overflow:
  // hidden — if it does, say so"*. **It does.** `OverviewCard` renders
  // `border rounded-md overflow-hidden …` (see OverviewCard.tsx), and that clip
  // is load-bearing in the OTHER direction: fix-422's finding is that a card
  // narrower than its content TRUNCATES silently rather than pushing the page
  // sideways, which is the scroll fix-423 was closing. Turning the clip off for
  // one card so a panel can escape downwards would let that card's content
  // escape sideways too.
  //
  // ★★ So the layer is `position: fixed`, which an ancestor's overflow does not
  //    clip at all — a fixed box's containing block is the viewport, so the card
  //    is not in its clip chain. This is the SAME hook `ReviewerRollupChip`
  //    already uses for exactly this reason ("the table sits inside a scroll
  //    container, so anchoring with absolute position would clip"), so it is a
  //    pattern reused, not a second one invented.
  //
  // ★ IT IS STILL THE TEAM CARD'S OWN DOM. No portal: the panel renders as a
  //   child of this disclosure, inside the Team cell, so `OVERVIEW_CELL_ATTR`
  //   measurements and fix-423's row logic see exactly the tree they saw
  //   before. A fixed child contributes nothing to its parent's layout, which
  //   is the whole point.
  const btnRef = useRef<HTMLButtonElement | null>(null);
  // ★ The panel is the WIDTH OF THE CARD BODY, which is the width of the
  //   disclosure button — measured, because the grid decides it (the five
  //   columns resolve from OVERVIEW_GRID_TEMPLATE) and no constant here could
  //   know it. The fallback is only ever reached in jsdom, where every rect is 0.
  const [anchorWidth, setAnchorWidth] = useState(0);
  useEffect(() => {
    if (!open) return;
    function measure() {
      const el = btnRef.current;
      if (el) setAnchorWidth(el.getBoundingClientRect().width);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open]);

  // ★★★ fix-508 §F3 — THE PANEL OVERLAYS WIDER THAN ITS COLUMN.
  //
  //     fix-479 sized it to the trigger, when the trigger was a full Team card
  //     (447px) and Bobby's complaint was that expanding was *"so horizontally
  //     wide"*. fix-507 §C then put Builder/Owner in a 142px column — and the
  //     panel followed it down, so a full email wrapped to three lines inside
  //     a 95px box. Sizing to the trigger stopped being the right rule the
  //     moment the trigger stopped being the card.
  //
  // ★★★ AND THE FIX IS THE PANEL, NOT THE COLUMN. `TEAM_GRID_COLUMN_1_MIN`
  //     must not rise to make an email fit: at 1600 it would push the chat cell
  //     under its 150px minimum, collapse the container query and hand back
  //     fix-507 §C's whole 1600 win. A floating layer is the one thing here
  //     that can be wider than the box it comes out of — it takes no space in
  //     flow, which is fix-479's own reason for making it float.
  //
  // ★ `max`, not a constant: on a wide card the panel still matches the
  //   trigger, so Bobby's original complaint stays fixed where it was made.
  const popover = useViewportAwarePopover({
    triggerRef: btnRef,
    open,
    width: Math.max(anchorWidth, BUILDER_PANEL_FALLBACK_WIDTH),
    maxHeight: BUILDER_PANEL_MAX_HEIGHT,
    preferred: 'bottom',
    gap: 4,
  });

  // ★★ THREE WAYS OUT, and the brief named all three: the Collapse button,
  //    Escape, and a click outside the layer. A layer that covers the roster
  //    has to be dismissible without hunting for the control that opened it.
  //
  // ★ `mousedown` rather than `click`, so a drag that STARTS inside the panel
  //   and ends outside it — selecting an email address — does not close it.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onDown(e: MouseEvent) {
      const wrap = wrapRef.current;
      if (wrap && !wrap.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div className="flex flex-col gap-1" ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} builder and owner details`}
        className="w-full text-left rounded border px-2 py-1 pb-3 relative"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-s2)',
        }}
        data-testid="pd-builder-disclose"
      >
        {/* ★★★ fix-507 §C — THE NAME IS THE HEADING AND THE COMPANY IS THE
            SUBHEADING, and the word `Expand` is gone from the face.

            Bobby: *"their name and then their company name, kind of like in
            these heading, subheading fonts"*, and the mock's `.bo .car` puts a
            bare caret in the corner. fix-475 led with a `Expand ⌄` label above
            the name, which spent the block's strongest line on the CONTROL
            rather than on the person — in a 142px column that is the whole
            first line gone.

            ★ The word survives where it is actually needed: `aria-label` still
              says "Expand builder and owner details", so nothing was taken away
              from a screen reader — only from the two-line block a reader is
              scanning for a name. `aria-expanded` is unchanged. */}
        {/* ★★★ fix-508 §F3 — THE NAME CARRIES THE MOCK'S WEIGHT. Bobby:
            *"their name and then their company name, kind of like in these
            heading, subheading fonts."* fix-507 §C got the ORDER right (name
            first, company beneath, the word `Expand` gone) but left both lines
            at nearly the same weight, so the block read as two facts rather
            than as a person and where they work. 11.5 semibold → 13 extrabold
            against a 10.5 regular company line. */}
        <span className="block text-[13px] font-extrabold truncate leading-tight" style={{ color: 'var(--color-text)' }}>
          {owner || '—'}
        </span>
        {/* ★ An unset one renders the card's normal em dash rather than a
            blank, so "not recorded" and "still loading" cannot look the same. */}
        <span className="block text-[10.5px] truncate" style={{ color: 'var(--color-text)' }}>
          {business || '—'}
        </span>
        <span
          className="absolute right-1.5 bottom-0.5 text-[10px] leading-none"
          style={{ color: 'var(--color-muted)' }}
          aria-hidden="true"
          data-testid="pd-builder-caret"
        >
          {open ? '⌃' : '⌄'}
        </span>
      </button>
      {open && (
        // ★ The shadow is what makes it read as a LAYER rather than as a
        //   section that has appeared. The border and the rounding come from
        //   the OverviewCard inside it, unchanged — this is the same card that
        //   used to render inline, in the same place, with the same fields, all
        //   still editable.
        <div
          className="shadow-xl rounded-md"
          style={{
            ...(popover.style ?? {
              position: 'fixed',
              top: 0,
              left: 0,
              width: BUILDER_PANEL_FALLBACK_WIDTH,
              maxHeight: BUILDER_PANEL_MAX_HEIGHT,
              overflowY: 'auto',
            }),
            zIndex: BUILDER_PANEL_Z,
            background: 'var(--color-surface)',
          }}
          data-testid="pd-builder-expanded"
        >
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

// ============================================================
// Project cell — Proposal (units/type/unit_types/tags) + Site (zone/
// lot/alley/parking). All values read from projects.*, all writes via
// useUpdateProject post-Mig 3.
// ============================================================

// ===========================================================================
// ★★★ fix-506 §A/§B/§C/§D (P-139, P-140) — THE PROJECT CARD, REBUILT
// ===========================================================================
//
// Bobby's v14: *"Permit intake's column is gone; its width goes to the Plan of
// Record card."* Milestones and Consultants cease to exist as CARDS, and this
// one absorbs the dates half of that:
//
//     Site data  |  Dates            <- a flex-wrap pair (projectCardLayout)
//     [Connect ↗]|  [Draw schedule →]
//     -------------------------------
//     units matrix, types across
//
// ★★★ WHAT LEFT THIS CARD, AND WHERE IT WENT. Every one of these is an EDITOR
//     that moved to Project Data (§G) rather than a field that was deleted:
//
//       Proposal · Units (stored)   -> Units is DERIVED from the unit rows now
//       Proposal · Type chips       -> Project Data, Site data tab
//       Proposal · Redesigns (N)    -> Project Data, Actions tab
//       Site · every inline editor  -> Project Data, Site data tab
//       Unit dimensions editor      -> Project Data, Units tab
//
// ★★ THE PERMIT-LESS SHELL IS NOT A SPECIAL CASE ANY MORE, and that is worth
//    saying because the card it replaces had three branches for it. Every date
//    in the new box prints `—` when its source is null, so a project with no
//    Building Permit renders the same shape with empty values — which is the
//    brief's own rule for the three BP rows, applied to all eleven.

function ProjectCell({
  project,
  bp,
  allProjects,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  allProjects: Project[];
}) {
  // ★ ONE parse, handed to both readers. `parseUnitTypes` is a whitelist that
  //   both editors write back through (fix-412), and two parses of the same
  //   JSONB are two chances for the derived count and the matrix to disagree
  //   about how many units a project has.
  const unitTypes = useMemo(
    () => parseUnitTypes(project.unit_types),
    [project.unit_types],
  );
  // ★★★ THE DRAW BLOCK'S START WEEK, NOT `dd_start`. `drawScheduleTarget`
  //     turns this into `?quarter=`, and the two are different facts: dd_start
  //     is when design development begins, `draw_schedule.start_week` is where
  //     the project's BLOCK sits on the board. Handing it the wrong one gives a
  //     link that opens the wrong quarter — fix-306's defect class, and a
  //     regression I introduced here that the fix-335 §7 suite caught.
  const drawQ = useDrawSchedule();
  const drawStart =
    (drawQ.data ?? []).find(
      (r) => (r as { project_id?: string }).project_id === project.id,
    )?.start_week ?? null;

  return (
    // ★★★ fix-507 §B: the card carries the containment context the Site/Dates
    //     pair's breakpoint queries. `container-type: inline-size` contains the
    //     INLINE axis only, so the card's height distribution (fix-331 §1) and
    //     its `h-full` stretch (fix-309 #55) are untouched — and its width has
    //     never come from its contents anyway, because the row's tracks are
    //     `minmax(<px>, <fr>)` (fix-417).
    <OverviewCard title="Project" testId="pd-project-card" className={PROJECT_CARD_CLASS}>
      <SiteAndDates
        project={project}
        bp={bp}
        allProjects={allProjects}
        unitTypes={unitTypes}
        siteFoot={<ConnectLink />}
        datesFoot={
          <DrawScheduleLinkRow projectId={project.id} startWeek={drawStart} />
        }
      />
      {/* ★★★ AND STILL NO `overflow-x` ANYWHERE IN HERE. fix-417 §B's scroller
          stays deleted. What keeps the matrix legible is that the PROJECT
          card's FLOOR is derived from the transposed matrix at six type
          columns, so the card can never be narrower than the grid inside it
          and never has anything to scroll. See lib/projectCardLayout. */}
      <UnitsMatrix unitTypes={unitTypes} />
    </OverviewCard>
  );
}

// ============================================================
// ★★★ fix-506 §C (P-032) — CONNECT IS A REAL LINK NOW
// ============================================================
//
// Bobby, 2026-09-08: it opens `blueprint.datapage.com/home`, *"for the time
// being"*.
//
// ★★★ THIS RETIRES THE APP'S ONLY INERT CONTROL. fix-335 §8 shipped it as a
//     placeholder — knowingly, against the no-placeholders rule Bobby himself
//     set, because nobody knew what URL it should open. It was made honest by
//     LOOKING not-yet-working: disabled, dashed, "no link yet". The whole of
//     that treatment goes, because the reason for it does.
//
// ★★ fix-335's note on WHAT THE REAL VERSION LIKELY IS turned out to be wrong
//    in an instructive way, so it is recorded rather than deleted: it guessed a
//    protocol handler (`connect://…`) registered by the desktop installer, and
//    warned that Chrome refuses to navigate an https page to `file:` or a UNC
//    path SILENTLY (fix-289). Neither applies — the answer was a web address
//    all along, which is why this is an ordinary `<a target="_blank">` and
//    needs none of that machinery.
//
// ★ "For the time being" is Bobby's own framing and is why the URL is a named
//   constant: when Connect gets a per-project deep link, one line changes.

/** ★ Named, not inlined, so a test can assert the EXACT destination rather than
 *  "an href exists" — the fix-335 §4 rule for SHAREPOINT_URL, and the fix-306
 *  defect class it exists to prevent (a nav link to the wrong place). */
export const CONNECT_URL = 'https://blueprint.datapage.com/home';

function ConnectLink() {
  return (
    <OverviewSection testId="pd-connect-section" pinBottom>
      <OverviewAction
        href={CONNECT_URL}
        testId="pd-connect-button"
        title="Open Connect (blueprint.datapage.com) in a new tab"
      >
        <span>Connect</span>
        <span className="font-normal text-[9px]">↗</span>
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
    // ★ fix-487: the sixth block. `internal` is `projectInternalTeam`, which
    //   deliberately does NOT let the BP's own `ca` override the project's —
    //   see lib/projectTeam for why this one differs from ent/dm/da.
    ca: internal.ca,
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
    <OverviewCard title="Team" testId="project-overview-team" className={TEAM_CARD_CLASS}>
      {/* ★★★ fix-507 §C (P-176) — BUILDER/OWNER AND INTERNAL RUN DOWN COLUMN 1,
          CHAT TAKES THE BLOCK TO THEIR RIGHT.

          This is fix-506's stated deviation #1 coming home, and it is the
          single largest lever on §D: Team is the TALLEST card in the row on
          both measurement projects (773 / 721 at 1920), and Chat stacked
          underneath costs its full height where beside costs nothing.

          ★★★ WHAT fix-345 §3 AND fix-331 §1 DO UNDER THIS GRID is answered in
              full in lib/teamCardLayout — the short version is that the Chat
              BUTTON's section is still a direct `pinBottom` child of the card
              (fix-345 untouched), and the grid is itself a GROWING child, so
              fix-331's distribution still happens, over two children instead of
              four, with the grid passing its share to the Internal row exactly
              as the mock's `grid-template-rows:auto 1fr` draws it. The fix-418
              trap is a wrapper that swallows the growth; this one declares it.
      */}
      {/* ★ `flexGrow`/`flexShrink` INLINE as well as in the stylesheet, and
          deliberately: they are fix-331 §1's contract, three suites read a
          section's growth off `style.flexGrow`, and a value that lives only in
          a `<style>` tag is invisible to `element.style` — which is how a
          wrapper stops participating in the distribution without anything
          failing (the fix-418 trap). Same value, one source, two readers. */}
      <div
        className={TEAM_GRID_CLASS}
        style={{ flexGrow: 1, flexShrink: 0, minWidth: 0 }}
        data-testid="pd-team-grid"
      >
      <div className={TEAM_GRID_COLUMN_1_CLASS} data-testid="pd-team-grid-col1">
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

          ★ fix-507 §C SUPERSEDES THE POSITION, NOT THE REASONING. Bobby has
          asked for the mock's own arrangement — Chat beside Builder/Owner and
          Internal rather than under them — because Team is the card setting the
          row's height and a stacked preview costs its full height. fix-346's
          rule that there is ONE way into the chat is untouched: the pinned
          button below is still the only opener, and it is still `pinBottom`, so
          fix-345 §3's baseline holds. */}
      </div>
      {/* ★★★ fix-507 §C — CHAT GOES BACK TO THE TOP RIGHT, which is where the
          v14 mock has always drawn it (`.chatcell{grid-column:2/4;grid-row:
          1/3}`). fix-346 §1 moved the preview DOWN so it sat directly above the
          button that opens it, and that reasoning is superseded rather than
          wrong: the button is still the only way in and is still pinned to the
          card's floor, but the preview now sits beside the two blocks it used
          to sit under, where it costs the card no height at all.

          ★ Its content, its posts, its reply counts and its mention tint are
            untouched, and it is still an <OverviewSection> and nothing else —
            fix-331's complaint, that chat must read as a section of Team rather
            than a widget parked inside one, is exactly as true in a cell as it
            was in a stack. */}
      <div className={TEAM_GRID_CHAT_CLASS} data-testid="pd-team-grid-chat">
      <OverviewSection title="Chat" testId="project-overview-team-chat">
        <ProjectChatSection projectId={project.id} />
        {/* ★★★ fix-508 §F4 — THE BUTTON COMES INTO THE CELL, AND THIS REVERSES
            fix-345 §3. Bobby asked for it deliberately, so the contract it
            breaks is rewritten here rather than deleted.

            ★★★ WHAT fix-345 §3 BOUGHT: `pinBottom` takes a section out of
                fix-331 §1's even height distribution so the three card actions
                — Milestones' draw-schedule link, Project's Connect, Team's chat
                — land on ONE baseline across the row. Bobby: *"make them all at
                the bottom … so it kind of points to here are 3 active buttons
                for each category."*

            ★★★ WHAT IT COSTS NOW, STATED: **the shared baseline covers two
                cards, not three.** Site data's Connect and the Dates card's
                draw-schedule link are both inside the PROJECT card and both
                still pinned, so they still align with each other. Team's chat
                button leaves that line and sits under the preview it opens.

            ★★ AND THE REASON IT IS NOT A REGRESSION IS THAT THE ROW CHANGED
               SHAPE UNDER fix-345. It pinned three buttons on three cards of
               four, three and four stacked sections. fix-507 §C made Team a
               two-column grid, so its "floor" is the floor of a card whose
               right-hand cell ends halfway up — the button was landing level
               with the consultant band's bottom edge, a long way below the
               preview it belongs to, pointing at nothing. A baseline shared
               with a control on another card is worth less than adjacency to
               the thing the control opens.

            ★ fix-346's rule is untouched and is the one that mattered most:
              there is still exactly ONE way into the chat, and the unread badge
              still rides it. */}
        <div className="mt-1.5">
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
            {/* ★ The unread count rides the control, per fix-346 — same query,
                same subtraction, same source as the bell. */}
            <ProjectChatUnread projectId={project.id} />
            <span aria-hidden>→</span>
          </OverviewAction>
        </div>
      </OverviewSection>
      </div>
      </div>

      {/* ===================================================================
          ★★★ fix-506 §F (P-139) — THE CONSULTANT BAND, ACROSS THE CARD
          ===================================================================

          §A retires the Consultants CARD; its pills become a grid at the foot
          of Team. Bobby's rules — minimum four slots, Surveyor · Arborist ·
          Structural · Civil always first in that order, odd counts stretching
          the bottom row (5 goes 3+2, 7 goes 4+3) — all live in
          `ConsultantBand` and `consultantRowSplit`.

          ★★★ fix-506's DEVIATION #1 IS CLOSED — see the three-column grid
              above. That ticket kept the stacked sections and flagged the
              reshuffle rather than taking it unasked; fix-507 §C takes it, with
              the answer to fix-506's own question (what fix-345 and fix-331 do
              underneath) written out in lib/teamCardLayout rather than assumed.
              The band itself is unchanged — it was already exactly as drawn. */}
      <OverviewSection title="Consultants" testId="project-overview-team-consultants">
        <ConsultantBand projectId={project.id} bp={bp} />
      </OverviewSection>

      {/* ★★ fix-345 §3: the Team card's action, matching Milestones and Project.
          fix-346 §1 moved the preview down to sit directly above it; the button
          itself is unchanged, and it is still the ONLY way into the modal. */}
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

// ★★★ fix-479 §A (P-132) — `ExternalTeamEditor` IS GONE FROM THIS CARD AND
//     FROM THIS FILE. Bobby, 2026-09-02: *"that external team, under team, is
//     no longer going to be there. We are going to move that external team over
//     to consultants."* The Team card reads Builder/Owner → Internal → Chat,
//     which is what P-116's approved layout said all along.
//
// ★★★ THE BLOB IT WROTE IS NOT GONE, AND THAT IS THE WHOLE CARE OF THIS TICKET.
//     `projects.external_team` has five live readers that this ticket does not
//     touch — lib/waitingOn, lib/myTasksHelpers, hooks/useWaitingOnTasks,
//     lib/vendorReport and PermitDetailV2's waiting-on firm line. What changed
//     is WHO WRITES IT: fix-479 §D moved that into `bp_add_project_consultant`
//     and `bp_set_consultant_firm`, server-side and in the same transaction as
//     the consultant record, so the record and the blob cannot drift.
//
// ★ `lib/externalTeam`, `ExternalFirmSelect` and `useExternalTeamShowRules` all
//   survive deliberately (the brief's rule). They are the blob's shared
//   vocabulary, and the next surface that needs a firm picker should reuse them
//   rather than grow a second one.

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
