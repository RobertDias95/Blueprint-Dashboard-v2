import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
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
import {
  DATES_CARD_MIN_WIDTH,
  DATES_COLUMN_GAP,
  DATES_LABEL_WIDTH_LEFT,
  DATES_LABEL_WIDTH_RIGHT,
  SITE_DATA_MIN_WIDTH,
  SITE_DATES_GAP,
  SITE_LABEL_WIDTH,
  UNIT_MATRIX_LABEL_COL,
  UNIT_MATRIX_TYPE_COL,
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
// ★★★ AND THE PAIR WRAPS RATHER THAN CLIPPING. See `lib/projectCardLayout` for
//     the Chrome measurement and the three-way constraint it resolves — the
//     short version is that the mock's side-by-side Site/Dates needs 475px of
//     card body and the app's Project column gets 390 at 1920, so the two boxes
//     are a `flex-wrap` pair with declared bases: side by side wherever they
//     fit, stacked where they do not, truncated never.

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
      <span
        className="text-[9px] text-dim flex-none"
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
        <Field label="Lot size" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-lot-size-row">
          {lot.sizeSf != null ? (
            <span className="font-mono tabular-nums whitespace-nowrap">
              {lot.sizeText}
              {/* ★ fix-488's rule kept: a size the card DERIVED from W×D is not
                  the same claim as one somebody typed, and the reader can see
                  which is which. */}
              {lot.sizeDerived && (
                <span className="text-dim font-sans font-normal"> derived</span>
              )}
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
        <Field label="Units" labelWidth={SITE_LABEL_WIDTH} testId="pd-site-units-row">
          <span className="text-sm font-extrabold" data-testid="pd-site-units-count">
            {unitCount}
          </span>
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
// §B — THE DATES CARD
// ---------------------------------------------------------------------------

/**
 * ★★★ ONE CARD REPLACES THREE SECTIONS — Key dates, the DD window and Permit
 *     intake. Bobby's layout, quadrant by quadrant:
 *
 *         GO date · Closing              |  SD start · SD end
 *         DD start · Consultant · DD end |  Accepted · ACQ target · Est. approval
 *
 * ★★ THE RIGHT-HAND BOTTOM QUADRANT IS THE BUILDING PERMIT'S FLOW, and it
 *    carries **no "Building Permit" heading** — Bobby removed it on 09-08. No
 *    BP on the project and its three rows read `—` with the labels unchanged,
 *    which is why the labels are rendered outside the null check.
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

  return (
    <OverviewSection title="Dates" testId="pd-dates-card">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `minmax(0,1fr) minmax(0,1fr)`,
          columnGap: DATES_COLUMN_GAP,
        }}
        data-testid="pd-dates-grid"
      >
        {/* top-left */}
        <Quadrant testId="pd-dates-q1" rule="right bottom">
          <Field label="GO date" labelWidth={DATES_LABEL_WIDTH_LEFT} testId="pd-date-go">
            <DateText value={project.go_date} />
          </Field>
          <Field label="Closing" labelWidth={DATES_LABEL_WIDTH_LEFT} testId="pd-date-closing">
            <DateText value={project.closing_date} />
          </Field>
        </Quadrant>

        {/* top-right */}
        <Quadrant testId="pd-dates-q2" rule="bottom">
          <Field label="SD start" labelWidth={DATES_LABEL_WIDTH_RIGHT} testId="pd-date-sd-start"
            title="Schematic design start — derived from DD start, not stored">
            <DateText value={sd?.start} />
          </Field>
          <Field label="SD end" labelWidth={DATES_LABEL_WIDTH_RIGHT} testId="pd-date-sd-end"
            title="Schematic design ends where DD begins — derived from DD start">
            <DateText value={sd?.end} />
          </Field>
        </Quadrant>

        {/* bottom-left */}
        <Quadrant testId="pd-dates-q3" rule="right">
          <Field label="DD start" labelWidth={DATES_LABEL_WIDTH_LEFT} testId="pd-date-dd-start">
            <DateText value={bp?.dd_start} />
          </Field>
          <Field label="Consultant" labelWidth={DATES_LABEL_WIDTH_LEFT} testId="pd-date-consultant"
            title={`Target external send — ${VENDOR_SEND_LEAD_DAYS} days before DD end. Same date the consultant forecast quotes.`}>
            <DateText value={consultantDate} />
          </Field>
          <Field label="DD end" labelWidth={DATES_LABEL_WIDTH_LEFT} testId="pd-date-dd-end">
            <DateText value={bp?.dd_end} />
          </Field>
        </Quadrant>

        {/* bottom-right — the Building Permit's flow, unheaded */}
        <Quadrant testId="pd-dates-q4" rule="">
          {/* ★★ `permits.intake_date`, which is what the brief names — NOT
              cycle 0's `intake_accepted`, which is what the Milestones card
              this replaces read. Measured on prod: of 229 building permits 193
              carry `intake_date` and 190 carry the cycle-0 value, they disagree
              on 3, and exactly ONE permit has the cycle value without the
              permit one. So this is the better-covered of the two and the swap
              costs a single row its date. */}
          <Field label="Accepted" labelWidth={DATES_LABEL_WIDTH_RIGHT} testId="pd-date-accepted"
            title="Intake accepted on the Building Permit — scraped from the portal">
            <DateText value={bp?.intake_date} />
          </Field>
          <Field label="ACQ target" labelWidth={DATES_LABEL_WIDTH_RIGHT} testId="pd-date-acq-target"
            title="The team's target issue date. Editable in Project Data and on Schedule Health.">
            <span className="font-mono tabular-nums" style={{ color: 'var(--color-de)' }}>
              {bp?.expected_issue ? formatUsDate(bp.expected_issue) : <span className="text-dim">—</span>}
            </span>
          </Field>
          {/* ★★★ THE FLIP. `Est. approval` becomes `Approved` with the real
              date the moment the city approves — the same determination
              Schedule Health's column 6 prints, read through the one helper
              that owns the words. */}
          <Field
            label={approval.label}
            labelWidth={DATES_LABEL_WIDTH_RIGHT}
            testId="pd-date-approval"
            title={
              approval.isActual
                ? 'The city has approved this permit — the real date.'
                : 'Projected from this permit type and jurisdiction. Same number as Schedule Health.'
            }
          >
            <span
              className="font-mono tabular-nums"
              data-testid="pd-date-approval-value"
              data-actual={approval.isActual ? 'true' : 'false'}
              style={
                approval.isActual
                  ? undefined
                  : {
                      color: 'var(--color-muted)',
                      borderBottom: '1px dashed var(--color-border)',
                    }
              }
            >
              {approval.date ? formatUsDate(approval.date) : <span className="text-dim">—</span>}
            </span>
          </Field>
        </Quadrant>
      </div>
    </OverviewSection>
  );
}

/** ★ The mock's dashed quadrant rules (`.dgrid .dq`), which are what make four
 *  groups read as four groups rather than as twelve rows. */
function Quadrant({
  children,
  testId,
  rule,
}: {
  children: ReactNode;
  testId: string;
  rule: string;
}) {
  const right = rule.includes('right');
  const bottom = rule.includes('bottom');
  return (
    <div
      data-testid={testId}
      className="flex flex-col"
      style={{
        paddingRight: right ? 10 : undefined,
        paddingBottom: bottom ? 5 : undefined,
        marginBottom: bottom ? 3 : undefined,
        borderRight: right ? '1px dashed var(--color-border)' : undefined,
        borderBottom: bottom ? '1px dashed var(--color-border)' : undefined,
      }}
    >
      {children}
    </div>
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
 *     Each unit type costs 45px of width and each attribute costs 16px of
 *     height, and the card's floor is derived from six type columns —
 *     prod's maximum.
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
  return (
    <OverviewSection title="Units" testId="pd-units-matrix">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${UNIT_MATRIX_LABEL_COL}px repeat(${unitTypes.length}, minmax(0, ${UNIT_MATRIX_TYPE_COL}px))`,
        }}
        data-testid="pd-units-matrix-grid"
      >
        <div />
        {unitTypes.map((u, i) => (
          <div
            key={`h-${i}`}
            className="text-[10.5px] font-bold text-center truncate pb-0.5 border-b-2"
            style={{ color: 'var(--color-de)', borderBottomColor: 'var(--color-border)' }}
            title={u.label}
            data-testid={`pd-units-col-${i}`}
          >
            {u.label}
          </div>
        ))}
        {UNIT_ATTRIBUTES.map((attr) => (
          <Fragment key={attr.key}>
            <div
              className="text-[9px] text-dim h-4 flex items-center"
              title={attr.title}
              data-testid={`pd-units-attr-${attr.key}`}
            >
              {attr.label}
            </div>
            {unitTypes.map((u, i) => (
              <div
                key={`${attr.key}-${i}`}
                className="text-[10.5px] font-semibold font-mono tabular-nums text-center h-4 flex items-center justify-center border-b"
                style={{ borderBottomColor: 'var(--color-s3)' }}
                data-testid={`pd-units-cell-${attr.key}-${i}`}
              >
                {attr.read(u)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </OverviewSection>
  );
}

// ---------------------------------------------------------------------------
// THE PAIR
// ---------------------------------------------------------------------------

/**
 * ★★★ SITE DATA AND DATES, SIDE BY SIDE WHERE THEY FIT.
 *
 * `flex-wrap` with a declared basis on each box. Above
 * `SITE_DATES_SIDE_BY_SIDE_MIN` of card body they share a line, exactly as the
 * mock draws them; below it they stack. See `lib/projectCardLayout` for why
 * that is the only arrangement satisfying all three ruled constraints.
 *
 * ★ `min-width: 0` on both is load-bearing: a flex item's default minimum is
 *   its min-content, which would let the Dates grid push the pair wider than
 *   the card and re-open the clipping this whole mechanism removes.
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
    <div
      className="flex flex-wrap"
      style={{ gap: SITE_DATES_GAP }}
      data-testid="pd-site-dates-pair"
    >
      <div
        className="flex flex-col"
        style={{ flex: `1 1 ${SITE_DATA_MIN_WIDTH}px`, minWidth: 0 }}
        data-testid="pd-site-dates-site"
      >
        <SiteDataBox project={project} allProjects={allProjects} unitTypes={unitTypes} />
        <div className="mt-auto">{siteFoot}</div>
      </div>
      <div
        className="flex flex-col"
        style={{ flex: `1.25 1 ${DATES_CARD_MIN_WIDTH}px`, minWidth: 0 }}
        data-testid="pd-site-dates-dates"
      >
        <DatesBox project={project} bp={bp} />
        <div className="mt-auto">{datesFoot}</div>
      </div>
    </div>
  );
}

