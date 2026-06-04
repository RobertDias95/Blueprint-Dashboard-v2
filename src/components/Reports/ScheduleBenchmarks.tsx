import { useMemo, useState } from 'react';
import {
  computeLearnedSchedule,
  listSourcePermits,
  listTypeJurisCombos,
  type LearnedEstimate,
  type RecencyTier,
} from '../../lib/scheduleBenchmarks';
import type { PermitWithCycles, Project } from '../../lib/database.types';
import BenchmarkSourceModal from './BenchmarkSourceModal';

// Q7.2.c: per (type, juris) schedule benchmarks. One card per combo from
// listTypeJurisCombos, sorted descending by sample count. Empty-data
// combos still render (planning signal — Bobby wants to see which combos
// exist but lack a learned baseline).
//
// Q9.5.f-fix-3: visual layout switched from the 3-col table to v1's tile
// grid (index.html:5395-5500) — status dot + corner badge + 2-up headline
// tiles + cycle tiles per learned data. Clicking a card opens
// BenchmarkSourceModal listing the contributing permits.

interface Props {
  permits: PermitWithCycles[];
  projects: Project[];
}

export default function ScheduleBenchmarks({ permits, projects }: Props) {
  const projectsById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );

  const combos = useMemo(
    () => listTypeJurisCombos(permits, projectsById),
    [permits, projectsById],
  );

  const today = useMemo(() => new Date(), []);

  const cards = useMemo(
    () =>
      combos.map((combo) => ({
        ...combo,
        estimate: computeLearnedSchedule(
          permits,
          combo.type,
          combo.juris,
          projectsById,
          today,
        ),
      })),
    [combos, permits, projectsById, today],
  );

  // Q9.5.f-fix-3 4.B: state for the source modal. Holds the (type, juris)
  // pair of the clicked card; sources are derived lazily on open.
  const [modalTarget, setModalTarget] = useState<{
    type: string;
    juris: string;
  } | null>(null);

  const modalSources = useMemo(() => {
    if (!modalTarget) return [];
    return listSourcePermits(
      permits,
      modalTarget.type,
      modalTarget.juris,
      projectsById,
      today,
    );
  }, [modalTarget, permits, projectsById, today]);

  return (
    <div
      className="bg-surface border border-border rounded-lg p-4"
      data-testid="schedule-benchmarks"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wide text-muted font-display font-bold">
          Schedule Benchmarks
        </div>
        <div className="text-[10px] text-dim">
          Learned from approved permits · recent → all-time fallback · click a card to see sources
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="text-xs text-dim text-center py-6 italic">
          No (type · juris) combos in the current dataset.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {cards.map((c) => (
            <BenchmarkCard
              key={`${c.type}||${c.juris}`}
              type={c.type}
              juris={c.juris}
              count={c.count}
              estimate={c.estimate}
              onSelect={() => setModalTarget({ type: c.type, juris: c.juris })}
            />
          ))}
        </div>
      )}

      {modalTarget && (
        <BenchmarkSourceModal
          type={modalTarget.type}
          juris={modalTarget.juris}
          sources={modalSources}
          onClose={() => setModalTarget(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Card render — v1 tile layout per index.html:5395-5500
// ============================================================

// fix-112-c: the badge now reads the actual recencyTier from the learner
// (last_90d / last_180d / last_365d / all_time / default), not a hardcoded
// "↑ LAST 120D" string that never matched any real cascade tier
// (scheduleBenchmarks.ts WINDOW_TIERS_DAYS = [90, 180, 365]).
type StyleTier = 'recent' | 'all-time' | 'default';

function styleTierFor(tier: RecencyTier): StyleTier {
  if (tier === 'all_time') return 'all-time';
  if (tier === 'default') return 'default';
  return 'recent';
}

function badgeLabelFor(tier: RecencyTier): string {
  switch (tier) {
    case 'last_90d':
      return '↑ LAST 90D';
    case 'last_180d':
      return '↑ LAST 180D';
    case 'last_365d':
      return '↑ LAST 365D';
    case 'all_time':
      return '⚠ ALL-TIME';
    case 'default':
      return 'DEFAULT';
  }
}

function tierOf(estimate: LearnedEstimate | null): RecencyTier {
  if (!estimate) return 'default';
  return estimate.recencyTier;
}

const TIER_DOT: Record<StyleTier, string> = {
  recent: 'var(--color-pm)',
  'all-time': 'var(--color-co)',
  default: 'var(--color-border)',
};

interface TierBadgeStyle {
  background: string;
  color: string;
  borderColor: string;
}

const TIER_BADGE_STYLE: Record<StyleTier, TierBadgeStyle> = {
  recent: {
    background: 'rgba(16,185,129,.1)',
    color: 'var(--color-pm)',
    borderColor: 'rgba(16,185,129,.3)',
  },
  'all-time': {
    background: 'rgba(245,158,11,.1)',
    color: 'var(--color-co)',
    borderColor: 'rgba(245,158,11,.4)',
  },
  default: {
    background: 'var(--color-s2)',
    color: 'var(--color-dim)',
    borderColor: 'var(--color-border)',
  },
};

// Exported for the fix-37 component-contract test: the CROSS-JURIS badge
// still renders when isCrossJuris is true, even though no live cascade
// produces that flag anymore (fix-37 dropped the cross-juris tier).
export function BenchmarkCard({
  type,
  juris,
  count,
  estimate,
  onSelect,
}: {
  type: string;
  juris: string;
  count: number;
  estimate: LearnedEstimate | null;
  onSelect: () => void;
}) {
  const tier = tierOf(estimate);
  const styleTier = styleTierFor(tier);
  const sampleCount = estimate?.sampleCount ?? 0;
  const badgeStyle = TIER_BADGE_STYLE[styleTier];

  return (
    <div
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
      className="border border-border rounded-lg p-3 flex flex-col gap-2 cursor-pointer hover:border-de transition"
      data-testid={`benchmark-card-${type}-${juris}`}
    >
      {/* Header: status dot + type/juris + corner badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <span
            className="rounded-full flex-shrink-0"
            style={{
              width: 7,
              height: 7,
              marginTop: 5,
              background: TIER_DOT[styleTier],
            }}
          />
          <div className="min-w-0 flex flex-col">
            <span className="font-display font-bold text-text text-sm truncate">
              {type}
            </span>
            <span className="text-[10px] text-muted truncate">
              {juris} · {sampleCount > 0 ? sampleCount : count} permit
              {(sampleCount || count) === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span
            className="text-[8px] font-bold"
            style={{
              padding: '2px 7px',
              borderRadius: 4,
              background: badgeStyle.background,
              color: badgeStyle.color,
              border: `1px solid ${badgeStyle.borderColor}`,
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            }}
          >
            {badgeLabelFor(tier)}
          </span>
          {/* fix-35 Bug 4: the learner fell back to (type, *) cross-juris
              samples because this juris has no own-type approved permits.
              Surface it so Seattle's numbers aren't silently shown for
              Bellevue/Phoenix BPs. Display-only — learner logic unchanged. */}
          {estimate?.isCrossJuris && (
            <span
              className="text-[8px] font-bold"
              style={{
                padding: '2px 7px',
                borderRadius: 4,
                background: 'rgba(139,92,246,.12)',
                color: '#8b5cf6',
                border: '1px solid rgba(139,92,246,.4)',
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
              }}
              title={`Based on ${type} data from all jurisdictions — no ${juris} ${type} samples yet. Will differentiate once ${juris} accumulates approved ${type} permits.`}
              data-testid={`benchmark-card-crossjuris-${type}-${juris}`}
            >
              CROSS-JURIS
            </span>
          )}
        </div>
      </div>

      {estimate === null ? (
        <div className="text-[11px] text-dim italic py-2">
          Insufficient data — {count} permit{count === 1 ? '' : 's'} in set, none
          approved yet
        </div>
      ) : (
        <>
          {/* Headline tiles: GO → Submit + Submit → Approval */}
          <div className="grid grid-cols-2 gap-2 mt-1">
            <HeadlineTile
              label="GO → Submit"
              value={estimate.goToSubmit !== null ? `${estimate.goToSubmit}d` : '—'}
              tone="text"
            />
            <HeadlineTile
              label="Intake → Approval"
              value={
                estimate.avgIntakeToApproval !== null
                  ? `${estimate.avgIntakeToApproval}d`
                  : '—'
              }
              tone="pm"
            />
          </div>

          {/* Cycle tiles — 4 base, +2 for cycle 3 if data, +2 for cycle 4 */}
          <CycleTiles estimate={estimate} />
        </>
      )}
    </div>
  );
}

function HeadlineTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'text' | 'pm';
}) {
  return (
    <div
      style={{
        background: 'var(--color-s2)',
        borderRadius: 5,
        padding: '6px 8px',
      }}
    >
      <div
        className="font-bold uppercase tracking-wide"
        style={{ fontSize: 8, color: 'var(--color-dim)' }}
      >
        {label}
      </div>
      <div
        className="font-bold"
        style={{
          fontSize: 13,
          color: tone === 'pm' ? 'var(--color-pm)' : 'var(--color-text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function CycleTiles({ estimate }: { estimate: LearnedEstimate }) {
  const hasC3 = estimate.cr3Count > 0 || estimate.co3Count > 0;
  const hasC4 = estimate.cr4Count > 0 || estimate.co4Count > 0;
  const rows: Array<{
    index: number;
    cr: number;
    crCount: number;
    co: number;
    coCount: number;
  }> = [
    { index: 1, cr: estimate.cityReview1, crCount: estimate.cr1Count, co: estimate.corrResponse1, coCount: estimate.co1Count },
    { index: 2, cr: estimate.cityReview2, crCount: estimate.cr2Count, co: estimate.corrResponse2, coCount: estimate.co2Count },
  ];
  if (hasC3) {
    rows.push({ index: 3, cr: estimate.cityReview3, crCount: estimate.cr3Count, co: estimate.corrResponse3, coCount: estimate.co3Count });
  }
  if (hasC4) {
    rows.push({ index: 4, cr: estimate.cityReview4, crCount: estimate.cr4Count, co: estimate.corrResponse4, coCount: estimate.co4Count });
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.flatMap((r) => [
        <CycleTile
          key={`cr${r.index}`}
          label={`City Review ${r.index}`}
          value={r.cr}
          count={r.crCount}
          tone="de"
        />,
        <CycleTile
          key={`co${r.index}`}
          label={`Corr. Response ${r.index}`}
          value={r.co}
          count={r.coCount}
          tone="co"
        />,
      ])}
    </div>
  );
}

function CycleTile({
  label,
  value,
  count,
  tone,
}: {
  label: string;
  value: number;
  count: number;
  tone: 'de' | 'co';
}) {
  const isFallback = count === 0;
  const accent = tone === 'de' ? 'var(--color-de)' : 'var(--color-co)';
  const title = isFallback
    ? 'No learned data — using default'
    : `${count} permit${count === 1 ? '' : 's'} contributed`;
  return (
    <div
      title={title}
      style={{
        background: 'var(--color-s2)',
        borderRadius: 5,
        padding: '6px 8px',
      }}
    >
      <div
        className="font-bold uppercase tracking-wide"
        style={{ fontSize: 8, color: 'var(--color-dim)' }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="font-bold"
          style={{
            fontSize: 13,
            color: isFallback ? 'var(--color-dim)' : accent,
            fontStyle: isFallback ? 'italic' : 'normal',
          }}
        >
          {value}d
        </span>
        {count > 0 && (
          <span style={{ fontSize: 9, color: 'var(--color-dim)' }}>
            n={count}
          </span>
        )}
      </div>
    </div>
  );
}
