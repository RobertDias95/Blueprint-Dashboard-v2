import { useEffect, useRef } from 'react';
import OriginLink from '../OriginLink';
import { PREVIOUS_ORIGINS } from '../../lib/previousOrigin';
import { effectiveStage } from '../../lib/permitStage';
import { STAGE_FULL_LABEL } from '../../lib/stageLabel';
import { permitUrgency, type UrgencyLevel } from '../../lib/urgencyHelpers';
import PendingScrapeChip from '../shared/PendingScrapeChip';
import { HoldBadge } from '../shared/HoldBadge';
import PermitWaitingOn from './PermitWaitingOn';
import type { StageCount } from '../../lib/pipelineDistribution';
import { useDashboardPermitCards } from '../../hooks/useDashboardPermitCards';
import type {
  Permit,
  PermitCycle,
  PermitCycleReviewer,
  PermitHold,
  ProjectHold,
  Stage,
} from '../../lib/database.types';

// Q9.5.e2: Address-clumped permit group per v1 .addr-group at index.html
// :177-211. One group per (sub-bucket, address) pair. Collapsed header
// shows chevron + address + juris + per-stage badge counts + permit-type
// pills. Expanded body shows detailed permit rows. Cross-bucket highlight
// is driven by the parent Dashboard via highlightedAddress + openAddresses
// state — the same address renders highlighted/open in every bucket it
// appears in.

interface AddrGroupProps {
  address: string;
  juris: string | null;
  projectId: string;
  permits: Permit[];
  /** Stage label for the badge in expanded rows + urgency math. */
  stage: Stage;
  cyclesByPermit: Map<number, PermitCycle[]>;
  /** fix-54: per-permit reviewer rows. Wired through to effectiveStage +
   *  derivePermitStatus so MPB stage/status pills respect the wholistic
   *  rollup (any outstanding reviewer → "in review", overriding any
   *  premature corr_issued the scraper stamped). */
  reviewersByPermit: Map<number, PermitCycleReviewer[]>;
  /** fix-309 #50: NO LONGER USED FOR COLOUR — the project pill is neutral.
   *  Kept on the props so the caller's sort key and this component stay in one
   *  conversation; remove it here and the next person re-adds a tint. */
  cardUrgency?: UrgencyLevel;
  /** fix-170: project has an ACTIVE hold → per-row urgency colors suppressed. */
  activeHold?: boolean;
  /**
   * ★★ fix-390: permit ids on their OWN open hold, and the rows behind them.
   *
   * A project hold already arrives as `activeHold` and covers every permit
   * here. These add the permit-scoped half: a held permit goes 'ok' and wears
   * its own badge while its siblings carry on. They never combine upward — the
   * card's own urgency is untouched by one permit's hold.
   */
  heldPermitIds?: ReadonlySet<number>;
  permitHoldMap?: ReadonlyMap<number, PermitHold>;
  /** fix-178: the project's active hold (for the on-hold card badge), or null. */
  hold?: Pick<ProjectHold, 'reason' | 'hold_start' | 'note'> | null;
  keyDateLabel: string;
  getKeyDate: (p: Permit) => string | null;
  isOpen: boolean;
  isHighlighted: boolean;
  /**
   * ★★ fix-383: where ALL of this project's cards are, across every bucket —
   * computed once in Dashboard.tsx. Optional: when omitted the pills fall back
   * to counting the permits THIS group was handed, which is the pre-fix-383
   * behaviour and what a bare render of this component still gets.
   */
  distribution?: StageCount[];
  /**
   * ★★ fix-383: a count was clicked — send the reader to that bucket. Omit it
   * and the pills stay plain, non-interactive text.
   */
  onCountClick?: (stage: Stage) => void;
  /**
   * ★★★ fix-383: the reveal ticket for THIS (address, stage). Non-zero and
   * newly-changed means "a count click targeted you"; see the scroll effect.
   */
  revealNonce?: number;
  /** Toggles open state for THIS address across all buckets simultaneously. */
  onToggle: () => void;
  onHover: () => void;
  onLeave: () => void;
}

// fix-309 #50: the URGENCY_BG / URGENCY_BORDER / URGENCY_HOVER_BG maps are
// gone with the project-level tint they existed to paint. Per-permit colour is
// computed inline from permitUrgency, at the permit, where it is true.

const STAGE_PILL_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Perm',
  co: 'Corr',
  ap: 'Appr',
  is: 'Iss',
};

// ★ fix-364: one concept, one term. The SHORT labels above are what the pill
// renders; the spelled-out ones are for the tooltip and the screen-reader
// label, matching the column headings on the board.
//
// ★★ fix-508 §E MOVED THEM TO `lib/stageLabel`, where the short form has lived
//    since fix-104, because the permits rail now heads its phase groups with
//    the same five words. A second copy is what that file was created to stop.

const STAGE_PILL_FG: Record<Stage, string> = {
  de: 'var(--color-de)',
  pm: 'var(--color-pm)',
  co: 'var(--color-co)',
  ap: 'var(--color-jv)',
  is: 'var(--color-is)',
};

export default function AddrGroup({
  address,
  juris,
  projectId,
  permits,
  stage,
  cyclesByPermit,
  reviewersByPermit,
  activeHold = false,
  heldPermitIds,
  permitHoldMap,
  hold = null,
  keyDateLabel,
  getKeyDate,
  isOpen,
  isHighlighted,
  distribution,
  onCountClick,
  revealNonce = 0,
  onToggle,
  onHover,
  onLeave,
}: AddrGroupProps) {
  // ★★★ fix-383: THE PILLS NOW DESCRIBE THE WHOLE PROJECT.
  //
  // The comment that stood here said these counts were "across ALL permits at
  // this address" and then noted, two lines later, that the parent passes
  // `permits` already filtered to one sub-bucket — so they were the bucket's
  // own permits and nothing else. That drift is the regression Bobby noticed:
  // "it would say okay, there's one in permitting, one in issued, two in design
  // and engineering... I would like the UI to bring that back."
  //
  // A group can only ever see its own bucket, so the answer cannot be computed
  // here. `distribution` arrives from Dashboard.tsx where every permit is in
  // hand. The local fallback is kept for a bare render of this component.
  const localCounts = useStageCounts(permits, cyclesByPermit, reviewersByPermit);
  const stageCounts = distribution ?? localCounts;

  // Q9.5.f-fix-1d: each AddrGroup scrolls ITS containing data-scroll-bucket
  // when its own isOpen flips true. Component-local because that's the
  // only timing at which we're guaranteed the expanded body has
  // contributed to the scroll parent's scrollHeight — a parent-imperative
  // scrollAddrIntoView ran before non-active buckets had committed their
  // expanded-state render, so the offset math was being clamped to 0 by
  // the unchanged scrollHeight on those buckets. rAF defers the scroll
  // until after this AddrGroup's paint, then closest() walks up to find
  // the real scrollable parent regardless of intermediate wrappers.
  //
  // ★★★ fix-383 ADDS `revealNonce` TO THE DEPS AND CHANGES NOTHING ELSE.
  //
  // A count click has to scroll the target bucket even when the address was
  // ALREADY open there — in that case `isOpen` never flips, so an effect keyed
  // on `isOpen` alone would not re-run and the click would appear to do
  // nothing. The nonce changes on every click, so the effect fires either way,
  // and both starting states land in the same place.
  //
  // ★★★ It is STILL this component's own effect. The parent does not call a
  // scroll function; it publishes state and this group reacts to it after its
  // OWN render commits, which is the whole point of fix-1d. Do not "simplify"
  // this into a parent-imperative scroll — that is the bug fix-1d spent ten
  // iterations on, and the failure is silent.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    const el = rootRef.current;
    if (!el) return;
    const container = el.closest<HTMLElement>('[data-scroll-bucket="true"]');
    if (!container) return;
    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top + container.scrollTop - 8;
      container.scrollTop = Math.max(0, offset);
    });
  }, [isOpen, revealNonce]);

  return (
    <div
      ref={rootRef}
      data-addr={address}
      data-addr-group={address}
      data-testid={`addr-group-${stage}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      // ★ fix-309 #50: THE PROJECT PILL CARRIES NO STATUS COLOUR.
      //
      // "Keep the colour just to the permit status … the whole project pill is
      // not red — just the actual permit within that project is colour-coded."
      //
      // A solid red project reads as "this whole project is in trouble" when
      // the truth is usually one permit out of four. Deliberately NOT replaced
      // with a blended or worst-case tint either — that reintroduces the same
      // lie more quietly. The permit pills below and the expanded rows keep
      // their own per-permit colour, which is where the truth lives.
      //
      // cardUrgency still drives the SORT in Dashboard.tsx: ordering by the
      // worst permit is a useful ranking, not a claim about the project.
      data-urgency-neutral="true"
      style={{
        // ★ fix-327 #1: A PROJECT IS ONE OBJECT, so it gets one edge. Bobby:
        // "maybe a very clean way to kind of border around a project."
        //
        // WHAT THIS REPLACES, and why each piece went:
        //   · the 3px LEFT RAIL — the "gray bar that runs vertically" he named.
        //     A rail says "a group starts here" from one side only; a border
        //     says it from all four, so keeping both is two things making the
        //     same claim, and the rail was the heavier of them.
        //   · the 1px BOTTOM RULE — the "thinner gray bars". It separated one
        //     project from the next; the gap between two bordered blocks does
        //     that now, without drawing a line that reads as shared furniture
        //     between two objects that are not related.
        //
        // ★ THE LIGHTEST EDGE THAT STILL CONTAINS: a 1px hairline in the
        // existing border token, with the radius and the surface doing the rest.
        // Rendered at twelve projects to a column before settling — anything
        // heavier turns the list into a grid of boxes, which is the failure mode
        // the brief names.
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        // The separation the bottom rule used to provide.
        marginBottom: 6,
        background: isHighlighted ? 'var(--color-s2)' : 'var(--color-surface)',
        // Q9.5.e2-fix-5: v1 .addr-highlighted at index.html:186 outlines the
        // opened address with a 3px blue ring. CSS outline renders on top of
        // all child content per spec — needed here because the expanded body
        // sets its own background, which would mask an inset box-shadow.
        // outline-offset: -3px pulls the ring inside the element so the
        // visible outer perimeter is unchanged (matches v1 border-but-inside).
        outline: isOpen ? '3px solid var(--color-de)' : undefined,
        outlineOffset: isOpen ? '-3px' : undefined,
        position: isOpen ? 'relative' : undefined,
        zIndex: isOpen ? 2 : undefined,
        // ★ fix-327: the transition still covers BACKGROUND ONLY, which is what
        // keeps the hover grey Bobby asked to keep — "when you hover over a
        // project I do like how it goes gray and that identifies other projects
        // as well." The border is the RESTING state and the grey is the HOVER
        // state; they are two different jobs and neither replaces the other.
        transition: 'background 0.15s, outline-color 0.15s',
      }}
      className="overflow-hidden"
    >
      {/* Collapsed header (always shown). Q9.5.e2-fix-3: density matches
          v1 .addr-collapsed (padding 12/14), .addr-top (gap 7, mb 6),
          .addr-name (13px bold), .addr-juris (chip s2/border/4px radius),
          .addr-pcount (10px on s3, padding 2/7, radius 10), .addr-permits-row
          (gap 4, pl 16), .permit-pill (10px, padding 3/8, radius 5). */}
      {/* ★★ fix-383: this was a <button>, and it cannot stay one — the stage
          counts inside it are now buttons themselves, and a button nested in a
          button is invalid HTML that browsers resolve by dropping one of them.
          A div with role="button", tabIndex and an Enter/Space handler is the
          standard "card with its own inner actions" shape and keeps the whole
          header clickable and keyboard-reachable exactly as before. The testid
          is unchanged so nothing that drives this row has to know. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full flex flex-col text-left cursor-pointer bg-transparent border-0"
        style={{ padding: '12px 14px' }}
        data-testid={`addr-group-toggle-${stage}`}
      >
        {/* =================================================================
            ★★★ fix-516 §B (P-206) — THE ADDRESS STOPS TRUNCATING
            =================================================================

            Bobby, 2026-09-09: *"in the Pipeline, when you open up Design &
            Engineering and Permitting, you can't really see the address…
            inline with the address you have the jurisdiction, and then you
            have the buckets of all the other permits. What we should do is
            stack the buckets vertically two… That would help free up
            horizontal width for the address… and then maybe the jurisdiction
            goes below."*

            ★★★ THE ARGUMENT IS STRONGER THAN "IT LOOKS CRAMPED". The header
                was ONE line carrying four things — caret · address · juris ·
                up to FOUR count chips — so the address truncated in proportion
                to how busy the project is. `2450 3rd Ave W` rendered as
                `2450 3r…` while `370 Lynn St` beside it rendered in full,
                because that one carries two chips instead of four. **The
                projects whose names you most need to read were exactly the
                ones you could not.**

            ★★★ THE CHIPS EARN THEIR PLACE; THEIR PLACEMENT DOES NOT. Bobby
                also said *"we don't need to put the permits there because it
                clearly shows the permit types and the permit numbers
                already"* — true WITHIN a lane and false ACROSS them. The same
                project appears in several lanes at once (`2450 3rd Ave W` is
                in DD & Pending Consultants AND Under Review), and the rows
                under each instance show only THAT lane's permits. The chips
                are the project's whole footprint, repeated on every instance,
                which is the one thing the rows below cannot tell you. So they
                are moved, not deleted.

            ★★ THE SHAPE: two columns. Left is the address with the
               jurisdiction under it; right is the chip grid, two wide, which
               is Bobby's own description — 4 goes 2×2, 3 goes 2+1, 2 goes 2,
               1 goes 1. `align-items: start` so a one-chip card does not
               centre its chip against a two-line stack.

            ★★★ AND THE HEIGHT IS WHY IT IS TWO COLUMNS RATHER THAN THREE ROWS.
                Height is the constraint that has bitten every ticket on this
                screen ([[P-177-the-overview-row-is-taller-than-the-screen]]),
                and a Pipeline lane shows many cards. A 2×2 chip grid is two
                rows tall on its own; putting the jurisdiction in the LEFT
                column means it lands in height the chip grid has already
                spent. On a 3- or 4-chip card the second line is therefore
                free. Measured before and after in the fix-516 PR.

            ⏸ RULED BY BOBBY 2026-09-10: chip EMPHASIS is out of scope. The
              open question — whether the chip for the lane you are currently
              looking at should be de-emphasised, since that one IS redundant
              with the rows below — got *"i need to think about this more."*
              **All four chips keep equal weight. Nothing here dims, greys,
              outlines or reorders any of them**, and a test pins that. */}
        <div
          className="flex items-start min-w-0"
          style={{ gap: 7, marginBottom: 6 }}
        >
          <span
            className="text-[11px] text-muted flex-shrink-0"
            style={{
              transition: 'transform 0.2s',
              transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
              lineHeight: 1.5,
            }}
          >
            ▶
          </span>
          {/* ★ The left column takes the freed width — `min-w-0` so the
              address can still ellipsis at a genuinely narrow lane rather
              than forcing the row wider than the card. */}
          <div className="flex flex-col min-w-0 flex-1" style={{ gap: 2 }}>
            <span
              className="text-[13px] font-bold text-text truncate"
              style={{ lineHeight: 1.3 }}
              title={address}
              data-testid={`addr-name-${stage}`}
            >
              {address}
            </span>
            {/* ★★ THE JURISDICTION, ON ITS OWN LINE. `self-start` so the chip
                is its own width rather than the column's. */}
            {juris && (
              <span
                className="text-[9px] text-text self-start flex-shrink-0"
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'var(--color-s2)',
                  border: '1px solid var(--color-border)',
                }}
                data-testid={`addr-juris-${stage}`}
              >
                {juris}
              </span>
            )}
          </div>
          {/* ★★★ TWO WIDE, which is what buys the address its width back: four
              chips in one row is four chip-widths of the header; four chips in
              a 2×2 is two. `grid` rather than a wrapping flex so 3 chips land
              2+1 deterministically instead of depending on the container. */}
          <div
            className="grid flex-shrink-0"
            style={{
              gridTemplateColumns: stageCounts.length > 1 ? '1fr 1fr' : '1fr',
              gap: 4,
              justifyItems: 'end',
            }}
            data-testid={`addr-counts-${stage}`}
            data-chip-columns={stageCounts.length > 1 ? '2' : '1'}
          >
            {/* ★★ fix-383: one pill per bucket this project has cards in.
                A stage with no cards renders NOTHING — not a "0". A project
                sitting in one bucket only therefore shows a single pill and
                does not shout; 74 of 174 are in that position. And there is no
                zero to click, which settles "a count of zero is not clickable"
                by never drawing one. */}
            {stageCounts.map((c) => {
              const text = `${STAGE_PILL_LABEL[c.stage]} ${c.count}`;
              const pillStyle = {
                padding: '2px 7px',
                borderRadius: 10,
                background: 'var(--color-s3, var(--color-s2))',
                color: STAGE_PILL_FG[c.stage],
                border: '1px solid var(--color-border)',
              } as const;
              if (!onCountClick) {
                return (
                  <span
                    key={c.stage}
                    className="text-[10px] font-bold flex-shrink-0 whitespace-nowrap"
                    style={pillStyle}
                  >
                    {text}
                  </span>
                );
              }
              return (
                <button
                  key={c.stage}
                  type="button"
                  // ★★★ stopPropagation, or this also fires the row's toggle
                  // and the targeted click becomes the broad one.
                  onClick={(e) => {
                    e.stopPropagation();
                    onCountClick(c.stage);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  title={`Show this project in ${STAGE_FULL_LABEL[c.stage]}`}
                  aria-label={`Show ${address} in ${STAGE_FULL_LABEL[c.stage]} (${c.count})`}
                  data-testid={`addr-count-${stage}-${c.stage}`}
                  data-count-stage={c.stage}
                  className="text-[10px] font-bold flex-shrink-0 cursor-pointer whitespace-nowrap"
                  style={pillStyle}
                >
                  {text}
                </button>
              );
            })}
          </div>
        </div>
        {/* fix-178: on-hold badge — a held project is visually flagged so it
            doesn't masquerade as a normal (red-zone) urgency card. */}
        {hold && (
          <div className="flex items-center" style={{ marginBottom: 6, paddingLeft: 16 }}>
            <HoldBadge hold={hold} testid={`addr-group-hold-${projectId}`} />
          </div>
        )}
        {/* Permit-type pill row */}
        <div
          className="flex items-center flex-wrap"
          style={{ gap: 4, paddingLeft: 16 }}
        >
          {permits.map((p) => {
            // ★★ fix-390: held EITHER way — by this permit's own hold or by its
            // project's. Reading downward only; a permit hold never reaches up.
            const permitHeld = !!heldPermitIds?.has(p.id);
            const u = permitUrgency(
              p,
              cyclesByPermit.get(p.id) ?? [],
              stage,
              undefined,
              activeHold || permitHeld,
            );
            const ownHold = permitHoldMap?.get(p.id) ?? null;
            return (
              <span
                key={p.id}
                className="text-[10px] flex items-center"
                style={{
                  padding: '3px 8px',
                  borderRadius: 5,
                  gap: 5,
                  background:
                    u === 'red'
                      ? '#fee2e2'
                      : u === 'yellow'
                        ? '#fef9c3'
                        : 'var(--color-s2)',
                  border: `1px solid ${
                    u === 'red'
                      ? '#fca5a5'
                      : u === 'yellow'
                        ? '#fcd34d'
                        : 'var(--color-border)'
                  }`,
                  color: 'var(--color-text)',
                  fontWeight: 600,
                }}
              >
                {pillLabel(p)}
                {/* ★ The permit's OWN hold only — the project's badge is
                    already on the row above, and repeating it here would make a
                    project hold look like a permit one. */}
                {ownHold && (
                  <HoldBadge hold={ownHold} testid={`permit-hold-pill-${p.id}`} />
                )}
                {getKeyDate(p) && (
                  <span
                    className="text-dim"
                    style={{ marginLeft: 5, fontSize: 9 }}
                  >
                    {getKeyDate(p)}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* Expanded body */}
      {isOpen && (
        <div
          className="border-t"
          style={{
            background: 'var(--color-bg)',
            borderTopColor: 'var(--color-border)',
          }}
        >
          {permits.map((p) => (
            <ExpandedRow
              key={p.id}
              permit={p}
              projectId={projectId}
              stage={stage}
              cycles={cyclesByPermit.get(p.id) ?? []}
              keyDate={getKeyDate(p)}
              keyDateLabel={keyDateLabel}
              activeHold={activeHold}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function pillLabel(p: Permit): string {
  if (p.type === 'Building Permit' && p.nickname) {
    return `BP — ${p.nickname}`;
  }
  return p.type ?? '—';
}

function useStageCounts(
  permits: Permit[],
  cyclesByPermit: Map<number, PermitCycle[]>,
  reviewersByPermit: Map<number, PermitCycleReviewer[]>,
): { stage: Stage; count: number }[] {
  const counts = new Map<Stage, number>();
  for (const p of permits) {
    const s = effectiveStage(
      p,
      cyclesByPermit.get(p.id) ?? [],
      reviewersByPermit.get(p.id) ?? [],
    );
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  // Stable order matching v1 :2792 (de / pm / co / ap / is)
  const order: Stage[] = ['de', 'pm', 'co', 'ap', 'is'];
  return order
    .filter((s) => (counts.get(s) ?? 0) > 0)
    .map((s) => ({ stage: s, count: counts.get(s)! }));
}

function ExpandedRow({
  permit,
  projectId,
  stage,
  cycles,
  keyDate,
  keyDateLabel,
  activeHold = false,
}: {
  permit: Permit;
  projectId: string;
  stage: Stage;
  cycles: PermitCycle[];
  keyDate: string | null;
  keyDateLabel: string;
  activeHold?: boolean;
}) {
  const urgency = permitUrgency(permit, cycles, stage, undefined, activeHold);
  // fix-notes-2: the "what's this waiting on?" summary. One shared tenant-wide
  // query (deduped across every ExpandedRow); an absent permit → Nothing pending.
  const cardsQ = useDashboardPermitCards();
  const dateColor =
    urgency === 'red'
      ? '#dc2626'
      : urgency === 'yellow'
        ? 'var(--color-co)'
        : 'var(--color-text)';

  return (
    <OriginLink
      to={`/project/${projectId}`}
      // ★ fix-403: the origin for Project Overview's Previous button.
      state={{ from: PREVIOUS_ORIGINS.pipeline }}
      className="grid items-start gap-2 px-3 py-2 border-b last:border-b-0 hover:bg-s2 transition no-underline"
      style={{
        gridTemplateColumns: '1fr auto',
        borderBottomColor: 'var(--color-border)',
        color: 'var(--color-text)',
      }}
      data-permit-id={permit.id}
      data-testid={`addr-group-expanded-${permit.id}`}
    >
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[11px] font-bold"
            style={{ color: STAGE_PILL_FG[stage] }}
          >
            {pillLabel(permit)}
          </span>
          {permit.num && (
            <span
              className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
              style={{
                background: 'var(--color-bg)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-de)',
              }}
            >
              {permit.num}
            </span>
          )}
          {/* fix-159: pending-portal-change chip (tooltip explains the
              guard-skipped change) right where Bobby first scans the matrix. */}
          <PendingScrapeChip extras={permit.extras} permitId={permit.id} />
        </div>
        {/* fix-notes-2: replaced the team-names + phase/stage lines with the
            "what's this waiting on?" summary — next open task(s) by owner group
            and/or the newest active note (max 2, tasks first). */}
        <PermitWaitingOn summary={cardsQ.data?.get(permit.id)} />
      </div>
      <div className="text-right flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className="text-[8px] uppercase tracking-wide text-dim">
          {keyDateLabel}
        </span>
        <span
          className="text-[11px] font-mono font-bold"
          style={{ color: dateColor }}
        >
          {keyDate ?? '—'}
        </span>
      </div>
    </OriginLink>
  );
}
