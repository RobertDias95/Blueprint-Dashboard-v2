import { useMemo } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import OriginLink from '../OriginLink';
import { OverviewSection } from './OverviewCard';
import { lotSizeView } from '../../lib/lotDimensions';
import { schematicWindow } from '../../lib/schematicWindow';
import { VENDOR_SEND_LEAD_DAYS, vendorTargetSend } from '../../lib/vendorReport';
import { approvalDisplay } from '../../lib/approvalDisplay';
import { useProjectedApprovalFor } from '../../hooks/useProjectedApprovalFor';
// ★ In lib, not here: this file exports components and the React Compiler's
//   `react-refresh/only-export-components` is an ERROR in this repo — the
//   fourth time that rule has moved a helper (fix-403, fix-408, fix-499).
import { formatUsDate } from '../../lib/dateUtils';
import { parkingKindCode } from '../../lib/unitParking';
// ★ fix-508 §D: Target Approval and the ONE definition of "accepted".
import { intakeDisplay, targetApproval } from '../../lib/targetApproval';
import {
  DATES_LABEL_WIDTH,
  SITE_DATES_PAIR_CLASS,
  SITE_DATES_SITE_CLASS,
  SITE_LABEL_WIDTH,
  UNIT_MATRIX_CORNER_PCT,
  UNIT_MATRIX_TYPE_STEPS,
  unitMatrixIsBig,
} from '../../lib/projectCardLayout';
import type { PermitWithCycles, Project, UnitType } from '../../lib/database.types';

// ===========================================================================
// ★★★ fix-506 §B/§C/§D (P-139) — THE PROJECT CARD, READ AS A BOOK
// ===========================================================================
//
// Bobby's v14 mock replaces Milestones + Permit intake + the Site editor with
// three read-only boxes inside ONE card:
//
//     +--------------------------------------------------+
//     |  Site data           |  Dates                     |
//     |  Zone / Lot / ...    |  GO · Closing | SD · SD    |
//     |  [ Connect ↗ ]       |  DD ...       | Accepted…  |
//     |                      |  [ Draw schedule → ]       |
//     +--------------------------------------------------+
//     |  units matrix, types across, attributes down      |
//     +--------------------------------------------------+
//
// ★★★ EVERY FIELD HERE IS READ-ONLY, AND THAT IS THE TICKET. P-140: *"Overview
//     is read-only; every project field is edited in Project Data."* The
//     editors these boxes replace are not deleted — they move to the Project
//     Data modal (§G) and keep their own hooks, OCC tokens and toasts, so no
//     write path changed shape.
//
// ★★★ AND THE PAIR SITS SIDE BY SIDE (fix-507 §B). fix-506 made it a
//     `flex-wrap` pair — side by side wherever it fits, stacked where it does
//     not — and the "wherever it fits" branch NEVER FIRED: the pair needs 475px
//     of card body and the Project column got 390 at 1920, so every real
//     machine saw the stacked fallback (P-174). fix-507 §A narrows the permits
//     rail and re-shares the row to give the card 476, and the arrangement
//     becomes the mock's two-column grid with a DECLARED breakpoint. See
//     `lib/projectCardLayout`.

// ---------------------------------------------------------------------------
// One field
// ---------------------------------------------------------------------------

/**
 * ★ A label and a value, and the label column is a declared WIDTH rather than a
 *   `min-w` — every row in a box lines its values up on one edge, which is the
 *   whole reason these read as a table and not as a list of sentences.
 */
function Field({
  label,
  labelWidth,
  children,
  testId,
  title,
}: {
  label: string;
  labelWidth: number;
  children: ReactNode;
  testId?: string;
  title?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-[1.5px]" data-testid={testId} title={title}>
      {/* ★★★ fix-508 §G (P-189) — FIELD LABELS ARE `--color-text`. One class,
          every row of Site data and every row of the Dates card. The value
          beside it stays `font-semibold`, so the two are still told apart by
          WEIGHT rather than by one of them being faded out. */}
      <span
        className="text-[9px] text-text flex-none"
        style={{ width: labelWidth }}
      >
        {label}
      </span>
      <span className="text-[10.5px] font-semibold text-text min-w-0">
        {children}
      </span>
    </div>
  );
}

/** ★ A date, printed. `tabular-nums` so a column of them aligns digit for
 *  digit — the same treatment `MILESTONE_BOX_CLASS` gives an editable one. */
function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-dim">—</span>;
  return <span className="font-mono tabular-nums">{formatUsDate(value)}</span>;
}


// ---------------------------------------------------------------------------
// §C — SITE DATA
// ---------------------------------------------------------------------------

/**
 * ★★ THE ROW LIST IS BOBBY'S, AND TWO THINGS LEFT IT.
 *
 *   · **Regular shape** (P-161) — implied by the two dimension rows above it.
 *     The column and the wizard are untouched; this is the overview's
 *     restatement going away.
 *   · **Lots** (`num_lots`) — not on the v14 list. It is a parcel fact that
 *     still edits in Project Data; it simply is not one of the eight things
 *     Bobby reads here.
 *
 * ★★★ AND `Units` IS DERIVED FROM THE UNIT ROWS, not from `projects.units`.
 *     The brief: *"Units — derived count of unit rows."* Those two have been
 *     free to disagree since the wizard started writing both, and this is the
 *     surface that showed the stored one — including the `⚠ missing` badge
 *     fix-88 added for projects saved without a count. A count that is the sum
 *     of what the matrix underneath actually lists cannot be missing or stale.
 */
export function SiteDataBox({
  project,
  allProjects,
  unitTypes,
}: {
  project: Project;
  allProjects: readonly Project[];
  unitTypes: readonly UnitType[];
}) {
  const lot = lotSizeView(project.lot_width, project.lot_depth, project.lot_size_sf);
  const tags = Array.isArray(project.project_tags) ? project.project_tags : [];
  const unitCount = unitTypes.reduce((a, u) => a + (u.qty ?? 0), 0);

  // ★★★ P-141 — "Reuse a plan" SHOWS WHAT IT REUSED. And the reason it never
  //     could is that `reused_from_project_id` was missing from `useProjects`'
  //     explicit select list: six prod projects carry a source and the overview
  //     read `undefined` for every one of them. Fixed in the hook; this row is
  //     what the fix is for.
  const reuseSource = useMemo(
    () =>
      project.reused_from_project_id
        ? allProjects.find((p) => p.id === project.reused_from_project_id) ?? null
        : null,
    [allProjects, project.reused_from_project_id],
  );

  return (
    <OverviewSection title="Site data" testId="pd-site-data">
      <div className="flex flex-col">
        <Field label="Zone" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-zone-row">
          {project.zone ? project.zone : <span className="text-dim">—</span>}
        </Field>
        <Field label="Lot" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-lot-row">
          {lot.pairText ? (
            <span className="font-mono tabular-nums whitespace-nowrap">
              {lot.pairText}
            </span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </Field>
        <Field
          label="Lot size"
          labelWidth={SITE_LABEL_WIDTH}
          testId="pd-site-lot-size-row"
          title={
            lot.sizeDerived
              ? 'Computed from the lot width × depth — no size was typed for this project.'
              : undefined
          }
        >
          {lot.sizeSf != null ? (
            <span className="font-mono tabular-nums whitespace-nowrap">
              {/* ★★★ fix-508 §A — THE ` derived` SUFFIX LEAVES THE FACE, and
                  fix-488's rule is NOT being overturned, it is being moved. A
                  size the card computed from W×D is still not the same claim as
                  one somebody typed; what changed is that Bobby does not want
                  that distinction spending a line of the narrowest card on the
                  row. The `title` below carries it, and P-192 — *"lot size is
                  derived when it should not be"* — is where the RULE about when
                  a size may be derived at all is being decided. This ticket
                  touches no write path.
                  ★ It was also the row that set the Site box's floor: 147px
                    with the suffix, 116 without, which is 15 of the 20 §A
                    gives back. */}
              {lot.sizeText}
            </span>
          ) : (
            <span className="text-dim">—</span>
          )}
        </Field>
        <Field label="Corner" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-corner-row">
          {project.is_corner_lot == null ? (
            <span className="text-dim">—</span>
          ) : (
            (project.is_corner_lot ? 'Yes' : 'No')
          )}
        </Field>
        <Field label="Alley" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-alley-row">
          {project.alley ? project.alley : <span className="text-dim">—</span>}
        </Field>
        {/* ★★★ fix-508 §A — THE COUNT LOSES ITS `big` TREATMENT. fix-506 drew
            it at `text-sm font-extrabold` from the mock's `f('Units','6','big')`;
            the mock's own v8 hierarchy, which the same ticket adopted, is
            *"labels bold, values the same face regular, no special cases"* —
            and this was the special case. It is a number like every other
            number on the card, and the matrix underneath already spells out
            what it counts. */}
        <Field label="Units" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-units-row">
          <span data-testid="pd-site-units-count">{unitCount}</span>
        </Field>
        {/* ★ The row renders only when there IS a source. The mock's
            `+ Reuse a plan` affordance opens the Project Data modal's Reuse-of
            picker, and that modal is §G — a link whose destination does not
            exist yet is the inert control P-032 has just finished removing from
            this very card. */}
        {reuseSource && (
          <Field label="Reuse" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-reuse-row">
            <OriginLink
              to={`/project/${reuseSource.id}`}
              className="text-de hover:underline truncate block"
              data-testid="pd-site-reuse-link"
              title={`Reuses the plan from ${reuseSource.address}`}
            >
              {reuseSource.address}
            </OriginLink>
          </Field>
        )}
        <Field label="Tags" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-tags-row">
          {tags.length === 0 ? (
            <span className="text-dim italic text-[9px]">none</span>
          ) : (
            <span className="flex flex-wrap gap-0.5">
              {tags.map((t) => (
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
              ))}
            </span>
          )}
        </Field>
      </div>
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------
// ★★★ fix-508 §B/§D — THE DATES CARD, ONE COLUMN
// ---------------------------------------------------------------------------

/**
 * ★★★ ONE CARD REPLACED THREE SECTIONS (fix-506) — Key dates, the DD window and
 *     Permit intake. fix-508 §B turns the two-by-two quadrant grid it drew them
 *     in into ONE VERTICAL COLUMN, in the same order, top to bottom:
 *
 *         GO date · Closing · SD start · SD end · DD start · Consultant ·
 *         DD end · Estimated intake · Target Approval · Est. approval
 *
 * ★★★ AND THIS IS THE CHANGE THAT PAID FOR THE WHOLE TICKET. Two label tracks
 *     and two date tracks side by side is **296px** of box; one of each is
 *     **156**. The Site/Dates pair went 475 → 320, which is what let the
 *     Project card give Bobby his 20% without the pair falling back to stacked
 *     — two earlier fix-508 briefs were written to find that 77px by tightening
 *     the pair and narrowing the permits rail, and both were voided because the
 *     296 they priced against is this grid.
 *     [[do-not-brief-a-layout-that-is-still-being-redesigned]]
 *
 * ★★ THE QUADRANT RULES WENT WITH IT. They existed to make four groups read as
 *    four groups rather than as twelve rows; a single column has one group and
 *    reads top to bottom, so a dashed rule between arbitrary pairs of rows
 *    would be decoration claiming to be structure.
 *
 * ★★ NO "Building Permit" HEADING, unchanged from fix-506 — Bobby removed it on
 *    09-08. A project with no BP renders the same rows with `—`, which is why
 *    the labels sit outside the null check.
 */
export function DatesBox({
  project,
  bp,
}: {
  project: Project;
  bp: PermitWithCycles | null;
}) {
  const sd = schematicWindow(bp?.dd_start ?? null);
  // ★★ The SAME function the consultant forecast email uses (`vendorTargetSend`,
  //    `dd_end − VENDOR_SEND_LEAD_DAYS`). A second literal `- 7` here is exactly
  //    how this row and that email would silently diverge the day the lead
  //    changes — fix-311's note, still load-bearing.
  const consultantDate = vendorTargetSend({ dd_end: bp?.dd_end ?? null, end_week: null });

  // ★★★ §I — THE PROJECTION IS ASSEMBLED ONCE, IN A SHARED HOOK, so this card
  //     and Schedule Health's column 6 cannot disagree about a project.
  const projected = useProjectedApprovalFor(bp);
  const approval = approvalDisplay(projected, 'datesCard');

  // ★★★ fix-508 §D — the two new rows, both computed in `lib/targetApproval`.
  const intake = intakeDisplay(bp);
  const target = targetApproval(project, bp);

  return (
    <OverviewSection title="Dates" testId="pd-dates-card">
      <div className="flex flex-col" data-testid="pd-dates-grid">
        <DateField label="GO date" testId="pd-date-go" value={project.go_date} />
        <DateField label="Closing" testId="pd-date-closing" value={project.closing_date} />
        <DateField
          label="SD start"
          testId="pd-date-sd-start"
          value={sd?.start}
          title="Schematic design start — derived from DD start, not stored"
        />
        <DateField
          label="SD end"
          testId="pd-date-sd-end"
          value={sd?.end}
          title="Schematic design ends where DD begins — derived from DD start"
        />
        <DateField label="DD start" testId="pd-date-dd-start" value={bp?.dd_start} />
        <DateField
          label="Consultant"
          testId="pd-date-consultant"
          value={consultantDate}
          title={`Target external send — ${VENDOR_SEND_LEAD_DAYS} days before DD end. Same date the consultant forecast quotes.`}
        />
        <DateField label="DD end" testId="pd-date-dd-end" value={bp?.dd_end} />

        {/* ★★★ fix-508 §D — `Target intake` FLIPS TO `Accepted intake`.
            The same shape as `Est. approval → Approved` below it, deliberately:
            two rows that mean "the plan, then the fact" should not read as two
            different mechanisms. Until the city accepts, it prints the team's
            target submit — the city accepts what is submitted, so that IS the
            target. `intakeIsAccepted` is the ONE definition, in
            lib/targetApproval, because P-182 and P-180 both need it next.
            ★★★ fix-513 §B: the noun was `Estimated`, and Bobby's word is
                `Target` — it matches `Target Approval` two rows down and the
                column underneath is literally `target_submit`.
            ★★★ fix-513 §A: and the FLIP now needs the date to have ARRIVED, not
                merely to exist. Nine prod permits had a booked 2027 intake and
                read "Accepted intake" against it. */}
        <Field
          label={intake.label}
          labelWidth={DATES_LABEL_WIDTH}
          testId="pd-date-intake"
          title={
            intake.isActual
              ? 'The city has accepted this intake — the real date.'
              : 'The team’s target submit. The city accepts what is submitted, so this is the intake target.'
          }
        >
          {/* ★★★ fix-513 §D (P-209) — THE GREY AND THE DASHED RULE ARE GONE.
              See the note on the approval row below: this was the second and
              last instance of the convention, and both go together. */}
          <span
            className="font-mono tabular-nums"
            data-testid="pd-date-intake-value"
            data-actual={intake.isActual ? 'true' : 'false'}
          >
            {intake.date ? formatUsDate(intake.date) : <span className="text-dim">—</span>}
          </span>
        </Field>

        {/* ★★★ fix-508 §D — `ACQ target` IS REPLACED BY `Target Approval`, and
            the change is not the name. It was `permits.expected_issue` printed
            straight through; it is now the LATEST of the ACQ date, the closing
            date, and the GO date plus six calendar months.
            ★★★ AND THE ROW SHOWS THE DATE AND NOTHING ELSE — Bobby's ruling, in
                as many words: no driver, no badge, no tooltip naming which of
                the three won. Project Details is where the driver is named, and
                `targetApproval()` returns it for exactly that reason. */}
        <Field
          label="Target Approval"
          labelWidth={DATES_LABEL_WIDTH}
          testId="pd-date-target-approval"
        >
          <span
            className="font-mono tabular-nums"
            data-testid="pd-date-target-approval-value"
            data-driver={target.driver ?? undefined}
          >
            {target.date ? formatUsDate(target.date) : <span className="text-dim">—</span>}
          </span>
        </Field>

        {/* ★★★ THE FLIP. `Est. approval` becomes `Approved` with the real date
            the moment the city approves — the same determination Schedule
            Health's column 6 prints, read through the one helper that owns the
            words. */}
        <Field
          label={approval.label}
          labelWidth={DATES_LABEL_WIDTH}
          testId="pd-date-approval"
          title={
            approval.isActual
              ? 'The city has approved this permit — the real date.'
              : 'Projected from this permit type and jurisdiction. Same number as Schedule Health.'
          }
        >
          {/* =================================================================
              ★★★ fix-513 §D (P-209) — `Est. approval` IS NOT A DIFFERENT COLOUR
              =================================================================

              Bobby, 2026-09-09: *"est approval should not be a different color.
              remove the lines under est approval."*

              ★★★ THE CAUSE WAS §D's FIRST CANDIDATE, NOT ITS SECOND: no stray
              `<abbr>`, no leftover tooltip border. It was a deliberate
              **derived/estimated affordance** — `color: var(--color-muted)` plus
              a dashed bottom rule, meaning "computed, not entered."

              ★★★ SO THE CONVENTION IS DELETED, NOT THE CELL REPAINTED. That is
              [[P-195-schedule-health-labels-and-the-blue-target]]'s precedent
              read the same way it settled itself: the stray blue there *"was the
              editable-input affordance, not a colour choice"*, and it went with
              the input rather than being overpainted.

              ★★★ AND THE MEASUREMENT IS WHAT MAKES IT A DELETION. The card has
              ten rows. The convention marked **two** — this one and the intake
              row above. Of the eight it left plain, **four are equally derived**:
              `SD start` and `SD end` (their own titles say *"derived from DD
              start, not stored"*), `Consultant` (`dd_end − 7`, computed by
              `vendorTargetSend`), and `Target Approval` (fix-508 §D's `max` over
              three dates). A mark that appears on two of six derived values
              communicates nothing — the reader cannot learn a rule from it, so
              it is decoration that costs contrast.

              ★★ WHAT SURVIVES, because it carries the same fact without the
              colour: the row LABEL still flips (`Target intake` → `Accepted
              intake`, `Est. approval` → `Approved`), the `title` still says
              which it is, and `data-actual` still carries it for tests. The
              distinction was never lost — it was said three times and painted
              once.

              ★ SWEEP RESULT (§D asks for it, including "nothing else"): these
              two `style={}` blocks were the ONLY survivors of the convention in
              this file. Every other `text-dim` here is the em-dash placeholder
              for "not recorded", which is a different statement and stays.
              Third instance of [[P-189-the-overview-is-grey-where-it-should-be-black]]. */}
          <span
            className="font-mono tabular-nums"
            data-testid="pd-date-approval-value"
            data-actual={approval.isActual ? 'true' : 'false'}
          >
            {approval.date ? formatUsDate(approval.date) : <span className="text-dim">—</span>}
          </span>
        </Field>
      </div>
    </OverviewSection>
  );
}

/** ★ One printed date row. Every row in the single column is this shape, so the
 *  label track and the value face are declared once rather than at ten call
 *  sites — fix-311's rule, applied to the card that replaced that one. */
function DateField({
  label,
  testId,
  value,
  title,
}: {
  label: string;
  testId: string;
  value: string | null | undefined;
  title?: string;
}) {
  return (
    <Field label={label} labelWidth={DATES_LABEL_WIDTH} testId={testId} title={title}>
      <DateText value={value} />
    </Field>
  );
}
// ---------------------------------------------------------------------------
// §D — THE TRANSPOSED UNITS MATRIX
// ---------------------------------------------------------------------------

/** The attribute rows, top to bottom, in Bobby's order. ★ Declared as one list
 *  so the header column and every value row are generated from it and cannot
 *  drift — fix-412's ruling, which is the reason `unitRowLayout` exists at all,
 *  applied to the transpose. */
const UNIT_ATTRIBUTES: ReadonlyArray<{
  key: string;
  label: string;
  title: string;
  read: (u: UnitType) => string;
}> = [
  // ★★★ fix-507 §E — `Type` IS AN ATTRIBUTE ROW, AND THAT IS THE WHOLE POINT OF
  //     THE TRANSPOSE. fix-506 headed each column with the type NAME, which
  //     ellipsised to `Detach…Detach…` on the 59 prod projects whose units are
  //     all `Detached` — a header row that says the same word n times and then
  //     truncates it identifies nothing. The mock heads the columns `Unit 1 …
  //     Unit n` (an ordinal the reader can point at) and prints the type as the
  //     first row, like every other attribute.
  {
    key: 'type',
    label: 'Type',
    title: 'The product type this unit is.',
    read: (u) => (u.label ?? '').trim() || '—',
  },
  { key: 'width', label: 'Width', title: 'How wide this unit type is, in feet.', read: (u) => num(u.width_ft) },
  { key: 'depth', label: 'Depth', title: 'How deep this unit type is, in feet.', read: (u) => num(u.depth_ft) },
  {
    key: 'size',
    label: 'Size (sf)',
    // ★★★ P-150 SHIPS HERE. fix-488 §B built this column, measured it at +38px
    //     of matrix, and reverted it because the horizontal row could not
    //     afford the width. Transposed, an attribute is a ROW: it costs height.
    title: 'Floor area for this unit type, in square feet. Typed, never computed from width × depth.',
    read: (u) => (u.size_sf == null ? '—' : u.size_sf.toLocaleString()),
  },
  { key: 'qty', label: 'Qty', title: 'How many units on this project match these dimensions.', read: (u) => num(u.qty) },
  { key: 'stories', label: 'Stories', title: 'How many stories tall this unit type is.', read: (u) => num(u.stories) },
  {
    key: 'parking',
    label: 'Parking',
    title: 'What kind of parking is proposed. G garage · S surface · B both · N none · — not recorded',
    read: (u) => parkingKindCode(u.parking_kind ?? null),
  },
  { key: 'stalls', label: 'Stalls', title: 'How many parking stalls this unit type gets.', read: (u) => num(u.parking_stalls) },
  {
    key: 'roof_deck',
    label: 'Roof deck',
    title: 'Whether this unit type has a roof deck.',
    read: (u) => (u.roof_deck == null ? '—' : u.roof_deck ? 'Y' : 'N'),
  },
];

/** ★ `null` is NOT RECORDED and prints as an em dash — fix-386's rule, and
 *  fix-402's for the parking trio specifically. A `0` is a recorded zero and
 *  prints as `0`. */
function num(v: number | null | undefined): string {
  return v == null ? '—' : String(v);
}

/**
 * ★★★ TYPES ACROSS, ATTRIBUTES DOWN. fix-422 turned this matrix horizontal to
 *     stop each extra unit type spending HEIGHT that four other cards were
 *     charged for; v14 turns it ninety degrees again, and the reason the
 *     trade-off reversed is that the row is three cards now instead of five.
 *
 * ★★★ fix-507 §E — AND IT FILLS THE BOX NOW (P-175). fix-506 shipped it as a
 *     CSS grid of FIXED 45px type columns, so a two-unit project drew a 152px
 *     strip inside a 400px card and left the rest of the box empty, while its
 *     headers — the type NAME, per column — ellipsised to `Detach…Detach…` on
 *     the 59 prod projects whose units are all `Detached`.
 *
 *     The mock is a `table` at `width:100%; table-layout:fixed` with a 19%
 *     corner cell, so `n` columns divide whatever the card gives them; the
 *     headers are the ordinals `Unit 1 … Unit n`; and `Type` is the first
 *     attribute ROW, like every other attribute. At four units or fewer it
 *     takes a type step UP (`big`) — Bobby: *"if you had two, it would fill out
 *     the space. If you had six, it would kind of shrink and condense to the
 *     space."*
 *
 * ★ THE CARD'S FLOOR IS UNCHANGED and still derived from six type columns.
 *   `table-layout:fixed` divides the width it is GIVEN; it does not ask for
 *   any, so the thing that stops the columns becoming unreadable is still
 *   `PROJECT_CARD_MIN_WIDTH`. See lib/projectCardLayout for why 19% and 62px
 *   describe the same table at 332.
 */
export function UnitsMatrix({ unitTypes }: { unitTypes: readonly UnitType[] }) {
  if (unitTypes.length === 0) {
    return (
      <OverviewSection title="Units" testId="pd-units-matrix">
        <div className="text-[9px] text-dim italic" data-testid="pd-units-matrix-empty">
          No unit types recorded.
        </div>
      </OverviewSection>
    );
  }
  const big = unitMatrixIsBig(unitTypes.length);
  const step = big ? UNIT_MATRIX_TYPE_STEPS.big : UNIT_MATRIX_TYPE_STEPS.normal;
  const headCell: CSSProperties = {
    fontSize: step.header,
    padding: `${step.padY}px ${step.padX}px`,
    borderBottom: '2px solid var(--color-border)',
    color: 'var(--color-text)',
    letterSpacing: '0.06em',
  };
  return (
    <OverviewSection title="Units" testId="pd-units-matrix">
      <table
        className="border-collapse"
        style={{ width: '100%', tableLayout: 'fixed' }}
        data-testid="pd-units-matrix-grid"
        data-big={big ? 'true' : 'false'}
      >
        <thead>
          <tr>
            <th
              scope="col"
              className="text-left font-black uppercase"
              style={{
                ...headCell,
                width: `${UNIT_MATRIX_CORNER_PCT}%`,
                paddingLeft: 0,
              }}
              data-testid="pd-units-corner"
            >
              {/* ★★★ fix-515 §C (P-210) — THE WORD IS GONE, THE CELL IS NOT.
                  Bobby, 2026-09-10, with it highlighted twice: *"redunant to
                  have units there 2x."* The card chrome prints UNITS as the
                  section title and this corner printed it again ~20px lower.

                  ★★★ WHICH ONE WAS NEWER, CHECKED RATHER THAN GUESSED: the
                      card title is fix-506 (`4fc59fb`, PR #447); this corner
                      arrived with fix-507's transposed matrix (`33ffae9`,
                      PR #448), which gave the row-name column a header cell for
                      the first time and reached for the label already on the
                      card. So the newer copy is the one that goes, and the one
                      every sibling card carries stays.

                  ★★ THE `<th>` ITSELF STAYS, EMPTY. It is the `scope="col"`
                     header of the column that holds the attribute names, and
                     `tableLayout: 'fixed'` sizes that column from
                     `UNIT_MATRIX_CORNER_PCT` on this cell — deleting it would
                     collapse the matrix's first column and take fix-508 §C's
                     width derivation with it. An empty corner cell is the
                     conventional shape for a transposed table. */}
            </th>
            {unitTypes.map((_, i) => (
              <th
                scope="col"
                key={`h-${i}`}
                className="text-center font-extrabold uppercase"
                style={headCell}
                data-testid={`pd-units-col-${i}`}
              >
                {`Unit ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {UNIT_ATTRIBUTES.map((attr) => (
            <tr key={attr.key}>
              <th
                scope="row"
                className="text-left font-bold"
                style={{
                  fontSize: step.cell,
                  padding: `${step.padY}px 0`,
                  color: 'var(--color-text)',
                  borderBottom: '1px solid var(--color-s3)',
                }}
                title={attr.title}
                data-testid={`pd-units-attr-${attr.key}`}
              >
                {attr.label}
              </th>
              {unitTypes.map((u, i) => (
                <td
                  key={`${attr.key}-${i}`}
                  className="text-center truncate"
                  style={{
                    fontSize: step.cell,
                    padding: `${step.padY}px ${step.padX}px`,
                    borderBottom: '1px solid var(--color-s3)',
                  }}
                  // ★ The type is prose and can be off-registry free text, so
                  //   it carries its own title; the numbers speak for
                  //   themselves and the row heading already names them.
                  title={attr.key === 'type' ? attr.read(u) : undefined}
                  data-testid={`pd-units-cell-${attr.key}-${i}`}
                >
                  {attr.read(u)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------
// THE PAIR
// ---------------------------------------------------------------------------

/**
 * ★★★ fix-507 §B — SITE DATA BESIDE DATES, ON EVERY MACHINE THAT CAN HOLD IT.
 *
 * Bobby's ruling 1, 2026-09-09, and it closes the ⏸ question fix-506 left open:
 * *"Site data sits beside Dates on every machine."*
 *
 * ★★★ fix-506's `flex-wrap` PAIR IS GONE, AND THE REASON IT HAD TO GO IS THAT
 *     ITS "WHERE IT FITS" BRANCH NEVER FIRED. Measured in Chrome on the shipped
 *     app: the Project card's body is **406px** at a 1920 viewport against the
 *     475 the pair declares, so every real machine got the stacked fallback and
 *     the side-by-side layout existed only above a 2560 window. A fallback that
 *     is the only state is not a fallback.
 *
 * ★★ IT IS A TWO-COLUMN GRID WITH A DECLARED BREAKPOINT — the mock's `.pstrip`
 *    — and the breakpoint is a CONTAINER query on the Project card, not a media
 *    query: the ribbon collapses 156px without the window changing size, so
 *    only the card's own width can answer "is there room?" (fix-423). Its
 *    tracks carry the two boxes' own floors, so above the threshold neither box
 *    can be squeezed under the width it was measured at.
 *
 * ★ `min-width: 0` on both columns is still load-bearing: a grid item's
 *   automatic minimum is its min-content, which would let the Dates grid push
 *   the pair wider than the card and re-open the clipping (`OverviewCard` is
 *   `overflow-hidden`, so the failure is silent — fix-422).
 */
export function SiteAndDates({
  project,
  bp,
  allProjects,
  unitTypes,
  siteFoot,
  datesFoot,
}: {
  project: Project;
  bp: PermitWithCycles | null;
  allProjects: readonly Project[];
  unitTypes: readonly UnitType[];
  siteFoot: ReactNode;
  datesFoot: ReactNode;
}) {
  return (
    <div className={SITE_DATES_PAIR_CLASS} data-testid="pd-site-dates-pair">
      <div
        className={`flex flex-col ${SITE_DATES_SITE_CLASS}`}
        style={{ minWidth: 0 }}
        data-testid="pd-site-dates-site"
      >
        <SiteDataBox project={project} allProjects={allProjects} unitTypes={unitTypes} />
        <div className="mt-auto">{siteFoot}</div>
      </div>
      <div
        className="flex flex-col"
        style={{ minWidth: 0 }}
        data-testid="pd-site-dates-dates"
      >
        <DatesBox project={project} bp={bp} />
        <div className="mt-auto">{datesFoot}</div>
      </div>
    </div>
  );
}

