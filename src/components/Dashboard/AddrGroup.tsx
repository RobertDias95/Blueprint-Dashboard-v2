import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { effectiveStage } from '../../lib/permitStage';
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
// renders; these are the same five buckets spelled out for the tooltip and the
// screen-reader label, matching the column headings on the board.
const STAGE_FULL_LABEL: Record<Stage, string> = {
  de: 'Design & Engineering',
  pm: 'Permitting',
  co: 'Corrections',
  ap: 'Approved',
  is: 'Issued',
};

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
        <div
          className="flex items-center min-w-0"
          style={{ gap: 7, marginBottom: 6 }}
        >
          <span
            className="text-[11px] text-muted flex-shrink-0"
            style={{
              transition: 'transform 0.2s',
              transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
          >
            ▶
          </span>
          <span
            className="text-[13px] font-bold text-text truncate flex-1 min-w-0"
            style={{ lineHeight: 1.3 }}
          >
            {address}
          </span>
          {juris && (
            <span
              className="text-[9px] text-text flex-shrink-0"
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--color-s2)',
                border: '1px solid var(--color-border)',
              }}
            >
              {juris}
            </span>
          )}
          <div
            className="flex items-center flex-shrink-0"
            style={{ gap: 4 }}
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
                    className="text-[10px] font-bold flex-shrink-0"
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
                  className="text-[10px] font-bold flex-shrink-0 cursor-pointer"
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
    <Link
      to={`/project/${projectId}`}
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
    </Link>
  );
}
