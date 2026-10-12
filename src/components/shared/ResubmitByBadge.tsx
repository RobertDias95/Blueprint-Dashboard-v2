import {
  pastLabel,
  resubmitByLabel,
  resubmitTooltip,
  type ResubmitRound,
} from '../../lib/resubmitBy';

// ★★ fix-646 (P-066): "Resubmit by Oct 22 · 3 days past" — one rendering for
// every screen that shows an open correction round. The tooltip names the basis
// ("CR1 · 14 items → 15 business days"). Red only when past.
export default function ResubmitByBadge({
  round,
  testid,
  className = '',
}: {
  round: ResubmitRound;
  testid?: string;
  className?: string;
}) {
  const past = pastLabel(round);
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap text-[10px] ${className}`}
      style={{ color: 'var(--color-text)' }}
      title={resubmitTooltip(round)}
      data-testid={testid ?? `resubmit-by-${round.permit_id}`}
    >
      <span className="font-semibold">{resubmitByLabel(round)}</span>
      {past && (
        <span
          className="font-semibold"
          style={{ color: 'var(--color-er)' }}
          data-testid={`${testid ?? `resubmit-by-${round.permit_id}`}-past`}
        >
          · {past}
        </span>
      )}
    </span>
  );
}
