import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { effectiveStage } from '../../lib/permitStage';
import { permitUrgency, type UrgencyLevel } from '../../lib/urgencyHelpers';
import type { Permit, PermitCycle, Stage } from '../../lib/database.types';

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
  /** Worst-of-group urgency for the left-border + bg tint. */
  cardUrgency: UrgencyLevel;
  keyDateLabel: string;
  getKeyDate: (p: Permit) => string | null;
  isOpen: boolean;
  isHighlighted: boolean;
  /** Toggles open state for THIS address across all buckets simultaneously. */
  onToggle: () => void;
  onHover: () => void;
  onLeave: () => void;
}

const URGENCY_BG: Record<UrgencyLevel, string> = {
  red: '#fee2e2',
  yellow: '#fef9c3',
  ok: 'var(--color-surface)',
};

const URGENCY_BORDER: Record<UrgencyLevel, string> = {
  red: '#dc2626',
  yellow: '#eab308',
  ok: 'transparent',
};

const URGENCY_HOVER_BG: Record<UrgencyLevel, string> = {
  red: '#fecaca',
  yellow: '#fef08a',
  ok: 'var(--color-s2)',
};

const STAGE_PILL_LABEL: Record<Stage, string> = {
  de: 'D&E',
  pm: 'Perm',
  co: 'Corr',
  ap: 'Appr',
  is: 'Iss',
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
  cardUrgency,
  keyDateLabel,
  getKeyDate,
  isOpen,
  isHighlighted,
  onToggle,
  onHover,
  onLeave,
}: AddrGroupProps) {
  // Per-stage badge counts across ALL permits at this address (not just
  // the bucket-filtered set), matches v1 :2791-2799.
  // Note: parent passes `permits` already filtered to this sub-bucket. The
  // counts here reflect the visible permits in this bucket only — that's
  // what v1 shows when the group lives inside one stage column.
  const stageCounts = useStageCounts(permits, cyclesByPermit);

  // Q9.5.f-fix-1d: each AddrGroup scrolls ITS containing data-scroll-bucket
  // when its own isOpen flips true. Component-local because that's the
  // only timing at which we're guaranteed the expanded body has
  // contributed to the scroll parent's scrollHeight — a parent-imperative
  // scrollAddrIntoView ran before non-active buckets had committed their
  // expanded-state render, so the offset math was being clamped to 0 by
  // the unchanged scrollHeight on those buckets. rAF defers the scroll
  // until after this AddrGroup's paint, then closest() walks up to find
  // the real scrollable parent regardless of intermediate wrappers.
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
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      data-addr={address}
      data-addr-group={address}
      data-testid={`addr-group-${stage}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        borderLeft: `3px solid ${URGENCY_BORDER[cardUrgency]}`,
        background: isHighlighted
          ? URGENCY_HOVER_BG[cardUrgency]
          : URGENCY_BG[cardUrgency],
        borderBottom: '1px solid var(--color-border)',
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
        transition: 'background 0.15s, outline-color 0.15s',
      }}
      className="overflow-hidden"
    >
      {/* Collapsed header (always shown). Q9.5.e2-fix-3: density matches
          v1 .addr-collapsed (padding 12/14), .addr-top (gap 7, mb 6),
          .addr-name (13px bold), .addr-juris (chip s2/border/4px radius),
          .addr-pcount (10px on s3, padding 2/7, radius 10), .addr-permits-row
          (gap 4, pl 16), .permit-pill (10px, padding 3/8, radius 5). */}
      <button
        type="button"
        onClick={onToggle}
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
            {stageCounts.map((c) => (
              <span
                key={c.stage}
                className="text-[10px] font-bold flex-shrink-0"
                style={{
                  padding: '2px 7px',
                  borderRadius: 10,
                  background: 'var(--color-s3, var(--color-s2))',
                  color: STAGE_PILL_FG[c.stage],
                  border: '1px solid var(--color-border)',
                }}
              >
                {STAGE_PILL_LABEL[c.stage]} {c.count}
              </span>
            ))}
          </div>
        </div>
        {/* Permit-type pill row */}
        <div
          className="flex items-center flex-wrap"
          style={{ gap: 4, paddingLeft: 16 }}
        >
          {permits.map((p) => {
            const u = permitUrgency(
              p,
              cyclesByPermit.get(p.id) ?? [],
              stage,
            );
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
      </button>

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
): { stage: Stage; count: number }[] {
  const counts = new Map<Stage, number>();
  for (const p of permits) {
    const s = effectiveStage(p, cyclesByPermit.get(p.id) ?? []);
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
}: {
  permit: Permit;
  projectId: string;
  stage: Stage;
  cycles: PermitCycle[];
  keyDate: string | null;
  keyDateLabel: string;
}) {
  const urgency = permitUrgency(permit, cycles, stage);
  const team = [permit.ent_lead, permit.da, permit.dual_da, permit.dm]
    .filter(Boolean)
    .join(' · ');
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
        </div>
        {team && (
          <span className="text-[10px] text-muted truncate">{team}</span>
        )}
        {permit.status && (
          <span className="text-[10px] text-dim truncate">{permit.status}</span>
        )}
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
